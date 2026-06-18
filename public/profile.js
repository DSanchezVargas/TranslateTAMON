const user = JSON.parse(localStorage.getItem('tamon_user') || 'null');
const token = localStorage.getItem('tamon_token');

function authHeaders(extra = {}) {
  const headers = { ...extra };
  if (token) headers.Authorization = 'Bearer ' + token;
  return headers;
}

function requireSession() {
  if (!user) {
    alert('Debes iniciar sesión para ver tu perfil.');
    window.location.href = '/';
    return false;
  }
  return true;
}

async function loadProfile() {
  if (!requireSession()) return;
  const response = await fetch('/api/user/profile', { headers: authHeaders() });
  const data = await response.json();
  if (!response.ok) {
    alert(data.error || 'No se pudo cargar el perfil.');
    return;
  }

  document.getElementById('profile-name').value = data.nombre || '';
  document.getElementById('profile-email').value = data.correo || '';
  document.getElementById('profile-plan').textContent = `Plan actual: ${data.planInfo.name} · $${data.planInfo.monthlyPriceUsd}/mes`;
  document.getElementById('profile-quota').textContent = data.quota.unlimited
    ? `Cuota: ilimitada (usados hoy: ${data.quota.used})`
    : `Cuota: ${data.quota.used}/${data.quota.total} usadas`;

  const avatar = document.getElementById('profile-avatar');
  avatar.style.display = data.avatarUrl ? 'block' : 'none';
  avatar.src = data.avatarUrl || '';
  avatar.alt = data.nombre || 'Avatar';

  const rows = (data.translationHistory || []).map((item) => `
    <tr>
      <td>${item.original_file_name || '-'}</td>
      <td>${item.file_type || '-'}</td>
      <td>${item.source_language || '-'} → ${item.target_language || '-'}</td>
      <td>${item.status || '-'}</td>
      <td>${new Date(item.created_at).toLocaleString()}</td>
    </tr>
  `).join('');

  document.getElementById('history-list').innerHTML = `
    <table class="simple-table">
      <thead><tr><th>Archivo</th><th>Tipo</th><th>Idiomas</th><th>Estado</th><th>Fecha</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="5">Sin historial todavía.</td></tr>'}</tbody>
    </table>
  `;
}

document.getElementById('profile-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const body = {
    nombre: document.getElementById('profile-name').value.trim(),
    correo: document.getElementById('profile-email').value.trim()
  };
  const response = await fetch('/api/user/profile', {
    method: 'PUT',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(body)
  });
  const data = await response.json();
  alert(data.message || data.error);
  if (response.ok) {
    localStorage.setItem('tamon_user', JSON.stringify({ ...user, ...data.user, correo: data.user.email }));
    loadProfile();
  }
});

document.getElementById('password-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const body = {
    currentPassword: document.getElementById('current-password').value,
    newPassword: document.getElementById('new-password').value
  };
  const response = await fetch('/api/user/profile/password', {
    method: 'PUT',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(body)
  });
  const data = await response.json();
  alert(data.message || data.error);
  if (response.ok) event.target.reset();
});

document.getElementById('avatar-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const file = document.getElementById('avatar-file').files[0];
  if (!file) return alert('Selecciona una imagen.');

  const formData = new FormData();
  formData.append('avatar', file);
  const response = await fetch('/api/user/profile/avatar', {
    method: 'POST',
    headers: authHeaders(),
    body: formData
  });
  const data = await response.json();
  alert(data.message || data.error);
  if (response.ok) loadProfile();
});

loadProfile();
