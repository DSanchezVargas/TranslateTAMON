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
  assistantStatus.textContent = message;
}

function setProcessProgress(percent) {
  processProgress.style.width = `${Math.max(Math.min(percent, 100), 0)}%`;
}

function setHistoryProgress(percent) {
  historyProgress.style.width = `${Math.max(Math.min(percent, 100), 0)}%`;
}

function populateSelect(select) {
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
  sourceLanguageSelect.value = 'en';
  targetLanguageSelect.value = 'es';
  commentSourceLanguage.value = 'en';
  commentTargetLanguage.value = 'es';
  quickSourceLanguage.value = 'en';
  quickTargetLanguage.value = 'es';
}

function showTranslationTab() {
  tabTranslation.classList.add('is-active');
  tabComments.classList.remove('is-active');
  translationView.classList.remove('hidden');
  commentsView.classList.add('hidden');
}

function showCommentsTab() {
  tabComments.classList.add('is-active');
  tabTranslation.classList.remove('is-active');
  commentsView.classList.remove('hidden');
  translationView.classList.add('hidden');
}

function startProcessTicker(estimatedSeconds) {
  if (processTicker) clearInterval(processTicker);
  const maxSeconds = Math.max(Math.min(estimatedSeconds || DEFAULT_ESTIMATED_SECONDS, MAX_ESTIMATED_SECONDS), 10);
  let elapsed = 0;
  setProcessProgress(3);
  etaText.textContent = `Tiempo estimado de traducción: ${Math.ceil(maxSeconds / 60)} min (menos de 1 día).`;
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
  previewPanel.classList.remove('hidden');
  translatedTextInput.value = data.translatedText;
  originalTextPreview.value = data.originalText;
  previewMeta.textContent = `Trace: ${data.traceId} · ${
    data.experience?.fromCache ? UI_TEXT.fromMemory : UI_TEXT.fromModel
  } · ${data.experience?.processingMs || '-'}ms`;

  stopProcessTicker();
  setProcessProgress(data.experience?.progress?.completionPercent || 100);
  etaText.textContent = `Tiempo estimado de traducción: ${
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
  setHistoryProgress(Math.min((parseInt(historyProgress.style.width, 10) || 0) + 5, 100));
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

  commentsStatus.textContent = UI_TEXT.suggestionSent;
  commentsForm.reset();
  document.querySelector('#commentProject').value = 'default';
  commentSourceLanguage.value = 'en';
  commentTargetLanguage.value = 'es';
  loadAssistantStatus().catch(() => {});
}

async function translateQuickText(event) {
  event.preventDefault();
  quickTranslateStatus.textContent = UI_TEXT.processing;
  quickTranslateOutput.value = '';

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

  quickTranslateOutput.value = data.assistantResponse;
  quickTranslateStatus.textContent = `${data.learningState} (trace: ${data.traceId})`;
  setStatus('Asistente IA: traducción de texto rápida completada.');
}

tabTranslation.addEventListener('click', showTranslationTab);
tabComments.addEventListener('click', showCommentsTab);

form.addEventListener('submit', (event) => {
  requestPreview(event).catch((error) => {
    stopProcessTicker();
    setStatus(error.message);
  });
});

finalizeBtn.addEventListener('click', () => {
  finalizeTranslation().catch((error) => {
    setStatus(error.message);
  });
});

commentsForm.addEventListener('submit', (event) => {
  sendComment(event).catch((error) => {
    commentsStatus.textContent = error.message;
  });
});

quickTranslateForm.addEventListener('submit', (event) => {
  translateQuickText(event).catch((error) => {
    quickTranslateStatus.textContent = error.message;
  });
});

populateLanguages();
loadAssistantStatus().catch(() => {});
