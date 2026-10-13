// js/auth.js

(async () => {
  const { data: { session } } = await _supabase.auth.getSession();
  if (session) window.location.href = 'index.html';
})();

function switchTab(tab) {
  document.getElementById('form-login').style.display    = tab === 'login'    ? 'block' : 'none';
  document.getElementById('form-register').style.display = tab === 'register' ? 'block' : 'none';
  document.querySelectorAll('.tab').forEach((t, i) => {
    t.classList.toggle('active', (i === 0 && tab === 'login') || (i === 1 && tab === 'register'));
  });
  clearMsg();
}

function showMsg(text, type) {
  const el = document.getElementById('msg');
  el.textContent = text;
  el.className = `msg ${type}`;
}

function clearMsg() {
  const el = document.getElementById('msg');
  el.className = 'msg';
  el.textContent = '';
}

function setLoading(btnId, loading) {
  const btn = document.getElementById(btnId);
  btn.disabled = loading;
  btn.innerHTML = loading
    ? '<span class="spinner"></span> Cargando...'
    : btnId === 'btn-login' ? 'Entrar' : 'Crear cuenta';
}

async function handleLogin() {
  const email = document.getElementById('login-email').value.trim();
  const pass  = document.getElementById('login-pass').value;
  if (!email || !pass) return showMsg('Completa todos los campos', 'error');
  setLoading('btn-login', true); clearMsg();
  const { error } = await _supabase.auth.signInWithPassword({ email, password: pass });
  if (error) { showMsg('Correo o contraseña incorrectos', 'error'); setLoading('btn-login', false); }
  else window.location.href = 'index.html';
}

async function handleRegister() {
  const name   = document.getElementById('reg-name').value.trim();
  const email  = document.getElementById('reg-email').value.trim();
  const pass   = document.getElementById('reg-pass').value;
  const period = document.getElementById('reg-period').value;
  if (!name || !email || !pass) return showMsg('Completa todos los campos', 'error');
  if (pass.length < 6) return showMsg('La contraseña debe tener mínimo 6 caracteres', 'error');
  setLoading('btn-register', true); clearMsg();
  const { error } = await _supabase.auth.signUp({
    email, password: pass,
    options: { data: { full_name: name, pay_period: period } }
  });
  if (error) { showMsg(error.message || 'Error al registrarse', 'error'); setLoading('btn-register', false); }
  else { showMsg('¡Cuenta creada! Revisa tu correo para confirmar.', 'success'); setLoading('btn-register', false); }
}

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  const loginVisible = document.getElementById('form-login').style.display !== 'none';
  if (loginVisible) handleLogin(); else handleRegister();
});