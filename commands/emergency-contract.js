const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const database = require('../db/database');
const constants = require('../config/constants');
const builderHelpers = require('../utils/builder-helpers');
const { canManageTeam, requireOfficialGuild } = require('../utils/validations');
const { getTransferWindowContractState } = require('../utils/transfer-window-permissions');
const { buildContractOfferPayload, isDMDeliveryError } = require('../utils/contract-offer');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('emergency-contract')
    .setDescription(`Emergency contract while window is CLOSED (Limit: ${constants.MAX_EMERGENCY_CONTRACTS_PER_TEAM} per team)`)
    .addStringOption((option) =>
      option.setName('team').setDescription('Select the team').setRequired(true)
        .addChoices(builderHelpers.getTeamChoices())
    )
    .addUserOption((option) =>
      option.setName('player').setDescription('Player to offer a contract').setRequired(true)
    ),

  async execute(interaction) {
    if (!await requireOfficialGuild(interaction)) return;

    const selectedTeam = interaction.options.getString('team');
    const formattedTeamName = `**${builderHelpers.getFormattedTeamName(selectedTeam)}**`;
    const teamInfo = await database.getTeamInfo(selectedTeam);

    if (!canManageTeam(interaction.member, teamInfo)) {
      return interaction.editReply({ content: `❌ You do not have permission to offer contracts to players for ${formattedTeamName}.`, flags: MessageFlags.Ephemeral });
    }

    const issuer = interaction.user;
    const issuerDisplayName = issuer.displayName || issuer.username;
    const targetUser = interaction.options.getMember('player');
    const displayName = targetUser.displayName;
    const userId = targetUser.id;

    if (targetUser.bot) {
      return interaction.editReply({ content: '❌ You cannot offer a contract to a bot.', flags: MessageFlags.Ephemeral });
    }

    const restrictedActions = await database.getPlayerRestrictedActions(userId);
    if (restrictedActions && restrictedActions.includes('CONTRACTS')) {
      return interaction.editReply({
        content: `❌ <@${userId}> is currently frozen from contract offers.`,
        flags: MessageFlags.Ephemeral
      });
    }

    try {
      const [contractState, isStaffSomewhere, activeContract, currentSquad] = await Promise.all([
        getTransferWindowContractState(selectedTeam),
        database.isUserStaffAnywhere(userId),
        database.getContractedTeam(userId),
        database.getPlayersByTeam(selectedTeam)
      ]);

      if (contractState.isWindowOpen) {
        return interaction.editReply({ content: '❌ The window is **OPEN**. Use `/contract` instead.', flags: MessageFlags.Ephemeral });
      }
      if (contractState.isAllowedWhileClosed) {
        return interaction.editReply({ content: '✅ This team is allowed to offer contracts freely while the window is closed. Use `/contract` instead.', flags: MessageFlags.Ephemeral });
      }
      if (teamInfo && teamInfo.emergencyContractsUsed >= constants.MAX_EMERGENCY_CONTRACTS_PER_TEAM) {
        return interaction.editReply({ content: `❌ **Emergency limit reached!** ${formattedTeamName} has used all ${constants.MAX_EMERGENCY_CONTRACTS_PER_TEAM} emergency contracts.`, flags: MessageFlags.Ephemeral });
      }
      if (currentSquad.length >= constants.MAX_ROSTER_SIZE) {
        return interaction.editReply({ content: `❌ Roster full (${constants.MAX_ROSTER_SIZE}/${constants.MAX_ROSTER_SIZE}).`, flags: MessageFlags.Ephemeral });
      }
      if (isStaffSomewhere) {
        const teamName = builderHelpers.getFormattedTeamName(isStaffSomewhere.name);
        return interaction.editReply({ content: `❌ **${displayName}** is management staff for **${teamName}** and cannot hold a player contract.`, flags: MessageFlags.Ephemeral });
      }
      if (activeContract) {
        const targetFormattedTeamName = `**${builderHelpers.getFormattedTeamName(activeContract.teamName)}**`;
        return interaction.editReply({ content: `❌ **${displayName}** already has a contract with ${targetFormattedTeamName}.`, flags: MessageFlags.Ephemeral });
      }
      const individualContractsUsed = await database.getIndividualContractsCount(userId);
      if (individualContractsUsed >= constants.MAX_CONTRACTS_PER_PLAYER) {
        return interaction.editReply({
          content: `❌ **${displayName}** has reached the maximum number of contracts allowed.`,
          flags: MessageFlags.Ephemeral
        });
      }

      const role = await builderHelpers.getTeamRole(interaction.client, selectedTeam);
      try {
        await targetUser.send(buildContractOfferPayload({
          client: interaction.client,
          teamName: selectedTeam,
          formattedTeamName,
          userId,
          issuerId: interaction.user.id,
          issuerDisplayName,
          embedColor: role?.color || constants.DEFAULT_EMBED_COLOR,
          isEmergency: true,
        }));
      } catch (dmError) {
        if (isDMDeliveryError(dmError)) {
          return interaction.editReply({
            content: `❌ Unable to send a DM to **${displayName}**. They may have **DMs disabled** or **blocked the bot**. \nPlease ask them to enable DMs from server members and try again.\n 1. Right-click the server icon and select "**Privacy Settings**".\n 2. Ensure "**Allow DMs from other members**" is enabled.\n 3. Try running the command again.`,
            flags: MessageFlags.Ephemeral,
          });
        }
        throw dmError;
      }

      return interaction.editReply({ content: `📨 Emergency offer sent to <@${userId}> for ${formattedTeamName}! (${teamInfo?.emergencyContractsUsed ?? 0}/${constants.MAX_EMERGENCY_CONTRACTS_PER_TEAM} used)`, flags: MessageFlags.Ephemeral });

    } catch (error) {
      if (error.code === 50007) {
        return interaction.editReply({ content: `❌ Could not send the offer. **${displayName}** likely has DMs closed.`, flags: MessageFlags.Ephemeral });
      }
      console.error('❌ Error in /emergency-contract:', error);
      return interaction.editReply({ content: '❌ Error processing emergency offer.', flags: MessageFlags.Ephemeral });
    }
  },
};