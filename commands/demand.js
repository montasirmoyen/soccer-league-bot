const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const database = require('../db/database');
const constants = require('../config/constants');
const builderHelpers = require('../utils/builder-helpers');
const { buildPSLEmbed } = require('../utils/embed-helpers');
const { safeRoleRemove } = require('../utils/discord-helpers');
const { isTeamStaff } = require('../utils/validations');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('demand')
    .setDescription(`Voluntarily leave your team contract (Limit: ${constants.MAX_DEMANDS_PER_SEASON} per season).`),

  async execute(interaction) {
    const userId = interaction.user.id;

    try {
      const activeContract = await database.getContractedTeam(userId);
      if (!activeContract) {
        return interaction.editReply({ content: '❌ You do not have an active contract. You are already a Free Agent.', flags: MessageFlags.Ephemeral });
      }

      const playerTeam = activeContract.teamName;
      const [teamInfo, demandsUsed] = await Promise.all([
        database.getTeamInfo(playerTeam),
        database.getPlayerDemandsCount(userId)
      ]);

      if (teamInfo && isTeamStaff(teamInfo, userId)) {
        return interaction.editReply({ content: '❌ Management staff cannot use the demand command.', flags: MessageFlags.Ephemeral });
      }
      if (demandsUsed >= constants.MAX_DEMANDS_PER_SEASON) {
        return interaction.editReply({ content: `❌ **Seasonal limit reached!** You have used all ${constants.MAX_DEMANDS_PER_SEASON} demands this season.`, flags: MessageFlags.Ephemeral });
      }

      await database.releasePlayer(userId);
      const updatedHistory = await database.incrementPlayerDemand(userId);
      
      const remainingDemands = constants.MAX_DEMANDS_PER_SEASON - updatedHistory.demandsUsed;
      const formattedTeamName = `**${playerTeam.toUpperCase()}**`;

      interaction.editReply({ content: `✅ You have left ${formattedTeamName}. You have **${remainingDemands}** demand(s) remaining this season.`, flags: MessageFlags.Ephemeral });

      (async () => {
        if (teamInfo?.roleId) {
          safeRoleRemove(interaction.member, teamInfo.roleId).catch(console.warn);
        }

        const releasesChannel = await interaction.client.channels.fetch(constants.RELEASES_CHANNEL_ID).catch(() => null);
        if (releasesChannel) {
          const [teamCapacity, teamManager, teamAssistant] = await Promise.all([
            builderHelpers.getDisplayedPlayersAmount(playerTeam),
            database.getTeamStaff(playerTeam, 'manager'),
            database.getTeamStaff(playerTeam, 'assistantManager')
          ]);

          const demandEmbed = buildPSLEmbed(interaction.client, constants.DEMAND_COLOR)
            .setTitle(`${formattedTeamName} OFFICIAL DEMAND`)
            .addFields(
              { name: 'Player Demanded Release', value: `<@${userId}> has voluntarily left ${formattedTeamName} and is now a Free Agent! 📝\n(**Demands remaining: ${remainingDemands}**/${constants.MAX_DEMANDS_PER_SEASON})` },
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
      if (!interaction.replied) interaction.editReply({ content: '❌ An error occurred processing your demand.', flags: MessageFlags.Ephemeral });
    }
  },
};