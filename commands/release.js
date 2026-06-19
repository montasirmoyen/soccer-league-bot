const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const database = require('../db/database');
const constants = require('../config/constants');
const builderHelpers = require('../utils/builderHelpers');
const { buildPSLEmbed } = require('../utils/embedHelpers');
const { canManageTeam } = require('../utils/validations');
const { safeRoleRemove, safeFetchMember } = require('../utils/discordHelpers');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('release')
    .setDescription('Releases a player from their national team contract.')
    .addUserOption((option) =>
      option.setName('player').setDescription('Player to release').setRequired(true)
    ),

  async execute(interaction) {
    const targetUser = interaction.options.getUser('player');

    if (targetUser.bot) {
      return interaction.editReply({ content: '❌ Bots do not have contracts.', flags: MessageFlags.Ephemeral });
    }

    try {
      const [isWindowOpen, activeContract] = await Promise.all([
        database.getTransferWindowState(),
        database.getContractedTeam(targetUser.id)
      ]);

      if (!isWindowOpen) {
        return interaction.editReply({ content: '🔒 The transfer window is **CLOSED**. Players cannot be released right now.', flags: MessageFlags.Ephemeral });
      }
      if (!activeContract) {
        return interaction.editReply({ content: `❌ <@${targetUser.id}> is already a **Free Agent**.`, flags: MessageFlags.Ephemeral });
      }

      const playerTeam = activeContract.teamName;
      const teamInfo = await database.getTeamInfo(playerTeam);
      const formattedTeamName = `**${builderHelpers.getFormattedTeamName(playerTeam).toUpperCase()}**`;

      if (!canManageTeam(interaction.member, teamInfo)) {
        return interaction.editReply({ content: `❌ You do not have permission to release players from ${formattedTeamName}.`, flags: MessageFlags.Ephemeral });
      }

      await database.releasePlayer(targetUser.id);
      
      interaction.editReply({ content: `✅ <@${targetUser.id}> has been released from ${formattedTeamName}.`, flags: MessageFlags.Ephemeral });

      (async () => {
        const targetMember = await safeFetchMember(interaction.guild, targetUser.id);
        if (targetMember && teamInfo?.roleId) {
          safeRoleRemove(targetMember, teamInfo.roleId).catch(console.warn);
        }

        const releaseChannel = await interaction.client.channels.fetch(constants.RELEASES_CHANNEL_ID).catch(() => null);
        if (releaseChannel) {
          const [teamManager, teamAssistant, teamCapacity, role] = await Promise.all([
            database.getTeamStaff(playerTeam, 'manager'),
            database.getTeamStaff(playerTeam, 'assistantManager'),
            builderHelpers.getDisplayedPlayersAmount(playerTeam),
            builderHelpers.getTeamRole(interaction.client, playerTeam)
          ]);

          const releaseEmbed = buildPSLEmbed(interaction.client, role?.color || constants.DEFAULT_EMBED_COLOR)
            .setTitle(`${formattedTeamName} OFFICIAL RELEASE`)
            .addFields(
              { name: 'Player Released', value: `<@${targetUser.id}> has been released from ${formattedTeamName} and is now a Free Agent! 📝` },
              { name: 'Team Capacity', value: teamCapacity }
            );

          const mentions = [
            `<@${targetUser.id}>`,
            teamManager?.manager ? `<@${teamManager.manager}>` : null,
            teamAssistant?.assistantManager ? `<@${teamAssistant.assistantManager}>` : null,
          ].filter(Boolean).join(' ');

          releaseChannel.send({ content: mentions, embeds: [releaseEmbed] }).catch(console.warn);
        }
      })();

    } catch (error) {
      console.error('❌ Error in /release:', error);
      if (!interaction.replied) interaction.editReply({ content: '❌ An error occurred during release.', ephemeral: true });
    }
  },
};