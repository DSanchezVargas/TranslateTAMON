const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');

async function procesarPdfConPython(pdfPath) {
  const form = new FormData();
  form.append('file', fs.createReadStream(pdfPath));
  const response = await axios.post('http://localhost:5002/procesar-pdf', form, {
    headers: form.getHeaders(),
    responseType: 'stream'
  });
  const outputPath = pdfPath.replace('.pdf', '_procesado.pdf');
  const output = fs.createWriteStream(outputPath);
  response.data.pipe(output);
  return new Promise((resolve) => {
    output.on('finish', () => resolve(outputPath));
  });
}

module.exports = { procesarPdfConPython };