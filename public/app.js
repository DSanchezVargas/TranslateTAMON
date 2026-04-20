// =====================================================================
// 1. CONFIGURACIÓN INICIAL Y CONSTANTES
// =====================================================================
const LANGUAGES = [
  { value: 'es', label: 'Español' },
  { value: 'en', label: 'English' },
  { value: 'pt', label: 'Português' },
  { value: 'fr', label: 'Français' },
  { value: 'de', label: 'Deutsch' },
  { value: 'it', label: 'Italiano' },
  { value: 'zh', label: '中文' },
  { value: 'ja', label: '日本語' },
  { value: 'ko', label: '한국어' },
  { value: 'ru', label: 'Русский' },
  { value: 'ar', label: 'العربية' },
  { value: 'hi', label: 'हिन्दी' },
];

const DEFAULT_ESTIMATED_SECONDS = 1800;
const MAX_ESTIMATED_SECONDS = 23 * 60 * 60;

const UI_TEXT = {
  processing: 'Asistente IA: procesando entrada, memoria y traducción...',
  previewError: 'No se pudo generar la vista previa.',
  previewReady: 'Vista previa lista para corrección.',
  fromMemory: 'resultado desde memoria',
  fromModel: 'resultado generado por IA',
  finalizing: 'Asistente IA: finalizando documento y aplicando aprendizaje...',
  finalizeError: 'No se pudo finalizar la traducción.',
  downloaded: 'Documento final listo y descargado.',
  suggestionSent: 'Comentario enviado. Tamon lo usará para mejorar continuamente.',
  suggestionError: 'No se pudo registrar el comentario de usuario.',
  quickTranslateError: 'No se pudo traducir el texto rápido.'
};

let previewState = null;
let processTicker = null;

// --- FEEDBACK ---
const feedbackForm = document.getElementById('feedback-form');
const feedbackInput = document.getElementById('feedback-input');
const feedbackType = document.getElementById('feedback-type');
const feedbackStatus = document.getElementById('feedback-status');

if (feedbackForm) {
  feedbackForm.onsubmit = async (e) => {
    e.preventDefault();
    if (!feedbackInput.value || !feedbackType.value) return;
    feedbackStatus.textContent = 'Enviando...';
    try {
      const user = JSON.parse(localStorage.getItem('tamon_user') || '{}');
      const res = await fetch('/api/translate/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user.id,
          comentario: feedbackInput.value,
          tipo: feedbackType.value,
          traceId: previewState?.traceId || null
        })
      });
      const data = await res.json();
      if (res.ok) {
        feedbackStatus.textContent = '¡Gracias por tu comentario!';
        feedbackInput.value = '';
      } else {
        feedbackStatus.textContent = data.error || 'Error al enviar feedback.';
      }
    } catch (err) {
      feedbackStatus.textContent = 'Error de red.';
    }
  };
}

// =====================================================================
// 2. SELECTORES DE DOM (Protegidos)
// =====================================================================
const getEl = id => document.querySelector(id) || document.getElementById(id.replace('#', ''));

const form = getEl('#translate-form');
const commentsForm = getEl('#comments-form');
const previewPanel = getEl('#preview-panel');
const previewMeta = getEl('#preview-meta');
const etaText = getEl('#eta-text');
const translatedTextInput = getEl('#translatedText');
const originalTextPreview = getEl('#originalTextPreview');
const assistantStatus = getEl('#assistant-status');
const commentsStatus = getEl('#comments-status');
const finalizeBtn = getEl('#finalize-btn');
const sourceLanguageSelect = getEl('#sourceLanguage');
const targetLanguageSelect = getEl('#targetLanguage');
const processProgress = getEl('#process-progress');
const historyProgress = getEl('#history-progress');

// =====================================================================
// 3. FUNCIONES DE INTERFAZ Y PROGRESO
// =====================================================================
function setStep(stepId) {
  document.querySelectorAll('.flow-steps li').forEach(item => item.classList.remove('active'));
  const selected = document.getElementById(stepId);
  if (selected) selected.classList.add('active');
}

function setStatus(message) {
  if (assistantStatus) assistantStatus.textContent = message;
}

function setProcessProgress(percent) {
  if (processProgress) processProgress.style.width = `${Math.max(Math.min(percent, 100), 0)}%`;
}

function setHistoryProgress(percent) {
  if (historyProgress) historyProgress.style.width = `${Math.max(Math.min(percent, 100), 0)}%`;
}

function populateLanguages() {
  const selects = [sourceLanguageSelect, targetLanguageSelect];
  selects.forEach(select => {
    if (!select) return;
    LANGUAGES.forEach(({ value, label }) => {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = label;
      select.appendChild(option);
    });
  });
  if (sourceLanguageSelect) sourceLanguageSelect.value = 'en';
  if (targetLanguageSelect) targetLanguageSelect.value = 'es';
  // if (quickSourceLanguage) quickSourceLanguage.value = 'en';
  // if (quickTargetLanguage) quickTargetLanguage.value = 'es';
}

function startProcessTicker(estimatedSeconds) {
  if (processTicker) clearInterval(processTicker);
  const maxSeconds = Math.max(Math.min(estimatedSeconds || DEFAULT_ESTIMATED_SECONDS, MAX_ESTIMATED_SECONDS), 10);
  let elapsed = 0;
  setProcessProgress(3);
  if (etaText) etaText.textContent = `Tiempo estimado de traducción: ${Math.ceil(maxSeconds / 60)} min.`;
  processTicker = setInterval(() => {
    elapsed += 1;
    const ratio = Math.min(elapsed / maxSeconds, 0.9);
    setProcessProgress(5 + ratio * 85);
  }, 1000);
}

function stopProcessTicker() {
  if (processTicker) clearInterval(processTicker);
  processTicker = null;
}

// =====================================================================
// 4. LÓGICA DE TRADUCCIÓN, BACKEND Y DRAG & DROP (MÚLTIPLES ARCHIVOS)
// =====================================================================
const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('document');
const fileListContainer = document.getElementById('file-list');
let selectedFiles = []; 

if (dropzone && fileInput) {
  dropzone.addEventListener('click', () => fileInput.click());

  dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropzone.classList.add('dragover');
  });

  dropzone.addEventListener('dragleave', () => {
    dropzone.classList.remove('dragover');
  });

  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('dragover');
    if (e.dataTransfer.files.length > 0) handleFiles(e.dataTransfer.files);
  });

  fileInput.addEventListener('change', () => handleFiles(fileInput.files));
}

function handleFiles(files) {
  for (let i = 0; i < files.length; i++) selectedFiles.push(files[i]);
  renderFileList();
}

window.removeFile = function(index) {
  selectedFiles.splice(index, 1);
  renderFileList();
}

function renderFileList() {
  if (!fileListContainer) return;
  fileListContainer.innerHTML = '';
  selectedFiles.forEach((file, index) => {
    const div = document.createElement('div');
    div.className = 'file-item';
    div.innerHTML = `
      <span>📄 ${file.name}</span>
      <span class="remove-file" onclick="event.stopPropagation(); window.removeFile(${index})">✖</span>
    `;
    fileListContainer.appendChild(div);
  });
  
  if (selectedFiles.length > 0) {
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(selectedFiles[0]); // El sistema toma el primero de la cola para mandarlo al servidor
      fileInput.files = dataTransfer.files;
  } else {
      fileInput.value = '';
  }
}

async function requestPreview(event) {
  event.preventDefault();
  
  if (selectedFiles.length === 0) {
    alert("Por favor, arrastra o selecciona al menos un archivo.");
    return;
  }

  const fileToProcess = selectedFiles[0]; 
  const formData = new FormData(form);
  formData.set('document', fileToProcess);

  setStep('step-upload');
  setStatus(UI_TEXT.processing + ` (${fileToProcess.name})`);
  startProcessTicker(Math.max(Math.ceil(fileToProcess.size / 8000), 60));

  try {
    const response = await fetch('/api/translate/preview', { method: 'POST', body: formData });
    const rawBody = await response.text();
    const data = rawBody ? JSON.parse(rawBody) : {};

    if (!response.ok) throw new Error(data.error || UI_TEXT.previewError);

    previewState = data;
    if (previewPanel) previewPanel.classList.remove('hidden');

    // DOCX avanzado: mostrar runs para traducción
    if (data.docxRuns) {
      // Renderiza cada run editable
      const docxRunsContainer = document.getElementById('docxRunsContainer') || (() => {
        const c = document.createElement('div');
        c.id = 'docxRunsContainer';
        c.style.maxHeight = '350px';
        c.style.overflowY = 'auto';
        c.style.margin = '12px 0';
        previewPanel.insertBefore(c, previewPanel.firstChild);
        return c;
      })();
      docxRunsContainer.innerHTML = '';
      data.docxRuns.forEach((run, idx) => {
        const input = document.createElement('input');
        input.type = 'text';
        input.value = run.texto;
        input.style.width = '98%';
        input.dataset.idx = idx;
        input.oninput = e => data.docxRuns[idx].texto = e.target.value;
        const label = document.createElement('label');
        label.textContent = `P${run.paragraph} R${run.run}`;
        label.style.fontSize = '0.8em';
        label.style.opacity = '0.7';
        const div = document.createElement('div');
        div.style.marginBottom = '6px';
        div.appendChild(label);
        div.appendChild(input);
        docxRunsContainer.appendChild(div);
      });
      // Oculta los inputs de texto plano
      if (translatedTextInput) translatedTextInput.style.display = 'none';
      if (originalTextPreview) originalTextPreview.style.display = 'none';
    } else {
      if (translatedTextInput) translatedTextInput.value = data.translatedText;
      if (originalTextPreview) originalTextPreview.value = data.originalText;
      if (translatedTextInput) translatedTextInput.style.display = '';
      if (originalTextPreview) originalTextPreview.style.display = '';
      const docxRunsContainer = document.getElementById('docxRunsContainer');
      if (docxRunsContainer) docxRunsContainer.remove();
    }
    if (previewMeta) previewMeta.textContent = `Trace: ${data.traceId} · ${data.experience?.fromCache ? UI_TEXT.fromMemory : UI_TEXT.fromModel}`;
    stopProcessTicker();
    setProcessProgress(100);
    setStep('step-preview');
    setStatus(data.experience?.assistantMessage || UI_TEXT.previewReady);
  } catch (error) {
    stopProcessTicker();
    setStatus(error.message);
  }
}

async function finalizeTranslation() {
  if (!previewState) return;
  setStep('step-correction');
  setStatus(UI_TEXT.finalizing);
  setProcessProgress(92);

  let payload = {
    previewId: previewState.previewId,
    sourceLanguage: previewState.sourceLanguage,
    targetLanguage: previewState.targetLanguage,
    originalFileName: previewState.originalFileName
  };
  // Si es DOCX avanzado, enviar los runs traducidos
  if (previewState.docxRuns) {
    payload.docxRunsTranslated = previewState.docxRuns;
  } else {
    payload.translatedText = translatedTextInput.value;
  }

  try {
    const response = await fetch('/api/translate/finalize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.error || UI_TEXT.finalizeError);
    }

    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `Tamon_${previewState.originalFileName || 'traduccion'}.docx`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();

    setProcessProgress(100);
    setStep('step-download');
    
    // Magia de la Cola: Eliminamos el archivo que ya se terminó con éxito
    window.removeFile(0);
    
    if (selectedFiles.length > 0) {
        setStatus(`✅ Descargado. ¡Tienes ${selectedFiles.length} archivo(s) más en cola! Haz clic en "Generar vista previa IA" para seguir.`);
        if (previewPanel) previewPanel.classList.add('hidden'); // Ocultamos el panel
    } else {
        setStatus(UI_TEXT.downloaded + " (Cola vacía)");
    }

  } catch (error) {
    setStatus(error.message);
  }
}

// =====================================================================
// 5. SIDEBAR, MENÚS Y NAVEGACIÓN
// =====================================================================
const sidebarToggle = document.getElementById('sidebar-toggle');
const sidebar = document.querySelector('.sidebar');

if (sidebarToggle && sidebar) {
  sidebarToggle.addEventListener('click', () => {
    sidebar.classList.toggle('hide');
    sidebarToggle.classList.toggle('active');
    
    // NUEVO: Expande el contenido para que no quede el hueco negro
    const mainContent = document.querySelector('.main-content');
    if (mainContent) mainContent.classList.toggle('expanded');
  });
}

const menuBtn = document.getElementById('menu-btn');
const chatBtn = document.getElementById('chat-btn');
const faqBtn = document.getElementById('faq-btn');
const translationView = document.getElementById('translation-view');
const chatSection = document.getElementById('tamon-chat-section');
const faqSection = document.getElementById('faq-section');

function showSection(section) {
  if (translationView) translationView.style.display = section === 'menu' ? '' : 'none';
  if (chatSection) chatSection.style.display = section === 'chat' ? '' : 'none';
  if (faqSection) faqSection.style.display = section === 'faq' ? '' : 'none';
  
  [menuBtn, chatBtn, faqBtn].forEach(btn => btn && btn.classList.remove('active'));
  if (section === 'menu' && menuBtn) menuBtn.classList.add('active');
  if (section === 'chat' && chatBtn) chatBtn.classList.add('active');
  if (section === 'faq' && faqBtn) faqBtn.classList.add('active');
}

if (menuBtn) menuBtn.onclick = () => showSection('menu');
if (chatBtn) chatBtn.onclick = () => showSection('chat');
if (faqBtn) faqBtn.onclick = () => showSection('faq');

// =====================================================================
// 6. LÓGICA DE USUARIO Y AUTENTICACIÓN
// =====================================================================
function updateSidebarUser(user) {
  const usernameElem = document.getElementById('sidebar-username');
  const usertypeElem = document.getElementById('sidebar-usertype');
  const sidebarUser = document.getElementById('sidebar-user');
  const adminBtn = document.getElementById('admin-reports-btn'); // NUEVO

  if (user && Object.keys(user).length > 0) {
    const username = user.nombre || user.usuario || 'Usuario';
    if (usernameElem) {
      usernameElem.textContent = username;
      usernameElem.style.fontSize = '1.08rem';
    }
    
   if (usertypeElem) {
      if (user.role === 'admin') {
        usertypeElem.textContent = 'Admin';
        usertypeElem.className = 'user-badge admin';
        if (adminBtn) adminBtn.style.display = 'block'; // Mostrar botón al admin
      } else {
        if (user.plan === 'pro_plus') {
          usertypeElem.textContent = 'Tamon Pro+';
          usertypeElem.className = 'user-badge pro_plus';
        } else {
          usertypeElem.textContent = 'Tamon Chill';
          usertypeElem.className = 'user-badge chill';
        }
        if (adminBtn) adminBtn.style.display = 'none'; // Ocultar a mortales
      }
      usertypeElem.style.display = '';
    }
    if (sidebarUser) {
      sidebarUser.onclick = (e) => {
        e.stopPropagation();
        let menu = document.getElementById('sidebar-user-float-menu');
        if (menu) menu.remove();
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
        menu.style.padding = '18px 22px 10px 22px';
        menu.style.zIndex = 2000;
        menu.innerHTML = `
          <div style="font-weight:600;font-size:1.13rem;margin-bottom:2px;">${username}</div>
          <div style="font-size:0.98rem;opacity:0.85;margin-bottom:10px;">${usertypeElem.textContent}</div>
          <button id="sidebar-logout-btn-float" style="display:block;width:100%;padding:8px 0;background:#ff007f;color:#fff;border:none;border-radius:8px;font-weight:bold;cursor:pointer;">Cerrar sesión</button>
        `;
        document.body.appendChild(menu);
        
        document.getElementById('sidebar-logout-btn-float').onclick = () => {
          localStorage.removeItem('tamon_user');
          location.reload();
        };
        setTimeout(() => document.addEventListener('click', ev => {
          if (!menu.contains(ev.target)) menu.remove();
        }, { once: true }), 100);
      };
    }
  } else {
    if (usernameElem) {
        usernameElem.textContent = 'Inicia sesión / Regístrate';
        usernameElem.style.fontSize = '0.95rem';
    }
    if (usertypeElem) usertypeElem.style.display = 'none';
    
    if (sidebarUser) {
      sidebarUser.onclick = () => {
        const modal = document.getElementById('auth-modal');
        if (modal) modal.style.display = 'flex';
      };
    }
  }
}

const usuarioGuardado = localStorage.getItem('tamon_user');
if (usuarioGuardado) {
  try { updateSidebarUser(JSON.parse(usuarioGuardado)); } 
  catch (e) { updateSidebarUser(null); }
} else {
  updateSidebarUser(null);
}

const authModal = document.getElementById('auth-modal');
const authToggleBtn = document.getElementById('auth-toggle-btn');
const authForm = document.getElementById('auth-form');
let isLoginMode = true;

if (authToggleBtn) {
  authToggleBtn.addEventListener('click', () => {
    isLoginMode = !isLoginMode;
    document.getElementById('auth-title').textContent = isLoginMode ? 'Iniciar Sesión' : 'Crear Cuenta';
    document.getElementById('auth-nombre').style.display = isLoginMode ? 'none' : 'block';
    document.getElementById('auth-nombre').required = !isLoginMode;
    document.getElementById('auth-submit-btn').textContent = isLoginMode ? 'Entrar a Tamon' : 'Registrarse';
    document.getElementById('auth-toggle-text').textContent = isLoginMode ? '¿No tienes cuenta?' : '¿Ya tienes cuenta?';
    authToggleBtn.textContent = isLoginMode ? 'Regístrate aquí' : 'Inicia sesión';
  });
}

if (authModal) {
  window.addEventListener('click', (e) => { if (e.target === authModal) authModal.style.display = 'none'; });
}

if (authForm) {
  authForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const endpoint = isLoginMode ? '/api/auth/login' : '/api/auth/register';
    const payload = {
      correo: document.getElementById('auth-correo').value.trim(),
      password: document.getElementById('auth-pass').value
    };
    if (!isLoginMode) payload.nombre = document.getElementById('auth-nombre').value.trim();

    document.getElementById('auth-submit-btn').textContent = 'Procesando...';
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await response.json();
      if (response.ok) {
        localStorage.setItem('tamon_user', JSON.stringify(data.usuario));
        authModal.style.display = 'none';
        updateSidebarUser(data.usuario);
        if (!isLoginMode) alert('¡Registro exitoso!');
      } else {
        alert(data.error);
      }
    } catch (err) {
      alert('Error de conexión.');
    } finally {
      document.getElementById('auth-submit-btn').textContent = isLoginMode ? 'Entrar a Tamon' : 'Registrarse';
    }
  });
}
// --- NUEVO: FUNCIÓN PARA ACTUALIZAR LA CUOTA EN LA BARRA SUPERIOR ---
async function actualizarCuotaVisual() {
  const usageCounter = document.getElementById('usage-counter');
  if (!usageCounter) return;

  const userJson = localStorage.getItem('tamon_user');
  if (!userJson) {
    usageCounter.textContent = 'Cuota: Inicia sesión para ver';
    return;
  }

  const user = JSON.parse(userJson);
  try {
    // Llamamos a la ruta que creamos en userChatRoutes.js
    const response = await fetch(`/api/user/quota/${user.id || user._id}`);
    if (response.ok) {
      const data = await response.json();
      const restantes = data.total - data.usados;
      
      if (user.plan === 'pro_plus') {
        usageCounter.innerHTML = `🌟 Tamon Pro+: <span style="color: #ff007f;">Ilimitado</span> (Usados hoy: ${data.usados})`;
      } else {
        // Si le quedan 3 o menos, se pone fucsia/rojo. Si no, se queda azulito.
        const colorAlerta = restantes <= 3 ? '#ff007f' : '#a7e9f7';
        usageCounter.innerHTML = `Cuota Chill: <span style="color: ${colorAlerta}; font-weight: bold;">${restantes} restantes</span> de ${data.total}`;
      }
    }
  } catch (error) {
    usageCounter.textContent = 'Error cargando cuota';
  }
}

// Ejecutamos la función apenas cargue la página
actualizarCuotaVisual();

// =====================================================================
// 7. MODAL VIP TAMON PRO+
// =====================================================================
const btnProPlus = getEl('#btn-pro-plus');
const proModal = getEl('#pro-modal');
const btnUpgradeNow = getEl('#btn-upgrade-now');


if (btnProPlus && proModal) btnProPlus.addEventListener('click', () => proModal.style.display = 'flex');
window.addEventListener('click', e => { if (e.target === proModal) proModal.style.display = 'none'; });

// Botón "Quizás luego" cierra el modal
const closeModalBtn = document.getElementById('close-modal-btn');
if (closeModalBtn && proModal) {
  closeModalBtn.addEventListener('click', () => {
    proModal.style.display = 'none';
  });
}

if (btnUpgradeNow && proModal) {
  btnUpgradeNow.addEventListener('click', async () => {
    const userJson = localStorage.getItem('tamon_user');
    if (!userJson) {
        alert('Debes iniciar sesión para unirte a la fila VIP.');
        proModal.style.display = 'none';
        if (authModal) authModal.style.display = 'flex';
        return;
    }

    const user = JSON.parse(userJson);
    const textoOriginal = btnUpgradeNow.textContent;
    btnUpgradeNow.textContent = 'Enviando...';
    btnUpgradeNow.disabled = true;

    try {
        const response = await fetch('/api/auth/join-vip', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ correo: user.correo, nombre: user.nombre || 'Usuario' })
        });

        if (response.ok) {
            proModal.innerHTML = `
              <div style="background: #2d2a32; padding: 40px; border-radius: 15px; text-align: center; border: 1px solid #7928ca;">
                <h2 style="color: #7928ca; font-size: 1.8rem; margin-top: 0;">¡Estás en la lista VIP! 🚀</h2>
                <p style="color: #cbd5e1; margin-top: 15px;">Revisa tu bandeja de entrada (${user.correo}).</p>
                <button id="close-success-btn" style="margin-top: 25px; padding: 10px 20px; border-radius: 8px; cursor: pointer;">Entendido</button>
              </div>`;
            document.getElementById('close-success-btn').onclick = () => location.reload();
        } else {
            alert((await response.json()).error);
        }
    } catch (error) {
        alert('Error al conectar con el servidor.');
    } finally {
        if (document.getElementById('btn-upgrade-now')) {
            btnUpgradeNow.textContent = textoOriginal;
            btnUpgradeNow.disabled = false;
        }
    }
  });
}

// =====================================================================
// 8. CHAT TAMON Y FAQ
// =====================================================================
// if (quickTranslateForm) quickTranslateForm.addEventListener('submit', e => { e.preventDefault(); alert("Función en desarrollo."); });
if (form) form.addEventListener('submit', requestPreview);
if (finalizeBtn) finalizeBtn.addEventListener('click', finalizeTranslation);

document.addEventListener('DOMContentLoaded', () => {
  populateLanguages();
  showSection('menu');

  document.querySelectorAll('.faq-question').forEach(btn => {
    btn.addEventListener('click', function() { this.parentElement.classList.toggle('active'); });
  });

  const faqList = document.getElementById('faq-list');
  const faqForm = document.getElementById('faq-form');
  let faqs = JSON.parse(localStorage.getItem('tamon_faqs') || '[]');

  function renderFaqs() {
    if (!faqList) return;
    faqList.innerHTML = '';
    faqs.forEach((item, idx) => {
      const li = document.createElement('li');
      li.innerHTML = `<b>${item.q}</b>: ${item.a} <button onclick="removeFaq(${idx})" style="margin-left:8px;color:#ff007f;">X</button>`;
      faqList.appendChild(li);
    });
  }
  
  window.removeFaq = idx => { faqs.splice(idx, 1); localStorage.setItem('tamon_faqs', JSON.stringify(faqs)); renderFaqs(); };
  
  if (faqForm) {
    faqForm.onsubmit = e => {
      e.preventDefault();
      faqs.push({ q: document.getElementById('faq-question').value, a: document.getElementById('faq-answer').value });
      localStorage.setItem('tamon_faqs', JSON.stringify(faqs));
      renderFaqs();
    };
    renderFaqs();
  }
});

// =====================================================================
// 9. LÓGICA DEL CHAT DE TAMON (STREAMING + MARKDOWN + ICONOS)
// =====================================================================
const chatMessages = getEl('#chat-messages');
const chatForm = getEl('#chat-form');
const chatInput = getEl('#chat-input');

// Variable temporal para guardar el texto de la IA si le damos a "No me gusta"
window.currentTamonMessage = ""; 

function renderChatMessage(msg, from, id = null) {
  if (from === 'user') {
    const div = document.createElement('div');
    div.className = 'chat-bubble user-bubble';
    if (id) div.id = id;
    div.innerHTML = `<span>${msg.replace(/\n/g, '<br>')}</span>`;
    
    if (chatMessages) {
      chatMessages.appendChild(div);
      chatMessages.scrollTop = chatMessages.scrollHeight; 
    }
    return div;
  } else {
    // Contenedor principal del mensaje
    const wrapper = document.createElement('div');
    wrapper.className = 'tamon-message-wrapper';
    if (id) wrapper.id = id;

    const bubble = document.createElement('div');
    bubble.className = 'chat-bubble tamon-bubble';
    
    bubble.innerHTML = `
      <div style="font-weight:bold; margin-bottom:4px;">Tamon:</div>
      <div class="tamon-content">${marked.parse(msg)}</div>
    `;

   // Contenedor de iconos
    const actions = document.createElement('div');
    actions.className = 'message-actions';
    actions.style.display = 'none'; // NUEVO: Se ocultan mientras "escribe..."
    // Botón Copiar
    const btnCopy = document.createElement('button');
    btnCopy.className = 'action-btn';
    btnCopy.title = 'Copiar texto';
    btnCopy.innerHTML = '📋';
    btnCopy.onclick = () => {
      const tempDiv = document.createElement('div');
      tempDiv.innerHTML = bubble.querySelector('.tamon-content').innerHTML;
      navigator.clipboard.writeText(tempDiv.innerText);
      
      btnCopy.innerHTML = '✅';
      setTimeout(() => btnCopy.innerHTML = '📋', 2000);
    };

    // Botón Me Gusta (Check)
    const btnLike = document.createElement('button');
    btnLike.className = 'action-btn';
    btnLike.title = 'Buena respuesta';
    btnLike.innerHTML = '👍';
    btnLike.onclick = () => {
      btnLike.innerHTML = '💖';
      const toast = document.getElementById('tamon-toast');
      toast.classList.add('show');
      setTimeout(() => { 
        toast.classList.remove('show'); 
        btnLike.innerHTML = '👍'; 
      }, 3000);
    };
    
    // Botón No Me Gusta (Wrong / Modal)
    const btnDislike = document.createElement('button');
    btnDislike.className = 'action-btn';
    btnDislike.title = 'Mala respuesta';
    btnDislike.innerHTML = '👎';
    btnDislike.onclick = () => {
      // Extraemos solo el texto plano sin etiquetas <p> o <b>
      const tempDiv = document.createElement('div');
      tempDiv.innerHTML = bubble.querySelector('.tamon-content').innerHTML;
      window.currentTamonMessage = tempDiv.innerText; 
      
      document.getElementById('feedback-text').value = ''; 
      document.getElementById('feedback-modal').style.display = 'flex';
    };

    actions.appendChild(btnCopy);
    actions.appendChild(btnLike);
    actions.appendChild(btnDislike);

    wrapper.appendChild(bubble);
    wrapper.appendChild(actions);

    if (chatMessages) {
      chatMessages.appendChild(wrapper);
      chatMessages.scrollTop = chatMessages.scrollHeight; 
    }
    return wrapper;
  }
}

if (chatForm) {
  chatForm.addEventListener('submit', async (e) => {
    e.preventDefault(); 
    const msg = chatInput.value.trim();
    if (!msg) return;
    
    renderChatMessage(msg, 'user');
    chatInput.value = '';
    
    const userJson = localStorage.getItem('tamon_user');
    const nombreUsuario = userJson ? JSON.parse(userJson).nombre : 'Usuario';

    const tamonMsgId = 'tamon-stream-' + Date.now();
    const tamonWrapper = renderChatMessage('<i>escribiendo...</i>', 'tamon', tamonMsgId);
    const contentDiv = tamonWrapper.querySelector('.tamon-content');

    try {
        const response = await fetch('/api/user/chat', { 
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: msg, userName: nombreUsuario })
        });

        if (!response.ok) throw new Error('Error en la conexión');

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let fullText = "";

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const chunk = decoder.decode(value, { stream: true });
            fullText += chunk;
            
            contentDiv.innerHTML = marked.parse(fullText);
            chatMessages.scrollTop = chatMessages.scrollHeight; 
        }

        // Mostrar los iconos solo cuando termina de generar el texto (El arreglo anterior)
        const actionsDiv = tamonWrapper.querySelector('.message-actions');
        if (actionsDiv) actionsDiv.style.display = 'flex';

        // NUEVO: Refrescar el contador de cuota de la barra superior al terminar el mensaje
        actualizarCuotaVisual();

    } catch (error) {
//...
        if (contentDiv) contentDiv.innerHTML = `Error: Mis circuitos están sobrecargados.`;
    }
  });
}

// =====================================================================
// 10. LÓGICA DEL MODAL DE FEEDBACK (REPORTES)
// =====================================================================
const feedbackModal = document.getElementById('feedback-modal');
const closeFeedbackBtn = document.getElementById('close-feedback-btn');
const sendFeedbackBtn = document.getElementById('send-feedback-btn');

if (closeFeedbackBtn) {
  closeFeedbackBtn.onclick = () => feedbackModal.style.display = 'none';
}

if (sendFeedbackBtn) {
  sendFeedbackBtn.onclick = async () => {
    const comentario = document.getElementById('feedback-text').value.trim();
    if (!comentario) return alert("Por favor, escribe un comentario detallado antes de enviar.");
    
    const userJson = localStorage.getItem('tamon_user');
    const userId = userJson ? JSON.parse(userJson).id : null;

    sendFeedbackBtn.textContent = 'Enviando...';

    try {
      await fetch('/api/user/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: userId,
          botMessage: window.currentTamonMessage,
          userComment: comentario
        })
      });
      
      feedbackModal.style.display = 'none';
      const toast = document.getElementById('tamon-toast');
      toast.classList.add('show');
      setTimeout(() => toast.classList.remove('show'), 3000);
      
    } catch (e) {
      alert("Error enviando el reporte.");
    } finally {
      sendFeedbackBtn.textContent = 'Enviar a Admin';
    }
  };
}// =====================================================================
// 11. PANEL SECRETO DEL ADMIN (REPORTES DE IA)
// =====================================================================
const adminReportsBtn = document.getElementById('admin-reports-btn');
const adminReportsSection = document.getElementById('admin-reports-section');
const refreshReportsBtn = document.getElementById('refresh-reports-btn');
const reportsContainer = document.getElementById('reports-container');

if (adminReportsBtn) {
  adminReportsBtn.onclick = () => {
    showSection('admin'); 
    loadReports();
  };
}

// Modificamos un poco showSection para incluir la vista de admin
const originalShowSection = window.showSection; // Guardamos la original temporalmente si es necesario, o la reescribimos:
window.showSection = function(section) {
  if (translationView) translationView.style.display = section === 'menu' ? '' : 'none';
  if (chatSection) chatSection.style.display = section === 'chat' ? '' : 'none';
  if (faqSection) faqSection.style.display = section === 'faq' ? '' : 'none';
  if (adminReportsSection) adminReportsSection.style.display = section === 'admin' ? '' : 'none';
  
  [menuBtn, chatBtn, faqBtn, adminReportsBtn].forEach(btn => btn && btn.classList.remove('active'));
  
  if (section === 'menu' && menuBtn) menuBtn.classList.add('active');
  if (section === 'chat' && chatBtn) chatBtn.classList.add('active');
  if (section === 'faq' && faqBtn) faqBtn.classList.add('active');
  if (section === 'admin' && adminReportsBtn) adminReportsBtn.classList.add('active');
};

if (refreshReportsBtn) {
  refreshReportsBtn.onclick = loadReports;
}

async function loadReports() {
  if (!reportsContainer) return;
  reportsContainer.innerHTML = '<p style="color: #cbd5e1;">Cargando reportes de la base de datos...</p>';
  
  try {
    // Llamaremos a una nueva ruta en el backend
    const res = await fetch('/api/admin/reports');
    const data = await res.json();
    
    if (!res.ok) throw new Error(data.error || 'Error cargando reportes');
    
    if (data.length === 0) {
      reportsContainer.innerHTML = '<p style="color: #a894a3;">No hay reportes pendientes. Tamon se está portando bien.</p>';
      return;
    }

    reportsContainer.innerHTML = '';
    data.forEach(report => {
      const div = document.createElement('div');
      div.style.background = '#1e1c22';
      div.style.padding = '15px';
      div.style.borderRadius = '8px';
      div.style.borderLeft = '4px solid #ff007f';
      
      const fecha = new Date(report.created_at).toLocaleString();
      
      div.innerHTML = `
        <div style="font-size: 0.8rem; color: #a894a3; margin-bottom: 8px;">
          Reporte ID: ${report.id} | Fecha: ${fecha} | ID Usuario: ${report.user_id || 'Anónimo'}
        </div>
        <div style="margin-bottom: 10px;">
          <strong>🤖 Lo que dijo Tamon:</strong>
          <div style="background: #2d2a32; padding: 8px; border-radius: 4px; font-size: 0.9rem; margin-top: 4px; color: #d983ab;">
             "${report.bot_message}"
          </div>
        </div>
        <div>
          <strong style="color: #ff007f;">😡 Comentario del Usuario:</strong>
          <div style="background: #2d2a32; padding: 8px; border-radius: 4px; font-size: 0.9rem; margin-top: 4px; color: #fff;">
             "${report.user_comment}"
          </div>
        </div>
      `;
      reportsContainer.appendChild(div);
    });

  } catch (error) {
    reportsContainer.innerHTML = `<p style="color: red;">Error: ${error.message}</p>`;
  }
}