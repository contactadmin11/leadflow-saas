/**
 * LeadFlow Auth Module
 * Handles login/register UI and state for the SaaS app.
 */

async function doLoginSaaS() {
  const email = document.getElementById('loginUser')?.value?.trim();
  const pass  = document.getElementById('loginPass')?.value?.trim();
  if (!email || !pass) { showLoginError('Enter email and password'); return; }

  try {
    showLoginLoading(true);
    const data = await API.login(email, pass);
    document.getElementById('loginErr').style.display = 'none';
    currentUser = data.user.name || data.user.email;
    document.getElementById('loginScreen').style.display = 'none';
    document.getElementById('appContainer').style.display = 'block';
    document.getElementById('topbarAvatar').textContent = currentUser[0].toUpperCase();
    init();
    toast('Welcome back, ' + currentUser + '! 🎯', 'success');
  } catch (err) {
    showLoginError(err.message || 'Login failed');
  } finally {
    showLoginLoading(false);
  }
}

async function doRegisterSaaS() {
  const name  = document.getElementById('regName')?.value?.trim();
  const email = document.getElementById('regEmail')?.value?.trim();
  const pass  = document.getElementById('regPass')?.value?.trim();
  if (!name || !email || !pass) { showLoginError('All fields required'); return; }
  if (pass.length < 8) { showLoginError('Password must be at least 8 characters'); return; }

  try {
    showLoginLoading(true);
    const data = await API.register(email, pass, name);
    currentUser = data.user.name;
    document.getElementById('loginScreen').style.display = 'none';
    document.getElementById('appContainer').style.display = 'block';
    document.getElementById('topbarAvatar').textContent = currentUser[0].toUpperCase();
    init();
    toast('Account created! Welcome, ' + currentUser + '! 🎉', 'success');
  } catch (err) {
    showLoginError(err.message || 'Registration failed');
  } finally {
    showLoginLoading(false);
  }
}

async function doLogout() {
  if (!confirm('Log out?')) return;
  await API.logout();
  location.reload();
}

function showLoginError(msg) {
  const el = document.getElementById('loginErr');
  if (el) { el.textContent = msg; el.style.display = 'block'; }
}

function showLoginLoading(on) {
  const btn = document.getElementById('loginBtn');
  if (btn) btn.disabled = on;
}

// Auto-login if tokens exist
if (API.isLoggedIn()) {
  const user = API.getUser();
  currentUser = user?.name || user?.email || 'User';
  if (typeof init === 'function') {
    document.getElementById('loginScreen').style.display = 'none';
    document.getElementById('appContainer').style.display = 'block';
    document.getElementById('topbarAvatar').textContent = currentUser[0].toUpperCase();
    init();
  }
}

document.addEventListener('keydown', e => {
  if (e.key === 'Enter' && document.getElementById('loginScreen')?.style.display !== 'none') {
    doLoginSaaS();
  }
});
