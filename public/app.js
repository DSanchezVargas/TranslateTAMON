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

const form = document.querySelector('#translate-form');
const commentsForm = document.querySelector('#comments-form');
const quickTranslateForm = document.querySelector('#quick-translate-form');
const previewPanel = document.querySelector('#preview-panel');
const previewMeta = document.querySelector('#preview-meta');
const etaText = document.querySelector('#eta-text');
const translatedTextInput = document.querySelector('#translatedText');
const originalTextPreview = document.querySelector('#originalTextPreview');
const assistantStatus = document.querySelector('#assistant-status');
const commentsStatus = document.querySelector('#comments-status');
const quickTranslateStatus = document.querySelector('#quick-translate-status');
const quickTranslateOutput = document.querySelector('#quick-translate-output');
const finalizeBtn = document.querySelector('#finalize-btn');
const sourceLanguageSelect = document.querySelector('#sourceLanguage');
const targetLanguageSelect = document.querySelector('#targetLanguage');
const commentSourceLanguage = document.querySelector('#commentSourceLanguage');
const commentTargetLanguage = document.querySelector('#commentTargetLanguage');
const quickSourceLanguage = document.querySelector('#quickSourceLanguage');
const quickTargetLanguage = document.querySelector('#quickTargetLanguage');
const processProgress = document.querySelector('#process-progress');
const historyProgress = document.querySelector('#history-progress');
const tabTranslation = document.querySelector('#tab-translation');
const tabComments = document.querySelector('#tab-comments');
const translationView = document.querySelector('#translation-view');
const commentsView = document.querySelector('#comments-view');

let previewState = null;
let processTicker = null;

function setStep(stepId) {
  document.querySelectorAll('.flow-steps li').forEach((item) => item.classList.remove('active'));
  const selected = document.querySelector(`#${stepId}`);
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
  ].forEach(populateSelect);
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

const btnLoginModal = document.querySelector('#btn-login-modal');
const authModal = document.querySelector('#auth-modal');
const authToggleBtn = document.querySelector('#auth-toggle-btn');
const authTitle = document.querySelector('#auth-title');
const authNombreInput = document.querySelector('#auth-nombre');
const authSubmitBtn = document.querySelector('#auth-submit-btn');
const authToggleText = document.querySelector('#auth-toggle-text');
const authForm = document.querySelector('#auth-form');
const userProfileMenu = document.querySelector('#user-profile-menu');
const displayUserName = document.querySelector('#display-user-name');
const btnProfileDropdown = document.querySelector('#btn-profile-dropdown');
const profileDropdownContent = document.querySelector('#profile-dropdown-content');
const btnLogout = document.querySelector('#btn-logout');

let isLoginMode = true;

function checkAuth() {
  const usuarioGuardado = localStorage.getItem('tamon_user');
  if (usuarioGuardado) {
    const user = JSON.parse(usuarioGuardado);
    if (btnLoginModal) btnLoginModal.style.display = 'none';
    if (userProfileMenu) userProfileMenu.style.display = 'block';
    if (displayUserName) displayUserName.textContent = user.nombre;
  } else {
    if (btnLoginModal) btnLoginModal.style.display = 'block';
    if (userProfileMenu) userProfileMenu.style.display = 'none';
  }
}

if (btnLoginModal && authModal) {
  btnLoginModal.addEventListener('click', () => {
    authModal.style.display = 'flex';
  });

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
          checkAuth();
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
          checkAuth(); 
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

if (btnProfileDropdown) {
  btnProfileDropdown.addEventListener('click', () => {
    profileDropdownContent.style.display = 
      profileDropdownContent.style.display === 'none' ? 'flex' : 'none';
  });
}

if (btnLogout) {
  btnLogout.addEventListener('click', () => {
    localStorage.removeItem('tamon_user');
    profileDropdownContent.style.display = 'none';
    checkAuth();
  });
}

checkAuth();