// --- Sidebar toggle (hamburguesa) ---
const sidebar = document.querySelector('.sidebar');
const sidebarToggle = document.getElementById('sidebar-toggle');
if (sidebarToggle && sidebar) {
  sidebarToggle.addEventListener('click', () => {
    sidebar.classList.toggle('hide');
    sidebarToggle.classList.toggle('active');
  });
}
const LANGUAGES = [
  { value: 'es', label: 'Español' },
  { value: 'en', label: 'English' },
  { value: 'pt', label: 'Português' },
  { value: 'fr', label: 'Français' },
  { value: 'de', label: 'Deutsch' },
  { value: 'it', label: 'Italiano' }
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

// Selectores robustos (no fallan si no existe el elemento)
const form = document.querySelector('#translate-form') || null;
const commentsForm = document.querySelector('#comments-form') || null;
const quickTranslateForm = document.querySelector('#quick-translate-form') || null;
const previewPanel = document.querySelector('#preview-panel') || null;
const previewMeta = document.querySelector('#preview-meta') || null;
const etaText = document.querySelector('#eta-text') || null;
const translatedTextInput = document.querySelector('#translatedText') || null;
const originalTextPreview = document.querySelector('#originalTextPreview') || null;
const assistantStatus = document.querySelector('#assistant-status') || null;
const commentsStatus = document.querySelector('#comments-status') || null;
const quickTranslateStatus = document.querySelector('#quick-translate-status') || null;
const quickTranslateOutput = document.querySelector('#quick-translate-output') || null;
const finalizeBtn = document.querySelector('#finalize-btn') || null;
const sourceLanguageSelect = document.querySelector('#sourceLanguage') || null;
const targetLanguageSelect = document.querySelector('#targetLanguage') || null;
const commentSourceLanguage = document.querySelector('#commentSourceLanguage') || null;
const commentTargetLanguage = document.querySelector('#commentTargetLanguage') || null;
const quickSourceLanguage = document.querySelector('#quickSourceLanguage') || null;
const quickTargetLanguage = document.querySelector('#quickTargetLanguage') || null;
const processProgress = document.querySelector('#process-progress') || null;
const historyProgress = document.querySelector('#history-progress') || null;
const tabTranslation = document.querySelector('#tab-translation') || null;
const tabComments = document.querySelector('#tab-comments') || null;
const translationView = document.getElementById('translation-view') || null;
const commentsView = document.getElementById('comments-view') || null;

let previewState = null;
let processTicker = null;

function setStep(stepId) {
  const steps = document.querySelectorAll('.flow-steps li');
  steps.forEach((item) => item.classList.remove('active'));
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

function populateSelect(select) {
  if (!select) return;
  LANGUAGES.forEach(({ value, label }) => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    select.appendChild(option);
  });
}

function populateLanguages() {
  [
    sourceLanguageSelect,
    targetLanguageSelect,
    commentSourceLanguage,
    commentTargetLanguage,
    quickSourceLanguage,
    quickTargetLanguage
  ].forEach(sel => sel && populateSelect(sel));
  if (sourceLanguageSelect) sourceLanguageSelect.value = 'en';
  if (targetLanguageSelect) targetLanguageSelect.value = 'es';
  if (commentSourceLanguage) commentSourceLanguage.value = 'en';
  if (commentTargetLanguage) commentTargetLanguage.value = 'es';
  if (quickSourceLanguage) quickSourceLanguage.value = 'en';
  if (quickTargetLanguage) quickTargetLanguage.value = 'es';
}


function showTranslationTab() {
  if (tabTranslation) tabTranslation.classList.add('is-active');
  if (tabComments) tabComments.classList.remove('is-active');
  if (translationView) translationView.classList.remove('hidden');
  if (commentsView) commentsView.classList.add('hidden');
}

function showCommentsTab() {
  if (tabComments) tabComments.classList.add('is-active');
  if (tabTranslation) tabTranslation.classList.remove('is-active');
  if (commentsView) commentsView.classList.remove('hidden');
  if (translationView) translationView.classList.add('hidden');
}

function startProcessTicker(estimatedSeconds) {
  if (processTicker) clearInterval(processTicker);
  const maxSeconds = Math.max(Math.min(estimatedSeconds || DEFAULT_ESTIMATED_SECONDS, MAX_ESTIMATED_SECONDS), 10);
  let elapsed = 0;
  setProcessProgress(3);
  if (etaText) etaText.textContent = `Tiempo estimado de traducción: ${Math.ceil(maxSeconds / 60)} min (menos de 1 día).`;
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

function estimateByFileSize(file) {
  if (!file) return 600;
  return Math.max(Math.ceil(file.size / 8000), 60);
}

async function loadAssistantStatus() {
  try {
    const response = await fetch('/api/assistant/status');
    if (!response.ok) return;
    const data = await response.json();
    
    setHistoryProgress(data.learning?.learningProgressPercent || 0);
    
    const limitElement = document.querySelector('#tamon-daily-limit');
    if (limitElement && data.serviceCommitment?.dailyLimits) {
      limitElement.textContent = data.serviceCommitment.dailyLimits;
    }

    const counterElement = document.querySelector('#usage-counter');
    if (counterElement && data.serviceCommitment?.remainingDocs !== undefined) {
      const remaining = data.serviceCommitment.remainingDocs;
      counterElement.textContent = `Gratis hoy: ${remaining}/10`;
      
      if (remaining === 0) {
        counterElement.style.color = '#ff4d4d';
        counterElement.style.background = 'rgba(255, 77, 77, 0.15)';
      }
    }
  } catch (error) {
    console.warn('No se pudo cargar estado del asistente:', error);
  }
}

async function requestPreview(event) {
  event.preventDefault();
  const formData = new FormData(form);
  const file = document.querySelector('#document').files[0];
  setStep('step-upload');
  setStatus(UI_TEXT.processing);
  startProcessTicker(estimateByFileSize(file));

  const response = await fetch('/api/translate/preview', {
    method: 'POST',
    body: formData
  });
  const rawBody = await response.text();
  let data;
  try {
    data = rawBody ? JSON.parse(rawBody) : {};
  } catch (error) {
    data = { rawError: rawBody || error.message };
  }

  if (!response.ok) {
    stopProcessTicker();
    throw new Error(data.error || data.rawError || UI_TEXT.previewError);
  }

  previewState = data;
  if (previewPanel) previewPanel.classList.remove('hidden');
  if (translatedTextInput) translatedTextInput.value = data.translatedText;
  if (originalTextPreview) originalTextPreview.value = data.originalText;
  if (previewMeta) previewMeta.textContent = `Trace: ${data.traceId} · ${
    data.experience?.fromCache ? UI_TEXT.fromMemory : UI_TEXT.fromModel
  } · ${data.experience?.processingMs || '-'}ms`;

  stopProcessTicker();
  setProcessProgress(data.experience?.progress?.completionPercent || 100);
  if (etaText) etaText.textContent = `Tiempo estimado de traducción: ${
    Math.ceil((data.experience?.estimatedCompletionSeconds || 60) / 60)
  } min (menos de 1 día).`;
  setStep('step-preview');
  setStatus(data.experience?.assistantMessage || UI_TEXT.previewReady);
}

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

async function finalizeTranslation() {
  if (!previewState) return;
  setStep('step-correction');
  setStatus(UI_TEXT.finalizing);
  setProcessProgress(92);

  const payload = {
    previewId: previewState.previewId,
    translatedText: translatedTextInput.value,
    sourceLanguage: previewState.sourceLanguage,
    targetLanguage: previewState.targetLanguage,
    originalFileName: previewState.originalFileName
  };

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
  const disposition = response.headers.get('content-disposition') || '';
  const match = disposition.match(/filename="(.+)"/);
  const filename = match?.[1] || 'traduccion.docx';
  triggerDownload(blob, filename);

  setProcessProgress(100);
  if (historyProgress) setHistoryProgress(Math.min((parseInt(historyProgress.style.width, 10) || 0) + 5, 100));
  setStep('step-download');
  setStatus(response.headers.get('x-tamon-assistant-message') || UI_TEXT.downloaded);
}

async function sendComment(event) {
  event.preventDefault();
  const payload = {
    project: document.querySelector('#commentProject').value.trim(),
    sourceLanguage: commentSourceLanguage.value,
    targetLanguage: commentTargetLanguage.value,
    originalTranslation: document.querySelector('#originalTranslation').value.trim(),
    suggestedTranslation: document.querySelector('#suggestedTranslation').value.trim()
  };

  const response = await fetch('/api/memory/corrections/suggestions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const data = await response.json();
    throw new Error(data.error || UI_TEXT.suggestionError);
  }

  if (commentsStatus) commentsStatus.textContent = UI_TEXT.suggestionSent;
  if (commentsForm) commentsForm.reset();
  const cp = document.querySelector('#commentProject');
  if (cp) cp.value = 'default';
  if (commentSourceLanguage) commentSourceLanguage.value = 'en';
  if (commentTargetLanguage) commentTargetLanguage.value = 'es';
  loadAssistantStatus().catch(() => {});
}

async function translateQuickText(event) {
  event.preventDefault();
  if (quickTranslateStatus) quickTranslateStatus.textContent = UI_TEXT.processing;
  if (quickTranslateOutput) quickTranslateOutput.value = '';

  const payload = {
    userName: document.querySelector('#quickUserName').value.trim() || 'usuario',
    text: document.querySelector('#quickText').value.trim(),
    sourceLanguage: quickSourceLanguage.value,
    targetLanguage: quickTargetLanguage.value
  };

  const response = await fetch('/api/assistant/translate-text', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || UI_TEXT.quickTranslateError);
  }

  if (quickTranslateOutput) quickTranslateOutput.value = data.assistantResponse;
  if (quickTranslateStatus) quickTranslateStatus.textContent = `${data.learningState} (trace: ${data.traceId})`;
  setStatus('Asistente IA: traducción de texto rápida completada.');
}

if (tabTranslation) tabTranslation.addEventListener('click', showTranslationTab);
if (tabComments) tabComments.addEventListener('click', showCommentsTab);

if (form) {
  form.addEventListener('submit', (event) => {
    requestPreview(event).catch((error) => {
      stopProcessTicker();
      setStatus(error.message);
    });
  });
}

if (finalizeBtn) {
  finalizeBtn.addEventListener('click', () => {
    finalizeTranslation().catch((error) => {
      setStatus(error.message);
    });
  });
}

if (commentsForm) {
  commentsForm.addEventListener('submit', (event) => {
    sendComment(event).catch((error) => {
      if (commentsStatus) commentsStatus.textContent = error.message;
    });
  });
}

if (quickTranslateForm) {
  quickTranslateForm.addEventListener('submit', (event) => {
    translateQuickText(event).catch((error) => {
      if (quickTranslateStatus) quickTranslateStatus.textContent = error.message;
    });
  });
}

populateLanguages();
loadAssistantStatus().catch(() => {});

// Lógica para el Modal de Tamon Pro+
const btnProPlus = document.querySelector('#btn-pro-plus');
const proModal = document.querySelector('#pro-modal');
const closeModalBtn = document.querySelector('#close-modal-btn');
const btnUpgradeNow = document.querySelector('#btn-upgrade-now');

if (btnProPlus && proModal) {
  btnProPlus.addEventListener('click', () => {
    proModal.style.display = 'flex';
  });
}

if (closeModalBtn && proModal) {
  closeModalBtn.addEventListener('click', () => {
    proModal.style.display = 'none';
  });
}

if (btnUpgradeNow && proModal) {
  btnUpgradeNow.addEventListener('click', () => {
    proModal.innerHTML = `
      <div style="background: #2d2a32; padding: 40px; border-radius: 15px; max-width: 450px; text-align: center; border: 1px solid #7928ca; color: #f8f9fa; box-shadow: 0 10px 30px rgba(0,0,0,0.5);">
        <h2 style="color: #7928ca; font-size: 1.8rem; margin-top: 0;">¡Estás en la lista VIP! 🚀</h2>
        <p style="color: #cbd5e1; margin-top: 15px; line-height: 1.6;">La pasarela de pagos oficial está siendo configurada para soportar a nuestros primeros usuarios fundadores.</p>
        <p style="color: #cbd5e1; line-height: 1.6;">Tu espacio ha sido reservado. Te avisaremos en cuanto Tamon Pro+ esté habilitado.</p>
        <button id="close-success-btn" style="margin-top: 25px; background: #cbd5e1; color: #2d2a32; border: none; padding: 10px 20px; border-radius: 8px; cursor: pointer; font-weight: bold; transition: 0.2s;">Entendido</button>
      </div>
    `;
    document.querySelector('#close-success-btn').addEventListener('click', () => {
      proModal.style.display = 'none';
      location.reload(); 
    });
  });
}

window.addEventListener('click', (event) => {
  if (event.target === proModal) {
    proModal.style.display = 'none';
  }
});

// =====================================================================
// --- LÓGICA DE AUTENTICACIÓN (LOGIN, REGISTRO Y PERFIL) ---
// =====================================================================

const sidebarUser = document.getElementById('sidebar-user');
const authModal = document.getElementById('auth-modal');
const authToggleBtn = document.getElementById('auth-toggle-btn');
const authTitle = document.getElementById('auth-title');
const authNombreInput = document.getElementById('auth-nombre');
const authSubmitBtn = document.getElementById('auth-submit-btn');
const authToggleText = document.getElementById('auth-toggle-text');
const authForm = document.getElementById('auth-form');
// Eliminadas referencias a userProfileMenu y displayUserName de la barra superior
const btnProfileDropdown = null;
const profileDropdownContent = document.querySelector('#profile-dropdown-content') || null;
const btnLogout = document.querySelector('#btn-logout') || null;

let isLoginMode = true;

// checkAuth eliminado, la barra lateral gestiona todo


if (authToggleBtn) {
  authToggleBtn.addEventListener('click', () => {
    isLoginMode = !isLoginMode;
    if (isLoginMode) {
      authTitle.textContent = 'Iniciar Sesión';
      authNombreInput.style.display = 'none';
      authNombreInput.removeAttribute('required');
      authSubmitBtn.textContent = 'Entrar a Tamon';
      authToggleText.textContent = '¿No tienes cuenta?';
      authToggleBtn.textContent = 'Regístrate aquí';
    } else {
      authTitle.textContent = 'Crear Cuenta';
      authNombreInput.style.display = 'block';
      authNombreInput.setAttribute('required', 'true');
      authSubmitBtn.textContent = 'Registrarse';
      authToggleText.textContent = '¿Ya tienes cuenta?';
      authToggleBtn.textContent = 'Inicia sesión';
    }
  });
}

if (authModal) {
  window.addEventListener('click', (event) => {
    if (event.target === authModal) {
      authModal.style.display = 'none';
    }
  });
}

if (authForm) {
  authForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    if (!isLoginMode) {
      const payload = {
        nombre: authNombreInput.value.trim(),
        correo: document.querySelector('#auth-correo').value.trim(),
        password: document.querySelector('#auth-pass').value
      };

      authSubmitBtn.textContent = 'Registrando...';
      
      try {
        const response = await fetch('/api/auth/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        
        const data = await response.json();
        
        if (response.ok) {
          localStorage.setItem('tamon_user', JSON.stringify(data.usuario));
          authModal.style.display = 'none';
          updateSidebarUser(data.usuario);
          alert('¡Registro exitoso! Revisa tu correo (si configuraste las credenciales).');
        } else {
          alert(data.error);
        }
      } catch (err) {
        alert('Error al conectar con el servidor.');
      } finally {
        authSubmitBtn.textContent = 'Registrarse';
      }
} else {
      // --- LÓGICA DE INICIAR SESIÓN (LOGIN) ---
      const payloadLogin = {
        correo: document.querySelector('#auth-correo').value.trim(),
        password: document.querySelector('#auth-pass').value
      };

      authSubmitBtn.textContent = 'Iniciando...';
      
      try {
        const response = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payloadLogin)
        });
        
        const data = await response.json();
        
        if (response.ok) {
          // Guardamos al usuario y actualizamos la pantalla
          localStorage.setItem('tamon_user', JSON.stringify(data.usuario));
          authModal.style.display = 'none';
          updateSidebarUser(data.usuario);
        } else {
          // Si pone mal la clave o el correo
          alert(data.error);
        }
      } catch (err) {
        alert('Error al conectar con el servidor.');
      } finally {
        authSubmitBtn.textContent = 'Entrar a Tamon';
      }
    }
  });
}

// Eliminado: btnProfileDropdown y btnLogout, ahora todo es gestionado por updateSidebarUser
// Sidebar navigation


document.addEventListener('DOMContentLoaded', () => {
  const menuBtn = document.getElementById('menu-btn');
  const chatBtn = document.getElementById('chat-btn');
  const faqBtn = document.getElementById('faq-btn');
  const chatSection = document.getElementById('tamon-chat-section');
  const faqSection = document.getElementById('faq-section');

  function showSection(section) {
    if (translationView) translationView.style.display = section === 'menu' ? '' : 'none';
    if (commentsView) commentsView.style.display = 'none';
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
  showSection('menu');
});

// Chat Tamon moderno
const chatMessages = document.getElementById('chat-messages');
const chatForm = document.getElementById('chat-form');
const chatInput = document.getElementById('chat-input');
let chatUser = 'Usuario';
const usuarioGuardado = localStorage.getItem('tamon_user');
if (usuarioGuardado) {
  try {
    const user = JSON.parse(usuarioGuardado);
    chatUser = user?.nombre || user?.usuario || 'Usuario';
  } catch (e) {
    chatUser = 'Usuario';
  }
}
function renderChatMessage(msg, from) {
  const div = document.createElement('div');
  if (from === 'user') {
    div.className = 'chat-bubble user-bubble';
    div.innerHTML = `<span>${msg}</span>`;
  } else {
    div.className = 'chat-bubble tamon-bubble';
    div.innerHTML = `<span><b>Tamon:</b> ${msg}</span>`;
  }
  if (chatMessages) {
    chatMessages.appendChild(div);
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }
}
if (chatForm) {
  chatForm.onsubmit = e => {
    e.preventDefault();
    const msg = chatInput.value.trim();
    if (!msg) return;
    renderChatMessage(msg, 'user');
    chatInput.value = '';
    setTimeout(() => {
      renderChatMessage(getTamonReply(msg), 'tamon');
    }, 700);
  };
}
function getTamonReply(msg) {
  if (msg.toLowerCase().includes('hola')) return '¡Hola! ¿En qué idioma necesitas ayuda o explicación?';
  if (msg.toLowerCase().includes('traduce')) return 'Por favor, dime el texto y el idioma de destino.';
  return '¡Estoy aquí para ayudarte con traducciones y explicaciones de idiomas!';
}

// FAQ acordeón
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.faq-question').forEach(btn => {
    btn.addEventListener('click', function() {
      const item = this.parentElement;
      item.classList.toggle('active');
    });
  });
});

// FAQ editable (en localStorage)
const faqList = document.getElementById('faq-list');
const faqForm = document.getElementById('faq-form');
const faqQuestion = document.getElementById('faq-question');
const faqAnswer = document.getElementById('faq-answer');
let faqs = JSON.parse(localStorage.getItem('tamon_faqs') || '[]');
function renderFaqs() {
  faqList.innerHTML = '';
  faqs.forEach((item, idx) => {
    const li = document.createElement('li');
    li.innerHTML = `<b>${item.q}</b>: ${item.a} <button onclick="removeFaq(${idx})" style="margin-left:8px;color:#ff007f;background:none;border:none;cursor:pointer;">Eliminar</button>`;
    faqList.appendChild(li);
  });
}
window.removeFaq = idx => {
  faqs.splice(idx, 1);
  localStorage.setItem('tamon_faqs', JSON.stringify(faqs));
  renderFaqs();
};
faqForm.onsubmit = e => {
  e.preventDefault();
  faqs.push({ q: faqQuestion.value, a: faqAnswer.value });
  localStorage.setItem('tamon_faqs', JSON.stringify(faqs));
  faqQuestion.value = '';
  faqAnswer.value = '';
  renderFaqs();
};
renderFaqs();


// Usuario en sidebar sincronizado y menú completo
function updateSidebarUser(user) {
  const usernameElem = document.getElementById('sidebar-username');
  const usertypeElem = document.getElementById('sidebar-usertype');
  const sidebarUser = document.getElementById('sidebar-user');
  if (user) {
    // Usuario autenticado: muestra nombre y tipo
    const username = user?.nombre || user?.usuario || 'Usuario';
    if (usernameElem) usernameElem.textContent = username;
    if (usertypeElem) {
      if (user?.role === 'admin') {
        usertypeElem.textContent = 'Admin';
        usertypeElem.className = 'user-badge admin';
      } else if (user?.plan === 'pro_plus') {
        usertypeElem.textContent = 'Pro+';
        usertypeElem.className = 'user-badge pro_plus';
      } else {
        usertypeElem.textContent = 'Chill';
        usertypeElem.className = 'user-badge chill';
      }
      usertypeElem.style.display = '';
    }
    if (sidebarUser) sidebarUser.onclick = null;
  } else {
    // No autenticado: muestra mensaje de login/registro y hace clickable toda el área
    if (usernameElem) usernameElem.textContent = 'Inicia Sesión / Regístrate';
    if (usertypeElem) {
      usertypeElem.textContent = '';
      usertypeElem.className = '';
      usertypeElem.style.display = 'none';
    }
    if (sidebarUser) {
      sidebarUser.onclick = () => {
        const modal = document.getElementById('auth-modal');
        if (modal) modal.style.display = 'flex';
      };
    }
  }
  // Menú de usuario en sidebar
  const sidebarUserMenu = document.getElementById('sidebar-user-menu');
  if (sidebarUserMenu) {
    sidebarUserMenu.innerHTML = '';
    if (user) {
      sidebarUserMenu.innerHTML = `
        <button id="sidebar-settings-btn">⚙️ Ajustes</button>
        <button id="sidebar-logout-btn">🚪 Cerrar sesión</button>
      `;
      document.getElementById('sidebar-settings-btn').onclick = () => {
        alert('Ajustes de usuario próximamente.');
      };
      document.getElementById('sidebar-logout-btn').onclick = () => {
        localStorage.removeItem('tamon_user');
        location.reload();
      };
    } else {
      sidebarUserMenu.innerHTML = `
        <button id="sidebar-login-btn">Iniciar sesión</button>
        <button id="sidebar-register-btn">Registrarse</button>
      `;
      document.getElementById('sidebar-login-btn').onclick = () => {
        const modal = document.getElementById('auth-modal');
        if (modal) modal.style.display = 'flex';
      };
      document.getElementById('sidebar-register-btn').onclick = () => {
        const modal = document.getElementById('auth-modal');
        if (modal) modal.style.display = 'flex';
        setTimeout(() => {
          const toggle = document.getElementById('auth-toggle-btn');
          if (toggle) toggle.click();
        }, 200);
      };
    }
  }
  // Panel admin diferenciado
  const sidebarMenu = document.querySelector('.sidebar-menu');
  if (sidebarMenu) {
    let adminPanel = document.getElementById('admin-panel-btn');
    let adminChat = document.getElementById('admin-chat-btn');
    if (user?.role === 'admin') {
      if (!adminPanel) {
        adminPanel = document.createElement('button');
        adminPanel.id = 'admin-panel-btn';
        adminPanel.className = 'sidebar-btn';
        adminPanel.textContent = 'Panel de Admin';
        adminPanel.onclick = () => alert('Panel de administración (en desarrollo)');
        sidebarMenu.appendChild(adminPanel);
      }
      if (!adminChat) {
        adminChat = document.createElement('button');
        adminChat.id = 'admin-chat-btn';
        adminChat.className = 'sidebar-btn';
        adminChat.textContent = 'Chat Enseñanza Tamon';
        adminChat.onclick = () => alert('Chat especial de enseñanza para admin (en desarrollo)');
        sidebarMenu.appendChild(adminChat);
      }
    } else {
      if (adminPanel) adminPanel.remove();
      if (adminChat) adminChat.remove();
    }
  }
}
// Llama a updateSidebarUser tras login/registro o muestra login si no hay usuario
if (usuarioGuardado) {
  updateSidebarUser(JSON.parse(usuarioGuardado));
} else {
  updateSidebarUser(null);
}
// FAQ acordeón
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.faq-question').forEach(btn => {
    btn.addEventListener('click', function() {
      const item = this.parentElement;
      item.classList.toggle('active');
    });
  });
});