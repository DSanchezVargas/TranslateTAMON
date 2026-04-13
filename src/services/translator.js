const axios = require('axios');

const CHUNK_SIZE = 1800;

function splitIntoChunks(text, size = CHUNK_SIZE) {
  const chunks = [];
  let pointer = 0;
  while (pointer < text.length) {
    chunks.push(text.slice(pointer, pointer + size));
    pointer += size;
  }
  return chunks;
}

async function translateChunk(chunk, sourceLanguage, targetLanguage) {
  const endpoint = process.env.LIBRETRANSLATE_URL || 'https://libretranslate.com/translate';
  const apiKey = process.env.LIBRETRANSLATE_API_KEY;

  const payload = {
    q: chunk,
    source: sourceLanguage,
    target: targetLanguage,
    format: 'text'
  };

  if (apiKey) payload.api_key = apiKey;

  const response = await axios.post(endpoint, payload, {
    timeout: 15000,
    headers: { 'Content-Type': 'application/json' }
  });

  if (!response.data?.translatedText) {
    throw new Error('Respuesta inválida del proveedor de traducción.');
  }

  return response.data.translatedText;
}

async function translateText(text, sourceLanguage, targetLanguage) {
  if (!text?.trim()) {
    throw new Error('No hay texto para traducir.');
  }

  if (sourceLanguage === targetLanguage) {
    return text;
  }

  const chunks = splitIntoChunks(text);
  const translatedChunks = [];

  for (const chunk of chunks) {
    // eslint-disable-next-line no-await-in-loop
    const translated = await translateChunk(chunk, sourceLanguage, targetLanguage);
    translatedChunks.push(translated);
  }

  return translatedChunks.join('');
}

module.exports = {
  translateText,
  splitIntoChunks
};
