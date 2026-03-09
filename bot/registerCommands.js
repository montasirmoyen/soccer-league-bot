const { REST, Routes } = require('discord.js');

async function registerCommands(commands) {
  const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);
  console.log('Refreshing commands....');
  await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: commands });
  console.log('Commands refreshed.');
}

module.exports = { registerCommands };
