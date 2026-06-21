const { assertSupportedFile } = require('../src/services/textExtractor');

describe('textExtractor', () => {
  test('assertSupportedFile accepts txt extension', () => {
    expect(assertSupportedFile('archivo.txt')).toBe('.txt');
  });

  test('assertSupportedFile rejects unsupported extension', () => {
    expect(() => assertSupportedFile('archivo.xlsx')).toThrow('Formato no soportado');
  });
});
