const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');

// Paso 1: Extraer textos de imágenes del PDF
async function extraerTextosDePdf(pdfPath) {
  const form = new FormData();
  form.append('file', fs.createReadStream(pdfPath));
  const response = await axios.post('http://localhost:5002/extraer-textos-pdf', form, {
    headers: form.getHeaders(),
  });
  return response.data.textos; // Array de { page, img_index, texto }
}

// Paso 2: Insertar textos traducidos sobre imágenes y devolver PDF final
async function insertarTextosEnPdf(pdfPath, textosTraducidos, outputPath) {
  const form = new FormData();
  form.append('file', fs.createReadStream(pdfPath));
  form.append('textos', JSON.stringify(textosTraducidos));
  const response = await axios.post('http://localhost:5002/insertar-textos-pdf', form, {
    headers: form.getHeaders(),
    responseType: 'stream'
  });
  const output = fs.createWriteStream(outputPath);
  response.data.pipe(output);
  return new Promise((resolve) => {
    output.on('finish', () => resolve(outputPath));
  });
}

// Ejemplo de uso:
// (async () => {
//   const pdfPath = 'ruta/al/archivo.pdf';
//   const textos = await extraerTextosDePdf(pdfPath);
//   // Aquí traduce los textos con tu lógica/API
//   const textosTraducidos = textos.map(t => ({ ...t, texto: traducir(t.texto) }));
//   const outputPath = pdfPath.replace('.pdf', '_procesado.pdf');
//   await insertarTextosEnPdf(pdfPath, textosTraducidos, outputPath);
//   console.log('PDF procesado:', outputPath);
// })();

module.exports = {
  extraerTextosDePdf,
  insertarTextosEnPdf
};
