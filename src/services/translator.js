const { translate } = require('@vitalets/google-translate-api');
// Ajustamos el chunk size para que Google no rechace peticiones por ser muy largas.
const CHUNK_SIZE = 4500; 
// Un retraso pequeño para no saturar al servidor y evitar que bloquee la IP
const INTER_CHUNK_DELAY_MS = 500; 

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function splitIntoChunks(text, size = CHUNK_SIZE) {
  const chunks = [];
  let pointer = 0;
  while (pointer < text.length) {
    // Intentamos cortar en un salto de línea o espacio para no romper palabras a la mitad
    let end = pointer + size;
    if (end < text.length) {
      const lastSpace = text.lastIndexOf(' ', end);
      const lastNewline = text.lastIndexOf('\n', end);
      const breakPoint = Math.max(lastSpace, lastNewline);
      if (breakPoint > pointer) {
          end = breakPoint;
      }
    }
    chunks.push(text.slice(pointer, end));
    pointer = end;
  }
  return chunks;
}

// REEMPLAZA ESTA FUNCIÓN EN services/translator.js
async function translateChunk(chunk, sourceLanguage, targetLanguage) {
    try {
        const res = await translate(chunk, { from: sourceLanguage, to: targetLanguage });
        return res.text;
    } catch (error) {
        // Detectamos si Google nos bloqueó temporalmente por exceso de tráfico
        if (error.name === 'TooManyRequestsError' || error.message.includes('429') || error.message.includes('Too Many Requests')) {
            throw new Error('Tamon ha procesado demasiados documentos recientemente y el servidor gratuito necesita un breve respiro. Por favor, intenta de nuevo en unos minutos.');
        }
        
        // Si es cualquier otro error, lo mostramos normal
        throw new Error(`Error de traducción: ${error.message}`);
    }
}

async function translateText(text, sourceLanguage, targetLanguage) {
  return translateTextWithProgress(text, sourceLanguage, targetLanguage);
}

async function translateTextWithProgress(text, sourceLanguage, targetLanguage, options = {}) {
  if (!text?.trim()) {
    throw new Error('No hay texto para traducir.');
  }

  if (sourceLanguage === targetLanguage) {
    if (typeof options.onProgress === 'function') {
      options.onProgress({
        processedChunks: 1,
        totalChunks: 1,
        translatedSoFar: text,
        percentage: 100
      });
    }
    return text;
  }

  const chunkSize = options.chunkSize || CHUNK_SIZE;
  const chunks = splitIntoChunks(text, chunkSize);
  const translatedChunks = [];
  const totalChunks = chunks.length;
  const fallbackToOriginalOnError = options.fallbackToOriginalOnError === true;

  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index];
    try {
      const translated = await translateChunk(chunk, sourceLanguage, targetLanguage);
      translatedChunks.push(translated);
    } catch (error) {
      if (!fallbackToOriginalOnError) {
        throw error;
      }

      translatedChunks.push(chunk); // Mantenemos el original si falla
      if (typeof options.onChunkError === 'function') {
        options.onChunkError({
          chunkIndex: index,
          totalChunks,
          message: error.message
        });
      }
    }

    if (typeof options.onProgress === 'function') {
      options.onProgress({
        processedChunks: index + 1,
        totalChunks,
        translatedSoFar: translatedChunks.join(''),
        percentage: Math.round(((index + 1) / totalChunks) * 100)
      });
    }

    // Retraso entre envíos para no ser bloqueados
    if (index < chunks.length - 1) {
      await delay(INTER_CHUNK_DELAY_MS);
    }
  }

  return translatedChunks.join('');
}

module.exports = {
  translateText,
  translateTextWithProgress,
  splitIntoChunks
};