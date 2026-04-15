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

// =====================================================================
// 2. SELECTORES DE DOM (Protegidos)
// =====================================================================
const getEl = id => document.querySelector(id) || document.getElementById(id.replace('#', ''));

const form = getEl('#translate-form');
const commentsForm = getEl('#comments-form');
const quickTranslateForm = getEl('#quick-translate-form');
const previewPanel = getEl('#preview-panel');
const previewMeta = getEl('#preview-meta');
const etaText = getEl('#eta-text');
const translatedTextInput = getEl('#translatedText');
const originalTextPreview = getEl('#originalTextPreview');
const assistantStatus = getEl('#assistant-status');
const commentsStatus = getEl('#comments-status');
const quickTranslateStatus = getEl('#quick-translate-status');
const quickTranslateOutput = getEl('#quick-translate-output');
const finalizeBtn = getEl('#finalize-btn');
const sourceLanguageSelect = getEl('#sourceLanguage');
const targetLanguageSelect = getEl('#targetLanguage');
const quickSourceLanguage = getEl('#quickSourceLanguage');
const quickTargetLanguage = getEl('#quickTargetLanguage');
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
  const selects = [sourceLanguageSelect, targetLanguageSelect, quickSourceLanguage, quickTargetLanguage];
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
  if (quickSourceLanguage) quickSourceLanguage.value = 'en';
  if (quickTargetLanguage) quickTargetLanguage.value = 'es';
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
// 4. LÓGICA DE TRADUCCIÓN Y BACKEND
// =====================================================================
async function requestPreview(event) {
  event.preventDefault();
  const formData = new FormData(form);
  const file = getEl('#document').files[0];
  setStep('step-upload');
  setStatus(UI_TEXT.processing);
  startProcessTicker(file ? Math.max(Math.ceil(file.size / 8000), 60) : 60);

  try {
    const response = await fetch('/api/translate/preview', { method: 'POST', body: formData });
    const rawBody = await response.text();
    const data = rawBody ? JSON.parse(rawBody) : {};

    if (!response.ok) throw new Error(data.error || UI_TEXT.previewError);

    previewState = data;
    if (previewPanel) previewPanel.classList.remove('hidden');
    if (translatedTextInput) translatedTextInput.value = data.translatedText;
    if (originalTextPreview) originalTextPreview.value = data.originalText;
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

  const payload = {
    previewId: previewState.previewId,
    translatedText: translatedTextInput.value,
    sourceLanguage: previewState.sourceLanguage,
    targetLanguage: previewState.targetLanguage,
    originalFileName: previewState.originalFileName
  };

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
    anchor.download = 'traduccion_tamon.docx';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();

    setProcessProgress(100);
    setStep('step-download');
    setStatus(UI_TEXT.downloaded);
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
      } else if (user.plan === 'pro_plus') {
        usertypeElem.textContent = 'Tamon Pro+';
        usertypeElem.className = 'user-badge pro_plus';
      } else {
        usertypeElem.textContent = 'Tamon Chill';
        usertypeElem.className = 'user-badge chill';
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

// Inicializar usuario desde LocalStorage
const usuarioGuardado = localStorage.getItem('tamon_user');
if (usuarioGuardado) {
  try { updateSidebarUser(JSON.parse(usuarioGuardado)); } 
  catch (e) { updateSidebarUser(null); }
} else {
  updateSidebarUser(null);
}

// Modal de Autenticación
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

// =====================================================================
// 7. MODAL VIP TAMON PRO+
// =====================================================================
const btnProPlus = getEl('#btn-pro-plus');
const proModal = getEl('#pro-modal');
const btnUpgradeNow = getEl('#btn-upgrade-now');

if (btnProPlus && proModal) btnProPlus.addEventListener('click', () => proModal.style.display = 'flex');
window.addEventListener('click', e => { if (e.target === proModal) proModal.style.display = 'none'; });

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
// 8. CHAT TAMON Y FAQ (Acordeón y LocalStorage)
// =====================================================================
if (quickTranslateForm) quickTranslateForm.addEventListener('submit', e => { e.preventDefault(); alert("Función en desarrollo."); });
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
// 9. LÓGICA DEL CHAT DE TAMON (ACTUALIZADO CON STREAMING)
// =====================================================================
const chatMessages = getEl('#chat-messages');
const chatForm = getEl('#chat-form');
const chatInput = getEl('#chat-input');

function renderChatMessage(msg, from, id = null) {
  const div = document.createElement('div');
  div.className = from === 'user' ? 'chat-bubble user-bubble' : 'chat-bubble tamon-bubble';
  if (id) div.id = id;
  
  const label = from === 'user' ? '' : '<b>Tamon:</b> ';
  div.innerHTML = `<span>${label}${msg.replace(/\n/g, '<br>')}</span>`;
  
  if (chatMessages) {
    chatMessages.appendChild(div);
    chatMessages.scrollTop = chatMessages.scrollHeight; 
  }
  return div;
}

if (chatForm) {
  chatForm.addEventListener('submit', async (e) => {
    e.preventDefault(); 
    const msg = chatInput.value.trim();
    if (!msg) return;
    
    // 1. Mostrar mensaje del usuario
    renderChatMessage(msg, 'user');
    chatInput.value = '';
    
    const userJson = localStorage.getItem('tamon_user');
    const nombreUsuario = userJson ? JSON.parse(userJson).nombre : 'Usuario';

    // 2. Crear burbuja vacía para Tamon donde "caerá" el stream
    const tamonMsgId = 'tamon-stream-' + Date.now();
    const tamonDiv = renderChatMessage('<i>escribiendo...</i>', 'tamon', tamonMsgId);
    const textSpan = tamonDiv.querySelector('span');

    try {
        const response = await fetch('/api/user/chat', { 
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: msg, userName: nombreUsuario })
        });

        if (!response.ok) throw new Error('Error en la conexión');

        // 3. PROCESAR EL STREAM (Lectura por trozos)
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let fullText = "";
        textSpan.innerHTML = `<b>Tamon:</b> `; // Limpiamos el "escribiendo..."

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const chunk = decoder.decode(value, { stream: true });
            fullText += chunk;
            
            // Actualizamos la burbuja en tiempo real con cada palabra nueva
            textSpan.innerHTML = `<b>Tamon:</b> ${fullText.replace(/\n/g, '<br>')}`;
            chatMessages.scrollTop = chatMessages.scrollHeight; 
        }

    } catch (error) {
        if (textSpan) textSpan.innerHTML = `<b>Tamon:</b> Error: Mis circuitos están sobrecargados.`;
    }
  });
}