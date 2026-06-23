/**
 * docxTranslatorService.js
 * Traduce DOCX preservando formato usando la librería 'docx' (node.js puro).
 * Reemplaza la llamada a localhost:5001/procesar-docx.
 *
 * Estrategia:
 * - Usa mammoth para extraer texto raw + estructura básica
 * - Usa xml-js / xml parsing para editar runs directamente en el XML del DOCX
 * - Si no es posible, fallback a crear un nuevo DOCX con texto traducido
 */

const AdmZip = require('adm-zip');
const { translateText } = require('./translator');

/**
 * Aplica traducciones a los runs del XML word/document.xml
 * @param {string} xmlContent - Contenido XML del documento
 * @param {Array} docxRunsTranslated - Array [{paragraph, run, textoTraducido}]
 * @returns {string} XML modificado
 */
function applyTranslationsToXml(xmlContent, docxRunsTranslated) {
  // Construir mapa de traducciones: "pIdx-rIdx" => textoTraducido
  const translationMap = {};
  for (const item of docxRunsTranslated) {
    if (item.textoTraducido !== undefined) {
      translationMap[`${item.paragraph}-${item.run}`] = item.textoTraducido;
    } else if (item.texto !== undefined) {
      translationMap[`${item.paragraph}-${item.run}`] = item.texto;
    }
  }

  let xml = xmlContent;

  // Encontrar todos los párrafos <w:p>
  let pIdx = 0;
  xml = xml.replace(/<w:p[ >]/g, (match) => `__PARA_${pIdx++}__${match}`);

  // Para cada párrafo encontrado, encontrar sus runs <w:r>
  let rIdx = 0;
  let currentPara = -1;

  xml = xml.replace(/__PARA_(\d+)__(<w:p[ >])/g, (match, pi, tag) => {
    currentPara = parseInt(pi);
    rIdx = 0;
    return tag;
  });

  // Reiniciar y hacer el reemplazo real de texto en runs
  // Estrategia: regex para encontrar <w:r>...<w:t>texto</w:t>...</w:r>
  pIdx = 0;
  rIdx = 0;
  let inPara = false;

  // Dividir por párrafos para procesar runs en orden
  const parts = xml.split(/(<w:p[ >\/])/);
  let result = '';
  let paraCounter = -1;
  let runCounter = 0;

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];

    // Detectar inicio de párrafo
    if (part.match(/^<w:p[ >]/)) {
      paraCounter++;
      runCounter = 0;
      result += part;
      continue;
    }

    // Detectar fin de párrafo
    if (part.includes('</w:p>')) {
      result += part;
      continue;
    }

    // Procesar runs dentro del párrafo actual
    if (paraCounter >= 0) {
      // Reemplazar <w:t>...</w:t> dentro de runs
      const processed = part.replace(/(<w:r[ >][\s\S]*?<w:t[^>]*>)([\s\S]*?)(<\/w:t>)/g, 
        (m, before, text, after) => {
          const key = `${paraCounter}-${runCounter}`;
          runCounter++;
          if (translationMap[key] !== undefined) {
            const translated = translationMap[key];
            // Preservar espacio al inicio/fin para w:xml:space
            const needsSpace = text.startsWith(' ') || text.endsWith(' ');
            const spaceAttr = needsSpace ? ' xml:space="preserve"' : '';
            return `${before.replace(/<w:t[^>]*>/, `<w:t${spaceAttr}>`) }${translated}${after}`;
          }
          return m;
        }
      );
      result += processed;
      continue;
    }

    result += part;
  }

  return result;
}

/**
 * Traduce un DOCX preservando su formato original.
 * @param {Buffer} originalFileBuffer - Buffer del DOCX original
 * @param {Array} docxRunsTranslated - Runs traducidos [{paragraph, run, texto/textoTraducido}]
 * @returns {Buffer} Buffer del DOCX traducido
 */
async function translateDocxWithRuns(originalFileBuffer, docxRunsTranslated) {
  try {
    const zip = new AdmZip(originalFileBuffer);
    const docXmlEntry = zip.getEntry('word/document.xml');

    if (!docXmlEntry) {
      throw new Error('No se encontró word/document.xml en el DOCX.');
    }

    let xmlContent = docXmlEntry.getData().toString('utf8');
    const modifiedXml = applyTranslationsToXml(xmlContent, docxRunsTranslated);

    zip.updateFile('word/document.xml', Buffer.from(modifiedXml, 'utf8'));
    return zip.toBuffer();
  } catch (err) {
    throw new Error('Error al procesar DOCX: ' + err.message);
  }
}

module.exports = { translateDocxWithRuns };
