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
  
  const planEl = document.getElementById('profile-plan');
  const quotaEl = document.getElementById('profile-quota');
  const avatar = document.getElementById('profile-avatar');
  const placeholder = document.getElementById('avatar-placeholder');
  const historyList = document.getElementById('history-list');

  try {
    const response = await fetch('/api/user/profile', { headers: authHeaders() });
    const data = await response.json();
    
    if (!response.ok) {
      if (response.status === 401) {
        localStorage.removeItem('tamon_user');
        localStorage.removeItem('tamon_token');
        if (planEl) planEl.textContent = 'Sesión expirada. Redirigiendo...';
        setTimeout(() => window.location.href = '/', 2000);
        return;
      }
      throw new Error(data.error || 'No se pudo cargar el perfil.');
    }

    document.getElementById('profile-name').value = data.nombre || '';
    document.getElementById('profile-email').value = data.correo || '';
    
    // Actualizar datos de la barra lateral
    const sidebarUsername = document.getElementById('sidebar-username');
    const sidebarUsertype = document.getElementById('sidebar-usertype');
    if (sidebarUsername) sidebarUsername.textContent = data.nombre || data.username || 'Usuario';
    if (sidebarUsertype) {
      if (data.role === 'admin') {
        sidebarUsertype.textContent = 'Admin';
        sidebarUsertype.className = 'user-badge admin';
      } else {
        if (data.plan === 'pro_plus') {
          sidebarUsertype.textContent = 'Tamon Pro+';
          sidebarUsertype.className = 'user-badge pro_plus';
        } else {
          sidebarUsertype.textContent = 'Tamon Chill';
          sidebarUsertype.className = 'user-badge chill';
        }
      }
    }
    
    const isPro = data.plan === 'pro_plus';
    const planPrice = isPro ? 'S/ 17.80' : 'S/ 0.00';
    if (planEl) planEl.innerHTML = `Plan actual: <strong style="color: ${isPro ? '#ff007f' : '#a7e9f7'};">${isPro ? 'Tamon Pro+' : 'Tamon Chill'}</strong> · ${planPrice}/mes`;

    if (quotaEl) {
      quotaEl.textContent = data.quota.unlimited
        ? `Cuota: Ilimitada (usadas hoy: ${data.quota.used})`
        : `Cuota: ${data.quota.used} de ${data.quota.total} documentos usados hoy`;
    }

    // Manejar el Avatar y su Placeholder
    if (data.avatarUrl) {
      if (avatar) {
        avatar.style.display = 'block';
        avatar.src = data.avatarUrl;
        avatar.alt = data.nombre || 'Avatar';
      }
      if (placeholder) placeholder.style.display = 'none';
    } else {
      if (avatar) avatar.style.display = 'none';
      if (placeholder) {
        placeholder.style.display = 'flex';
        const initialsName = (data.nombre || data.username || 'U').trim().substring(0, 1).toUpperCase();
        placeholder.textContent = initialsName;
      }
    }

    const rows = (data.translationHistory || []).map((item) => `
      <tr>
        <td>${item.original_file_name || '-'}</td>
        <td>${item.file_type || '-'}</td>
        <td>${item.source_language || '-'} → ${item.target_language || '-'}</td>
        <td style="color: ${item.status === 'success' ? '#a7e9f7' : '#ff007f'}; font-weight: bold;">${item.status || '-'}</td>
        <td>${new Date(item.created_at).toLocaleString()}</td>
      </tr>
    `).join('');

    if (historyList) {
      historyList.innerHTML = `
        <table class="simple-table">
          <thead><tr><th>Archivo</th><th>Tipo</th><th>Idiomas</th><th>Estado</th><th>Fecha</th></tr></thead>
          <tbody>${rows || '<tr><td colspan="5">Sin historial todavía.</td></tr>'}</tbody>
        </table>
      `;
    }

  } catch (error) {
    if (planEl) planEl.innerHTML = `<span style="color: #ff007f; font-weight: bold;">⚠️ Error cargando el perfil: ${error.message}</span>`;
    if (quotaEl) quotaEl.textContent = 'Intenta refrescar la página.';
    if (avatar) avatar.style.display = 'none';
    if (placeholder) {
      placeholder.style.display = 'flex';
      placeholder.textContent = '?';
    }
  }
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

// Control de clic e inicio de subida del avatar interactivo
const avatarTrigger = document.getElementById('avatar-trigger');
const avatarFileHidden = document.getElementById('avatar-file-hidden');

if (avatarTrigger && avatarFileHidden) {
  avatarTrigger.onclick = () => {
    avatarFileHidden.click();
  };

  avatarFileHidden.onchange = async () => {
    const file = avatarFileHidden.files[0];
    if (!file) return;

    const placeholder = document.getElementById('avatar-placeholder');
    const prevText = placeholder ? placeholder.textContent : '';
    if (placeholder) {
      placeholder.style.display = 'flex';
      placeholder.textContent = '⏳';
    }

    const formData = new FormData();
    formData.append('avatar', file);

    try {
      const response = await fetch('/api/user/profile/avatar', {
        method: 'POST',
        headers: authHeaders(),
        body: formData
      });
      const data = await response.json();
      
      if (response.ok) {
        loadProfile();
      } else {
        alert(data.error || 'No se pudo subir la foto.');
        if (placeholder) placeholder.textContent = prevText;
      }
    } catch (e) {
      alert('Error de conexión al subir la foto.');
      if (placeholder) placeholder.textContent = prevText;
    }
  };
}

loadProfile();

// --- LOGICA DE GESTION DE GLOSARIOS ---
async function loadGlossary() {
  const glossaryList = document.getElementById('glossary-list-tbody');
  if (!glossaryList) return;

  try {
    const response = await fetch('/api/memory/glossary', { headers: authHeaders() });
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Error al obtener glosario.');
    }

    if (data.length === 0) {
      glossaryList.innerHTML = `<tr><td colspan="3" style="text-align: center; color: rgba(255,255,255,0.4);">Tu glosario está vacío. Agrega términos arriba.</td></tr>`;
      return;
    }

    const rows = data.map((item) => `
      <tr id="glossary-row-${item.id}">
        <td style="font-weight: bold; color: #a7e9f7; padding: 0.75rem 1rem;">${item.sourceTerm}</td>
        <td style="color: #eaa8c1; padding: 0.75rem 1rem;">${item.targetTerm}</td>
        <td style="text-align: center; padding: 0.75rem 1rem;">
          <button class="btn-delete-term" onclick="deleteGlossaryTerm(${item.id})">Eliminar</button>
        </td>
      </tr>
    `).join('');

    glossaryList.innerHTML = rows;
  } catch (error) {
    glossaryList.innerHTML = `<tr><td colspan="3" style="text-align: center; color: #ff0055;">⚠️ ${error.message}</td></tr>`;
  }
}

async function deleteGlossaryTerm(id) {
  if (!confirm('¿Estás seguro de eliminar este término físicamente de tu glosario?')) return;

  try {
    const response = await fetch(`/api/memory/glossary/${id}`, {
      method: 'DELETE',
      headers: authHeaders()
    });
    const data = await response.json();

    if (response.ok) {
      const row = document.getElementById(`glossary-row-${id}`);
      if (row) row.remove();
      // Si la tabla queda vacía, recargar
      const tbody = document.getElementById('glossary-list-tbody');
      if (tbody && tbody.children.length === 0) {
        tbody.innerHTML = `<tr><td colspan="3" style="text-align: center; color: rgba(255,255,255,0.4);">Tu glosario está vacío. Agrega términos arriba.</td></tr>`;
      }
    } else {
      alert(data.error || 'No se pudo eliminar el término.');
    }
  } catch (e) {
    alert('Error al intentar conectar con el servidor.');
  }
}

// Vinculamos la función globalmente para que el onclick del botón en la fila la llame
window.deleteGlossaryTerm = deleteGlossaryTerm;

const glossaryForm = document.getElementById('glossary-form');
if (glossaryForm) {
  glossaryForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const sourceEl = document.getElementById('glossary-source');
    const targetEl = document.getElementById('glossary-target');
    const body = {
      sourceTerm: sourceEl.value.trim(),
      targetTerm: targetEl.value.trim(),
      project: 'default',
      sourceLanguage: 'en',
      targetLanguage: 'es'
    };

    try {
      const response = await fetch('/api/memory/glossary', {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(body)
      });
      const data = await response.json();

      if (response.ok) {
        sourceEl.value = '';
        targetEl.value = '';
        loadGlossary();
      } else {
        alert(data.error || 'No se pudo guardar el término.');
      }
    } catch (e) {
      alert('Error de conexión al agregar el término.');
    }
  });
}

// Cargar glosario al inicio
loadGlossary();

// --- LOGICA DE MENU DESPLEGABLE EN LA BARRA LATERAL ---
const sidebarUser = document.getElementById('sidebar-user');
if (sidebarUser) {
  sidebarUser.onclick = (e) => {
    e.stopPropagation();
    if (!user) return;
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
    menu.style.border = '1.5px solid #7928ca';
    menu.style.borderRadius = '12px';
    menu.style.padding = '18px 20px 14px 20px';
    menu.style.zIndex = 2000;
    
    let adminOptionHtml = '';
    if (user.role === 'admin') {
      adminOptionHtml = `
        <a href="/admin.html" class="dropdown-menu-item">
          <span>🛠️</span> Admin Dashboard
        </a>
      `;
    }
    
    const username = user.nombre || user.usuario || 'Usuario';
    const planText = user.role === 'admin' ? 'Administrador' : (user.plan === 'pro_plus' ? 'Tamon Pro+' : 'Tamon Chill');
    
    menu.innerHTML = `
      <div style="margin-bottom: 12px; padding: 0 4px;">
        <div style="font-weight: 700; font-size: 1.15rem; color: #fff; line-height: 1.2;">${username}</div>
        <div style="font-size: 0.85rem; margin-top: 4px; display: inline-block; padding: 3px 8px; border-radius: 6px; font-weight: 700; background: ${
          user.role === 'admin' 
            ? 'linear-gradient(135deg, #7928ca, #ff007f)' 
            : (user.plan === 'pro_plus' ? '#7928ca' : '#6c63ff')
        }; color: #fff;">
          ${planText}
        </div>
      </div>
      <div style="height: 1px; background: rgba(255, 255, 255, 0.1); margin: 12px 0;"></div>
      
      <a href="/profile.html" class="dropdown-menu-item">
        <span>👤</span> Mi Perfil
      </a>
      
      ${adminOptionHtml}
      
      <button id="sidebar-logout-btn-float" style="display: flex; align-items: center; gap: 8px; width: 100%; text-align: left; color: #fff; padding: 10px 14px; border: none; border-radius: 8px; font-weight: bold; font-size: 0.95rem; background: #ff007f; cursor: pointer; transition: all 0.2s; box-shadow: 0 4px 10px rgba(255, 0, 127, 0.2); margin-top: 4px;">
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
