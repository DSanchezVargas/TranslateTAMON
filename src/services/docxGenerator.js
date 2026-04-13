const { Document, HeadingLevel, Packer, Paragraph, TextRun } = require('docx');

function toParagraphs(text) {
  return text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => new Paragraph({ children: [new TextRun(line)] }));
}

async function createTranslatedDocxBuffer({ originalFileName, sourceLanguage, targetLanguage, translatedText }) {
  const title = `Traducción de ${originalFileName}`;

  const doc = new Document({
    sections: [
      {
        children: [
          new Paragraph({ text: title, heading: HeadingLevel.HEADING_1 }),
          new Paragraph({ text: `Idioma origen: ${sourceLanguage}` }),
          new Paragraph({ text: `Idioma destino: ${targetLanguage}` }),
          new Paragraph({ text: '' }),
          ...toParagraphs(translatedText)
        ]
      }
    ]
  });

  return Packer.toBuffer(doc);
}

module.exports = {
  createTranslatedDocxBuffer
};
