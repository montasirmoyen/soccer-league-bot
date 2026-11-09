const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const database = require('../db/database');
const constants = require('../config/constants');
const builderHelpers = require('../utils/builder-helpers');
const { buildPSLEmbed } = require('../utils/embed-helpers');
const { safeRoleRemove, safeFetchMember } = require('../utils/discord-helpers');
const { canManageTeam, isLeagueAdmin, requireOfficialGuild } = require('../utils/validations');
const { updateTeamsRoster } = require('../utils/roster-updater');
const { logCommandResult, logValidationFailure } = require('../utils/log-helpers');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('release')
    .setDescription('Release a player / staff member from their team contract')
    .addUserOption((option) =>
      option
          .setName('player')
          .setDescription('Player to release')
          .setRequired(true),
    ),

  async execute(interaction) {
    if (!await requireOfficialGuild(interaction)) return;

    const targetMember = interaction.options.getMember('player');
    const targetUser = interaction.options.getUser('player');
    const displayName = targetMember.displayName || targetUser.username;
    const userId = targetUser.id;

    if (targetUser.bot) {
      console.log(`⚠️ [VALIDATION] /release target ${displayName} (${userId}) is a bot; command terminated.`);
      return interaction.editReply({
        content: '❌ You cannot release a bot.',
        flags: MessageFlags.Ephemeral
      });
    }

    const activeContract = await database.getContractedTeam(userId);
    if (!activeContract) {
      await logValidationFailure(interaction, {
        title: 'Release Target Is Already a Free Agent',
        command: 'release',
        details: [{ label: 'Target', value: `**${displayName}** (\`${userId}\`)` }],
        terminalDetails: [{ label: 'Target', value: `${displayName} (${userId})` }],
        result: 'The selected player has no active contract; no release was performed.',
      });
      return interaction.editReply({
        content: `❌ **${displayName}** is already a free agent.`,
        flags: MessageFlags.Ephemeral
      });
    }

    const playerTeam = activeContract.teamName;
    const teamInfo = await database.getTeamInfo(playerTeam);
    const formattedTeamName = `**${builderHelpers.getFormattedTeamName(playerTeam)}**`;

    if (!canManageTeam(interaction.member, teamInfo)) {
      return interaction.editReply({
        content: `❌ You do not have permission to release players from ${formattedTeamName}.`,
        flags: MessageFlags.Ephemeral
      });
    }

    const restrictedActions = await database.getPlayerRestrictedActions(userId);
    if (restrictedActions && restrictedActions.includes('RELEASES')) {
      await logValidationFailure(interaction, {
        title: 'Release Target Is Restricted',
        command: 'release',
        details: [
          { label: 'Target', value: `**${displayName}** (\`${userId}\`)` },
          { label: 'Team', value: formattedTeamName },
        ],
        terminalDetails: [
          { label: 'Target', value: `${displayName} (${userId})` },
          { label: 'Team', value: playerTeam },
        ],
        result: 'The selected player is restricted from being released; no change was made.',
      });
      return interaction.editReply({
        content: `❌ <@${userId}> is currently frozen from being released.`,
        flags: MessageFlags.Ephemeral
      });
    }

    try {
      if (userId === interaction.user.id && !isLeagueAdmin(interaction.member)) {
        return interaction.editReply({
          content: `❌ You cannot release yourself from ${formattedTeamName}.`,
          flags: MessageFlags.Ephemeral
        });
      }

      const isManager = teamInfo.manager === userId;
      const isAssistant = teamInfo.assistantManager === userId;
      const isStaff = isManager || isAssistant;
      const staffRole = isManager ? 'manager' : 'assistant';
      const globalStaffRoleId = isManager ? constants.MANAGER_ROLE_ID : constants.ASSISTANT_MANAGER_ROLE_ID;
      const staffRoleName = isManager ? 'Manager' : 'Assistant Manager';

      if (isStaff) {
        await database.appointStaff(playerTeam, null, staffRole);
      }
      await database.releasePlayer(userId);
      await logCommandResult(interaction, {
        command: 'release',
        title: isStaff ? 'Staff Member Released' : 'Player Released',
        details: [
          { label: 'Player', value: `**${displayName}** (\`${userId}\`)`, terminalValue: `${displayName} (${userId})` },
          { label: 'Team', value: `**${builderHelpers.getFormattedTeamName(playerTeam)}**`, terminalValue: playerTeam },
          ...(isStaff ? [{ label: 'Staff Position Cleared', value: `\`${staffRoleName}\``, terminalValue: staffRoleName }] : []),
        ],
        result: isStaff
          ? `The player was released from **${builderHelpers.getFormattedTeamName(playerTeam)}** and their ${staffRoleName} position was cleared.`
          : `The player was released from **${builderHelpers.getFormattedTeamName(playerTeam)}**.`,
      });

      await interaction.editReply({
        content: isStaff
          ? `✅ **${displayName}** has been released from ${formattedTeamName} and their **${staffRoleName}** position has been cleared.`
          : `✅ **${displayName}** has been released from ${formattedTeamName}.`,
        flags: MessageFlags.Ephemeral
      });

      (async () => {
        try {
          const fetchedMember = await safeFetchMember(interaction.guild, userId);
          if (fetchedMember) {
            const rolesToRemove = [teamInfo.roleId];
            if (isStaff) rolesToRemove.push(globalStaffRoleId);

            const roleRemovalResults = await Promise.all(rolesToRemove.map((rId) => safeRoleRemove(fetchedMember, rId)));
            const failedRoleIds = rolesToRemove.filter((_, index) => !roleRemovalResults[index]);
            if (failedRoleIds.length) {
              await logCommandResult(interaction, {
                type: 'error',
                title: 'Release Completed With Role Cleanup Issues',
                command: 'release',
                details: [
                  { label: 'Player', value: `**${displayName}** (\`${userId}\`)`, terminalValue: `${displayName} (${userId})` },
                  { label: 'Team', value: `**${builderHelpers.getFormattedTeamName(playerTeam)}**`, terminalValue: playerTeam },
                  { label: 'Failed Role IDs', value: failedRoleIds.map(roleId => `\`${roleId}\``).join(', '), terminalValue: failedRoleIds.join(', ') },
                ],
                result: 'The release was completed, but one or more Discord roles could not be removed. Manual cleanup may be required.',
                terminalResult: `Release role cleanup failed for ${failedRoleIds.length} role(s).`,
              });
            }
            console.log(
              `[release.js] Stripped ${rolesToRemove.length} role(s) from ${userId}` +
              (isStaff ? ` (including ${staffRoleName} role).` : '.')
            );
          }

          const [updatedTeamInfo, teamCapacity, role] = await Promise.all([
            database.getTeamInfo(playerTeam),
            builderHelpers.getDisplayedPlayersAmount(playerTeam),
            builderHelpers.getTeamRole(interaction.client, playerTeam),
          ]);

          const releaseChannel = await interaction.client.channels
            .fetch(constants.RELEASES_CHANNEL_ID)
            .catch(async (error) => {
              await logCommandResult(interaction, {
                type: 'error',
                title: 'Release Announcement Could Not Be Posted',
                command: 'release',
                details: [
                  { label: 'Player', value: `**${displayName}** (\`${userId}\`)`, terminalValue: `${displayName} (${userId})` },
                  { label: 'Team', value: `**${builderHelpers.getFormattedTeamName(playerTeam)}**`, terminalValue: playerTeam },
                ],
                result: 'The player release succeeded, but the public announcement channel could not be reached.',
                terminalResult: 'Release channel fetch failed after the database release.',
                error,
              });
              return null;
            });
          if (releaseChannel) {
            const releaseEmbed = buildPSLEmbed(interaction.client, role?.color || constants.DEFAULT_EMBED_COLOR)
              .setTitle(`${formattedTeamName} Official Release`)
              .setThumbnail(targetUser.displayAvatarURL({ dynamic: true }))
              .addFields([
                {
                  name: isStaff ? 'Staff Released' : 'Player Released',
                  value: isStaff
                    ? `**${displayName}** has been released from ${formattedTeamName} and their **${staffRoleName}** badge has been revoked. They are now a Free Agent. 📋`
                    : `**${displayName}** has been released from ${formattedTeamName} and is now a Free Agent. 📋`,
                },
                {
                  name: 'Team Capacity',
                  value: `**${teamCapacity}**`,
                },
              ]);

            const mentions = [
              `<@${userId}>`,
              updatedTeamInfo?.manager ? `<@${updatedTeamInfo.manager}>` : null,
              updatedTeamInfo?.assistantManager ? `<@${updatedTeamInfo.assistantManager}>` : null,
            ]
              .filter(Boolean)
              .join(' ');

            await releaseChannel.send({ content: mentions, embeds: [releaseEmbed] }).catch(async (error) => {
              await logCommandResult(interaction, {
                type: 'error',
                title: 'Release Announcement Could Not Be Posted',
                command: 'release',
                details: [
                  { label: 'Player', value: `**${displayName}** (\`${userId}\`)`, terminalValue: `${displayName} (${userId})` },
                  { label: 'Team', value: `**${builderHelpers.getFormattedTeamName(playerTeam)}**`, terminalValue: playerTeam },
                ],
                result: 'The player release succeeded, but the public announcement could not be sent.',
                terminalResult: 'Release announcement send failed after the database release.',
                error,
              });
            });
          }

          await updateTeamsRoster(interaction.client);
        } catch (backgroundError) {
          await logCommandResult(interaction, {
            type: 'error',
            title: 'Release Follow-Up Failed',
            command: 'release',
            details: [
              { label: 'Player', value: `**${displayName}** (\`${userId}\`)`, terminalValue: `${displayName} (${userId})` },
              { label: 'Team', value: `**${builderHelpers.getFormattedTeamName(playerTeam)}**`, terminalValue: playerTeam },
            ],
            result: 'The player release succeeded, but a follow-up cleanup or roster update failed. Manual review may be required.',
            terminalResult: 'Release follow-up failed.',
            error: backgroundError,
          });
        }
      })();

    } catch (error) {
      await logCommandResult(interaction, {
        type: 'error',
        title: 'Release Command Failed',
        command: 'release',
        details: [
          { label: 'Player', value: `**${displayName}** (\`${userId}\`)`, terminalValue: `${displayName} (${userId})` },
          ...(activeContract ? [{
            label: 'Team',
            value: `**${builderHelpers.getFormattedTeamName(activeContract.teamName)}**`,
            terminalValue: activeContract.teamName,
          }] : []),
        ],
        result: 'The release command failed unexpectedly. Verify the player’s contract and team state before retrying.',
        terminalResult: 'Release command failed.',
        error,
      });
      if (!interaction.replied) {
        interaction.editReply({
          content: '❌ An unexpected error occurred during release.',
          flags: MessageFlags.Ephemeral
        });
      }
    }
  },
};