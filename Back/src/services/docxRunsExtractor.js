/**
 * docxRunsExtractor.js
 * Extrae los "runs" de texto de un DOCX con sus índices de párrafo y run.
 * Usa AdmZip para leer el XML interno del DOCX (formato ZIP).
 * 
 * Reemplaza la implementación anterior que usaba el módulo 'docx' para leer
 * archivos existentes (incorrecto, ese módulo solo crea documentos nuevos).
 */

const AdmZip = require('adm-zip');
const fs     = require('fs');

/**
 * Extrae todos los runs de texto del DOCX con sus índices.
 * @param {string} filePath - Ruta al archivo DOCX
 * @returns {Array<{paragraph: number, run: number, texto: string}>}
 */
function extractDocxRunsWithIndices(filePath) {
  try {
    const buffer = fs.existsSync(filePath) ? fs.readFileSync(filePath) : null;
    if (!buffer) return [];
    return extractDocxRunsFromBuffer(buffer);
  } catch (e) {
    console.error('Error extracting DOCX runs:', e.message);
    return [];
  }
}

/**
 * Extrae runs a partir de un Buffer del DOCX.
 * @param {Buffer} buffer
 * @returns {Array<{paragraph: number, run: number, texto: string}>}
 */
function extractDocxRunsFromBuffer(buffer) {
  try {
    const zip = new AdmZip(buffer);
    const docXmlEntry = zip.getEntry('word/document.xml');
    if (!docXmlEntry) return [];

    const xml = docXmlEntry.getData().toString('utf8');
    const runs = [];

    // Iterar sobre párrafos <w:p>
    let paraIdx = 0;
    const paraRegex = /<w:p[\s>][\s\S]*?<\/w:p>/g;
    let paraMatch;

    while ((paraMatch = paraRegex.exec(xml)) !== null) {
      const paraXml = paraMatch[0];
      let runIdx = 0;

      // Iterar sobre runs <w:r> dentro del párrafo
      const runRegex = /<w:r[\s>][\s\S]*?<\/w:r>/g;
      let runMatch;

      while ((runMatch = runRegex.exec(paraXml)) !== null) {
        const runXml = runMatch[0];

        // Extraer todos los <w:t> del run y concatenar
        const textMatches = [...runXml.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)];
        const text = textMatches.map(m => m[1]).join('');

        if (text.trim()) {
          runs.push({ paragraph: paraIdx, run: runIdx, texto: text });
        }
        runIdx++;
      }
      paraIdx++;
    }

    return runs;
  } catch (e) {
    console.error('Error parsing DOCX XML:', e.message);
    return [];
  }
}

module.exports = { extractDocxRunsWithIndices, extractDocxRunsFromBuffer };