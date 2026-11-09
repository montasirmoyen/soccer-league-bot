const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const constants = require('../config/constants');
const { buildPSLEmbed } = require('../utils/embed-helpers');
const { logCommandResult } = require('../utils/log-helpers');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('help')
    .setDescription('Quick guide to the commands every member can use'),

  async execute(interaction) {
    try {
      const mainEmbed = buildPSLEmbed(interaction.client, constants.DEFAULT_EMBED_COLOR)
        .setTitle('⚽ PSL Community Commands')
        .setDescription('Everything you need to get involved, stay connected, and make the most of the league — quickly and professionally.')
        .setThumbnail(interaction.client.user.avatarURL());

      mainEmbed.addFields(
        {
          name: '👥 Member Commands',
          value: 'Open to everyone in the community.',
          inline: false,
        },
        {
          name: '📝 `/free-agent`',
          value: 'Register as a free agent and make yourself available to managers looking for players.',
          inline: false,
        },
        {
          name: '📣 `/send-profile`',
          value: 'Share your profile with the community and show your position, timezone, and short summary.',
          inline: false,
        },
        {
          name: '⚽ `/friendly`',
          value: 'Announce a friendly match and connect with players in your region.',
          inline: false,
        },
        {
          name: '📊 `/roster`',
          value: 'Check a team’s official roster and keep up with the current squad.',
          inline: false,
        },
        {
          name: '👤 `/view-profile`',
          value: 'Open a player’s public profile to review their current team and activity.',
          inline: false,
        },
        {
          name: '⭐ `/rating`',
          value: 'Submit or review feedback for staff members in a simple, transparent way.',
          inline: false,
        },
        {
          name: '🏓 `/ping`',
          value: 'Confirm the bot is online and responding normally.',
          inline: false,
        },
        {
          name: '🏟️ Team Commands',
          value: 'Built for teams to manage their operations and communicate with the league.',
          inline: false,
        },
        {
          name: '📋 `/contract`',
          value: 'Send a contract offer to a player during the transfer window.',
          inline: false,
        },
        {
          name: '🚨 `/emergency-contract`',
          value: 'Request an emergency signing when the transfer window is closed.',
          inline: false,
        },
        {
          name: '🧹 `/release`',
          value: 'Remove a player from the squad and make them available again.',
          inline: false,
        },
        {
          name: '👔 `/appoint`',
          value: 'Assign or update manager and assistant manager roles inside the team structure.',
          inline: false,
        },
        {
          name: '📨 `/scout`',
          value: 'Post a recruitment message to attract players for a specific position.',
          inline: false,
        },
        {
          name: '📢 `/match-inform`',
          value: 'Send a match update to all players and staff linked to a selected fixture.',
          inline: false,
        },
        {
          name: '💬 Ready to join in?',
          value: 'Use the commands above to stay active, manage your team, and contribute to the league community.',
          inline: false,
        }
      );

      await interaction.editReply({ embeds: [mainEmbed], flags: MessageFlags.Ephemeral });
    } catch (error) {
      await logCommandResult(interaction, {
        type: 'error',
        title: 'Help Guide Could Not Be Generated',
        command: 'help',
        result: 'The command guide could not be generated.',
        terminalResult: 'Help guide generation failed.',
        error,
      });
      return interaction.editReply({ content: '❌ An error occurred generating help.', flags: MessageFlags.Ephemeral });
    }
  },
};