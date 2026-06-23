// =====================================================================
// 0. DIÁLOGOS Y ALERTAS PERSONALIZADOS (Estilo Tamon)
// =====================================================================
const BASE_API_URL = window.location.hostname.includes('vercel.app') 
  ? 'https://translatetamon.onrender.com' 
  : '';

function getApiUrl(path) {
  return BASE_API_URL + path;
}
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

// Nuevos selectores para traducción de texto y pestañas
const btnTabText = document.getElementById('btn-tab-text');
const btnTabFile = document.getElementById('btn-tab-file');
const workspaceText = document.getElementById('workspace-text');
const workspaceFile = document.getElementById('workspace-file');
const btnSwapLanguages = document.getElementById('btn-swap-languages');
const textInputSource = document.getElementById('text-input-source');
const textOutputTranslated = document.getElementById('text-output-translated');
const textOutputLoading = document.getElementById('text-output-loading');
const charCount = document.getElementById('char-count');
const btnClearText = document.getElementById('btn-clear-text');
const btnCopyText = document.getElementById('btn-copy-text');

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
  const tamonUser = JSON.parse(localStorage.getItem('tamon_user') || 'null');
  const plan = tamonUser ? tamonUser.plan : 'free';
  const isAdmin = tamonUser && tamonUser.role === 'admin';
  const maxSize = (plan === 'pro_plus' || isAdmin) ? 5 * 1024 * 1024 * 1024 : 1024 * 1024 * 1024;
  const displayLimit = (plan === 'pro_plus' || isAdmin) ? '5 GB' : '1 GB';

  for (let i = 0; i < files.length; i++) {
    if (files[i].size > maxSize) {
      alert(`⚠️ El archivo "${files[i].name}" supera el límite permitido de ${displayLimit} para tu plan (${plan === 'free' ? 'Tamon Chill' : 'Tamon Pro+'}).`);
      continue;
    }
    selectedFiles.push(files[i]);
  }
  renderFileList();
}

window.removeFile = function (index) {
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

function pollTranslationJob(jobId) {
  return new Promise((resolve, reject) => {
    const interval = setInterval(async () => {
      try {
        const headers = {};
        const token = localStorage.getItem('tamon_token');
        if (token) headers['Authorization'] = 'Bearer ' + token;

        const response = await fetch(getApiUrl(`/api/translate/job/${jobId}`), { headers });
        if (!response.ok) {
          const data = await response.json();
          throw new Error(data.error || 'Error al consultar el progreso del trabajo.');
        }

        const data = await response.json();

        if (typeof data.progressPercent === 'number') {
          setProcessProgress(data.progressPercent);
        }

        if (data.message) {
          setStatus(data.message);
        }

        if (etaText) {
          if (data.status === 'queued') {
            etaText.textContent = 'En cola esperando procesamiento...';
          } else if (typeof data.etaSeconds === 'number' && data.etaSeconds > 0) {
            const minutes = Math.floor(data.etaSeconds / 60);
            const seconds = data.etaSeconds % 60;
            const timeStr = minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
            etaText.textContent = `Tiempo estimado restante: ${timeStr}`;
          } else {
            etaText.textContent = '';
          }
        }

        if (data.status === 'completed') {
          clearInterval(interval);
          resolve(data.previewId);
        } else if (data.status === 'failed') {
          clearInterval(interval);
          reject(new Error(data.error || 'El procesamiento del archivo falló.'));
        }
      } catch (err) {
        clearInterval(interval);
        reject(err);
      }
    }, 2000);
  });
}

async function requestPreview(event) {
  event.preventDefault();

  const activeTab = document.querySelector('.translator-tab-btn.active');
  if (activeTab && activeTab.id === 'btn-tab-text') {
    performTextTranslation();
    return;
  }

  if (selectedFiles.length === 0) {
    alert("Por favor, arrastra o selecciona al menos un archivo.");
    return;
  }

  const fileToProcess = selectedFiles[0];
  const formData = new FormData(form);
  formData.set('document', fileToProcess);

  setStep('step-upload');
  setStatus(UI_TEXT.processing + ` (${fileToProcess.name})`);
  if (etaText) etaText.textContent = 'Iniciando subida y encolamiento...';
  setProcessProgress(3);

  try {
    const headers = {};
    const token = localStorage.getItem('tamon_token');
    if (token) headers['Authorization'] = 'Bearer ' + token;
    
    const response = await fetch(getApiUrl('/api/translate/preview-async'), { method: 'POST', headers, body: formData });
    const rawBody = await response.text();
    const initData = rawBody ? JSON.parse(rawBody) : {};

    if (!response.ok) throw new Error(initData.error || UI_TEXT.previewError);
    if (!initData.jobId) throw new Error('No se recibió el ID del trabajo asíncrono.');

    const previewId = await pollTranslationJob(initData.jobId);

    const resultRes = await fetch(getApiUrl(`/api/translate/preview-result/${previewId}`), { headers });
    if (!resultRes.ok) {
      const errData = await resultRes.json();
      throw new Error(errData.error || 'No se pudo obtener el resultado de la traducción.');
    }
    const data = await resultRes.json();

    previewState = data;
    if (previewPanel) previewPanel.classList.remove('hidden');

    if (data.docxRuns) {
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
    if (previewMeta) {
      previewMeta.textContent = `Trace: ${initData.jobId || previewId} · ` + (data.originalText ? UI_TEXT.fromModel : UI_TEXT.fromMemory);
    }
    setProcessProgress(100);
    setStep('step-preview');
    setStatus(UI_TEXT.previewReady);
  } catch (error) {
    if (etaText) etaText.textContent = '';
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
    const response = await fetch(getApiUrl('/api/translate/finalize'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + (localStorage.getItem('tamon_token') || '')
      },
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
    const origExt = previewState.originalFileName ? previewState.originalFileName.split('.').pop().toLowerCase() : 'docx';
    const downloadExt = origExt === 'pdf' ? 'pdf' : 'docx';
    const baseName = previewState.originalFileName ? previewState.originalFileName.split('.').slice(0, -1).join('.') : 'traduccion';
    anchor.download = `Tamon_${baseName}.${downloadExt}`;
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
  const servicesBtn = document.getElementById('services-btn');
  const btnProPlus = document.getElementById('btn-pro-plus');

  if (user && Object.keys(user).length > 0) {
    if (btnProPlus) {
      if (user.plan === 'pro_plus' || user.role === 'admin') {
        btnProPlus.style.display = 'none';
      } else {
        btnProPlus.style.display = 'block';
      }
    }
    const username = user.nombre || user.usuario || 'Usuario';
    if (usernameElem) {
      usernameElem.textContent = username;
      usernameElem.style.fontSize = '1.08rem';
    }

    if (servicesBtn) {
      servicesBtn.style.display = 'block';
    }

    if (usertypeElem) {
      if (user.role === 'admin') {
        usertypeElem.textContent = 'Admin';
        usertypeElem.className = 'user-badge admin';
      } else {
        if (user.plan === 'pro_plus') {
          usertypeElem.textContent = 'Tamon Pro+';
          usertypeElem.className = 'user-badge pro_plus';
        } else {
          usertypeElem.textContent = 'Tamon Chill';
          usertypeElem.className = 'user-badge chill';
        }
      }
      usertypeElem.style.display = '';
    }
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

        let adminOptionHtml = '';
        if (user.role === 'admin') {
          adminOptionHtml = `
            <a href="/admin.html" class="dropdown-menu-item">
              <span>🛠️</span> Admin Dashboard
            </a>
          `;
        }

        menu.innerHTML = `
          <div style="margin-bottom: 12px; padding: 0 4px;">
            <div style="font-weight: 700; font-size: 1.15rem; color: #fff; line-height: 1.2;">${username}</div>
            <div style="font-size: 0.85rem; margin-top: 4px; display: inline-block; padding: 3px 8px; border-radius: 6px; font-weight: 700; background: ${user.role === 'admin'
            ? 'linear-gradient(135deg, var(--tamon-primary), var(--tamon-secondary))'
            : (user.plan === 'pro_plus' ? 'var(--tamon-primary)' : 'rgba(255, 255, 255, 0.1)')
          }; color: ${user.role === 'admin' || user.plan === 'pro_plus' ? '#2d1221' : '#fff'};">
              ${user.role === 'admin' ? 'Administrador' : usertypeElem.textContent}
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
          location.reload();
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
  } else {
    if (usernameElem) {
      usernameElem.textContent = 'Inicia sesión / Regístrate';
      usernameElem.style.fontSize = '0.95rem';
    }
    if (usertypeElem) usertypeElem.style.display = 'none';
    if (servicesBtn) servicesBtn.style.display = 'block';

    if (sidebarUser) {
      sidebarUser.onclick = () => {
        const modal = document.getElementById('auth-modal');
        if (modal) modal.style.display = 'flex';
      };
    }
  }
  syncPlanButtons(user);
}

function syncPlanButtons(user) {
  const btnChill = document.getElementById('btn-select-chill');
  const btnPro = document.getElementById('btn-select-pro');
  const btnSelectChibi = document.getElementById('btn-select-chibi');
  const btnBeta = document.getElementById('btn-select-beta');

  if (!btnChill || !btnPro) return;

  if (!user || Object.keys(user).length === 0) {
    btnChill.disabled = false;
    btnChill.textContent = 'Elegir plan';
    btnChill.style.background = 'linear-gradient(135deg, #7928ca, #3b82f6)';
    btnChill.style.color = '#fff';
    btnChill.style.border = 'none';
    btnChill.style.cursor = 'pointer';
    btnChill.style.boxShadow = '0 4px 15px rgba(121,40,202,0.2)';
    btnChill.onclick = () => {
      const authModal = document.getElementById('auth-modal');
      if (authModal) authModal.style.display = 'flex';
    };

    btnPro.disabled = false;
    btnPro.textContent = 'Actualizar ahora';
    btnPro.style.background = 'linear-gradient(135deg, #ff007f, #7928ca)';
    btnPro.style.color = '#fff';
    btnPro.style.border = 'none';
    btnPro.style.cursor = 'pointer';
    btnPro.style.boxShadow = '0 4px 15px rgba(255, 0, 127, 0.3)';
    btnPro.onclick = () => {
      const authModal = document.getElementById('auth-modal');
      if (authModal) authModal.style.display = 'flex';
    };

    if (btnBeta) {
      btnBeta.disabled = false;
      btnBeta.textContent = 'Activar Beta Gratis';
      btnBeta.style.background = 'linear-gradient(135deg, #00f2fe, #4facfe)';
      btnBeta.style.color = '#000';
      btnBeta.style.border = 'none';
      btnBeta.style.cursor = 'pointer';
      btnBeta.style.boxShadow = '0 4px 15px rgba(0, 242, 254, 0.3)';
      btnBeta.onclick = () => {
        const authModal = document.getElementById('auth-modal');
        if (authModal) authModal.style.display = 'flex';
      };
    }

    if (btnSelectChibi) {
      btnSelectChibi.disabled = false;
      btnSelectChibi.textContent = 'Comprar Chibi';
      btnSelectChibi.style.background = '#ffe600';
      btnSelectChibi.style.color = '#000';
      btnSelectChibi.style.border = 'none';
      btnSelectChibi.style.cursor = 'pointer';
      btnSelectChibi.style.boxShadow = '0 4px 15px rgba(255, 230, 0, 0.2)';
      btnSelectChibi.onclick = () => {
        const authModal = document.getElementById('auth-modal');
        if (authModal) authModal.style.display = 'flex';
      };
    }
    return;
  }

  if (user.plan === 'pro_plus' || user.role === 'admin') {
    btnPro.disabled = true;
    btnPro.textContent = 'Plan Activo';
    btnPro.style.background = 'rgba(255, 255, 255, 0.05)';
    btnPro.style.color = '#888';
    btnPro.style.border = '1px solid rgba(255, 255, 255, 0.1)';
    btnPro.style.cursor = 'not-allowed';
    btnPro.style.boxShadow = 'none';
    btnPro.onclick = null;

    if (btnBeta) {
      btnBeta.disabled = true;
      btnBeta.textContent = 'Plan Beta Activo';
      btnBeta.style.background = 'rgba(255, 255, 255, 0.05)';
      btnBeta.style.color = '#888';
      btnBeta.style.border = '1px solid rgba(255, 255, 255, 0.1)';
      btnBeta.style.cursor = 'not-allowed';
      btnBeta.style.boxShadow = 'none';
      btnBeta.onclick = null;
    }

    btnChill.disabled = false;
    btnChill.textContent = 'Cambiar a Chill';
    btnChill.style.background = 'transparent';
    btnChill.style.color = '#fff';
    btnChill.style.border = '1px solid #7928ca';
    btnChill.style.cursor = 'pointer';
    btnChill.style.boxShadow = 'none';
    btnChill.onclick = () => {
      showTamonConfirm('¿Seguro que deseas volver al plan gratuito Tamon Chill?', async () => {
        try {
          const response = await fetch('/api/plans/change', {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': 'Bearer ' + localStorage.getItem('tamon_token')
            },
            body: JSON.stringify({ targetPlan: 'free' })
          });
          const data = await response.json();
          if (response.ok) {
            const updatedUser = { ...user, plan: 'free' };
            localStorage.setItem('tamon_user', JSON.stringify(updatedUser));
            alert('Has cambiado al plan Tamon Chill.');
            location.reload();
          } else {
            alert(data.error || 'Error al cambiar de plan.');
          }
        } catch (e) {
          alert('Error de conexión al cambiar de plan.');
        }
      });
    };

    if (btnSelectChibi) {
      btnSelectChibi.disabled = false;
      btnSelectChibi.textContent = 'Comprar Chibi';
      btnSelectChibi.style.background = '#ffe600';
      btnSelectChibi.style.color = '#000';
      btnSelectChibi.style.border = 'none';
      btnSelectChibi.style.cursor = 'pointer';
      btnSelectChibi.style.boxShadow = '0 4px 15px rgba(255, 230, 0, 0.2)';
      btnSelectChibi.onclick = () => {
        showPaymentScreen(user, 'chibi');
        const proModal = document.getElementById('pro-modal');
        if (proModal) proModal.style.display = 'flex';
      };
    }
  } else {
    btnChill.disabled = true;
    btnChill.textContent = 'Plan Activo';
    btnChill.style.background = 'rgba(255, 255, 255, 0.05)';
    btnChill.style.color = '#888';
    btnChill.style.border = '1px solid rgba(255, 255, 255, 0.1)';
    btnChill.style.cursor = 'not-allowed';
    btnChill.style.boxShadow = 'none';
    btnChill.onclick = null;

    btnPro.disabled = false;
    btnPro.textContent = 'Actualizar ahora';
    btnPro.style.background = 'linear-gradient(135deg, #ff007f, #7928ca)';
    btnPro.style.color = '#fff';
    btnPro.style.border = 'none';
    btnPro.style.cursor = 'pointer';
    btnPro.style.boxShadow = '0 4px 15px rgba(255, 0, 127, 0.3)';
    btnPro.onclick = () => {
      showPaymentScreen(user, 'pro_plus');
      const proModal = document.getElementById('pro-modal');
      if (proModal) proModal.style.display = 'flex';
    };

    if (btnBeta) {
      btnBeta.disabled = false;
      btnBeta.textContent = 'Activar Beta Gratis';
      btnBeta.style.background = 'linear-gradient(135deg, #00f2fe, #4facfe)';
      btnBeta.style.color = '#000';
      btnBeta.style.border = 'none';
      btnBeta.style.cursor = 'pointer';
      btnBeta.style.boxShadow = '0 4px 15px rgba(0, 242, 254, 0.3)';
      btnBeta.onclick = () => {
        showTamonConfirm('¿Deseas activar la Beta de Tamon Pro+ de forma gratuita?', async () => {
          try {
            const response = await fetch('/api/plans/change', {
              method: 'PUT',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + localStorage.getItem('tamon_token')
              },
              body: JSON.stringify({ targetPlan: 'pro_plus' })
            });
            const data = await response.json();
            if (response.ok) {
              const updatedUser = { ...user, plan: 'pro_plus' };
              localStorage.setItem('tamon_user', JSON.stringify(updatedUser));
              alert('¡Felicidades! Has activado Tamon Pro+ Beta de forma gratuita.');
              location.reload();
            } else {
              alert(data.error || 'Error al activar el plan Beta.');
            }
          } catch (e) {
            alert('Error de conexión al activar el plan Beta.');
          }
        });
      };
    }

    if (btnSelectChibi) {
      btnSelectChibi.disabled = false;
      btnSelectChibi.textContent = 'Comprar Chibi';
      btnSelectChibi.style.background = '#ffe600';
      btnSelectChibi.style.color = '#000';
      btnSelectChibi.style.border = 'none';
      btnSelectChibi.style.cursor = 'pointer';
      btnSelectChibi.style.boxShadow = '0 4px 15px rgba(255, 230, 0, 0.2)';
      btnSelectChibi.onclick = () => {
        showPaymentScreen(user, 'chibi');
        const proModal = document.getElementById('pro-modal');
        if (proModal) proModal.style.display = 'flex';
      };
    }
  }
}


const usuarioGuardado = localStorage.getItem('tamon_user');
const tokenGuardado = localStorage.getItem('tamon_token');
if (usuarioGuardado && tokenGuardado) {
  try { updateSidebarUser(JSON.parse(usuarioGuardado)); }
  catch (e) { updateSidebarUser(null); }
} else {
  localStorage.removeItem('tamon_user');
  localStorage.removeItem('tamon_token');
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
        if (data.requiereVerificacion) {
          // Cambiar a la sección de verificación por código OTP
          document.getElementById('auth-credentials-section').style.display = 'none';
          document.getElementById('auth-verification-section').style.display = 'block';
          document.getElementById('verification-email-target').textContent = data.correo;
          document.getElementById('verification-code').value = '';
          document.getElementById('verification-code').focus();
        } else {
          localStorage.setItem('tamon_user', JSON.stringify(data.usuario));
          if (data.token) localStorage.setItem('tamon_token', data.token);
          authModal.style.display = 'none';
          updateSidebarUser(data.usuario);
        }
      } else {
        if (data.requiereVerificacion) {
          // En caso de que el login retorne error porque la cuenta sigue pendiente
          document.getElementById('auth-credentials-section').style.display = 'none';
          document.getElementById('auth-verification-section').style.display = 'block';
          document.getElementById('verification-email-target').textContent = data.correo;
          document.getElementById('verification-code').value = '';
          document.getElementById('verification-code').focus();
          alert(data.error);
        } else {
          alert(data.error);
        }
      }
    } catch (err) {
      alert('Error de conexión.');
    } finally {
      document.getElementById('auth-submit-btn').textContent = isLoginMode ? 'Entrar a Tamon' : 'Registrarse';
    }
  });
}

// --- MANEJADORES DE LA VERIFICACIÓN DE CÓDIGO (OTP) ---
const verificationForm = document.getElementById('verification-form');
if (verificationForm) {
  verificationForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const submitBtn = document.getElementById('verification-submit-btn');
    const codigoInput = document.getElementById('verification-code');
    const correo = document.getElementById('verification-email-target').textContent;
    
    submitBtn.textContent = 'Verificando...';
    submitBtn.disabled = true;
    try {
      const response = await fetch('/api/auth/verify-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ correo, codigo: codigoInput.value.trim() })
      });
      const data = await response.json();
      if (response.ok) {
        alert(data.mensaje || '¡Cuenta verificada con éxito!');
        localStorage.setItem('tamon_user', JSON.stringify(data.usuario));
        if (data.token) localStorage.setItem('tamon_token', data.token);
        
        // Limpiar el estado de los contenedores
        document.getElementById('auth-credentials-section').style.display = 'block';
        document.getElementById('auth-verification-section').style.display = 'none';
        
        authModal.style.display = 'none';
        updateSidebarUser(data.usuario);
        location.reload();
      } else {
        alert(data.error || 'El código es incorrecto.');
      }
    } catch (err) {
      alert('Error de conexión al verificar el código.');
    } finally {
      submitBtn.textContent = 'Verificar Cuenta';
      submitBtn.disabled = false;
    }
  });
}

const verificationResendBtn = document.getElementById('verification-resend-btn');
if (verificationResendBtn) {
  verificationResendBtn.addEventListener('click', async () => {
    const correo = document.getElementById('verification-email-target').textContent;
    if (!correo) return;
    
    verificationResendBtn.style.pointerEvents = 'none';
    verificationResendBtn.style.opacity = '0.5';
    verificationResendBtn.textContent = 'Enviando...';
    
    try {
      const response = await fetch('/api/auth/resend-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ correo })
      });
      const data = await response.json();
      if (response.ok) {
        alert('Se ha enviado un nuevo código de 6 dígitos a tu correo.');
      } else {
        alert(data.error || 'Error al re-enviar el código.');
      }
    } catch (err) {
      alert('Error de conexión al solicitar el nuevo código.');
    } finally {
      verificationResendBtn.style.pointerEvents = 'auto';
      verificationResendBtn.style.opacity = '1';
      verificationResendBtn.textContent = 'Re-enviar código';
    }
  });
}

const verificationBackBtn = document.getElementById('verification-back-btn');
if (verificationBackBtn) {
  verificationBackBtn.addEventListener('click', () => {
    document.getElementById('auth-credentials-section').style.display = 'block';
    document.getElementById('auth-verification-section').style.display = 'none';
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
        usageCounter.innerHTML = `🌟 Tamon Pro+: <span style="color: var(--tamon-primary); font-weight: bold;">Ilimitado</span> (Usados hoy: ${data.usados})`;
      } else {
        const colorAlerta = restantes <= 3 ? 'var(--tamon-secondary)' : 'var(--tamon-primary)';
        usageCounter.innerHTML = `Cuota Chill: <span style="color: ${colorAlerta}; font-weight: bold;">${restantes} restantes</span> de ${data.total}`;
      }
    } else {
      const errData = await response.json().catch(() => ({}));
      usageCounter.textContent = errData.error || 'Error cargando cuota';
      if (response.status === 401 || response.status === 400 || (errData.error && errData.error.includes('Sesión'))) {
        localStorage.removeItem('tamon_user');
        localStorage.removeItem('tamon_token');
        updateSidebarUser(null);
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


if (btnProPlus && proModal) {
  btnProPlus.addEventListener('click', () => {
    const userJson = localStorage.getItem('tamon_user');
    const user = userJson ? JSON.parse(userJson) : null;
    restoreModalBenefits(user);
    proModal.style.display = 'flex';
  });
}
window.addEventListener('click', e => { if (e.target === proModal) proModal.style.display = 'none'; });

// Botón "Quizás luego" cierra el modal
const closeModalBtn = document.getElementById('close-modal-btn');
if (closeModalBtn && proModal) {
  closeModalBtn.addEventListener('click', () => {
    proModal.style.display = 'none';
  });
}

function restoreModalBenefits(user) {
  const modalBody = document.getElementById('pro-modal-body');
  if (!modalBody) return;

  modalBody.innerHTML = `
    <h2 style="margin-top: 0; color: #ff007f; font-size: 1.8rem;">✨ Tamon Pro+</h2>
    <p style="color: #cbd5e1; margin-bottom: 20px;">Desbloquea el poder total del aprendizaje hiperautomatizado y olvídate de los límites diarios.</p>
    
    <ul style="text-align: left; line-height: 1.8; margin-bottom: 25px; list-style: none; padding-left: 0;">
      <li>✅ <strong>Documentos ilimitados:</strong> Sin tope de 10 archivos al día.</li>
      <li>🚀 <strong>Motor VIP Oficial:</strong> Cero bloqueos de servidor.</li>
      <li>📚 <strong>Memoria extendida:</strong> Tamon aprende más rápido de ti.</li>
    </ul>
    
    <div style="display: flex; justify-content: center; gap: 15px;">
      <button id="close-modal-btn-restore" style="background: transparent; border: 1px solid #cbd5e1; color: #cbd5e1; padding: 10px 20px; border-radius: 8px; cursor: pointer; font-weight: bold; transition: 0.2s;">Quizás luego</button>
      <button id="btn-upgrade-now" style="background: linear-gradient(135deg, #ff007f, #7928ca); color: white; border: none; padding: 10px 20px; border-radius: 8px; cursor: pointer; font-weight: bold; box-shadow: 0 4px 15px rgba(255, 0, 127, 0.4);">Actualizar ahora</button>
    </div>
  `;

  document.getElementById('close-modal-btn-restore').onclick = () => {
    proModal.style.display = 'none';
  };

  document.getElementById('btn-upgrade-now').onclick = () => {
    if (!user) {
      alert('Debes iniciar sesión para actualizar tu plan.');
      proModal.style.display = 'none';
      const authModal = document.getElementById('auth-modal');
      if (authModal) authModal.style.display = 'flex';
      return;
    }
    showPaymentScreen(user);
  };
}

function showPaymentScreen(user, itemType = 'pro_plus') {
  const modalBody = document.getElementById('pro-modal-body');
  if (!modalBody) return;

  const isProPlus = itemType === 'pro_plus';
  const itemName = isProPlus ? 'Tamon Pro+' : 'Recarga Flash (Chibi)';
  const itemPrice = isProPlus ? 'S/ 17.80 al mes' : 'S/ 8.50';
  const itemDesc = isProPlus
    ? 'Desbloquea 50 documentos diarios, traductor de alta fidelidad, IA con modelos Pro y velocidad VIP.'
    : 'Agrega +10 documentos a tu cuota diaria de traducciones hoy. Acumulable y aplicable a tu cuenta.';

  modalBody.innerHTML = `
    <h2 style="margin-top: 0; color: #ff007f; font-size: 1.5rem;">💳 Método de Pago</h2>
    <div style="background: rgba(255,255,255,0.03); padding: 12px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.08); margin-bottom: 20px; text-align: left;">
      <div style="font-size: 0.8rem; color: #a894a3; text-transform: uppercase;">Producto seleccionado</div>
      <div style="font-weight: bold; font-size: 1.1rem; color: #fff; margin-top: 2px;">${itemName}</div>
      <div style="font-size: 0.85rem; color: #cbd5e1; margin-top: 4px;">${itemDesc}</div>
      <div style="font-size: 1.25rem; font-weight: bold; color: #ffe600; margin-top: 10px;">${itemPrice}</div>
    </div>
    <p style="color: #cbd5e1; margin-bottom: 15px; font-size: 0.9rem;">Selecciona cómo deseas realizar tu pago:</p>
    
    <div style="display: flex; flex-direction: column; gap: 12px; margin-bottom: 20px;">
      <button id="btn-pay-card" style="display: flex; align-items: center; justify-content: center; gap: 8px; width: 100%; padding: 12px; background: rgba(255,255,255,0.06); color: #fff; border: 1px solid #7928ca; border-radius: 10px; font-weight: bold; cursor: pointer; transition: 0.2s;" onmouseover="this.style.background='rgba(121,40,202,0.15)'" onmouseout="this.style.background='rgba(255,255,255,0.06)'">
        <span>💳</span> Tarjeta de Crédito / Débito
      </button>
      <button id="btn-pay-cash" style="display: flex; align-items: center; justify-content: center; gap: 8px; width: 100%; padding: 12px; background: rgba(255, 230, 0, 0.08); color: #ffe600; border: 1px solid #ffe600; border-radius: 10px; font-weight: bold; cursor: pointer; transition: 0.2s;" onmouseover="this.style.background='rgba(255, 230, 0, 0.18)'" onmouseout="this.style.background='rgba(255, 230, 0, 0.08)'">
        <span>💵</span> PagoEfectivo (Banca Móvil / Agentes)
      </button>
    </div>
    
    <button id="btn-payment-back" style="background: transparent; border: 1px solid #cbd5e1; color: #cbd5e1; padding: 8px 16px; border-radius: 8px; cursor: pointer; font-weight: bold; font-size: 0.9rem;">Atrás</button>
  `;

  document.getElementById('btn-payment-back').onclick = () => {
    restoreModalBenefits(user);
  };

  document.getElementById('btn-pay-card').onclick = () => {
    showCardPaymentForm(user, itemType);
  };

  document.getElementById('btn-pay-cash').onclick = () => {
    showCashPaymentForm(user, itemType);
  };
}

function showCardPaymentForm(user, itemType = 'pro_plus') {
  const modalBody = document.getElementById('pro-modal-body');
  if (!modalBody) return;

  const isProPlus = itemType === 'pro_plus';
  const itemName = isProPlus ? 'Tamon Pro+' : 'Recarga Flash (Chibi)';
  const itemPrice = isProPlus ? 'S/ 17.80' : 'S/ 8.50';

  modalBody.innerHTML = `
    <h2 style="margin-top: 0; color: #ff007f; font-size: 1.5rem;">💳 Tarjeta de Crédito / Débito</h2>
    <p style="color: #cbd5e1; margin-bottom: 15px; font-size: 0.85rem; line-height: 1.3;">Ingresa los datos de tu tarjeta para procesar el pago de forma segura.</p>
    
    <div style="background: rgba(255,255,255,0.03); padding: 8px 12px; border-radius: 6px; border: 1px solid rgba(255,255,255,0.08); margin-bottom: 12px; font-size: 0.85rem; text-align: left; display: flex; justify-content: space-between; align-items: center;">
      <span style="color: #cbd5e1;">Pagarás: <strong>${itemName}</strong></span>
      <span style="color: #ffe600; font-weight: bold;">${itemPrice}</span>
    </div>

    <form id="simulated-card-form" style="display: flex; flex-direction: column; gap: 10px; text-align: left; width: 100%;">
      <label style="font-size: 0.85rem; color: #cbd5e1; font-weight: bold;">Número de Tarjeta
        <input type="text" id="card-num" placeholder="4242 4242 4242 4242" required style="width: 100%; padding: 8px; background: #1e1c22; border: 1px solid #7928ca; color:#fff;" />
      </label>
      <div style="display: flex; gap: 10px;">
        <label style="flex: 1; font-size: 0.85rem; color: #cbd5e1; font-weight: bold;">Expiración (MM/AA)
          <input type="text" id="card-exp" placeholder="12/29" required style="width: 100%; padding: 8px; background: #1e1c22; border: 1px solid #7928ca; color:#fff;" />
        </label>
        <label style="flex: 1; font-size: 0.85rem; color: #cbd5e1; font-weight: bold;">CVC
          <input type="text" id="card-cvc" placeholder="123" required style="width: 100%; padding: 8px; background: #1e1c22; border: 1px solid #7928ca; color:#fff;" />
        </label>
      </div>
      <label style="font-size: 0.85rem; color: #cbd5e1; font-weight: bold;">Nombre del Titular
        <input type="text" id="card-name" placeholder="${user.nombre || 'Usuario'}" required style="width: 100%; padding: 8px; background: #1e1c22; border: 1px solid #7928ca; color:#fff;" />
      </label>
      
      <button type="submit" id="btn-submit-payment" style="width: 100%; padding: 12px; margin-top: 15px; background: linear-gradient(135deg, #ff007f, #7928ca); color: #fff; border: none; border-radius: 8px; font-weight: bold; cursor: pointer;">
        Confirmar y Pagar ${itemPrice}
      </button>
    </form>
    
    <button id="btn-card-back" style="background: transparent; border: none; color: #cbd5e1; cursor: pointer; text-decoration: underline; margin-top: 15px; font-size: 0.9rem;">Atrás</button>
  `;

  document.getElementById('btn-card-back').onclick = () => {
    showPaymentScreen(user, itemType);
  };

  document.getElementById('simulated-card-form').onsubmit = async (e) => {
    e.preventDefault();
    const btn = document.getElementById('btn-submit-payment');
    btn.textContent = 'Procesando pago...';
    btn.disabled = true;

    try {
      const endpoint = isProPlus ? '/api/plans/upgrade' : '/api/plans/buy-chibi';
      const bodyPayload = isProPlus ? { targetPlan: 'pro_plus' } : {};

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + localStorage.getItem('tamon_token')
        },
        body: JSON.stringify(bodyPayload)
      });
      const data = await response.json();

      if (response.ok) {
        let successMessage = '';
        if (isProPlus) {
          const updatedUser = { ...user, plan: 'pro_plus' };
          localStorage.setItem('tamon_user', JSON.stringify(updatedUser));
          successMessage = `
            <h2 style="color: #7928ca; font-size: 1.8rem; margin-top: 0;">¡Pago Exitoso! 🎉</h2>
            <p style="color: #cbd5e1; margin-top: 15px;">Tu cuenta ha sido actualizada con éxito a <strong>Tamon Pro+</strong>.</p>
            <p style="color: #ff007f; font-weight: bold; font-size: 1.1rem; margin-top: 10px;">¡Tu límite diario ahora es de 50 documentos!</p>
          `;
        } else {
          successMessage = `
            <h2 style="color: #ffe600; font-size: 1.8rem; margin-top: 0;">¡Recarga Exitosa! ⚡</h2>
            <p style="color: #cbd5e1; margin-top: 15px;">Se ha cargado un <strong>Chibi (+10 documentos)</strong> a tu cuota diaria.</p>
            <p style="color: #ffe600; font-weight: bold; font-size: 1.1rem; margin-top: 10px;">¡Tus documentos se agregaron con éxito!</p>
          `;
        }

        modalBody.innerHTML = `
          ${successMessage}
          <button id="btn-payment-success-close" style="margin-top: 25px; padding: 10px 20px; background: #7928ca; color:#fff; border:none; border-radius: 8px; cursor: pointer; font-weight:bold;">Aceptar y Actualizar</button>
        `;
        document.getElementById('btn-payment-success-close').onclick = () => {
          location.reload();
        };
      } else {
        alert(data.error || 'Error al procesar el pago.');
        btn.textContent = `Confirmar y Pagar ${itemPrice}`;
        btn.disabled = false;
      }
    } catch (err) {
      alert('Error de conexión.');
      btn.textContent = `Confirmar y Pagar ${itemPrice}`;
      btn.disabled = false;
    }
  };
}

function showCashPaymentForm(user, itemType = 'pro_plus') {
  const modalBody = document.getElementById('pro-modal-body');
  if (!modalBody) return;

  const isProPlus = itemType === 'pro_plus';
  const itemName = isProPlus ? 'Tamon Pro+' : 'Recarga Flash (Chibi)';
  const itemPrice = isProPlus ? 'S/ 17.80' : 'S/ 8.50';

  const cipCode = Math.floor(10000000 + Math.random() * 90000000);

  modalBody.innerHTML = `
    <!-- Header estilo PagoEfectivo -->
    <div style="background: #ffe600; color: #000; padding: 10px; border-radius: 10px; font-weight: bold; font-size: 1.2rem; display: flex; align-items: center; justify-content: center; gap: 8px; margin-bottom: 15px;">
      <span>💵</span> PagoEfectivo
    </div>
    <p style="color: #cbd5e1; margin-bottom: 15px; font-size: 0.9rem; line-height: 1.3;">Genera tu código CIP y realiza el pago a través de tu banca móvil o en agentes autorizados.</p>
    
    <div style="background: #1e1c22; padding: 15px; border-radius: 8px; border: 1.5px dashed #ffe600; margin: 15px 0;">
      <div style="font-size: 0.8rem; color: #a894a3; text-transform: uppercase; letter-spacing: 1px;">Código CIP generado</div>
      <div id="cip-value" style="font-size: 1.8rem; font-weight: bold; color: #ffe600; margin: 5px 0; font-family: monospace;">${cipCode}</div>
      <button id="btn-copy-cip" style="background: rgba(255,230,0,0.1); border: 1px solid #ffe600; color: #ffe600; padding: 4px 10px; border-radius: 6px; font-size: 0.75rem; font-weight: bold; cursor: pointer; margin-top: 5px; transition: 0.2s;" onmouseover="this.style.background='rgba(255,230,0,0.2)'" onmouseout="this.style.background='rgba(255,230,0,0.1)'">
        📋 Copiar Código CIP
      </button>
      <div style="font-size: 0.85rem; color: #fff; font-weight: bold; margin-top: 10px;">Total a pagar: ${itemPrice}</div>
    </div>
    
    <div style="text-align: left; font-size: 0.8rem; color: #cbd5e1; background: rgba(255,255,255,0.02); padding: 12px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.06); margin-bottom: 20px; line-height: 1.4;">
      <strong style="color: #ffe600; display: block; margin-bottom: 4px;">¿Cómo pagar en Perú?</strong>
      1. Entra a tu app bancaria (BCP, BBVA, Interbank, Scotiabank, etc.) o banca por internet.<br>
      2. Selecciona: <strong>Pago de Servicios</strong> > Buscar empresa <strong>"PagoEfectivo"</strong>.<br>
      3. Ingresa el código CIP de arriba y confirma el pago.<br>
      4. O paga físicamente indicando el código CIP en cualquier <strong>Agente BCP, Agente Interbank, Tambo</strong> o bodegas autorizadas.
    </div>
    
    <button id="btn-submit-cash-payment" style="width: 100%; padding: 12px; background: #ffe600; color: #000; border: none; border-radius: 8px; font-weight: bold; cursor: pointer; margin-bottom: 12px; box-shadow: 0 4px 15px rgba(255, 230, 0, 0.25); transition: 0.2s;" onmouseover="this.style.transform='scale(1.02)'" onmouseout="this.style.transform='scale(1)'">
      Confirmar Pago
    </button>
    
    <button id="btn-cash-back" style="background: transparent; border: none; color: #cbd5e1; cursor: pointer; text-decoration: underline; font-size: 0.9rem;">Atrás</button>
  `;

  document.getElementById('btn-copy-cip').onclick = () => {
    navigator.clipboard.writeText(cipCode.toString()).then(() => {
      const toast = document.getElementById('tamon-toast');
      if (toast) {
        toast.textContent = '¡Código CIP copiado al portapapeles! 📋';
        toast.classList.add('show');
        setTimeout(() => toast.classList.remove('show'), 3000);
      }
    });
  };

  document.getElementById('btn-cash-back').onclick = () => {
    showPaymentScreen(user, itemType);
  };

  document.getElementById('btn-submit-cash-payment').onclick = async () => {
    const btn = document.getElementById('btn-submit-cash-payment');
    btn.textContent = 'Verificando pago...';
    btn.disabled = true;

    try {
      const endpoint = isProPlus ? '/api/plans/upgrade' : '/api/plans/buy-chibi';
      const bodyPayload = isProPlus ? { targetPlan: 'pro_plus' } : {};

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + localStorage.getItem('tamon_token')
        },
        body: JSON.stringify(bodyPayload)
      });
      const data = await response.json();

      if (response.ok) {
        let successMessage = '';
        if (isProPlus) {
          const updatedUser = { ...user, plan: 'pro_plus' };
          localStorage.setItem('tamon_user', JSON.stringify(updatedUser));
          successMessage = `
            <h2 style="color: #ffe600; font-size: 1.8rem; margin-top: 0;">¡Pago Completado! 🎉</h2>
            <p style="color: #cbd5e1; margin-top: 15px;">El CIP <strong>${cipCode}</strong> ha sido verificado y procesado con éxito.</p>
            <p style="color: #ffe600; font-weight: bold; font-size: 1.1rem; margin-top: 10px;">¡Tu plan Tamon Pro+ ya está activo!</p>
          `;
        } else {
          successMessage = `
            <h2 style="color: #ffe600; font-size: 1.8rem; margin-top: 0;">¡Recarga Completada! ⚡</h2>
            <p style="color: #cbd5e1; margin-top: 15px;">El CIP <strong>${cipCode}</strong> ha sido procesado con éxito.</p>
            <p style="color: #ffe600; font-weight: bold; font-size: 1.1rem; margin-top: 10px;">¡Se ha agregado un Chibi (+10 documentos)!</p>
          `;
        }

        modalBody.innerHTML = `
          ${successMessage}
          <button id="btn-payment-success-close" style="margin-top: 25px; padding: 10px 20px; background: #ffe600; color:#000; border:none; border-radius: 8px; cursor: pointer; font-weight:bold;">Aceptar y Actualizar</button>
        `;
        document.getElementById('btn-payment-success-close').onclick = () => {
          location.reload();
        };
      } else {
        alert(data.error || 'Error al validar el pago.');
        btn.textContent = 'Confirmar Pago';
        btn.disabled = false;
      }
    } catch (err) {
      alert('Error de conexión.');
      btn.textContent = 'Confirmar Pago';
      btn.disabled = false;
    }
  };
}

// =====================================================================
// 8. CHAT TAMON Y FAQ
// =====================================================================
// if (quickTranslateForm) quickTranslateForm.addEventListener('submit', e => { e.preventDefault(); alert("Función en desarrollo."); });
if (form) form.addEventListener('submit', requestPreview);
if (finalizeBtn) finalizeBtn.addEventListener('click', finalizeTranslation);

let debounceTimeout;
function debounceTranslate() {
  clearTimeout(debounceTimeout);
  debounceTimeout = setTimeout(performTextTranslation, 600);
}

async function performTextTranslation() {
  if (!textInputSource) return;
  const text = textInputSource.value.trim();
  const sourceLang = sourceLanguageSelect ? sourceLanguageSelect.value : '';
  const targetLang = targetLanguageSelect ? targetLanguageSelect.value : '';

  if (!text) {
    if (textOutputTranslated) textOutputTranslated.value = '';
    if (btnClearText) btnClearText.style.display = 'none';
    if (btnCopyText) btnCopyText.style.display = 'none';
    return;
  }

  if (btnClearText) btnClearText.style.display = 'block';
  if (textOutputLoading) textOutputLoading.style.display = 'flex';

  try {
    const userObj = JSON.parse(localStorage.getItem('tamon_user') || '{}');
    const response = await fetch('/api/assistant/translate-text', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        userName: userObj.nombre || 'usuario',
        text: text,
        sourceLanguage: sourceLang,
        targetLanguage: targetLang
      })
    });

    const data = await response.json();
    if (response.ok) {
      if (textOutputTranslated) {
        textOutputTranslated.value = data.translatedText || '';
      }
      if (btnCopyText) btnCopyText.style.display = 'block';
    } else {
      if (textOutputTranslated) {
        textOutputTranslated.value = `Error: ${data.error || 'No se pudo traducir.'}`;
      }
      if (btnCopyText) btnCopyText.style.display = 'none';
    }
  } catch (error) {
    if (textOutputTranslated) {
      textOutputTranslated.value = 'Error de conexión con Tamon IA.';
    }
    if (btnCopyText) btnCopyText.style.display = 'none';
  } finally {
    if (textOutputLoading) textOutputLoading.style.display = 'none';
  }
}

function initRestructuredWorkspace() {
  if (btnTabText && btnTabFile && workspaceText && workspaceFile) {
    btnTabText.onclick = () => {
      btnTabText.classList.add('active');
      btnTabFile.classList.remove('active');
      workspaceText.classList.remove('hidden');
      workspaceFile.classList.add('hidden');
      performTextTranslation();
    };

    btnTabFile.onclick = () => {
      btnTabFile.classList.add('active');
      btnTabText.classList.remove('active');
      workspaceFile.classList.remove('hidden');
      workspaceText.classList.add('hidden');
    };
  }

  if (textInputSource) {
    textInputSource.addEventListener('input', (e) => {
      const len = e.target.value.length;
      if (charCount) charCount.textContent = `${len} / 5000`;
      if (len > 0) {
        if (btnClearText) btnClearText.style.display = 'block';
      } else {
        if (btnClearText) btnClearText.style.display = 'none';
      }
      debounceTranslate();
    });
  }

  if (btnClearText) {
    btnClearText.onclick = () => {
      if (textInputSource) textInputSource.value = '';
      if (textOutputTranslated) textOutputTranslated.value = '';
      if (charCount) charCount.textContent = '0 / 5000';
      btnClearText.style.display = 'none';
      if (btnCopyText) btnCopyText.style.display = 'none';
    };
  }

  if (btnCopyText && textOutputTranslated) {
    btnCopyText.onclick = () => {
      navigator.clipboard.writeText(textOutputTranslated.value).then(() => {
        const originalHtml = btnCopyText.innerHTML;
        btnCopyText.innerHTML = `✓`;
        btnCopyText.style.color = '#10b981';
        setTimeout(() => {
          btnCopyText.innerHTML = originalHtml;
          btnCopyText.style.color = '';
        }, 2000);
      });
    };
  }

  const btnCopyPreviewText = document.getElementById('btn-copy-preview-text');
  if (btnCopyPreviewText && translatedTextInput) {
    btnCopyPreviewText.onclick = () => {
      navigator.clipboard.writeText(translatedTextInput.value).then(() => {
        const originalHtml = btnCopyPreviewText.innerHTML;
        btnCopyPreviewText.innerHTML = `✓`;
        btnCopyPreviewText.style.color = '#10b981';
        setTimeout(() => {
          btnCopyPreviewText.innerHTML = originalHtml;
          btnCopyPreviewText.style.color = '';
        }, 2000);
      });
    };
  }

  if (btnSwapLanguages && sourceLanguageSelect && targetLanguageSelect) {
    btnSwapLanguages.onclick = () => {
      const temp = sourceLanguageSelect.value;
      sourceLanguageSelect.value = targetLanguageSelect.value;
      targetLanguageSelect.value = temp;
      debounceTranslate();
    };
  }

  if (sourceLanguageSelect) {
    sourceLanguageSelect.addEventListener('change', debounceTranslate);
  }
  if (targetLanguageSelect) {
    targetLanguageSelect.addEventListener('change', debounceTranslate);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  populateLanguages();
  initRestructuredWorkspace();
  showSection('menu');

  document.querySelectorAll('.faq-question').forEach(btn => {
    btn.addEventListener('click', function () { this.parentElement.classList.toggle('active'); });
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

const servicesBtn = document.getElementById('services-btn');
const servicesSection = document.getElementById('services-section');

if (servicesBtn) {
  servicesBtn.onclick = () => {
    showSection('services');
  };
}

// Modificamos un poco showSection para incluir la vista de admin y planes
const originalShowSection = window.showSection;
window.showSection = function (section) {
  if (translationView) translationView.style.display = section === 'menu' ? '' : 'none';
  if (chatSection) chatSection.style.display = section === 'chat' ? '' : 'none';
  if (faqSection) faqSection.style.display = section === 'faq' ? '' : 'none';
  if (adminReportsSection) adminReportsSection.style.display = section === 'admin' ? '' : 'none';
  if (servicesSection) servicesSection.style.display = section === 'services' ? '' : 'none';

  [menuBtn, chatBtn, faqBtn, adminReportsBtn, servicesBtn].forEach(btn => btn && btn.classList.remove('active'));

  if (section === 'menu' && menuBtn) menuBtn.classList.add('active');
  if (section === 'chat' && chatBtn) chatBtn.classList.add('active');
  if (section === 'faq' && faqBtn) faqBtn.classList.add('active');
  if (section === 'admin' && adminReportsBtn) adminReportsBtn.classList.add('active');
  if (section === 'services' && servicesBtn) servicesBtn.classList.add('active');
};

if (refreshReportsBtn) {
  refreshReportsBtn.onclick = loadReports;
}

async function loadReports() {
  if (!reportsContainer) return;
  reportsContainer.innerHTML = '<p style="color: #cbd5e1;">Cargando reportes de la base de datos...</p>';

  try {
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

// Registro de botones para comprar planes en la vista Nuestros Planes y Servicios
// El control de clics para btn-select-pro y btn-select-chill se realiza dinámicamente en syncPlanButtons(user)

const btnSelectChibi = document.getElementById('btn-select-chibi');
if (btnSelectChibi) {
  btnSelectChibi.onclick = () => {
    const userJson = localStorage.getItem('tamon_token') ? localStorage.getItem('tamon_user') : null;
    if (!userJson) {
      const authModal = document.getElementById('auth-modal');
      if (authModal) authModal.style.display = 'flex';
      return;
    }
    showPaymentScreen(JSON.parse(userJson), 'chibi');
    const proModal = document.getElementById('pro-modal');
    if (proModal) proModal.style.display = 'flex';
  };
}