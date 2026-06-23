/**
 * docxTranslatorService.js
 * Traduce DOCX preservando el 100% del formato original.
 *
 * Estrategia:
 *  - Abre el DOCX como ZIP y lee word/document.xml
 *  - Reemplaza el texto dentro de cada <w:t> con la traducción correspondiente
 *  - Preserva TODA la estructura XML: <w:rPr> (negrita, cursiva, color, fuente,
 *    tamaño), párrafos, tablas, imágenes, encabezados, pies de página, etc.
 *  - Solo cambia el contenido de texto, NADA más.
 */

const AdmZip = require('adm-zip');

/**
 * Aplica los runs ya traducidos al DOCX original, preservando formato.
 *
 * @param {Buffer} originalBuffer       - Buffer del DOCX original
 * @param {Array}  docxRunsTranslated   - [{paragraph, run, texto | textoTraducido}]
 * @returns {Buffer}                    - Buffer del DOCX traducido
 */
async function translateDocxWithRuns(originalBuffer, docxRunsTranslated) {
  if (!originalBuffer || !originalBuffer.length) {
    throw new Error('El buffer del DOCX original está vacío.');
  }

  const zip = new AdmZip(originalBuffer);
  const docXmlEntry = zip.getEntry('word/document.xml');
  if (!docXmlEntry) throw new Error('No se encontró word/document.xml en el DOCX.');

  let xml = docXmlEntry.getData().toString('utf8');

  // Construir mapa de traducciones: "paraIdx-runIdx" => texto traducido
  const translationMap = new Map();
  for (const item of docxRunsTranslated) {
    const text = item.textoTraducido ?? item.translated ?? item.texto ?? '';
    if (text !== undefined && item.paragraph !== undefined && item.run !== undefined) {
      translationMap.set(`${item.paragraph}-${item.run}`, text);
    }
  }

  // Reemplazar texto en el XML, párrafo a párrafo, run a run
  let paraIdx = 0;

  xml = xml.replace(/<w:p[\s>][\s\S]*?<\/w:p>/g, (paraXml) => {
    let runIdx = 0;

    const modifiedPara = paraXml.replace(/<w:r[\s>][\s\S]*?<\/w:r>/g, (runXml) => {
      const key = `${paraIdx}-${runIdx}`;
      runIdx++;

      if (!translationMap.has(key)) return runXml;

      const translatedText = translationMap.get(key);

      // Reemplazar solo el contenido de <w:t> preservando todos los atributos del run
      return runXml.replace(/<w:t([^>]*)>([^<]*)<\/w:t>/g, (_m, attrs, _original) => {
        // Añadir xml:space="preserve" si el texto traducido tiene espacios al inicio/fin
        const needsSpace = translatedText.startsWith(' ') || translatedText.endsWith(' ');
        let finalAttrs = attrs;
        if (needsSpace && !attrs.includes('xml:space')) {
          finalAttrs = ` xml:space="preserve"${attrs}`;
        }
        return `<w:t${finalAttrs}>${escapeXml(translatedText)}</w:t>`;
      });
    });

    paraIdx++;
    return modifiedPara;
  });

  zip.updateFile('word/document.xml', Buffer.from(xml, 'utf8'));
  return zip.toBuffer();
}

/**
 * Traduce un DOCX completo de forma automática (sin runs pre-traducidos).
 * Extrae cada run, lo traduce, y lo aplica de vuelta al DOCX.
 *
 * @param {Buffer}   originalBuffer
 * @param {string}   sourceLanguage
 * @param {string}   targetLanguage
 * @param {Function} translateFn     - async (text, sl, tl) => translatedText
 * @returns {Buffer}
 */
async function translateDocxBuffer(originalBuffer, sourceLanguage, targetLanguage, translateFn) {
  const zip = new AdmZip(originalBuffer);
  const docXmlEntry = zip.getEntry('word/document.xml');
  if (!docXmlEntry) throw new Error('No se encontró word/document.xml en el DOCX.');

  let xml = docXmlEntry.getData().toString('utf8');

  // 1. Recopilar todos los textos <w:t> únicos para traducción en lote
  const textSegments = [];
  const wtRegex = /<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g;
  let match;
  while ((match = wtRegex.exec(xml)) !== null) {
    if (match[1].trim()) {
      textSegments.push({ original: match[1], index: textSegments.length });
    }
  }

  if (!textSegments.length) return originalBuffer;

  // 2. Traducir en lotes de 10 en paralelo
  const concurrency = 10;
  const translated = new Array(textSegments.length);

  for (let i = 0; i < textSegments.length; i += concurrency) {
    const chunk = textSegments.slice(i, i + concurrency);
    const results = await Promise.all(
      chunk.map(async (seg) => {
        try {
          const t = await translateFn(seg.original, sourceLanguage, targetLanguage);
          return (t && t.trim()) ? t : seg.original;
        } catch (_) {
          return seg.original;
        }
      })
    );
    results.forEach((t, j) => { translated[i + j] = t; });
  }

  // 3. Reemplazar cada <w:t> en orden
  let idx = 0;
  xml = xml.replace(/<w:t(\s[^>]*)?>([^<]*)<\/w:t>/g, (m, attrs = '', text) => {
    if (!text.trim()) return m;
    const translatedText = translated[idx++] ?? text;
    const needsSpace = translatedText.startsWith(' ') || translatedText.endsWith(' ');
    let finalAttrs = attrs;
    if (needsSpace && !attrs.includes('xml:space')) {
      finalAttrs = ` xml:space="preserve"${attrs}`;
    }
    return `<w:t${finalAttrs}>${escapeXml(translatedText)}</w:t>`;
  });

  zip.updateFile('word/document.xml', Buffer.from(xml, 'utf8'));
  return zip.toBuffer();
}

function escapeXml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

module.exports = { translateDocxWithRuns, translateDocxBuffer };
