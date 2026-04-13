const LANGUAGES = [
  { value: 'es', label: 'Español' },
  { value: 'en', label: 'English' },
  { value: 'pt', label: 'Português' },
  { value: 'fr', label: 'Français' },
  { value: 'de', label: 'Deutsch' },
  { value: 'it', label: 'Italiano' }
];
const UI_TEXT = {
  processing: 'Asistente IA: procesando entrada y memoria contextual...',
  previewError: 'No se pudo generar la vista previa.',
  previewReady: 'Vista previa lista para corrección.',
  fromMemory: 'resultado desde memoria',
  fromModel: 'resultado generado por IA',
  finalizing: 'Asistente IA: finalizando documento y aplicando aprendizaje...',
  finalizeError: 'No se pudo finalizar la traducción.',
  downloaded: 'Documento final listo y descargado.'
};

const form = document.querySelector('#translate-form');
const previewPanel = document.querySelector('#preview-panel');
const previewMeta = document.querySelector('#preview-meta');
const translatedTextInput = document.querySelector('#translatedText');
const assistantStatus = document.querySelector('#assistant-status');
const finalizeBtn = document.querySelector('#finalize-btn');
const sourceLanguageSelect = document.querySelector('#sourceLanguage');
const targetLanguageSelect = document.querySelector('#targetLanguage');

let previewState = null;

function setStep(stepId) {
  document.querySelectorAll('.flow-steps li').forEach((item) => item.classList.remove('active'));
  const selected = document.querySelector(`#${stepId}`);
  if (selected) selected.classList.add('active');
}

function setStatus(message) {
  assistantStatus.textContent = message;
}

function populateLanguages() {
  LANGUAGES.forEach(({ value, label }) => {
    const originOption = document.createElement('option');
    originOption.value = value;
    originOption.textContent = label;
    sourceLanguageSelect.appendChild(originOption);

    const targetOption = document.createElement('option');
    targetOption.value = value;
    targetOption.textContent = label;
    targetLanguageSelect.appendChild(targetOption);
  });
  sourceLanguageSelect.value = 'en';
  targetLanguageSelect.value = 'es';
}

async function requestPreview(event) {
  event.preventDefault();
  const formData = new FormData(form);
  setStep('step-upload');
  setStatus(UI_TEXT.processing);

  const response = await fetch('/api/translate/preview', {
    method: 'POST',
    body: formData
  });
  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || UI_TEXT.previewError);
  }

  previewState = data;
  previewPanel.classList.remove('hidden');
  translatedTextInput.value = data.translatedText;
  previewMeta.textContent = `Trace: ${data.traceId} · ${
    data.experience?.fromCache ? UI_TEXT.fromMemory : UI_TEXT.fromModel
  } · ${data.experience?.processingMs || '-'}ms`;

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

  setStep('step-download');
  setStatus(response.headers.get('x-tamon-assistant-message') || UI_TEXT.downloaded);
}

form.addEventListener('submit', (event) => {
  requestPreview(event).catch((error) => {
    setStatus(error.message);
  });
});

finalizeBtn.addEventListener('click', () => {
  finalizeTranslation().catch((error) => {
    setStatus(error.message);
  });
});

populateLanguages();
