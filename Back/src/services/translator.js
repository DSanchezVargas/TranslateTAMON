const axios = require('axios');
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

async function translateChunk(chunk, sourceLanguage, targetLanguage) {
  try {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${sourceLanguage}&tl=${targetLanguage}&dt=t&q=${encodeURIComponent(chunk)}`;
    const response = await axios.get(url);
    if (response.data && response.data[0]) {
      const translated = response.data[0].map(item => item[0]).join('');
      return translated;
    }
    throw new Error('Respuesta inválida del servidor de traducción.');
  } catch (error) {
    if (error.response && error.response.status === 429) {
      throw new Error('Tamon ha procesado demasiados documentos recientemente y el servidor gratuito necesita un breve respiro. Por favor, intenta de nuevo en unos minutos.');
    }
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
  const totalChunks = chunks.length;
  const translatedChunks = new Array(totalChunks);
  const fallbackToOriginalOnError = options.fallbackToOriginalOnError === true;

  const batchSize = 3;
  for (let i = 0; i < totalChunks; i += batchSize) {
    const batch = chunks.slice(i, i + batchSize);
    
    const promises = batch.map((chunk, batchIdx) => {
      const chunkIdx = i + batchIdx;
      return translateChunk(chunk, sourceLanguage, targetLanguage)
        .then(translated => ({ translated, chunkIdx }))
        .catch(error => {
          if (!fallbackToOriginalOnError) {
            throw error;
          }
          if (typeof options.onChunkError === 'function') {
            options.onChunkError({
              chunkIndex: chunkIdx,
              totalChunks,
              message: error.message
            });
          }
          return { translated: chunk, chunkIdx };
        });
    });

    const batchResults = await Promise.all(promises);
    for (const res of batchResults) {
      translatedChunks[res.chunkIdx] = res.translated;
    }

    const processedChunks = Math.min(i + batchSize, totalChunks);
    if (typeof options.onProgress === 'function') {
      options.onProgress({
        processedChunks,
        totalChunks,
        translatedSoFar: translatedChunks.slice(0, processedChunks).join(''),
        percentage: Math.round((processedChunks / totalChunks) * 100)
      });
    }

    if (i + batchSize < totalChunks) {
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