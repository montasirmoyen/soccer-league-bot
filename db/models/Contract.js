const mongoose = require('mongoose');

const contractSchema = new mongoose.Schema({
  userId: { type: String, required: true, unique: true },
  teamName: { type: String, required: true },
  emoji: { type: String, required: true },
});

module.exports = mongoose.model('Contract', contractSchema);
