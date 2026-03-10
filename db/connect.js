const mongoose = require('mongoose');

async function connectMongo() {
  await mongoose.connect(process.env.MONGODB_URI);
}

module.exports = { connectMongo };
