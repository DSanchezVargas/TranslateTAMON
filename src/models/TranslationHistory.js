const mongoose = require('mongoose');

const translationHistorySchema = new mongoose.Schema(
  {
    originalFileName: { type: String, required: true },
    fileType: { type: String, required: true },
    sourceLanguage: { type: String, required: true },
    targetLanguage: { type: String, required: true },
    project: { type: String },
    domain: { type: String },
    sourceTextHash: { type: String },
    translatedTextCache: { type: String },
    sourceTextLength: { type: Number, required: true },
    translatedTextLength: { type: Number, required: true },
    status: { type: String, enum: ['success', 'failed'], required: true },
    errorMessage: { type: String }
  },
  { timestamps: true }
);

module.exports = mongoose.model('TranslationHistory', translationHistorySchema);
