const { SlashCommandBuilder } = require('discord.js');
const database = require('../db/database');
const constants = require('../config/constants');
const builderHelpers = require('../utils/builderHelpers');
const { buildPSLEmbed } = require('../utils/embedHelpers');
const { isTeamStaff } = require('../utils/validations');
const { safeRoleRemove } = require('../utils/discordHelpers');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('demand')
    .setDescription(`Voluntarily leave your team contract (Limit: ${constants.MAX_DEMANDS_PER_SEASON} per season).`),

  async execute(interaction) {
    const userId = interaction.user.id;
    console.log(`\n🏃 [demand.js] Demand triggered by ${interaction.user.tag}`);

    try {
      const activeContract = await database.getContractedTeam(userId);
      if (!activeContract) {
        return interaction.reply({
          content: '❌ You do not have an active contract. You are already a Free Agent.',
          ephemeral: true,
        });
      }

      const playerTeam = activeContract.teamName;
      const teamInfo = await database.getTeamInfo(playerTeam);

      if (teamInfo && isTeamStaff(teamInfo, userId)) {
        return interaction.reply({
          content: '❌ Management staff cannot use the demand command.',
          ephemeral: true,
        });
      }

      const demandsUsed = await database.getPlayerDemandsCount(userId);
      if (demandsUsed >= constants.MAX_DEMANDS_PER_SEASON) {
        return interaction.reply({
          content: `❌ **Seasonal limit reached!** You have used all ${constants.MAX_DEMANDS_PER_SEASON} demands this season.`,
          ephemeral: true,
        });
      }

      await database.releasePlayer(userId);
      const updatedHistory = await database.incrementPlayerDemand(userId);
      const remainingDemands = constants.MAX_DEMANDS_PER_SEASON - updatedHistory.demandsUsed;

      if (teamInfo?.roleId) {
        await safeRoleRemove(interaction.member, teamInfo.roleId);
      }

      const formattedTeamName = `**${playerTeam.toUpperCase()}**`;

      console.log(`[demand.js] ${userId} left ${formattedTeamName}. Demands used: ${updatedHistory.demandsUsed}`);

      try {
        const releasesChannel = await interaction.client.channels.fetch(constants.RELEASES_CHANNEL_ID);
        const teamManager = await database.getTeamStaff(playerTeam, 'manager');
        const teamAssistant = await database.getTeamStaff(playerTeam, 'assistantManager');
        if (releasesChannel) {
          const teamCapacity = await builderHelpers.getDisplayedPlayersAmount(playerTeam);
          const demandEmbed = buildPSLEmbed(interaction.client, constants.DEMAND_COLOR)
            .setTitle(`${formattedTeamName} OFFICIAL DEMAND`)
            .addFields(
              {
                name: 'Player Demanded Release',
                value: `<@${userId}> has voluntarily left ${formattedTeamName} and is now a Free Agent! 📝\n(**Demands remaining: ${remainingDemands}**/${constants.MAX_DEMANDS_PER_SEASON})`,
              },
              {
                name: 'Team Capacity',
                value: teamCapacity,
              }
            );
          const mentions = [
            `<@${userId}>`,
            teamManager?.manager ? `<@${teamManager.manager}>` : null,
            teamAssistant?.assistantManager ? `<@${teamAssistant.assistantManager}>` : null,
          ].filter(Boolean).join(' ');
          await releasesChannel.send({ content: mentions, embeds: [demandEmbed] });
        }
      } catch (logError) {
        console.warn('[demand.js] Could not post to releases channel:', logError.message);
      }

      return interaction.reply({
        content: `✅ You have left ${formattedTeamName}. You have **${remainingDemands}** demand(s) remaining this season.`,
        ephemeral: true,
      });
    } catch (error) {
      console.error('❌ Error in /demand:', error);
      return interaction.reply({ content: '❌ An error occurred processing your demand.', ephemeral: true });
    }
  },
};