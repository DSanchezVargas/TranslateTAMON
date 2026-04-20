const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');

async function procesarDocxConPython(docxPath) {
  const form = new FormData();
  form.append('file', fs.createReadStream(docxPath));
  const response = await axios.post('http://localhost:5001/procesar-docx', form, {
    headers: form.getHeaders(),
    responseType: 'stream'
  });
  // Guarda el archivo procesado en una ruta temporal
  const outputPath = docxPath.replace('.docx', '_procesado.docx');
  const output = fs.createWriteStream(outputPath);
  response.data.pipe(output);
  return new Promise((resolve) => {
    output.on('finish', () => resolve(outputPath));
  });
}

module.exports = { procesarDocxConPython };