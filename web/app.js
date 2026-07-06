const $ = (sel) => document.querySelector(sel);

async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

function show(view) {
  $('#login-view').hidden = view !== 'login';
  $('#home-view').hidden = view !== 'home';
}

async function refresh() {
  const { status, body } = await api('/api/me');
  if (status !== 200) { show('login'); return; }
  show('home');
  $('#welcome').textContent = `Ciao ${body.user.username} (${body.user.role})`;
  const isAdmin = body.user.role === 'admin';
  $('#admin-panel').hidden = !isAdmin;
  if (isAdmin) loadUsers();
}

async function loadUsers() {
  const { body } = await api('/api/admin/users');
  $('#user-list').innerHTML = (body.users || [])
    .map((u) => `<li>${u.username} — ${u.role} ${u.attivo ? '' : '(disattivato)'}</li>`)
    .join('');
}

$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  const { status } = await api('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username: f.username.value, password: f.password.value }),
  });
  if (status === 200) { f.reset(); refresh(); }
  else $('#login-error').textContent = 'Credenziali non valide';
});

$('#logout-btn').addEventListener('click', async () => {
  await api('/api/auth/logout', { method: 'POST' });
  show('login');
});

$('#new-user-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  const { status } = await api('/api/admin/users', {
    method: 'POST',
    body: JSON.stringify({ username: f.username.value, password: f.password.value, role: f.role.value }),
  });
  if (status === 201) { f.reset(); loadUsers(); }
});

refresh();
