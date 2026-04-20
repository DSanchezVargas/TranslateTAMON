const { sanitizeString } = require('../src/utils/validation');

describe('validation utilities', () => {
  test('sanitizeString supports unlimited maxLength when null', () => {
    const longText = 'a'.repeat(400000);
    expect(sanitizeString(longText, { maxLength: null })).toHaveLength(400000);
  });

  test('sanitizeString still enforces finite maxLength', () => {
    expect(() => sanitizeString('abcd', { maxLength: 3 })).toThrow('Campo supera el tamaño permitido.');
  });
});
