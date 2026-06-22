async function handleCommand(interaction, client) {
  try {
    const command = client.commands.get(interaction.commandName);
    if (!command) {
      console.warn(`[commandHandler.js] Command not found: ${interaction.commandName}`);
      return;
    }

    await command.execute(interaction);
  } catch (error) {
    console.error('[commandHandler.js] Error executing command:', error);
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({ content: '❌ An error occurred executing the command.', ephemeral: true });
    } else {
      await interaction.reply({ content: '❌ An error occurred executing the command.', ephemeral: true });
    }
  }
}

module.exports = { handleCommand };