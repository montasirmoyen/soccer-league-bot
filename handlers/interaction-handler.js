const { Events } = require('discord.js');
const { handleCommand } = require('./commandHandler');
const { handleButton } = require('./buttonHandler');
const { handleAnnounceModal } = require('./modal-handler');

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
        return;
      }
    } catch (error) {
      console.error('[interactionHandler.js] Unhandled interaction error:', error);

      const errorMessage = {
        content: `❌ An unexpected error occurred:\n\`\`\`${error.message}\`\`\``,
        ephemeral: true,
      };

      try {
        if (interaction.replied || interaction.deferred) {
          await interaction.followUp(errorMessage);
        } else {
          await interaction.reply(errorMessage);
        }
      } catch (replyError) {
        console.error('[interactionHandler.js] Failed to send error message:', replyError);
      }
    }
  });
}

module.exports = { registerInteractionHandler };