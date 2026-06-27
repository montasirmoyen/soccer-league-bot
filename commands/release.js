const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const database       = require('../db/database');
const constants      = require('../config/constants');
const builderHelpers = require('../utils/builder-helpers');
const { buildPSLEmbed }                  = require('../utils/embed-helpers');
const { safeRoleRemove, safeFetchMember } = require('../utils/discord-helpers');
const { canManageTeam, validateGuild }    = require('../utils/validations');
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

    const targetUser = interaction.options.getUser('player');

    if (targetUser.bot) {
      return interaction.editReply({
        content: '❌ Bots do not have contracts.',
        flags: MessageFlags.Ephemeral,
      });
    }

    try {
      const [isWindowOpen, activeContract] = await Promise.all([
        database.getTransferWindowState(),
        database.getContractedTeam(targetUser.id),
      ]);

      if (!isWindowOpen) {
        return interaction.editReply({
          content: '🔒 The transfer window is **CLOSED**. Players cannot be released right now.',
          flags: MessageFlags.Ephemeral,
        });
      }

      if (!activeContract) {
        return interaction.editReply({
          content: `❌ <@${targetUser.id}> is already a **Free Agent**.`,
          flags: MessageFlags.Ephemeral,
        });
      }

      const playerTeam        = activeContract.teamName;
      const teamInfo          = await database.getTeamInfo(playerTeam);
      const formattedTeamName = `**${builderHelpers.getFormattedTeamName(playerTeam).toUpperCase()}**`;

      if (!canManageTeam(interaction.member, teamInfo)) {
        return interaction.editReply({
          content: `❌ You do not have permission to release players from ${formattedTeamName}.`,
          flags: MessageFlags.Ephemeral,
        });
      }

      const isManager   = teamInfo.manager          === targetUser.id;
      const isAssistant = teamInfo.assistantManager === targetUser.id;
      const isStaff     = isManager || isAssistant;
      const staffRole         = isManager ? 'manager' : 'assistant';
      const globalStaffRoleId = isManager ? constants.MANAGER_ROLE_ID : constants.ASSISTANT_MANAGER_ROLE_ID;
      const staffRoleName     = isManager ? 'Manager' : 'Assistant Manager';

      if (isStaff) {
        await database.appointStaff(playerTeam, null, staffRole);
      }
      await database.releasePlayer(targetUser.id);

      await interaction.editReply({
        content: isStaff
          ? `✅ <@${targetUser.id}> has been released from ${formattedTeamName} and their **${staffRoleName}** position has been cleared.`
          : `✅ <@${targetUser.id}> has been released from ${formattedTeamName}.`,
        flags: MessageFlags.Ephemeral,
      });

      (async () => {
        try {
          const targetMember = await safeFetchMember(interaction.guild, targetUser.id);
          if (targetMember) {
            const rolesToRemove = [teamInfo.roleId];
            if (isStaff) rolesToRemove.push(globalStaffRoleId);

            await Promise.all(rolesToRemove.map((rId) => safeRoleRemove(targetMember, rId))).catch(console.warn);
            console.log(
              `[release.js] Stripped ${rolesToRemove.length} role(s) from ${targetUser.id}` +
              (isStaff ? ` (including ${staffRoleName} role).` : '.'),
            );
          }

          const [updatedTeamInfo, teamCapacity, role] = await Promise.all([
            database.getTeamInfo(playerTeam),
            builderHelpers.getDisplayedPlayersAmount(playerTeam),
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
                    ? `<@${targetUser.id}> has been released from ${formattedTeamName} and their **${staffRoleName}** badge has been revoked. They are now a Free Agent. 📋`
                    : `<@${targetUser.id}> has been released from ${formattedTeamName} and is now a Free Agent. 📋`,
                },
                {
                  name:  'Team Capacity',
                  value: teamCapacity,
                },
              );

            const mentions = [
              `<@${targetUser.id}>`,
              updatedTeamInfo?.manager          ? `<@${updatedTeamInfo.manager}>`          : null,
              updatedTeamInfo?.assistantManager  ? `<@${updatedTeamInfo.assistantManager}>` : null,
            ]
              .filter(Boolean)
              .join(' ');

            await releaseChannel.send({ content: mentions, embeds: [releaseEmbed] }).catch(console.warn);
          }

          await updateTeamsRoster(interaction.client);
        } catch (bgErr) {
          console.error('[release.js] Background release error:', bgErr);
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