const mongoose = require('mongoose');

const chatMessageSchema = new mongoose.Schema({
  sender: { type: String, enum: ['user', 'admin', 'tamon'], required: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  message: { type: String },
  fileUrl: { type: String },
  extractedText: { type: String },
  chatType: { type: String, enum: ['admin', 'user'], required: true },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('ChatMessage', chatMessageSchema);
