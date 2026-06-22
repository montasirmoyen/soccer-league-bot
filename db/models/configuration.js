const mongoose = require('mongoose');

const configSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true, default: 'global' },
  transferWindowOpened: { type: Boolean, default: false }
});

module.exports = mongoose.model('Config', configSchema);