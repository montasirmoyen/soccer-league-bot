async function handleCommand(interaction, client) {
  const command = client.commands.get(interaction.commandName);
  if (!command) {
    return;
  }

  await command.execute(interaction);
}

module.exports = { handleCommand };
