const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const database = require('../db/database');
const constants = require('../config/constants');
const builderHelpers = require('../utils/builder-helpers');
const { buildPSLEmbed } = require('../utils/embed-helpers');
const { safeRoleRemove, safeFetchMember } = require('../utils/discord-helpers');
const { validateGuild } = require('../utils/validations');

const cooldowns = new Map();

module.exports = {
  data: new SlashCommandBuilder()
    .setName('demand')
    .setDescription(`Voluntarily leave your team contract (Limit: ${constants.MAX_DEMANDS_PER_PLAYER} per season).`),

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

      if (demandsUsed >= constants.MAX_DEMANDS_PER_PLAYER) {
        return interaction.editReply({ content: `❌ **Demand limit reached!** You have used all ${constants.MAX_DEMANDS_PER_PLAYER} demands this season.`, flags: MessageFlags.Ephemeral });
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

      const isManager = teamInfo?.manager === userId;
      const isAssistant = teamInfo?.assistantManager === userId;
      const isStaff = isManager || isAssistant;
      const staffRole = isManager ? 'manager' : 'assistant';
      const globalStaffRoleId = isManager ? constants.MANAGER_ROLE_ID : constants.ASSISTANT_MANAGER_ROLE_ID;
      const staffRoleName = isManager ? 'Manager' : 'Assistant Manager';

      if (isStaff) {
        await database.appointStaff(playerTeam, null, staffRole);
      }
      await database.releasePlayer(userId);
      
      const updatedHistory = await database.incrementPlayerDemand(userId);
      const remainingDemands = constants.MAX_DEMANDS_PER_PLAYER - updatedHistory.demandsUsed;
      const formattedTeamName = `**${builderHelpers.getFormattedTeamName(playerTeam).toUpperCase()}**`;

      interaction.editReply({
        content: isStaff
          ? `✅ You have left ${formattedTeamName} and your **${staffRoleName}** position has been cleared. You have **${remainingDemands}** demand(s) remaining this season.`
          : `✅ You have left ${formattedTeamName}. You have **${remainingDemands}** demand(s) remaining this season.`,
        flags: MessageFlags.Ephemeral,
      });

      (async () => {
        try {
          const rolesToRemove = [];
          if (teamInfo?.roleId) rolesToRemove.push(teamInfo.roleId);
          if (isStaff) rolesToRemove.push(globalStaffRoleId);

          if (rolesToRemove.length > 0) {
            await Promise.all(rolesToRemove.map((rId) => safeRoleRemove(interaction.member, rId))).catch(console.warn);
          }

          const [updatedTeamInfo, teamCapacity, role] = await Promise.all([
            database.getTeamInfo(playerTeam),
            builderHelpers.getDisplayedPlayersAmount(playerTeam),
            builderHelpers.getTeamRole(interaction.client, playerTeam),
          ]);

          const rawIds = [userId];
          if (updatedTeamInfo?.manager) rawIds.push(updatedTeamInfo.manager);
          if (updatedTeamInfo?.assistantManager) rawIds.push(updatedTeamInfo.assistantManager);

          await safeFetchMember(interaction.guild, rawIds);

          const releasesChannel = await interaction.client.channels.fetch(constants.RELEASES_CHANNEL_ID).catch(() => null);
          if (releasesChannel) {
            const demandEmbed = buildPSLEmbed(interaction.client, role?.color || constants.DEFAULT_EMBED_COLOR)
              .setTitle(`${formattedTeamName} OFFICIAL DEMAND`)
              .setThumbnail(interaction.user.displayAvatarURL({ dynamic: true }))
              .addFields(
                {
                  name: isStaff ? 'Staff Demanded Release' : 'Player Demanded Release',
                  value: isStaff
                    ? `<@${userId}> has voluntarily left ${formattedTeamName} and their **${staffRoleName}** badge has been revoked. They are now a Free Agent! 📝\n(**Demands remaining: ${remainingDemands}**/${constants.MAX_DEMANDS_PER_PLAYER})`
                    : `<@${userId}> has voluntarily left ${formattedTeamName} and is now a Free Agent! 📝\n(**Demands remaining: ${remainingDemands}**/${constants.MAX_DEMANDS_PER_PLAYER})`,
                },
                { name: 'Team Capacity', value: teamCapacity }
              );

            const mentions = [
              `<@${userId}>`,
              updatedTeamInfo?.manager ? `<@${updatedTeamInfo.manager}>` : null,
              updatedTeamInfo?.assistantManager ? `<@${updatedTeamInfo.assistantManager}>` : null,
            ].filter(Boolean).join(' ');

            await releasesChannel.send({ content: mentions, embeds: [demandEmbed] }).catch(console.warn);
          }
        } catch (backgroundError) {
          console.error('[demand.js] Background demand error:', backgroundError);
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