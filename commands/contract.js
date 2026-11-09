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
const { logCommandResult, logValidationFailure } = require('../utils/log-helpers');

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
    const signeeDisplayName = signee.displayName || signee.user.username;
    let offerDelivered = false;

    const logContractValidationFailure = (title, result, terminalResult = result) => logValidationFailure(interaction, {
      title,
      command: 'contract',
      details: [
        { label: 'Team', value: `**${builderHelpers.getFormattedTeamName(selectedTeam)}**` },
        { label: 'Target', value: `**${signeeDisplayName}** (\`${userId}\`)` },
      ],
      result,
      terminalResult,
      terminalDetails: [
        { label: 'Team', value: selectedTeam },
        { label: 'Target', value: `${signeeDisplayName} (${userId})` },
      ],
    });

    if (signee.user.bot) {
      console.log(`⚠️ [VALIDATION] /contract target ${signeeDisplayName} (${userId}) is a bot; command terminated.`);

      return interaction.editReply({
        content: '❌ You cannot send a contract to a bot.',
        flags: MessageFlags.Ephemeral,
      });
    }

    const targetMember = await interaction.guild.members.fetch(userId ).catch(() => null);
    if (!targetMember) {
      await logContractValidationFailure('Target Not In Server', 'The selected user is no longer a member of this server; no contract offer was sent.');

      return interaction.editReply({
        content: `❌ <@${userId}> is not currently a member of this server.`,
        flags: MessageFlags.Ephemeral,
      });
    }

    if (!(await isRegistered(signee))) {
      await logContractValidationFailure('Player Not Registered', 'The selected user is not registered; no contract offer was sent.');

      return interaction.editReply({
        content: `❌ <@${userId}> has not registered themselves yet.`,
        flags: MessageFlags.Ephemeral
      });
    }

    const restrictedActions = await database.getPlayerRestrictedActions(userId);
    if (restrictedActions && restrictedActions.includes('CONTRACTS')) {
      await logContractValidationFailure('Frozen From Contracts', 'The selected user is restricted from receiving contract offers; no offer was sent.');

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
        await logContractValidationFailure('Team Denied From Contracts', 'The selected team is denied from regular contracts; no offer was sent.');

        return interaction.editReply({
          content: '🚫 This team is currently **denied from regular contracts**.',
          flags: MessageFlags.Ephemeral,
        });
      }
      if (!contractState.isWindowOpen && !contractState.isAllowedWhileClosed) {
        await logContractValidationFailure('Transfer Window Closed', 'The transfer window is closed for this team; no offer was sent.');

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
        await logContractValidationFailure(
          'Target Is Management Staff',
          `The selected user is management staff for **${builderHelpers.getFormattedTeamName(isStaffSomewhere.name)}**; no player contract offer was sent.`,
          `The selected user is management staff for ${isStaffSomewhere.name}; no player contract offer was sent.`,
        );

        return interaction.editReply({
            content: `❌ <@${userId }> is management staff for **${builderHelpers.getFormattedTeamName(isStaffSomewhere.name)}** and cannot hold a player contract.`,
          flags: MessageFlags.Ephemeral,
        });
      }
      if (activeContract) {
        await logContractValidationFailure(
          'Target Already Contracted',
          `The selected user already has a contract with **${builderHelpers.getFormattedTeamName(activeContract.teamName)}**; no additional offer was sent.`,
          `The selected user already has a contract with ${activeContract.teamName}; no additional offer was sent.`,
        );

        return interaction.editReply({
          content: `❌ <@${userId }> already has a contract with **${builderHelpers.getFormattedTeamName(activeContract.teamName)}**.`,
          flags: MessageFlags.Ephemeral,
        });
      }
      if (currentSquad.length >= constants.MAX_ROSTER_SIZE) {
        await logContractValidationFailure('Team Roster Full', `The selected team has reached its roster limit of ${constants.MAX_ROSTER_SIZE}; no offer was sent.`);

        return interaction.editReply({
          content: `❌ **Roster limit reached!** ${formattedTeamName} already has ${constants.MAX_ROSTER_SIZE} registered players.`,
          flags: MessageFlags.Ephemeral,
        });
      }
      const individualContractsUsed = await database.getIndividualContractsCount(userId);
      if (individualContractsUsed >= constants.MAX_CONTRACTS_PER_PLAYER && isLeagueStarted) {
        await logContractValidationFailure('Target Contract Limit Reached', 'The selected user has reached the maximum number of contracts allowed; no offer was sent.');

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
        await logCommandResult(interaction, {
          type: 'error',
            title: 'Contract Offer Not Delivered',
          command: 'contract',
          details: [
            { label: 'Team', value: `**${builderHelpers.getFormattedTeamName(selectedTeam)}**`, terminalValue: selectedTeam },
            { label: 'Target', value: `**${signeeDisplayName}** (\`${userId}\`)`, terminalValue: `${signeeDisplayName} (${userId})` },
          ],
          result: 'The contract offer could not be delivered by DM. No offer was sent.',
          terminalResult: 'Contract offer DM delivery failed.',
          error: dmError,
        });

          return interaction.editReply({
            content: `❌ Unable to send a DM to <@${userId }>. They may have **DMs disabled** or **blocked the bot**. \nPlease ask them to enable DMs from server members and try again.\n 1. Right-click the server icon and select "**Privacy Settings**".\n 2. Ensure "**Allow DMs from other members**" is enabled.\n 3. Try running the command again.`,
            flags: MessageFlags.Ephemeral,
          });
        }
        throw dmError;
      }

      offerDelivered = true;
      await logCommandResult(interaction, {
        command: 'contract',
        title: 'Contract Offer Delivered',
        details: [
          { label: 'Team', value: `**${builderHelpers.getFormattedTeamName(selectedTeam)}**`, terminalValue: selectedTeam },
          { label: 'Target', value: `**${signeeDisplayName}** (\`${userId}\`)`, terminalValue: `${signeeDisplayName} (${userId})` },
        ],
        result: 'The contract offer was successfully delivered by DM. The message content is not included in this audit log.',
      });

      return interaction.editReply({
        content: `📨 Contract offer successfully sent to <@${userId }>'s DMs for ${formattedTeamName}!`,
        flags: MessageFlags.Ephemeral,
      });

    } catch (error) {
      await logCommandResult(interaction, {
        type: 'error',
        title: offerDelivered ? 'Contract Offer Delivered, Response Failed' : 'Contract Offer Processing Failed',
        command: 'contract',
        details: [
          { label: 'Team', value: `**${builderHelpers.getFormattedTeamName(selectedTeam)}**`, terminalValue: selectedTeam },
          { label: 'Target', value: `**${signeeDisplayName}** (\`${userId}\`)`, terminalValue: `${signeeDisplayName} (${userId})` },
        ],
        result: offerDelivered
          ? 'The contract offer was delivered, but the command could not complete its response.'
          : 'The command failed before successful delivery of the contract offer could be confirmed.',
        terminalResult: offerDelivered
          ? 'Offer delivered; command response failed.'
          : 'Contract offer processing failed before successful delivery was confirmed.',
        error,
      });

      if (!interaction.replied) {
        return interaction.editReply({
          content: '❌ An unexpected error occurred while processing the contract offer.',
          flags: MessageFlags.Ephemeral,
        });
      }
    }
  },
};