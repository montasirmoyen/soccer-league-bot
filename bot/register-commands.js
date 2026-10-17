const { REST, Routes } = require('discord.js');
const { BOT_TOKEN, CLIENT_ID } = require('../config/constants');

async function registerCommands(commands) {
  const rest = new REST({ version: '10' }).setToken(BOT_TOKEN);
  console.log('🔄 Refreshing commands...');
  await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
  console.log('✅ Commands refreshed.');
}

module.exports = { registerCommands };