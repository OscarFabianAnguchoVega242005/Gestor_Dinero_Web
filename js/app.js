// js/app.js

const DAYS = ['Lunes','Martes','Miércoles','Jueves','Viernes','Sábado','Domingo'];

let currentUser       = null;
let userProfile       = {};
let transactions      = [];
let savingGoals       = [];
let recurringExpenses = [];
let selectedKey       = '';
let currentType       = 'expense';
let pendingAction     = null;

// ── Inicialización ────────────────────────────────────────

async function init() {
  try {
    const { data: { session } } = await _supabase.auth.getSession();
    if (!session) { window.location.href = 'auth.html'; return; }

    currentUser = session.user;
    userProfile = {
      full_name:  currentUser.user_metadata?.full_name || currentUser.email,
      pay_period: currentUser.user_metadata?.pay_period || 'weekly',
    };

    document.getElementById('user-name').textContent = userProfile.full_name;
    renderPeriodBadge();

    await Promise.all([
      loadTransactions(),
      loadSavingGoals(),
      loadRecurring(),
    ]);

    selectedKey = getCurrentPeriodKey();

    try { await applyRecurring(); } catch(e) { console.warn('applyRecurring:', e); }

    buildPeriodSelector();
    buildSavingGoalSelect();
    renderAll();
    setDefaultDay();
    renderRecurringList();

  } catch(err) {
    console.error('init error:', err);
  }
}

async function handleLogout() {
  await _supabase.auth.signOut();
  window.location.href = 'auth.html';
}

// ── Períodos ──────────────────────────────────────────────

function getPeriodType() { return userProfile.pay_period || 'weekly'; }

function getPeriodKey(date, type) {
  const d = new Date(date);
  if (type === 'weekly') {
    const wd   = d.getDay();
    const diff = d.getDate() - wd + (wd === 0 ? -6 : 1);
    const mon  = new Date(d); mon.setDate(diff);
    return mon.toISOString().split('T')[0];
  }
  if (type === 'biweekly') {
    const y    = d.getFullYear();
    const m    = String(d.getMonth() + 1).padStart(2, '0');
    const half = d.getDate() <= 15 ? '01' : '16';
    return `${y}-${m}-${half}`;
  }
  if (type === 'monthly') {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    return `${y}-${m}-01`;
  }
  return d.toISOString().split('T')[0];
}

function getCurrentPeriodKey() { return getPeriodKey(new Date(), getPeriodType()); }

function periodLabel(key, type) {
  const current = getCurrentPeriodKey();
  if (type === 'weekly')   return key === current ? 'Esta semana ✦' : `Semana del ${key}`;
  if (type === 'biweekly') {
    const [y, m, d] = key.split('-');
    const half = d === '01' ? '1ra quincena' : '2da quincena';
    return key === current ? `${half} (actual) ✦` : `${half} ${m}/${y}`;
  }
  if (type === 'monthly') {
    const months = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
    const [y, m] = key.split('-');
    const label  = `${months[parseInt(m)-1]} ${y}`;
    return key === current ? `${label} ✦` : label;
  }
  return key;
}

function buildPeriodSelector() {
  const type    = getPeriodType();
  const allKeys = [...new Set(transactions.map(t => t.period_key))].sort().reverse();
  const current = getCurrentPeriodKey();
  if (!allKeys.includes(current)) allKeys.unshift(current);

  const sel = document.getElementById('period-select');
  sel.innerHTML = allKeys.map(k =>
    `<option value="${k}">${periodLabel(k, type)}</option>`
  ).join('');
  sel.value = selectedKey;

  const labelMap = { weekly:'Semana:', biweekly:'Quincena:', monthly:'Mes:' };
  document.getElementById('period-label').textContent = labelMap[type] || 'Período:';
}

function onPeriodChange() {
  selectedKey = document.getElementById('period-select').value;
  renderAll();
}

// ── Cargar datos ──────────────────────────────────────────

async function loadTransactions() {
  const { data, error } = await _supabase
    .from('transactions')
    .select('*')
    .eq('user_id', currentUser.id)
    .order('created_at', { ascending: false });
  if (error) { console.error('loadTransactions:', error); return; }
  transactions = data || [];
}

async function loadSavingGoals() {
  const { data, error } = await _supabase
    .from('saving_goals')
    .select('*')
    .eq('user_id', currentUser.id)
    .order('created_at', { ascending: true });
  if (error) { console.error('loadSavingGoals:', error); return; }
  savingGoals = data || [];
}

async function loadRecurring() {
  const { data, error } = await _supabase
    .from('recurring_expenses')
    .select('*')
    .eq('user_id', currentUser.id)
    .order('created_at', { ascending: true });
  if (error) { console.error('loadRecurring:', error); return; }
  recurringExpenses = data || [];
}

function periodTxns(key) {
  return transactions.filter(t => t.period_key === key);
}

// ── Formateo ──────────────────────────────────────────────

function formatCOP(n) {
  const abs = Math.abs(n);
  if (abs >= 1000000) return `$${(abs/1000000).toFixed(1)}M`;
  if (abs >= 1000)    return '$' + abs.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return '$' + abs;
}

function todayDayIndex() {
  const wd = new Date().getDay();
  return wd === 0 ? 6 : wd - 1;
}

function showToast(msg, color) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.style.color = color || 'var(--textP)';
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2500);
}

// ── Render principal ──────────────────────────────────────

function renderAll() {
  const txns    = periodTxns(selectedKey);
  const income  = txns.filter(t => t.type === 'income') .reduce((s,t) => s + t.amount, 0);
  const expense = txns.filter(t => t.type === 'expense').reduce((s,t) => s + t.amount, 0);
  const saved   = txns.filter(t => t.type === 'saving') .reduce((s,t) => s + t.amount, 0);
  const balance = income - expense - saved;
  const spendPct = income === 0 ? 0 : Math.min(100, Math.round(((expense + saved) / income) * 100));

  const balEl = document.getElementById('balance-amount');
  balEl.textContent = (balance < 0 ? '-' : '') + formatCOP(balance);
  balEl.className   = `balance-amount ${balance >= 0 ? 'positive' : 'negative'}`;

  document.getElementById('stat-income').textContent   = formatCOP(income);
  document.getElementById('stat-expenses').textContent = formatCOP(expense);
  document.getElementById('stat-saved').textContent    = formatCOP(saved);
  document.getElementById('stat-pct').textContent      = spendPct + '%';

  const pw = document.getElementById('progress-wrap');
  if (income > 0) {
    pw.style.display = 'block';
    const fill = document.getElementById('progress-fill');
    fill.style.width      = spendPct + '%';
    fill.style.background = spendPct > 80
      ? 'linear-gradient(90deg,#f87171,#ef4444)'
      : 'linear-gradient(90deg,#7c5cbf,#a855f7)';
    document.getElementById('progress-label').textContent = `Usado: ${spendPct}% del ingreso`;
  } else {
    pw.style.display = 'none';
  }

  renderDayBars(txns);
  renderCategories(txns, expense);
  renderTxList(txns);
  renderSavings();
  renderHistory();
}

function renderDayBars(txns) {
  const map = {};
  DAYS.forEach(d => map[d] = 0);
  txns.filter(t => t.type === 'expense').forEach(t => {
    map[t.week_day] = (map[t.week_day] || 0) + t.amount;
  });

  const maxVal    = Math.max(...Object.values(map), 1);
  const isCurrent = selectedKey === getCurrentPeriodKey();
  const todayIdx  = todayDayIndex();
  const MAX_H     = 36;

  document.getElementById('day-bars').innerHTML = DAYS.map((d, i) => {
    const val     = map[d];
    const barH    = val === 0 ? 3 : Math.max(6, (val / maxVal) * MAX_H);
    const isToday = isCurrent && i === todayIdx;
    const cls     = isToday ? 'today' : val > 0 ? 'has-value' : '';
    return `
      <div class="day-col">
        <div class="day-amount" style="color:${isToday ? 'var(--purpleP)' : 'var(--textM)'}">${val > 0 ? formatCOP(val) : ''}</div>
        <div class="day-bar ${cls}" style="height:${barH}px"></div>
        <div class="day-name ${isToday ? 'today' : ''}">${d.substring(0, 2)}</div>
      </div>`;
  }).join('');
}

function renderCategories(txns, totalExpense) {
  const map = {};
  txns.filter(t => t.type === 'expense').forEach(t => {
    map[t.category] = (map[t.category] || 0) + t.amount;
  });
  const entries = Object.entries(map).sort((a, b) => b[1] - a[1]);
  const card    = document.getElementById('cat-card');
  if (!entries.length) { card.style.display = 'none'; return; }
  card.style.display = 'block';
  document.getElementById('cat-list').innerHTML = entries.map(([cat, amt]) => {
    const pct = totalExpense === 0 ? 0 : Math.round((amt / totalExpense) * 100);
    return `
      <div class="cat-row">
        <div class="cat-row-top"><span class="cat-name">${cat}</span><span class="cat-amt">${formatCOP(amt)}</span></div>
        <div class="cat-fill"><div class="cat-inner" style="width:${pct}%"></div></div>
      </div>`;
  }).join('');
}

function renderTxList(txns) {
  if (!txns.length) {
    document.getElementById('tx-list').innerHTML = '<div class="empty-state">Sin movimientos en este período</div>';
    return;
  }
  document.getElementById('tx-list').innerHTML = txns.map(t => {
    const isIncome = t.type === 'income';
    const isSaving = t.type === 'saving';
    const cls      = isIncome ? 'income' : isSaving ? 'saving' : 'expense';
    const sign     = isIncome ? '+' : '-';
    const emoji    = t.category.split(' ')[0];
    const goalName = isSaving && t.goal_id
      ? (savingGoals.find(g => g.id === t.goal_id)?.name || '') : '';
    const meta = goalName
      ? `${t.week_day} · ${goalName}`
      : `${t.week_day} · ${t.category.split(' ').slice(1).join(' ')}`;
    const recTag = t.recurring_id
      ? ' <span style="font-size:9px;color:var(--orange);font-weight:600">🔄</span>' : '';
    return `
      <div class="tx-item">
        <div class="tx-icon ${cls}">${emoji}</div>
        <div class="tx-info">
          <div class="tx-desc">${t.description}${recTag}</div>
          <div class="tx-meta">${meta}</div>
        </div>
        <div class="tx-right">
          <span class="tx-amount ${cls}">${sign}${formatCOP(t.amount)}</span>
          <button class="btn-del" onclick="confirmDelete('${t.id}','${t.description.replace(/'/g,"\\'")}')">✕</button>
        </div>
      </div>`;
  }).join('');
}

// ── Ahorros ───────────────────────────────────────────────

function renderSavings() {
  const totals = {};
  savingGoals.forEach(g => totals[g.id] = 0);
  transactions.filter(t => t.type === 'saving').forEach(t => {
    if (t.goal_id && totals[t.goal_id] !== undefined) totals[t.goal_id] += t.amount;
  });

  const grandTotal = Object.values(totals).reduce((s, v) => s + v, 0)
    + transactions.filter(t => t.type === 'saving' && !t.goal_id).reduce((s, t) => s + t.amount, 0);

  document.getElementById('savings-grand-total').textContent = formatCOP(grandTotal);
  document.getElementById('savings-goals-count').textContent =
    `${savingGoals.length} meta${savingGoals.length !== 1 ? 's' : ''} de ahorro`;

  if (!savingGoals.length) {
    document.getElementById('savings-grid').innerHTML =
      `<div style="grid-column:1/-1"><div class="empty-state">Aún no tienes metas de ahorro.<br>¡Crea una abajo!</div></div>`;
  } else {
    document.getElementById('savings-grid').innerHTML = savingGoals.map(g => {
      const total = totals[g.id] || 0;
      const count = transactions.filter(t => t.type === 'saving' && t.goal_id === g.id).length;
      return `
        <div class="saving-card">
          <button class="saving-card-del" onclick="confirmDeleteGoal('${g.id}','${g.name.replace(/'/g,"\\'")}')">✕</button>
          <div class="saving-card-name">${g.name}</div>
          <div class="saving-card-amount">${formatCOP(total)}</div>
          <div class="saving-card-count">${count} depósito${count !== 1 ? 's' : ''}</div>
        </div>`;
    }).join('');
  }

  const savingTxns = transactions.filter(t => t.type === 'saving').slice(0, 20);
  if (!savingTxns.length) {
    document.getElementById('saving-tx-list').innerHTML = '<div class="empty-state">Sin depósitos aún</div>';
  } else {
    document.getElementById('saving-tx-list').innerHTML = savingTxns.map(t => {
      const goalName = t.goal_id
        ? (savingGoals.find(g => g.id === t.goal_id)?.name || 'Sin meta') : 'Sin asignar';
      return `
        <div class="tx-item">
          <div class="tx-icon saving">🏦</div>
          <div class="tx-info">
            <div class="tx-desc">${t.description}</div>
            <div class="tx-meta">${goalName} · ${t.week_day}</div>
          </div>
          <div class="tx-right">
            <span class="tx-amount saving">-${formatCOP(t.amount)}</span>
            <button class="btn-del" onclick="confirmDelete('${t.id}','${t.description.replace(/'/g,"\\'")}')">✕</button>
          </div>
        </div>`;
    }).join('');
  }
}

function buildSavingGoalSelect() {
  const sel = document.getElementById('add-saving-goal');
  sel.innerHTML = '<option value="">— Sin asignar —</option>'
    + savingGoals.map(g => `<option value="${g.id}">${g.name}</option>`).join('');
}

function openNewGoalModal() {
  document.getElementById('goal-name').value = '';
  openModal('modal-new-goal');
}

async function handleNewGoal() {
  const name = document.getElementById('goal-name').value.trim();
  if (!name) return showToast('Ingresa un nombre', 'var(--red)');
  closeModal('modal-new-goal');
  const { data, error } = await _supabase.from('saving_goals').insert([{
    user_id: currentUser.id, name
  }]).select().single();
  if (error) { showToast('Error al crear', 'var(--red)'); return; }
  savingGoals.push(data);
  buildSavingGoalSelect();
  renderSavings();
  showToast('✅ Meta creada', 'var(--blue)');
}

function confirmDeleteGoal(id, name) {
  document.getElementById('modal-title').textContent = 'Eliminar meta';
  document.getElementById('modal-msg').textContent   = `¿Borrar "${name}" y todos sus depósitos?`;
  document.getElementById('modal-ok').onclick = async () => {
    closeModal('modal-confirm');
    await _supabase.from('transactions').delete().eq('goal_id', id);
    await _supabase.from('saving_goals').delete().eq('id', id);
    savingGoals  = savingGoals.filter(g => g.id !== id);
    transactions = transactions.filter(t => t.goal_id !== id);
    buildSavingGoalSelect();
    renderAll();
    showToast('🗑️ Meta eliminada');
  };
  openModal('modal-confirm');
}

// ── Agregar sueldo ────────────────────────────────────────

function openSalaryModal() {
  document.getElementById('salary-amount').value = '';
  document.getElementById('salary-desc').value   = '';
  openModal('modal-salary');
}

async function handleSalary() {
  const amount = parseInt(document.getElementById('salary-amount').value);
  const desc   = document.getElementById('salary-desc').value.trim() || 'Sueldo';
  if (isNaN(amount) || amount <= 0) return showToast('Ingresa una cantidad válida', 'var(--red)');
  closeModal('modal-salary');
  const { data, error } = await _supabase.from('transactions').insert([{
    user_id:      currentUser.id,
    type:         'income',
    amount,
    description:  desc,
    category:     '💵 Sueldo',
    week_day:     DAYS[todayDayIndex()],
    period_key:   getCurrentPeriodKey(),
    goal_id:      null,
    recurring_id: null,
  }]).select().single();
  if (error) { showToast('Error al guardar', 'var(--red)'); return; }
  transactions.unshift(data);
  selectedKey = getCurrentPeriodKey();
  buildPeriodSelector();
  renderAll();
  showToast('✅ Sueldo registrado', 'var(--green)');
}

// ── Agregar transacción manual ────────────────────────────

function setType(type) {
  if (type === 'recurring') { switchView('recurring'); return; }
  currentType = type;
  ['expense','income','saving','recurring'].forEach(t => {
    document.getElementById(`type-${t}`)?.classList.toggle('active', t === type);
  });
  document.getElementById('cat-group').style.display    = type === 'expense' ? 'block' : 'none';
  document.getElementById('saving-group').style.display = type === 'saving'  ? 'block' : 'none';
  document.getElementById('day-group').style.display    = 'block';
  const btn = document.getElementById('btn-submit');
  btn.className   = `btn-submit ${type}`;
  btn.textContent = { expense:'Registrar gasto', income:'Registrar ingreso', saving:'Registrar ahorro' }[type];
}

function setDefaultDay() {
  document.getElementById('add-day').value = DAYS[todayDayIndex()];
}

async function handleAdd() {
  const amountRaw = document.getElementById('add-amount').value.trim();
  const desc      = document.getElementById('add-desc').value.trim();
  const weekDay   = document.getElementById('add-day').value;
  const amount    = parseInt(amountRaw);

  if (!amountRaw || isNaN(amount) || amount <= 0)
    return showToast('Ingresa un monto válido', 'var(--red)');

  let category = '💸 Otro';
  let goalId   = null;
  if (currentType === 'expense')      category = document.getElementById('add-category').value;
  else if (currentType === 'income')  category = '💰 Ingreso';
  else if (currentType === 'saving') {
    category = '🏦 Ahorro';
    goalId   = document.getElementById('add-saving-goal').value || null;
  }

  const btn = document.getElementById('btn-submit');
  btn.innerHTML = '<span class="spinner"></span>';
  btn.disabled  = true;

  const { data, error } = await _supabase.from('transactions').insert([{
    user_id:      currentUser.id,
    type:         currentType,
    amount,
    description:  desc || { expense:'Gasto', income:'Ingreso', saving:'Ahorro' }[currentType],
    category,
    week_day:     weekDay,
    period_key:   getCurrentPeriodKey(),
    goal_id:      goalId,
    recurring_id: null,
  }]).select().single();

  btn.disabled = false;
  setType(currentType);

  if (error) { showToast('Error al guardar', 'var(--red)'); return; }

  transactions.unshift(data);
  document.getElementById('add-amount').value = '';
  document.getElementById('add-desc').value   = '';
  selectedKey = getCurrentPeriodKey();
  buildPeriodSelector();
  buildSavingGoalSelect();
  renderAll();
  showToast(
    currentType === 'expense' ? '✅ Gasto registrado'   :
    currentType === 'income'  ? '✅ Ingreso registrado' : '✅ Ahorro registrado',
    currentType === 'saving'  ? 'var(--blue)'  :
    currentType === 'income'  ? 'var(--green)' : 'var(--textP)'
  );
  switchView('home');
}

// ── Gastos recurrentes ────────────────────────────────────

function onRecFreqChange() {
  const freq = document.getElementById('rec-frequency').value;
  document.getElementById('rec-days-group').style.display = freq === 'daily' ? 'block' : 'none';
}

async function handleAddRecurring() {
  const name     = document.getElementById('rec-name').value.trim();
  const amount   = parseInt(document.getElementById('rec-amount').value);
  const category = document.getElementById('rec-category').value;
  const freq     = document.getElementById('rec-frequency').value;

  if (!name)                        return showToast('Ingresa un nombre', 'var(--red)');
  if (isNaN(amount) || amount <= 0) return showToast('Ingresa un monto válido', 'var(--red)');

  let activeDays = DAYS.slice();
  if (freq === 'daily') {
    activeDays = Array.from(
      document.querySelectorAll('#rec-days-group input[type=checkbox]:checked')
    ).map(cb => cb.value);
    if (!activeDays.length) return showToast('Selecciona al menos un día', 'var(--red)');
  }

  const { data, error } = await _supabase.from('recurring_expenses').insert([{
    user_id:             currentUser.id,
    name,
    amount,
    category,
    frequency:           freq,
    active_days:         activeDays,
    last_applied_period: null,
  }]).select().single();

  if (error) { showToast('Error: ' + error.message, 'var(--red)'); return; }

  recurringExpenses.push(data);
  document.getElementById('rec-name').value   = '';
  document.getElementById('rec-amount').value = '';
  document.querySelectorAll('#rec-days-group input[type=checkbox]').forEach((cb, i) => {
    cb.checked = i < 5;
  });

  try { await applyRecurring(); } catch(e) { console.warn(e); }
  buildPeriodSelector();
  renderAll();
  renderRecurringList();
  showToast('✅ Gasto recurrente agregado', 'var(--orange)');
}

async function applyRecurring() {
  if (!recurringExpenses.length) return;
  const currentKey = getCurrentPeriodKey();
  const toInsert   = [];

  for (const rec of recurringExpenses) {
    if (rec.last_applied_period === currentKey) continue;
    const days = rec.frequency === 'daily'
      ? (Array.isArray(rec.active_days) ? rec.active_days : DAYS)
      : ['Lunes'];

    for (const day of days) {
      const exists = transactions.some(
        t => t.recurring_id === rec.id && t.period_key === currentKey && t.week_day === day
      );
      if (!exists) {
        toInsert.push({
          user_id:      currentUser.id,
          type:         'expense',
          amount:       rec.amount,
          description:  rec.name,
          category:     rec.category,
          week_day:     day,
          period_key:   currentKey,
          goal_id:      null,
          recurring_id: rec.id,
        });
      }
    }
  }

  if (toInsert.length) {
    const { data, error } = await _supabase.from('transactions').insert(toInsert).select();
    if (error) { console.error('applyRecurring insert:', error); return; }
    transactions.unshift(...(data || []));
  }

  const toMark = recurringExpenses.filter(r => r.last_applied_period !== currentKey);
  if (toMark.length) {
    await _supabase.from('recurring_expenses')
      .update({ last_applied_period: currentKey })
      .in('id', toMark.map(r => r.id));
    toMark.forEach(r => { r.last_applied_period = currentKey; });
  }
}

async function deleteRecurring(id, name) {
  document.getElementById('modal-title').textContent = 'Eliminar gasto recurrente';
  document.getElementById('modal-msg').textContent   =
    `¿Eliminar "${name}" de la lista? Los gastos ya generados permanecen en el historial.`;
  document.getElementById('modal-ok').onclick = async () => {
    closeModal('modal-confirm');
    await _supabase.from('recurring_expenses').delete().eq('id', id);
    recurringExpenses = recurringExpenses.filter(r => r.id !== id);
    renderRecurringList();
    showToast('🗑️ Eliminado de la lista');
  };
  openModal('modal-confirm');
}

function renderRecurringList() {
  const container = document.getElementById('rec-list');
  if (!container) return;
  if (!recurringExpenses.length) {
    container.innerHTML = '<div class="empty-state">Sin gastos recurrentes aún</div>';
    return;
  }
  const periodName = { weekly:'semana', biweekly:'quincena', monthly:'mes' }[getPeriodType()] || 'período';
  container.innerHTML = recurringExpenses.map(r => {
    const emoji    = r.category.split(' ')[0];
    const catLabel = r.category.split(' ').slice(1).join(' ');
    const freqLabel = r.frequency === 'daily' ? 'Diario' : `Cada ${periodName}`;
    const days = r.frequency === 'daily'
      ? (Array.isArray(r.active_days) ? r.active_days : [])
          .map(d => `<span class="rec-day-pill">${d.substring(0,2)}</span>`).join('')
      : `<span class="rec-day-pill">1× por ${periodName}</span>`;
    return `
      <div class="rec-item">
        <div class="rec-icon">${emoji}</div>
        <div class="rec-info">
          <div class="rec-name">${r.name}</div>
          <div class="rec-meta">${catLabel} · ${freqLabel}</div>
          <div class="rec-days">${days}</div>
        </div>
        <div class="rec-right">
          <span class="rec-amount">-${formatCOP(r.amount)}</span>
          <button class="btn-del" onclick="deleteRecurring('${r.id}','${r.name.replace(/'/g,"\\'")}')">✕</button>
        </div>
      </div>`;
  }).join('');
}

// ── Eliminar transacción ──────────────────────────────────

function confirmDelete(id, desc) {
  document.getElementById('modal-title').textContent = 'Eliminar movimiento';
  document.getElementById('modal-msg').textContent   = `¿Seguro que quieres borrar "${desc}"?`;
  document.getElementById('modal-ok').onclick = async () => {
    closeModal('modal-confirm');
    const { error } = await _supabase.from('transactions').delete().eq('id', id);
    if (error) { showToast('Error al eliminar', 'var(--red)'); return; }
    transactions = transactions.filter(t => t.id !== id);
    buildPeriodSelector();
    renderAll();
    showToast('🗑️ Eliminado');
  };
  openModal('modal-confirm');
}

// ── Borrar todo ───────────────────────────────────────────

function confirmClearAll() {
  document.getElementById('modal-title').textContent = 'Borrar todos los datos';
  document.getElementById('modal-msg').textContent   =
    '¿Seguro? Se perderá TODO tu historial, ahorros y lista de recurrentes.';
  document.getElementById('modal-ok').onclick = async () => {
    closeModal('modal-confirm');
    await _supabase.from('transactions').delete().eq('user_id', currentUser.id);
    await _supabase.from('saving_goals').delete().eq('user_id', currentUser.id);
    await _supabase.from('recurring_expenses').delete().eq('user_id', currentUser.id);
    transactions = []; savingGoals = []; recurringExpenses = [];
    selectedKey  = getCurrentPeriodKey();
    buildPeriodSelector();
    buildSavingGoalSelect();
    renderAll();
    renderRecurringList();
    showToast('🗑️ Datos eliminados');
  };
  openModal('modal-confirm');
}

// ── Historial ─────────────────────────────────────────────

function renderHistory() {
  const type    = getPeriodType();
  const allKeys = [...new Set(transactions.map(t => t.period_key))].sort().reverse();
  const titleMap = {
    weekly:'📊 Historial semanal',
    biweekly:'📊 Historial quincenal',
    monthly:'📊 Historial mensual'
  };
  document.getElementById('history-title').textContent = titleMap[type] || '📊 Historial';

  if (!allKeys.length) {
    document.getElementById('history-list').innerHTML = '<div class="empty-state">Sin datos aún</div>';
    return;
  }
  document.getElementById('history-list').innerHTML = allKeys.slice(0, 8).map(k => {
    const txns   = periodTxns(k);
    const income = txns.filter(t => t.type === 'income') .reduce((s,t) => s + t.amount, 0);
    const exp    = txns.filter(t => t.type === 'expense').reduce((s,t) => s + t.amount, 0);
    const saved  = txns.filter(t => t.type === 'saving') .reduce((s,t) => s + t.amount, 0);
    const bal    = income - exp - saved;
    const cls    = bal >= 0 ? 'positive' : 'negative';
    return `
      <div class="history-item">
        <div>
          <div style="font-size:13px;font-weight:500">${periodLabel(k, type)}</div>
          <div style="font-size:10px;color:var(--textM)">${txns.length} movimientos · Gastos: ${formatCOP(exp)}</div>
        </div>
        <span class="badge ${cls}">${bal < 0 ? '-' : ''}${formatCOP(bal)}</span>
      </div>`;
  }).join('');
}

// ── Configuración ─────────────────────────────────────────

function renderPeriodBadge() {
  const labels = { weekly:'Semanal', biweekly:'Quincenal', monthly:'Mensual' };
  const badge  = document.getElementById('period-badge');
  if (badge) badge.textContent = labels[userProfile.pay_period] || userProfile.pay_period;
}

// ── Navegación ────────────────────────────────────────────

function switchView(name) {
  ['home','add','recurring','savings','settings'].forEach(v => {
    document.getElementById(`view-${v}`)?.classList.toggle('active', v === name);
    document.getElementById(`nav-${v}`)?.classList.toggle('active',  v === name);
  });
  if (name === 'home' || name === 'savings') renderAll();
  if (name === 'recurring')                  renderRecurringList();
}

// ── Modales ───────────────────────────────────────────────

function openModal(id)  { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }

document.addEventListener('click', e => {
  if (e.target.classList.contains('modal-overlay')) e.target.classList.remove('open');
});

// ── Arranque ──────────────────────────────────────────────
init();