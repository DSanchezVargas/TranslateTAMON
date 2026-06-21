// Cliente para enviar PDF a microservicio Python y obtener texto extraído por OCR
const axios = require('axios');
const FormData = require('form-data');

async function extractPdfTextWithOcrPython(fileBuffer, fileName) {
  const form = new FormData();
  form.append('file', fileBuffer, fileName);
  const response = await axios.post('http://localhost:5002/extraer-textos-pdf', form, {
    headers: form.getHeaders(),
    timeout: 120000 // 2 minutos por si el OCR es lento
  });
  // El microservicio responde con { textos: [{ texto, ... }] }
  const textos = response.data?.textos || [];
  return textos.map(t => t.texto).join('\n\n');
}

module.exports = { extractPdfTextWithOcrPython };
