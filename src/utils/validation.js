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

  if (normalized.length > maxLength) {
    throw new Error('Campo supera el tamaño permitido.');
  }

  return normalized;
}

module.exports = {
  sanitizeString
};
