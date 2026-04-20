require('dotenv').config();

async function listarMisModelos() {
  const apiKey = process.env.GEMINI_API_KEY;
  
  if (!apiKey) {
    return console.error("Falta tu GEMINI_API_KEY en el archivo .env");
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;

  try {
    const respuesta = await fetch(url);
    const data = await respuesta.json();

    console.log("--- MODELOS DISPONIBLES EN TU API ---");
    data.models.forEach(m => {
      // Filtramos solo los modelos que sirven para chatear/generar texto
      if (m.supportedGenerationMethods && m.supportedGenerationMethods.includes("generateContent")) {
        console.log(`Nombre visual: ${m.displayName}`);
        // Limpiamos el prefijo "models/" para darte el nombre exacto que va en tu código
        console.log(`CÓDIGO PARA NODE.JS: ${m.name.replace('models/', '')}`); 
        console.log("-----------------------------------");
      }
    });
  } catch (error) {
    console.error("Error al conectar con Google:", error);
  }
}

listarMisModelos();