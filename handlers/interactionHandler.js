const { Events } = require('discord.js');
const { handleCommand } = require('./commandHandler');
const { handleButton } = require('./buttonHandler');
const { handleAnnounceModal } = require('./modalHandler');

function registerInteractionHandler(client, emojiMap) {
  client.on(Events.InteractionCreate, async (interaction) => {
    try {
      if (interaction.isChatInputCommand()) {
        await handleCommand(interaction, client);
        return;
      }

      if (interaction.isButton()) {
        await handleButton(interaction);
        return;
      }

      if (interaction.isModalSubmit() && interaction.customId === 'announceModal') {
        await handleAnnounceModal(interaction, emojiMap);
      }
    } catch (err) {
      console.error('Error handling interaction:', err);

      const errorMessage = {
        content: `❌ There was an error:\n\`\`\`${err.stack || err.message}\`\`\``,
        ephemeral: true,
      };

      if (interaction.replied || interaction.deferred) {
        await interaction.followUp(errorMessage);
      } else {
        await interaction.reply(errorMessage);
      }
    }
  });
}

module.exports = { registerInteractionHandler };
