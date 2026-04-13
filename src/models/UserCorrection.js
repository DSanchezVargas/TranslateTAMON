const mongoose = require('mongoose');

const userCorrectionSchema = new mongoose.Schema(
  {
    project: { type: String, required: true },
    sourceLanguage: { type: String, required: true },
    targetLanguage: { type: String, required: true },
    originalTranslation: { type: String, required: true },
    correctedTranslation: { type: String, required: true }
  },
  { timestamps: true }
);

module.exports = mongoose.model('UserCorrection', userCorrectionSchema);
