function getOrCreateTamonDialog() {
  let modal = document.getElementById('tamon-dialog-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'tamon-dialog-modal';
    modal.style.cssText = 'display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(27, 17, 25, 0.8); z-index: 3000; justify-content: center; align-items: center; backdrop-filter: blur(4px); font-family: Arial, sans-serif;';

    modal.innerHTML = `
      <div style="background: rgba(74, 45, 62, 0.9); padding: 25px; border-radius: 15px; width: 90%; max-width: 400px; text-align: center; border: 1.5px solid #eaa8c1; color: #fff5fa; box-shadow: 0 10px 30px rgba(0,0,0,0.5);">
        <h3 id="tamon-dialog-title" style="margin-top: 0; color: #eaa8c1; font-size: 1.4rem;">Tamon IA</h3>
        <p id="tamon-dialog-message" style="margin: 15px 0 25px 0; color: #fff5fa; font-size: 1rem; line-height: 1.5;"></p>
        <div style="display: flex; justify-content: center; gap: 15px;">
          <button id="tamon-dialog-cancel-btn" style="display: none; background: transparent; border: 1px solid #eaa8c1; color: #eaa8c1; padding: 10px 20px; border-radius: 8px; cursor: pointer; font-weight: bold; transition: 0.2s;">Cancelar</button>
          <button id="tamon-dialog-confirm-btn" style="background: linear-gradient(135deg, #eaa8c1, #d983ab); color: #2d1221; border: none; padding: 10px 25px; border-radius: 8px; cursor: pointer; font-weight: bold; transition: 0.2s;">Aceptar</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
  }
  return {
    modal,
    titleEl: document.getElementById('tamon-dialog-title'),
    msgEl: document.getElementById('tamon-dialog-message'),
    cancelBtn: document.getElementById('tamon-dialog-cancel-btn'),
    confirmBtn: document.getElementById('tamon-dialog-confirm-btn')
  };
}

window.alert = function (message, callback) {
  const { modal, titleEl, msgEl, cancelBtn, confirmBtn } = getOrCreateTamonDialog();
  if (titleEl) titleEl.textContent = 'Tamon IA';
  if (msgEl) msgEl.textContent = message;
  if (cancelBtn) cancelBtn.style.display = 'none';
  if (confirmBtn) {
    confirmBtn.onclick = () => {
      modal.style.display = 'none';
      if (typeof callback === 'function') callback();
    };
  }
  modal.style.display = 'flex';
};

let languageChart;
let fileTypeChart;
const user = JSON.parse(localStorage.getItem('tamon_user') || 'null');
const token = localStorage.getItem('tamon_token');

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

  document.getElementById('kpi-total-users').textContent = stats.totalUsers || 0;
  document.getElementById('kpi-chill-users').textContent = stats.chillUsers || 0;
  document.getElementById('kpi-proplus-users').textContent = stats.proPlusUsers || 0;
  document.getElementById('kpi-most-lang').textContent = stats.mostRequestedLanguage || '-';
  document.getElementById('kpi-most-file').textContent = stats.mostUsedFileType || '-';

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
      <td class="acciones-celda">
        <select data-user-id="${user.id}" data-field="plan">
          <option value="free" ${user.plan === 'free' ? 'selected' : ''}>free</option>
          <option value="pro_plus" ${user.plan === 'pro_plus' ? 'selected' : ''}>pro_plus</option>
        </select>
        <select data-user-id="${user.id}" data-field="status">
          <option value="active" ${user.status === 'active' ? 'selected' : ''}>active</option>
          <option value="blocked" ${user.status === 'blocked' ? 'selected' : ''}>blocked</option>
        </select>
        <button data-user-id="${user.id}" class="btn-secondary save-user-btn">Guardar</button>
        <button data-user-id="${user.id}" class="btn-eliminar delete-user-btn">Borrar</button>
      </td>
    </tr>
  `).join('');

  document.getElementById('users-table').innerHTML = `
    <table class="simple-table">
      <thead><tr><th>Nombre</th><th>Correo</th><th>Plan</th><th>Estado</th><th>Editar</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="5">Sin resultados</td></tr>'}</tbody>
    </table>
  `;

  // Lógica de Guardar Usuario
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

  // NUEVA Lógica de Eliminar Usuario
  document.querySelectorAll('.delete-user-btn').forEach((button) => {
    button.addEventListener('click', async () => {
      const userId = button.dataset.userId;
      const confirmar = confirm("¿Estás seguro de que deseas eliminar este usuario definitivamente? Esta acción no se puede deshacer.");

      if (!confirmar) return;

      try {
        const deleteResponse = await adminFetch(`/api/admin/users/${userId}`, {
          method: 'DELETE'
        });
        const deleteData = await deleteResponse.json();

        if (deleteResponse.ok) {
          alert("Usuario eliminado correctamente.");
          loadUsers(filters); // Recargar la tabla
        } else {
          alert(`Error: ${deleteData.error || 'No se pudo eliminar el usuario'}`);
        }
      } catch (error) {
        console.error("Error al eliminar usuario:", error);
        alert("Ocurrió un error al intentar comunicar con el servidor.");
      }
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

function initSidebar() {
  if (!user || user.role !== 'admin') {
    alert('Acceso denegado. Solo administradores.', () => {
      window.location.href = '/';
    });
    return;
  }

  const sidebarUsername = document.getElementById('sidebar-username');
  const sidebarUsertype = document.getElementById('sidebar-usertype');
  if (sidebarUsername) sidebarUsername.textContent = user.nombre || user.username || 'Admin';
  if (sidebarUsertype) {
    sidebarUsertype.textContent = 'Admin';
    sidebarUsertype.className = 'user-badge admin';
  }

  const sidebarUser = document.getElementById('sidebar-user');
  if (sidebarUser) {
    sidebarUser.onclick = (e) => {
      e.stopPropagation();
      let menu = document.getElementById('sidebar-user-float-menu');
      if (menu) {
        menu.remove();
        return;
      }
      menu = document.createElement('div');
      menu.id = 'sidebar-user-float-menu';
      const rect = sidebarUser.getBoundingClientRect();
      menu.style.position = 'fixed';
      menu.style.left = rect.left + 'px';
      menu.style.bottom = (window.innerHeight - rect.top + 10) + 'px';
      menu.style.background = '#2d2a32';
      menu.style.color = '#fff';
      menu.style.border = '1.5px solid var(--tamon-primary)';
      menu.style.borderRadius = '12px';
      menu.style.padding = '18px 20px 14px 20px';
      menu.style.zIndex = 2000;

      menu.innerHTML = `
        <div style="margin-bottom: 12px; padding: 0 4px;">
          <div style="font-weight: 700; font-size: 1.15rem; color: #fff; line-height: 1.2;">${user.nombre || 'Admin'}</div>
          <div style="font-size: 0.85rem; margin-top: 4px; display: inline-block; padding: 3px 8px; border-radius: 6px; font-weight: 700; background: linear-gradient(135deg, var(--tamon-primary), var(--tamon-secondary)); color: #2d1221;">
            Administrador
          </div>
        </div>
        <div style="height: 1px; background: rgba(255, 255, 255, 0.1); margin: 12px 0;"></div>
        
        <a href="/profile.html" class="dropdown-menu-item">
          <span>👤</span> Mi Perfil
        </a>
        
        <a href="/admin.html" class="dropdown-menu-item">
          <span>🛠️</span> Admin Dashboard
        </a>
        
        <button id="sidebar-logout-btn-float" style="display: flex; align-items: center; gap: 8px; width: 100%; text-align: left; color: #2d1221; padding: 10px 14px; border: none; border-radius: 8px; font-weight: bold; font-size: 0.95rem; background: var(--tamon-secondary); cursor: pointer; transition: all 0.2s; margin-top: 4px;">
          <span>🚪</span> Cerrar Sesión
        </button>
      `;
      document.body.appendChild(menu);

      document.getElementById('sidebar-logout-btn-float').onclick = () => {
        localStorage.removeItem('tamon_user');
        localStorage.removeItem('tamon_token');
        window.location.href = '/';
      };

      setTimeout(() => {
        const clickOutsideHandler = ev => {
          if (!menu.contains(ev.target) && ev.target !== sidebarUser && !sidebarUser.contains(ev.target)) {
            menu.remove();
            document.removeEventListener('click', clickOutsideHandler);
          }
        };
        document.addEventListener('click', clickOutsideHandler);
      }, 100);
    };
  }
}

initSidebar();
loadDashboard();
loadUsers();
loadSuggestions();