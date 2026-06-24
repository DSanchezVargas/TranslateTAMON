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

window.alert = function(message, callback) {
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

function showTamonConfirm(message, onConfirm) {
  const { modal, titleEl, msgEl, cancelBtn, confirmBtn } = getOrCreateTamonDialog();
  if (titleEl) titleEl.textContent = 'Tamon IA';
  if (msgEl) msgEl.textContent = message;
  if (cancelBtn) {
    cancelBtn.style.display = 'block';
    cancelBtn.onclick = () => {
      modal.style.display = 'none';
    };
  }
  if (confirmBtn) {
    confirmBtn.onclick = () => {
      modal.style.display = 'none';
      if (onConfirm) onConfirm();
    };
  }
  modal.style.display = 'flex';
}

const user = JSON.parse(localStorage.getItem('tamon_user') || 'null');
const token = localStorage.getItem('tamon_token');

function authHeaders(extra = {}) {
  const headers = { ...extra };
  if (token) headers.Authorization = 'Bearer ' + token;
  return headers;
}

function requireSession() {
  if (!user) {
    alert('Debes iniciar sesión para ver tu perfil.', () => {
      window.location.href = '/';
    });
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
      if (response.status === 401 || response.status === 400 || (data.error && data.error.includes('Sesión'))) {
        localStorage.removeItem('tamon_user');
        localStorage.removeItem('tamon_token');
        if (planEl) planEl.textContent = 'Sesión expirada o inválida. Redirigiendo...';
        setTimeout(() => window.location.href = '/', 2000);
        return;
      }
      throw new Error(data.error || 'No se pudo cargar el perfil.');
    }

    // Mixpanel Tracking - view_history (revisar historial)
    if (typeof mixpanel !== 'undefined') {
      mixpanel.track('view_history', {
        email: data.correo || ''
      });
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

    const buildRows = (items) => (items || []).map((item) => `
      <tr>
        <td>${item.original_file_name || '-'}</td>
        <td>${item.file_type || '-'}</td>
        <td>${item.source_language || '-'} → ${item.target_language || '-'}</td>
        <td style="color: ${item.status === 'success' ? '#a7e9f7' : '#ff007f'}; font-weight: bold;">${item.status || '-'}</td>
        <td>${new Date(item.created_at).toLocaleString()}</td>
      </tr>
    `).join('');

    if (historyList) {
      const textualRows = buildRows(data.translationHistoryTextual);
      const archivosRows = buildRows(data.translationHistoryArchivos);

      historyList.innerHTML = `
        <div style="margin-bottom: 2rem;">
          <h3 style="color: var(--tamon-primary); font-size: 1.15rem; margin-bottom: 10px; font-weight: bold; border-left: 3px solid var(--tamon-primary); padding-left: 8px;">🔤 Traducciones de Texto</h3>
          <table class="simple-table">
            <thead><tr><th>Texto</th><th>Tipo</th><th>Idiomas</th><th>Estado</th><th>Fecha</th></tr></thead>
            <tbody>${textualRows || '<tr><td colspan="5" style="text-align: center; color: rgba(255,255,255,0.4);">No tienes traducciones de texto guardadas en tu historial.</td></tr>'}</tbody>
          </table>
        </div>
        
        <div>
          <h3 style="color: var(--tamon-secondary); font-size: 1.15rem; margin-bottom: 10px; font-weight: bold; border-left: 3px solid var(--tamon-secondary); padding-left: 8px;">📄 Traducciones de Archivos</h3>
          <table class="simple-table">
            <thead><tr><th>Archivo</th><th>Tipo</th><th>Idiomas</th><th>Estado</th><th>Fecha</th></tr></thead>
            <tbody>${archivosRows || '<tr><td colspan="5" style="text-align: center; color: rgba(255,255,255,0.4);">No tienes traducciones de archivos guardadas en tu historial.</td></tr>'}</tbody>
          </table>
        </div>
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

// =====================================================================
// DIÁLOGOS Y ALERTAS PERSONALIZADOS (Estilo Tamon)
// =====================================================================
// Diálogos y alertas personalizados removidos y movidos al inicio del archivo

async function deleteGlossaryTerm(id) {
  showTamonConfirm('¿Estás seguro de eliminar este término físicamente de tu glosario?', async () => {
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
          tbody.innerHTML = `<tr><td colspan="3" style="text-align: center; color: rgba(255,255,255,0.4);">No hay términos en tu glosario aún.</td></tr>`;
        }
      } else {
        alert(data.error || 'Error al eliminar el término.');
      }
    } catch (error) {
      alert('Error de conexión.');
    }
  });
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
    menu.style.border = '1.5px solid var(--tamon-primary)';
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
            ? 'linear-gradient(135deg, var(--tamon-primary), var(--tamon-secondary))' 
            : (user.plan === 'pro_plus' ? 'var(--tamon-primary)' : 'rgba(255, 255, 255, 0.1)')
        }; color: ${user.role === 'admin' || user.plan === 'pro_plus' ? '#2d1221' : '#fff'};">
          ${planText}
        </div>
      </div>
      <div style="height: 1px; background: rgba(255, 255, 255, 0.1); margin: 12px 0;"></div>
      
      <a href="/profile.html" class="dropdown-menu-item">
        <span>👤</span> Mi Perfil
      </a>
      
      ${adminOptionHtml}
      
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
