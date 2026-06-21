const TESSERACT_LANGUAGE_MAP = {
  es: 'spa',
  en: 'eng',
  pt: 'por',
  fr: 'fra',
  de: 'deu',
  it: 'ita'
};

function getTesseractLang(languageCode) {
  if (!languageCode) return 'eng';
  const base = languageCode.toLowerCase().split('-')[0];
  return TESSERACT_LANGUAGE_MAP[base] || 'eng';
}

module.exports = {
  getTesseractLang
};
