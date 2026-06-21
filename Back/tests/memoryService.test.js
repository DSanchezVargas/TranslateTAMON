const {
  applyRules,
  applyGlossaryPlaceholders,
  restoreGlossaryPlaceholders,
  applyCorrections
} = require('../src/services/memoryService');

describe('memoryService', () => {
  test('applyRules replaces configured text', () => {
    const text = 'Supply chain risk';
    const result = applyRules(text, [{ findText: 'risk', replaceText: 'exposure' }]);
    expect(result).toBe('Supply chain exposure');
  });

  test('glossary placeholders preserve target terms', () => {
    const text = 'Project schedule and project cost';
    const glossary = [
      { sourceTerm: 'project', targetTerm: 'proyecto' },
      { sourceTerm: 'cost', targetTerm: 'costo' }
    ];

    const placeholderResult = applyGlossaryPlaceholders(text, glossary);
    const translatedMock = placeholderResult.text.replace('schedule', 'cronograma').replace('and', 'y');
    const restored = restoreGlossaryPlaceholders(translatedMock, placeholderResult.placeholders);

    expect(restored).toContain('proyecto');
    expect(restored).toContain('costo');
    expect(restored).toContain('cronograma');
  });

  test('applyCorrections overrides wrong terms', () => {
    const text = 'cadena de suministros';
    const corrections = [{ originalTranslation: 'suministros', correctedTranslation: 'abastecimiento' }];
    expect(applyCorrections(text, corrections)).toBe('cadena de abastecimiento');
  });
});
