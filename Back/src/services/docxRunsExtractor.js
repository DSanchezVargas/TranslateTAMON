const { Document } = require('docx');
const fs = require('fs');

// Extrae todos los textos de cada run con sus índices de párrafo y run
function extractDocxRunsWithIndices(filePath) {
  const doc = new Document(fs.readFileSync(filePath));
  const result = [];
  doc.paragraphs.forEach((para, pIdx) => {
    para.runs.forEach((run, rIdx) => {
      result.push({
        paragraph: pIdx,
        run: rIdx,
        texto: run.text
      });
    });
  });
  return result;
}

module.exports = { extractDocxRunsWithIndices };