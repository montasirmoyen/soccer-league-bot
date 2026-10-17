const {
  SlashCommandBuilder,
  MessageFlags,
} = require('discord.js');
const database = require('../db/database');
const constants = require('../config/constants');
const builderHelpers = require('../utils/builder-helpers');
const { canManageTeam, requireOfficialGuild, isRegistered } = require('../utils/validations');
const { getTransferWindowContractState } = require('../utils/transfer-window-permissions');
const { buildContractOfferPayload, isDMDeliveryError } = require('../utils/contract-offer');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('contract')
    .setDescription("Send a contract offer to a player's DM")
    .addStringOption((option) =>
      option
        .setName('team')
        .setDescription('Select your team')
        .setRequired(true)
        .addChoices(builderHelpers.getTeamChoices()),
    )
    .addUserOption((option) =>
      option
        .setName('signee')
        .setDescription('Player to offer the contract')
        .setRequired(true),
    ),

  async execute(interaction) {
    if (!await requireOfficialGuild(interaction)) return;

    const issuer = interaction.user;
    const issuerDisplayName = issuer.displayName || issuer.username;
    const selectedTeam = interaction.options.getString('team');
    const signee = interaction.options.getMember('signee');
    const userId = signee.id;

    if (signee.bot) {
      return interaction.editReply({
        content: '❌ You cannot send a contract to a bot.',
        flags: MessageFlags.Ephemeral,
      });
    }

    const targetMember = await interaction.guild.members.fetch(userId ).catch(() => null);
    if (!targetMember) {
      return interaction.editReply({
        content: `❌ <@${userId}> is not currently a member of this server.`,
        flags: MessageFlags.Ephemeral,
      });
    }

    if (!(await isRegistered(signee))) {
      return interaction.editReply({
        content: `❌ <@${userId}> has not registered themselves yet.`,
        flags: MessageFlags.Ephemeral
      });
    }

    const restrictedActions = await database.getPlayerRestrictedActions(userId);
    if (restrictedActions && restrictedActions.includes('CONTRACTS')) {
      return interaction.editReply({
        content: `❌ <@${userId}> is currently frozen from contract offers.`,
        flags: MessageFlags.Ephemeral
      });
    }

    try {
      const [contractState, isLeagueStarted, teamInfo, isStaffSomewhere, activeContract, currentSquad] = await Promise.all([
        getTransferWindowContractState(selectedTeam),
        database.getLeagueState(),
        database.getTeamInfo(selectedTeam),
        database.isUserStaffAnywhere(userId ),
        database.getContractedTeam(userId ),
        database.getPlayersByTeam(selectedTeam),
      ]);

      const formattedTeamName = `**${builderHelpers.getFormattedTeamName(selectedTeam)}**`;

      if (contractState.isDenied) {
        return interaction.editReply({
          content: '🚫 This team is currently **denied from regular contracts**.',
          flags: MessageFlags.Ephemeral,
        });
      }
      if (!contractState.isWindowOpen && !contractState.isAllowedWhileClosed) {
        return interaction.editReply({
          content: '🔒 The transfer window is currently **CLOSED**. Use `/emergency-contract` instead.',
          flags: MessageFlags.Ephemeral,
        });
      }
      if (!canManageTeam(interaction.member, teamInfo)) {
        return interaction.editReply({
          content: `❌ You do not have permission to offer contracts for ${formattedTeamName}.`,
          flags: MessageFlags.Ephemeral,
        });
      }
      if (isStaffSomewhere) {
        return interaction.editReply({
          content: `❌ <@${userId }> is management staff for **${isStaffSomewhere.name}** and cannot hold a player contract.`,
          flags: MessageFlags.Ephemeral,
        });
      }
      if (activeContract) {
        return interaction.editReply({
          content: `❌ <@${userId }> already has a contract with **${builderHelpers.getFormattedTeamName(activeContract.teamName)}**.`,
          flags: MessageFlags.Ephemeral,
        });
      }
      if (currentSquad.length >= constants.MAX_ROSTER_SIZE) {
        return interaction.editReply({
          content: `❌ **Roster limit reached!** ${formattedTeamName} already has ${constants.MAX_ROSTER_SIZE} registered players.`,
          flags: MessageFlags.Ephemeral,
        });
      }
      const individualContractsUsed = await database.getIndividualContractsCount(userId);
      if (individualContractsUsed >= constants.MAX_CONTRACTS_PER_PLAYER && isLeagueStarted) {
        return interaction.editReply({
          content: `❌ This player has reached the maximum number of contracts allowed.`,
          flags: MessageFlags.Ephemeral
        });
      }

      const role = await builderHelpers.getTeamRole(interaction.client, selectedTeam);
      const embedColor = role?.color || constants.DEFAULT_EMBED_COLOR;

      try {
        await signee.send(buildContractOfferPayload({
          client: interaction.client,
          teamName: selectedTeam,
          formattedTeamName,
          userId,
          issuerId: interaction.user.id,
          issuerDisplayName,
          embedColor,
        }));
      } catch (dmError) {
        if (isDMDeliveryError(dmError)) {
          return interaction.editReply({
            content: `❌ Unable to send a DM to <@${userId }>. They may have **DMs disabled** or **blocked the bot**. \nPlease ask them to enable DMs from server members and try again.\n 1. Right-click the server icon and select "**Privacy Settings**".\n 2. Ensure "**Allow DMs from other members**" is enabled.\n 3. Try running the command again.`,
            flags: MessageFlags.Ephemeral,
          });
        }
        throw dmError;
      }

      return interaction.editReply({
        content: `📨 Contract offer successfully sent to <@${userId }>'s DMs for ${formattedTeamName}!`,
        flags: MessageFlags.Ephemeral,
      });

    } catch (error) {
      console.error('❌ Error in /contract:', error);
      if (!interaction.replied) {
        return interaction.editReply({
          content: '❌ An unexpected error occurred while processing the contract offer.',
          flags: MessageFlags.Ephemeral,
        });
      }
    }
  },
};