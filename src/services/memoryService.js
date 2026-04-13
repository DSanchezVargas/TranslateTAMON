const GlossaryEntry = require('../models/GlossaryEntry');
const UserCorrection = require('../models/UserCorrection');
const DomainRule = require('../models/DomainRule');
const { isDbReady } = require('../config/db');
const { sanitizeString } = require('../utils/validation');

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function getMemoryContext({ project, domain, sourceLanguage, targetLanguage }) {
  if (!isDbReady()) {
    return { glossary: [], corrections: [], preRules: [], postRules: [] };
  }

  const safeProject = sanitizeString(project, { required: true, maxLength: 120 });
  const safeDomain = sanitizeString(domain, { required: true, maxLength: 120 });
  const safeSourceLanguage = sanitizeString(sourceLanguage, { required: true, maxLength: 20 });
  const safeTargetLanguage = sanitizeString(targetLanguage, { required: true, maxLength: 20 });

  const [glossary, corrections, rules] = await Promise.all([
    GlossaryEntry.find({
      project: safeProject,
      sourceLanguage: safeSourceLanguage,
      targetLanguage: safeTargetLanguage
    }).lean(),
    UserCorrection.find({
      project: safeProject,
      sourceLanguage: safeSourceLanguage,
      targetLanguage: safeTargetLanguage
    }).lean(),
    DomainRule.find({ project: safeProject, domain: safeDomain }).lean()
  ]);

  return {
    glossary,
    corrections,
    preRules: rules.filter((rule) => rule.applyStage === 'pre_translation'),
    postRules: rules.filter((rule) => rule.applyStage === 'post_translation')
  };
}

function applyRules(text, rules) {
  return rules.reduce((acc, rule) => {
    if (!rule.findText) return acc;

    // Evita borrados masivos no intencionales por reemplazos vacios.
    if (typeof rule.replaceText !== 'string' || !rule.replaceText.trim()) return acc;

    return acc.replace(new RegExp(escapeRegExp(rule.findText), 'gi'), rule.replaceText);
  }, text);
}

function applyGlossaryPlaceholders(text, glossaryEntries) {
  const placeholders = new Map();
  let result = text;

  glossaryEntries.forEach((entry, index) => {
    const placeholder = `__TERM_${index}__`;
    const sourceTermRegex = new RegExp(escapeRegExp(entry.sourceTerm), 'gi');
    result = result.replace(sourceTermRegex, placeholder);
    placeholders.set(placeholder, entry.targetTerm);
  });

  return { text: result, placeholders };
}

function restoreGlossaryPlaceholders(text, placeholders) {
  let result = text;
  placeholders.forEach((targetTerm, placeholder) => {
    const regex = new RegExp(escapeRegExp(placeholder), 'g');
    result = result.replace(regex, targetTerm);
  });
  return result;
}

function applyCorrections(text, corrections) {
  return corrections.reduce((acc, correction) => {
    if (!correction.originalTranslation) return acc;
    if (typeof correction.correctedTranslation !== 'string' || !correction.correctedTranslation.trim()) return acc;

    const regex = new RegExp(escapeRegExp(correction.originalTranslation), 'gi');
    return acc.replace(regex, correction.correctedTranslation);
  }, text);
}

module.exports = {
  getMemoryContext,
  applyRules,
  applyGlossaryPlaceholders,
  restoreGlossaryPlaceholders,
  applyCorrections
};
