const fs = require('fs');
const path = require('path');

function loadCommands(client) {
  const commandsPath = path.join(__dirname, '..', 'commands');
  const commandFiles = fs.readdirSync(commandsPath).filter((file) => file.endsWith('.js'));
  const commands = [];

  for (const file of commandFiles) {
    try {
      const command = require(path.join(commandsPath, file));
      if (!command?.data?.name || !command?.execute) continue;

      commands.push(command.data.toJSON());
      client.commands.set(command.data.name, command);
    } catch (error) {
      console.error(`[load-commands] Failed to load command ${file}:`, error.message);
    }
  }

  return commands;
}

module.exports = { loadCommands };