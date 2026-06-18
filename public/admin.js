let languageChart;
let fileTypeChart;

function adminFetch(path, options = {}) {
  const separator = path.includes('?') ? '&' : '?';
  return fetch(`${path}${separator}admin=1`, options);
}

function renderChart(instance, canvasId, labels, data, type = 'bar') {
  if (instance) instance.destroy();
  const context = document.getElementById(canvasId).getContext('2d');
  return new Chart(context, {
    type,
    data: {
      labels,
      datasets: [{ data, borderWidth: 1 }]
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } }
    }
  });
}

async function loadDashboard() {
  const [statsRes, usageRes, fileTypesRes, learningRes] = await Promise.all([
    adminFetch('/api/admin/statistics'),
    adminFetch('/api/admin/usage-by-language'),
    adminFetch('/api/admin/file-types'),
    adminFetch('/api/admin/learning-metrics')
  ]);

  const stats = await statsRes.json();
  const usage = await usageRes.json();
  const fileTypes = await fileTypesRes.json();
  const learning = await learningRes.json();

  document.getElementById('kpi-translations').textContent = stats.totalTranslations || 0;
  document.getElementById('kpi-users').textContent = stats.activeUsers || 0;
  document.getElementById('kpi-learning').textContent = `${learning.learningProgressPercent || 0}%`;

  const usageItems = usage.items || [];
  languageChart = renderChart(
    languageChart,
    'language-chart',
    usageItems.map((item) => item.language),
    usageItems.map((item) => item.total),
    'bar'
  );

  const fileItems = fileTypes.items || [];
  fileTypeChart = renderChart(
    fileTypeChart,
    'filetype-chart',
    fileItems.map((item) => item.fileType),
    fileItems.map((item) => item.total),
    'doughnut'
  );
}

async function loadUsers(filters = {}) {
  const params = new URLSearchParams(filters);
  const response = await adminFetch(`/api/admin/users?${params.toString()}`);
  const data = await response.json();
  const items = data.items || [];

  const rows = items.map((user) => `
    <tr>
      <td>${user.nombre || '-'}</td>
      <td>${user.correo || '-'}</td>
      <td>${user.plan}</td>
      <td>${user.status}</td>
      <td>
        <select data-user-id="${user.id}" data-field="plan">
          <option value="free" ${user.plan === 'free' ? 'selected' : ''}>free</option>
          <option value="pro_plus" ${user.plan === 'pro_plus' ? 'selected' : ''}>pro_plus</option>
        </select>
        <select data-user-id="${user.id}" data-field="status">
          <option value="active" ${user.status === 'active' ? 'selected' : ''}>active</option>
          <option value="blocked" ${user.status === 'blocked' ? 'selected' : ''}>blocked</option>
        </select>
        <button data-user-id="${user.id}" class="btn-secondary save-user-btn">Guardar</button>
      </td>
    </tr>
  `).join('');

  document.getElementById('users-table').innerHTML = `
    <table class="simple-table">
      <thead><tr><th>Nombre</th><th>Correo</th><th>Plan</th><th>Estado</th><th>Editar</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="5">Sin resultados</td></tr>'}</tbody>
    </table>
  `;

  document.querySelectorAll('.save-user-btn').forEach((button) => {
    button.addEventListener('click', async () => {
      const userId = button.dataset.userId;
      const plan = document.querySelector(`select[data-user-id="${userId}"][data-field="plan"]`).value;
      const status = document.querySelector(`select[data-user-id="${userId}"][data-field="status"]`).value;
      const updateResponse = await adminFetch(`/api/admin/users/${userId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan, status })
      });
      const updateData = await updateResponse.json();
      alert(updateData.message || updateData.error || 'Actualizado');
      if (updateResponse.ok) loadUsers(filters);
    });
  });
}

async function loadSuggestions() {
  const response = await adminFetch('/api/admin/suggestions');
  const data = await response.json();
  const suggestions = Array.isArray(data) ? data : [];
  const content = suggestions.length
    ? suggestions.map((item) => `<p>• ${item.correctedText || item.comment || 'Sugerencia pendiente'}</p>`).join('')
    : '<p>No hay sugerencias pendientes.</p>';
  document.getElementById('suggestions-list').innerHTML = content;
}

document.getElementById('user-filters').addEventListener('submit', (event) => {
  event.preventDefault();
  loadUsers({
    search: document.getElementById('filter-search').value.trim(),
    plan: document.getElementById('filter-plan').value,
    status: document.getElementById('filter-status').value
  });
});

loadDashboard();
loadUsers();
loadSuggestions();
