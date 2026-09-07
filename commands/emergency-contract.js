const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const database = require('../db/database');
const constants = require('../config/constants');
const builderHelpers = require('../utils/builder-helpers');
const { buildPSLEmbed } = require('../utils/embed-helpers');
const { canManageTeam, validateGuild } = require('../utils/validations');
const { getTransferWindowSigningState } = require('../utils/transfer-window-permissions');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('emergency-contract')
    .setDescription(`Emergency contract while window is CLOSED (Limit: ${constants.MAX_EMERGENCY_SIGNS_PER_TEAM} per team)`)
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
    const targetUser = interaction.options.getMember('player');
    const displayName = targetUser.displayName;
    const userId = targetUser.id;

    if (targetUser.bot) {
      return interaction.editReply({ content: '❌ You cannot sign a bot.', flags: MessageFlags.Ephemeral });
    }

    try {
      const [signingState, teamInfo, isStaffSomewhere, activeContract, currentSquad] = await Promise.all([
        getTransferWindowSigningState(selectedTeam),
        database.getTeamInfo(selectedTeam),
        database.isUserStaffAnywhere(userId),
        database.getContractedTeam(userId),
        database.getPlayersByTeam(selectedTeam)
      ]);

      const formattedTeamName = `**${builderHelpers.getFormattedTeamName(selectedTeam)}**`;

      if (signingState.isWindowOpen) {
        return interaction.editReply({ content: '❌ The window is **OPEN**. Use `/contract` instead.', flags: MessageFlags.Ephemeral });
      }
      if (signingState.isAllowedWhileClosed) {
        return interaction.editReply({ content: '✅ This team is allowed to sign freely while the window is closed. Use `/contract` instead.', flags: MessageFlags.Ephemeral });
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
        const teamName = builderHelpers.getFormattedTeamName(isStaffSomewhere.name);
        return interaction.editReply({ content: `❌ <@${userId}> is management staff for **${teamName}** and cannot sign as a player.`, flags: MessageFlags.Ephemeral });
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
        .setDescription(`Hello **${displayName}**, \n${formattedTeamName} has sent you an **Emergency Contract** while the window is closed.\n\nReview and make your choice below:`);

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`emergencyaccept_${selectedTeam}_${userId}_${interaction.user.id}`).setLabel('🤝 Accept Emergency').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`emergencyrefuse_${selectedTeam}_${userId}_${interaction.user.id}`).setLabel('❌ Refuse').setStyle(ButtonStyle.Danger)
      );

      try {
        await targetUser.send({ embeds: [emergencyContractEmbed], components: [row] });
      } catch (dmError) {
        if (dmError.code === 50007 || dmError.code === 50278 || dmError.status === 403) {
          return interaction.editReply({
            content: `❌ Unable to send a DM to <@${userId }>. They may have **DMs disabled** or **blocked the bot**. \nPlease ask them to enable DMs from server members and try again.\n 1. Right-click the server icon and select "**Privacy Settings**".\n 2. Ensure "**Allow DMs from other members**" is enabled.\n 3. Try running the command again.`,
            flags: MessageFlags.Ephemeral,
          });
        }
        throw dmError;
      }

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