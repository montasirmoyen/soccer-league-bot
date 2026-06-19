const { SlashCommandBuilder } = require('discord.js');
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
    console.log(`\n🏃 [release.js] ${targetUser.tag} release attempt by ${interaction.user.tag}`);

    try {
      if (targetUser.bot) {
        return interaction.reply({ content: '❌ Bots do not have contracts.', ephemeral: true });
      }

      const isWindowOpen = await database.getTransferWindowState();
      if (!isWindowOpen) {
        return interaction.reply({
          content: '🔒 The transfer window is **CLOSED**. Players cannot be released right now.',
          ephemeral: true,
        });
      }

      const activeContract = await database.getContractedTeam(targetUser.id);
      if (!activeContract) {
        return interaction.reply({
          content: `❌ <@${targetUser.id}> is already a **Free Agent**.`,
          ephemeral: true,
        });
      }

      const playerTeam = activeContract.teamName;
      const teamInfo = await database.getTeamInfo(playerTeam);
      const formattedTeamName = `**${builderHelpers.getFormattedTeamName(playerTeam).toUpperCase()}**`;

      if (!canManageTeam(interaction.member, teamInfo)) {
        return interaction.reply({
          content: `❌ You do not have permission to release players from ${formattedTeamName}.`,
          ephemeral: true,
        });
      }

      await database.releasePlayer(targetUser.id);

      const targetMember = await safeFetchMember(interaction.guild, targetUser.id);
      if (targetMember && teamInfo?.roleId) {
        await safeRoleRemove(targetMember, teamInfo.roleId);
        console.log(`[release.js] Roles stripped from ${targetUser.tag}.`);
      }

      try {
        const teamManager = await database.getTeamStaff(playerTeam, 'manager');
        const teamAssistant = await database.getTeamStaff(playerTeam, 'assistantManager');
        const role = await builderHelpers.getTeamRole(interaction.client, playerTeam);
        const embedColor = role ? role.color : constants.DEFAULT_EMBED_COLOR;
        const releaseChannel = await interaction.client.channels.fetch(constants.RELEASES_CHANNEL_ID);
        if (releaseChannel) {
          const teamCapacity = await builderHelpers.getDisplayedPlayersAmount(playerTeam);
          const releaseEmbed = buildPSLEmbed(interaction.client, embedColor)
            .setTitle(`${formattedTeamName} OFFICIAL RELEASE`)
            .addFields(
              {
                name: 'Player Released',
                value: `<@${targetUser.id}> has been released from ${formattedTeamName} and is now a Free Agent! 📝`,
              },
              {
                name: 'Team Capacity',
                value: teamCapacity,
              }
            );

          const mentions = [
            `<@${targetUser.id}>`,
            teamManager?.manager ? `<@${teamManager.manager}>` : null,
            teamAssistant?.assistantManager ? `<@${teamAssistant.assistantManager}>` : null,
          ].filter(Boolean).join(' ');
          await releaseChannel.send({ content: mentions, embeds: [releaseEmbed] });
        }
      } catch (logError) {
        console.warn('[release.js] Could not post to releases channel:', logError.message);
      }

      return interaction.reply({
        content: `✅ <@${targetUser.id}> has been released from ${formattedTeamName}.`,
        ephemeral: true,
      });
    } catch (error) {
      console.error('❌ Error in /release:', error);
      if (interaction.replied || interaction.deferred) return;
      return interaction.reply({ content: '❌ An error occurred during release.', ephemeral: true });
    }
  },
};