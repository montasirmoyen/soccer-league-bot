const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const database = require('../db/database');
const constants = require('../config/constants');
const builderHelpers = require('../utils/builder-helpers');
const { buildPSLEmbed } = require('../utils/embed-helpers');
const { safeRoleRemove } = require('../utils/discord-helpers');
const { isTeamStaff, validateGuild } = require('../utils/validations');

const cooldowns = new Map();

module.exports = {
  data: new SlashCommandBuilder()
    .setName('demand')
    .setDescription(`Voluntarily leave your team contract (Limit: ${constants.MAX_DEMANDS_PER_SEASON} per season).`),

  async execute(interaction) {
    if (!validateGuild(interaction)) {
      return interaction.editReply({ content: '❌ You can only execute this command in the official server.', flags: MessageFlags.Ephemeral });
    }

    const userId = interaction.user.id;

    try {
      const activeContract = await database.getContractedTeam(userId);
      if (!activeContract) {
        return interaction.editReply({ content: '❌ You do not have an active contract. You are already a Free Agent.', flags: MessageFlags.Ephemeral });
      }

      const playerTeam = activeContract.teamName;
      const [teamInfo, demandsUsed] = await Promise.all([
        database.getTeamInfo(playerTeam),
        database.getPlayerDemandsCount(userId),
      ]);

      if (teamInfo && isTeamStaff(teamInfo, userId)) {
        return interaction.editReply({ content: '❌ Management staff cannot use the demand command.', flags: MessageFlags.Ephemeral });
      }
      if (demandsUsed >= constants.MAX_DEMANDS_PER_SEASON) {
        return interaction.editReply({ content: `❌ **Seasonal limit reached!** You have used all ${constants.MAX_DEMANDS_PER_SEASON} demands this season.`, flags: MessageFlags.Ephemeral });
      }

      const cooldownAmount = 3 * 24 * 60 * 60 * 1000;
      const now = Date.now();

      if (cooldowns.has(userId)) {
        const expirationTime = cooldowns.get(userId) + cooldownAmount;
        if (now < expirationTime) {
          const timeLeft = expirationTime - now;
          const hours = Math.floor(timeLeft / 3600000);
          const minutes = Math.floor((timeLeft % 3600000) / 60000);
          return interaction.editReply({
            content: `⏰ You are on cooldown! Please try again in **${hours}**h **${minutes}**m.`,
            flags: MessageFlags.Ephemeral,
          });
        }
      }

      cooldowns.set(userId, now);
      setTimeout(() => cooldowns.delete(userId), cooldownAmount);

      await database.releasePlayer(userId);
      const updatedHistory = await database.incrementPlayerDemand(userId);

      const remainingDemands = constants.MAX_DEMANDS_PER_SEASON - updatedHistory.demandsUsed;
      const formattedTeamName = `**${playerTeam.toUpperCase()}**`;

      interaction.editReply({
        content: `✅ You have left ${formattedTeamName}. You have **${remainingDemands}** demand(s) remaining this season.`,
        flags: MessageFlags.Ephemeral,
      });

      (async () => {
        if (teamInfo?.roleId) {
          safeRoleRemove(interaction.member, teamInfo.roleId).catch(console.warn);
        }

        const releasesChannel = await interaction.client.channels.fetch(constants.RELEASES_CHANNEL_ID).catch(() => null);
        if (releasesChannel) {
          const [teamCapacity, teamManager, teamAssistant, role] = await Promise.all([
            builderHelpers.getDisplayedPlayersAmount(playerTeam),
            database.getTeamStaff(playerTeam, 'manager'),
            database.getTeamStaff(playerTeam, 'assistantManager'),
            builderHelpers.getTeamRole(interaction.client, playerTeam),
          ]);

          const demandEmbed = buildPSLEmbed(interaction.client, role?.color || constants.DEFAULT_EMBED_COLOR)
            .setTitle(`${formattedTeamName} OFFICIAL DEMAND`)
            .addFields(
              {
                name: 'Player Demanded Release',
                value: `<@${userId}> has voluntarily left ${formattedTeamName} and is now a Free Agent! 📝\n(**Demands remaining: ${remainingDemands}**/${constants.MAX_DEMANDS_PER_SEASON})`,
              },
              { name: 'Team Capacity', value: teamCapacity }
            );

          const mentions = [
            `<@${userId}>`,
            teamManager?.manager ? `<@${teamManager.manager}>` : null,
            teamAssistant?.assistantManager ? `<@${teamAssistant.assistantManager}>` : null,
          ].filter(Boolean).join(' ');

          releasesChannel.send({ content: mentions, embeds: [demandEmbed] }).catch(console.warn);
        }
      })();

    } catch (error) {
      console.error('❌ Error in /demand:', error);
      if (!interaction.replied) {
        interaction.editReply({ content: '❌ An error occurred processing your demand.', flags: MessageFlags.Ephemeral });
      }
    }
  },
};