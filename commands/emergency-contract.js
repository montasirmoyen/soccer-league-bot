const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const database = require('../db/database');
const constants = require('../config/constants');
const builderHelpers = require('../utils/builder-helpers');
const { buildPSLEmbed } = require('../utils/embed-helpers');
const { canManageTeam, validateGuild } = require('../utils/validations');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('emergency-contract')
    .setDescription(`Emergency contract while window is CLOSED (Limit: ${constants.MAX_EMERGENCY_SIGNS_PER_TEAM} per team).`)
    .addStringOption((option) =>
      option.setName('team').setDescription('Select the team').setRequired(true)
        .addChoices(builderHelpers.getTeamChoices())
    )
    .addUserOption((option) =>
      option.setName('player').setDescription('Player to sign').setRequired(true)
    ),

  async execute(interaction) {
    if (!validateGuild(interaction)) {
      return interaction.editReply({ content: '❌ You can only execute this command in the official server.', flags: MessageFlags.Ephemeral });
    }

    const selectedTeam = interaction.options.getString('team');
    const targetUser = interaction.options.getUser('player');
    const userId = targetUser.id;

    if (targetUser.bot) {
      return interaction.editReply({ content: '❌ You cannot sign a bot.', flags: MessageFlags.Ephemeral });
    }

    try {
      const [isWindowOpen, teamInfo, isStaffSomewhere, activeContract, currentSquad] = await Promise.all([
        database.getTransferWindowState(),
        database.getTeamInfo(selectedTeam),
        database.isUserStaffAnywhere(userId),
        database.getContractedTeam(userId),
        database.getPlayersByTeam(selectedTeam)
      ]);

      const formattedTeamName = `**${builderHelpers.getFormattedTeamName(selectedTeam).toUpperCase()}**`;

      if (isWindowOpen) {
        return interaction.editReply({ content: '❌ The window is **OPEN**. Use `/contract` instead.', flags: MessageFlags.Ephemeral });
      }
      if (!canManageTeam(interaction.member, teamInfo)) {
        return interaction.editReply({ content: `❌ You do not have permission to sign players for ${formattedTeamName}.`, flags: MessageFlags.Ephemeral });
      }
      if (teamInfo && teamInfo.emergencySignsUsed >= constants.MAX_EMERGENCY_SIGNS_PER_TEAM) {
        return interaction.editReply({ content: `❌ **Emergency limit reached!** ${formattedTeamName} has used all ${constants.MAX_EMERGENCY_SIGNS_PER_TEAM} emergency signings.`, flags: MessageFlags.Ephemeral });
      }
      if (currentSquad.length >= constants.MAX_ROSTER_SIZE) {
        return interaction.editReply({ content: `❌ Roster full (${constants.MAX_ROSTER_SIZE}/${constants.MAX_ROSTER_SIZE}).`, flags: MessageFlags.Ephemeral });
      }
      if (isStaffSomewhere) {
        return interaction.editReply({ content: `❌ <@${userId}> is management staff for **${isStaffSomewhere.name}** and cannot sign as a player.`, flags: MessageFlags.Ephemeral });
      }
      if (activeContract) {
        return interaction.editReply({ content: `❌ <@${userId}> already has a contract with **${activeContract.teamName}**.`, flags: MessageFlags.Ephemeral });
      }
      const playerSigningsUsed = await database.getPlayerSigningsCount(userId);
      if (playerSigningsUsed >= constants.MAX_SIGNINGS_PER_PLAYER) {
        return interaction.editReply({
          content: `❌ This player has reached the maximum number of signings allowed.`,
          flags: MessageFlags.Ephemeral
        });
      }

      const role = await builderHelpers.getTeamRole(interaction.client, selectedTeam);
      const emergencyContractEmbed = buildPSLEmbed(interaction.client, role?.color || constants.DEFAULT_EMBED_COLOR)
        .setTitle('🚨 EMERGENCY CONTRACT OFFER!')
        .setDescription(`Hello <@${userId}>,\n${formattedTeamName} has sent you an **Emergency Contract** while the window is closed.\n\nReview and make your choice below:`);

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`emergencyaccept_${selectedTeam}_${userId}_${interaction.user.id}`).setLabel('🤝 Accept Emergency').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`emergencyrefuse_${selectedTeam}_${userId}_${interaction.user.id}`).setLabel('❌ Refuse').setStyle(ButtonStyle.Danger)
      );

      await targetUser.send({ embeds: [emergencyContractEmbed], components: [row] });

      return interaction.editReply({ content: `📨 Emergency offer sent to <@${userId}> for ${formattedTeamName}! (${teamInfo?.emergencySignsUsed ?? 0}/${constants.MAX_EMERGENCY_SIGNS_PER_TEAM} used)`, flags: MessageFlags.Ephemeral });

    } catch (error) {
      if (error.code === 50007) {
        return interaction.editReply({ content: `❌ Could not send the offer. <@${userId}> likely has DMs closed.`, flags: MessageFlags.Ephemeral });
      }
      console.error('❌ Error in /emergency-contract:', error);
      return interaction.editReply({ content: '❌ Error processing emergency offer.', flags: MessageFlags.Ephemeral });
    }
  },
};