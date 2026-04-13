function sanitizeString(value, { required = false, maxLength = 2000 } = {}) {
  if (value === undefined || value === null) {
    if (required) throw new Error('Campo requerido faltante.');
    return undefined;
  }

  if (typeof value !== 'string') {
    throw new Error('Formato de campo inválido. Debe ser texto.');
  }

  const normalized = value.trim();
  if (required && !normalized) {
    throw new Error('Campo requerido vacío.');
  }

  if (Number.isFinite(maxLength) && normalized.length > maxLength) {
    throw new Error('Campo supera el tamaño permitido.');
  }

  return normalized;
}

function isInvalidTranslatedText(text) {
  if (!text || typeof text !== 'string') return true;
  const upper = text.toUpperCase();
  // Validar si el proveedor gratuito tiró error de límite
  return upper.includes('QUERY LENGTH LIMIT EXCEEDED') || upper.includes('MAX ALLOWED QUERY');
}

module.exports = {
  sanitizeString,
  isInvalidTranslatedText
};