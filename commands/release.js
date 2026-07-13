const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const database       = require('../db/database');
const constants      = require('../config/constants');
const builderHelpers = require('../utils/builder-helpers');
const { buildPSLEmbed }                  = require('../utils/embed-helpers');
const { safeRoleRemove, safeFetchMember } = require('../utils/discord-helpers');
const { canManageTeam, isChairman, validateGuild }    = require('../utils/validations');
const { updateTeamsRoster }               = require('../utils/roster-updater');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('release')
    .setDescription('Releases a player or staff member from their national team contract.')
    .addUserOption((option) =>
      option.setName('player').setDescription('Player to release').setRequired(true),
    ),

  async execute(interaction) {
    if (!validateGuild(interaction)) {
      return interaction.editReply({
        content: '❌ You can only execute this command in the official server.',
        flags: MessageFlags.Ephemeral,
      });
    }

    const targetUser = interaction.options.getMember('player');
    const displayName = targetUser.displayName;
    const userId     = targetUser.id;

    if (targetUser.bot) {
      return interaction.editReply({
        content: '❌ Bots do not have contracts.',
        flags: MessageFlags.Ephemeral,
      });
    }

    try {
      const activeContract = await database.getContractedTeam(userId);
      if (!activeContract) {
        return interaction.editReply({
          content: `❌ **${displayName}** is already a **Free Agent**.`,
          flags: MessageFlags.Ephemeral,
        });
      }

      const playerTeam        = activeContract.teamName;
      const teamInfo          = await database.getTeamInfo(playerTeam);
      const formattedTeamName = `**${builderHelpers.getFormattedTeamName(playerTeam)}**`;

      if (!canManageTeam(interaction.member, teamInfo)) {
        return interaction.editReply({
          content: `❌ You do not have permission to release players from ${formattedTeamName}.`,
          flags: MessageFlags.Ephemeral,
        });
      }

      const releasesUsed = teamInfo.releasesUsed || 0;
      if (releasesUsed >= constants.MAX_RELEASES_PER_TEAM && !isChairman(interaction.member)) {
        return interaction.editReply({
          content: `❌ ${formattedTeamName} has reached the maximum number of releases allowed this season.`,
          flags: MessageFlags.Ephemeral,
        });
      }

      const isManager   = teamInfo.manager          === userId;
      const isAssistant = teamInfo.assistantManager === userId;
      const isStaff     = isManager || isAssistant;
      const staffRole         = isManager ? 'manager' : 'assistant';
      const globalStaffRoleId = isManager ? constants.MANAGER_ROLE_ID : constants.ASSISTANT_MANAGER_ROLE_ID;
      const staffRoleName     = isManager ? 'Manager' : 'Assistant Manager';

      if (isStaff) {
        await database.appointStaff(playerTeam, null, staffRole);
      }
      await database.releasePlayer(userId);
      await database.incrementTeamRelease(playerTeam);

      await interaction.editReply({
        content: isStaff
          ? `✅ **${displayName}** has been released from ${formattedTeamName} and their **${staffRoleName}** position has been cleared.`
          : `✅ **${displayName}** has been released from ${formattedTeamName}.`,
        flags: MessageFlags.Ephemeral,
      });

      (async () => {
        try {
          const targetMember = await safeFetchMember(interaction.guild, userId);
          if (targetMember) {
            const rolesToRemove = [teamInfo.roleId];
            if (isStaff) rolesToRemove.push(globalStaffRoleId);

            await Promise.all(rolesToRemove.map((rId) => safeRoleRemove(targetMember, rId))).catch(console.warn);
            console.log(
              `[release.js] Stripped ${rolesToRemove.length} role(s) from ${userId}` +
              (isStaff ? ` (including ${staffRoleName} role).` : '.'),
            );
          }

          const [updatedTeamInfo, teamCapacity, releasesCapacity, role] = await Promise.all([
            database.getTeamInfo(playerTeam),
            builderHelpers.getDisplayedPlayersAmount(playerTeam),
            builderHelpers.getDisplayedReleasesAmount(playerTeam),
            builderHelpers.getTeamRole(interaction.client, playerTeam),
          ]);

          const releaseChannel = await interaction.client.channels
            .fetch(constants.RELEASES_CHANNEL_ID)
            .catch(() => null);
          if (releaseChannel) {
            const releaseEmbed = buildPSLEmbed(interaction.client, role?.color || constants.DEFAULT_EMBED_COLOR)
              .setTitle(`${formattedTeamName} OFFICIAL RELEASE`)
              .setThumbnail(targetUser.displayAvatarURL({ dynamic: true }))
              .addFields(
                {
                  name: isStaff ? 'Staff Released' : 'Player Released',
                  value: isStaff
                    ? `**${displayName}** has been released from ${formattedTeamName} and their **${staffRoleName}** badge has been revoked. They are now a Free Agent. 📋`
                    : `**${displayName}** has been released from ${formattedTeamName} and is now a Free Agent. 📋`,
                },
                {
                  name:  'Team Capacity',
                  value: `**${teamCapacity}**`,
                },
                {
                  name:  'Releases Used',
                  value: `**${releasesCapacity}**`,
                }
              );

            const mentions = [
              `<@${userId}>`,
              updatedTeamInfo?.manager          ? `<@${updatedTeamInfo.manager}>`          : null,
              updatedTeamInfo?.assistantManager  ? `<@${updatedTeamInfo.assistantManager}>` : null,
            ]
              .filter(Boolean)
              .join(' ');

            await releaseChannel.send({ content: mentions, embeds: [releaseEmbed] }).catch(console.warn);
          }

          await updateTeamsRoster(interaction.client);
        } catch (backgroundError) {
          console.error('[release.js] Background release error:', backgroundError);
        }
      })();

    } catch (error) {
      console.error('❌ Error in /release:', error);
      if (!interaction.replied) {
        interaction.editReply({
          content: '❌ An unexpected error occurred during release.',
          flags: MessageFlags.Ephemeral,
        });
      }
    }
  },
};