// ELIMINAMOS LAS IMPORTACIONES DE MONGOOSE:
// const GlossaryEntry = require('../models/GlossaryEntry');
// const UserCorrection = require('../models/UserCorrection');
// const DomainRule = require('../models/DomainRule');

// IMPORTAMOS POSTGRESQL:
const { pool, isDbReady } = require('../config/db');
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

  let glossary = [];
  let corrections = [];
  let rules = [];

  try {
    // 1. AUTO-CREACIÓN DE TABLAS: Si no existen, se crean solas.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS glossary_entries (
        id SERIAL PRIMARY KEY, project VARCHAR(120), source_language VARCHAR(20), target_language VARCHAR(20),
        source_term VARCHAR(255), target_term VARCHAR(255)
      );
      CREATE TABLE IF NOT EXISTS user_corrections (
        id SERIAL PRIMARY KEY, project VARCHAR(120), source_language VARCHAR(20), target_language VARCHAR(20),
        original_translation TEXT, corrected_translation TEXT
      );
      CREATE TABLE IF NOT EXISTS domain_rules (
        id SERIAL PRIMARY KEY, project VARCHAR(120), domain VARCHAR(120),
        find_text TEXT, replace_text TEXT, apply_stage VARCHAR(50)
      );
    `);

    // 2. BUSCAMOS EN POSTGRESQL (En paralelo para que sea súper rápido)
    // Usamos el "AS" para transformar los nombres de las columnas SQL (con_guion_bajo) al formato que espera JavaScript (camelCase)
    const [glossaryRes, correctionsRes, rulesRes] = await Promise.all([
      pool.query(
        `SELECT source_term AS "sourceTerm", target_term AS "targetTerm" 
         FROM glossary_entries WHERE project = $1 AND source_language = $2 AND target_language = $3`, 
        [safeProject, safeSourceLanguage, safeTargetLanguage]
      ),
      pool.query(
        `SELECT original_translation AS "originalTranslation", corrected_translation AS "correctedTranslation" 
         FROM user_corrections WHERE project = $1 AND source_language = $2 AND target_language = $3`, 
        [safeProject, safeSourceLanguage, safeTargetLanguage]
      ),
      pool.query(
        `SELECT find_text AS "findText", replace_text AS "replaceText", apply_stage AS "applyStage" 
         FROM domain_rules WHERE project = $1 AND domain = $2`, 
        [safeProject, safeDomain]
      )
    ]);

    glossary = glossaryRes.rows;
    corrections = correctionsRes.rows;
    rules = rulesRes.rows;

  } catch (error) {
    console.error("Aviso: Error cargando memoria de PostgreSQL.", error.message);
  }

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