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

function splitChunkInHalf(chunk) {
  if (!chunk || chunk.length < 2) return [chunk];
  const middle = Math.floor(chunk.length / 2);
  const rightSpace = chunk.indexOf(' ', middle);
  const leftSpace = chunk.lastIndexOf(' ', middle);
  let splitIndex = middle;

  if (rightSpace !== -1 && leftSpace !== -1) {
    splitIndex = (rightSpace - middle) < (middle - leftSpace) ? rightSpace : leftSpace;
  } else if (rightSpace !== -1) {
    splitIndex = rightSpace;
  } else if (leftSpace !== -1) {
    splitIndex = leftSpace;
  }

  const first = chunk.slice(0, splitIndex).trim();
  const second = chunk.slice(splitIndex).trim();
  return [first, second].filter(Boolean);
}

function isSuspiciousTranslation(source, translated) {
  const src = (source || '').trim();
  const trg = (translated || '').trim();
  if (!src) return false;
  if (!trg) return true;

  const upper = trg.toUpperCase();
  if (upper.includes('QUERY LENGTH LIMIT EXCEEDED') || upper.includes('MAX ALLOWED QUERY')) {
    return true;
  }

  if (src.length < 250) return false;
  const coverage = trg.length / src.length;
  return coverage < MIN_TRANSLATION_COVERAGE_RATIO;
}

async function translateChunkConservative(chunk, sourceLanguage, targetLanguage, depth = 0) {
  const translated = await translateChunk(chunk, sourceLanguage, targetLanguage);
  if (!isSuspiciousTranslation(chunk, translated)) {
    return translated;
  }

  const canRechunk = depth < MAX_RECHUNK_DEPTH && chunk.length > 260;
  if (!canRechunk) {
    return translated;
  }

  const parts = splitChunkInHalf(chunk);
  if (parts.length < 2) {
    return translated;
  }

  const translatedParts = [];
  for (const part of parts) {
    const partTranslated = await translateChunkConservative(part, sourceLanguage, targetLanguage, depth + 1);
    translatedParts.push(partTranslated);
  }

  return translatedParts.join(' ');
}

async function requestMyMemoryTranslation(chunk, sourceLanguage, targetLanguage) {
  const url = 'https://api.mymemory.translated.net/get';
  let response;

  for (let attempt = 0; attempt <= MYMEMORY_MAX_RETRIES; attempt += 1) {
    try {
      response = await axios.get(url, {
        timeout: 15000,
        params: {
          q: chunk,
          langpair: `${sourceLanguage}|${targetLanguage}`
        }
      });
      break;
    } catch (error) {
      const isRateLimit = error.response?.status === 429;
      const canRetry = isRateLimit && attempt < MYMEMORY_MAX_RETRIES;
      if (!canRetry) {
        throw new Error(`Error del fallback gratuito: ${error.message}`, { cause: error });
      }

      const waitMs = 700 * (attempt + 1);
      await delay(waitMs);
    }
  }

  const translated = response.data?.responseData?.translatedText;
  if (!translated) {
    throw new Error('Fallback gratuito sin respuesta de traduccion valida.');
  }

  if (translated.toUpperCase().includes('QUERY LENGTH LIMIT EXCEEDED')) {
    throw new Error('Fallback gratuito excedio su limite de caracteres por solicitud.');
  }

  return translated;
}

async function translateChunkWithMyMemory(chunk, sourceLanguage, targetLanguage) {
  const parts = splitIntoChunks(chunk, MYMEMORY_MAX_CHARS);
  const translatedParts = [];

  for (const part of parts) {
    const translatedPart = await requestMyMemoryTranslation(part, sourceLanguage, targetLanguage);
    translatedParts.push(translatedPart);
  }

  return translatedParts.join('');
}

async function translateChunk(chunk, sourceLanguage, targetLanguage) {
  const endpoint = process.env.LIBRETRANSLATE_URL || 'https://libretranslate.com/translate';
  const apiKey = process.env.LIBRETRANSLATE_API_KEY;

  if (!apiKey && endpoint.includes('libretranslate.com')) {
    return translateChunkWithMyMemory(chunk, sourceLanguage, targetLanguage);
  }

  const payload = {
    q: chunk,
    source: sourceLanguage,
    target: targetLanguage,
    format: 'text'
  };

  if (apiKey) payload.api_key = apiKey;

  let response;
  try {
    response = await axios.post(endpoint, payload, {
      timeout: 15000,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    const providerMessage = error.response?.data?.error || error.message;

    // Si el proveedor pide API key o falla, usamos fallback gratuito.
    if (error.response?.status === 400 || error.response?.status === 401 || error.response?.status === 403) {
      return translateChunkWithMyMemory(chunk, sourceLanguage, targetLanguage);
    }

    throw new Error(`Error del proveedor de traduccion: ${providerMessage}`, { cause: error });
  }

  if (!response.data?.translatedText) {
    throw new Error('Respuesta inválida del proveedor de traducción.');
  }

  return response.data.translatedText;
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
      const translated = await translateChunkConservative(chunk, sourceLanguage, targetLanguage);
      translatedChunks.push(translated);
    } catch (error) {
      if (!fallbackToOriginalOnError) {
        throw error;
      }

      translatedChunks.push(chunk);
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