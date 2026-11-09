const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const database = require('../db/database');
const constants = require('../config/constants');
const builderHelpers = require('../utils/builder-helpers');
const { canManageTeam, requireOfficialGuild } = require('../utils/validations');
const { getTransferWindowContractState } = require('../utils/transfer-window-permissions');
const { buildContractOfferPayload, isDMDeliveryError } = require('../utils/contract-offer');
const { logCommandResult, logValidationFailure } = require('../utils/log-helpers');

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
    const targetPlayer = interaction.options.getMember('player');
    const displayName = targetPlayer.displayName;
    const userId = targetPlayer.id;

    if (targetPlayer.user.bot) {
      console.log(`⚠️ [VALIDATION] /emergency-contract target ${displayName} (${userId}) is a bot; command terminated.`);
      return interaction.editReply({ content: '❌ You cannot send a contract to a bot.', flags: MessageFlags.Ephemeral });
    }

    const restrictedActions = await database.getPlayerRestrictedActions(userId);
    if (restrictedActions && restrictedActions.includes('CONTRACTS')) {
      await logValidationFailure(interaction, {
        title: 'Target Frozen From Contracts',
        command: 'emergency-contract',
        details: [
          { label: 'Team', value: formattedTeamName },
          { label: 'Target', value: `**${displayName}** (\`${userId}\`)` },
        ],
        terminalDetails: [
          { label: 'Team', value: selectedTeam },
          { label: 'Target', value: `${displayName} (${userId})` },
        ],
        result: 'The selected player is restricted from receiving contract offers; no offer was sent.',
      });
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
        await logValidationFailure(interaction, {
          title: 'Emergency Offer Not Allowed',
          command: 'emergency-contract',
          details: [
            { label: 'Team', value: formattedTeamName },
            { label: 'Target', value: `**${displayName}** (\`${userId}\`)` },
          ],
          terminalDetails: [
            { label: 'Team', value: selectedTeam },
            { label: 'Target', value: `${displayName} (${userId})` },
          ],
          result: 'The transfer window is open; no emergency offer was sent.',
        });
        return interaction.editReply({ content: '❌ The window is **OPEN**. Use `/contract` instead.', flags: MessageFlags.Ephemeral });
      }
      if (contractState.isAllowedWhileClosed) {
        await logValidationFailure(interaction, {
          title: 'Emergency Offer Not Needed',
          command: 'emergency-contract',
          details: [
            { label: 'Team', value: formattedTeamName },
            { label: 'Target', value: `**${displayName}** (\`${userId}\`)` },
          ],
          terminalDetails: [
            { label: 'Team', value: selectedTeam },
            { label: 'Target', value: `${displayName} (${userId})` },
          ],
          result: 'The team is allowed to offer regular contracts while the window is closed; no emergency offer was sent.',
        });
        return interaction.editReply({ content: '✅ This team is allowed to offer contracts freely while the window is closed. Use `/contract` instead.', flags: MessageFlags.Ephemeral });
      }
      if (teamInfo && teamInfo.emergencyContractsUsed >= constants.MAX_EMERGENCY_CONTRACTS_PER_TEAM) {
        await logValidationFailure(interaction, {
          title: 'Emergency Contract Limit Reached',
          command: 'emergency-contract',
          details: [
            { label: 'Team', value: formattedTeamName },
            { label: 'Target', value: `**${displayName}** (\`${userId}\`)` },
          ],
          terminalDetails: [
            { label: 'Team', value: selectedTeam },
            { label: 'Target', value: `${displayName} (${userId})` },
          ],
          result: `The team has reached its limit of ${constants.MAX_EMERGENCY_CONTRACTS_PER_TEAM} emergency contracts; no offer was sent.`,
        });
        return interaction.editReply({ content: `❌ **Emergency limit reached!** ${formattedTeamName} has used all ${constants.MAX_EMERGENCY_CONTRACTS_PER_TEAM} emergency contracts.`, flags: MessageFlags.Ephemeral });
      }
      if (currentSquad.length >= constants.MAX_ROSTER_SIZE) {
        await logValidationFailure(interaction, {
          title: 'Team Roster Full',
          command: 'emergency-contract',
          details: [
            { label: 'Team', value: formattedTeamName },
            { label: 'Target', value: `**${displayName}** (\`${userId}\`)` },
          ],
          terminalDetails: [
            { label: 'Team', value: selectedTeam },
            { label: 'Target', value: `${displayName} (${userId})` },
          ],
          result: `The team roster is full at ${constants.MAX_ROSTER_SIZE}; no offer was sent.`,
        });
        return interaction.editReply({ content: `❌ Roster full (${constants.MAX_ROSTER_SIZE}/${constants.MAX_ROSTER_SIZE}).`, flags: MessageFlags.Ephemeral });
      }
      if (isStaffSomewhere) {
        const teamName = builderHelpers.getFormattedTeamName(isStaffSomewhere.name);
        await logValidationFailure(interaction, {
          title: 'Target Is Management Staff',
          command: 'emergency-contract',
          details: [
            { label: 'Team', value: formattedTeamName },
            { label: 'Target', value: `**${displayName}** (\`${userId}\`)` },
          ],
          terminalDetails: [
            { label: 'Team', value: selectedTeam },
            { label: 'Target', value: `${displayName} (${userId})` },
          ],
          result: `The selected player is management staff for **${teamName}**; no offer was sent.`,
          terminalResult: `The selected player is management staff for ${isStaffSomewhere.name}; no offer was sent.`,
        });
        return interaction.editReply({ content: `❌ **${displayName}** is management staff for **${teamName}** and cannot hold a player contract.`, flags: MessageFlags.Ephemeral });
      }
      if (activeContract) {
        const targetFormattedTeamName = `**${builderHelpers.getFormattedTeamName(activeContract.teamName)}**`;
        await logValidationFailure(interaction, {
          title: 'Target Already Contracted',
          command: 'emergency-contract',
          details: [
            { label: 'Team', value: formattedTeamName },
            { label: 'Target', value: `**${displayName}** (\`${userId}\`)` },
          ],
          terminalDetails: [
            { label: 'Team', value: selectedTeam },
            { label: 'Target', value: `${displayName} (${userId})` },
          ],
          result: `The selected player already has a contract with ${targetFormattedTeamName}; no offer was sent.`,
          terminalResult: `The selected player already has a contract with ${activeContract.teamName}; no offer was sent.`,
        });
        return interaction.editReply({ content: `❌ **${displayName}** already has a contract with ${targetFormattedTeamName}.`, flags: MessageFlags.Ephemeral });
      }
      const individualContractsUsed = await database.getIndividualContractsCount(userId);
      if (individualContractsUsed >= constants.MAX_CONTRACTS_PER_PLAYER) {
        await logValidationFailure(interaction, {
          title: 'Target Contract Limit Reached',
          command: 'emergency-contract',
          details: [
            { label: 'Team', value: formattedTeamName },
            { label: 'Target', value: `**${displayName}** (\`${userId}\`)` },
          ],
          terminalDetails: [
            { label: 'Team', value: selectedTeam },
            { label: 'Target', value: `${displayName} (${userId})` },
          ],
          result: 'The selected player has reached the maximum number of contracts; no offer was sent.',
        });
        return interaction.editReply({
          content: `❌ **${displayName}** has reached the maximum number of contracts allowed.`,
          flags: MessageFlags.Ephemeral
        });
      }

      const role = await builderHelpers.getTeamRole(interaction.client, selectedTeam);
      try {
        await targetPlayer.send(buildContractOfferPayload({
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
          await logCommandResult(interaction, {
            type: 'error',
            title: 'Emergency Contract Offer Not Delivered',
            command: 'emergency-contract',
            details: [
              { label: 'Team', value: formattedTeamName, terminalValue: selectedTeam },
              { label: 'Target', value: `**${displayName}** (\`${userId}\`)`, terminalValue: `${displayName} (${userId})` },
            ],
            result: 'The emergency contract offer could not be delivered by DM. No offer was sent.',
            terminalResult: 'Emergency contract DM delivery failed.',
            error: dmError,
          });
          return interaction.editReply({
            content: `❌ Unable to send a DM to **${displayName}**. They may have **DMs disabled** or **blocked the bot**. \nPlease ask them to enable DMs from server members and try again.\n 1. Right-click the server icon and select "**Privacy Settings**".\n 2. Ensure "**Allow DMs from other members**" is enabled.\n 3. Try running the command again.`,
            flags: MessageFlags.Ephemeral,
          });
        }
        throw dmError;
      }

      await logCommandResult(interaction, {
        command: 'emergency-contract',
        title: 'Emergency Contract Offer Delivered',
        details: [
          { label: 'Team', value: formattedTeamName, terminalValue: selectedTeam },
          { label: 'Target', value: `**${displayName}** (\`${userId}\`)`, terminalValue: `${displayName} (${userId})` },
        ],
        result: `The emergency contract offer was successfully delivered by DM. The message content is not included in this audit log.`,
      });
      return interaction.editReply({ content: `📨 Emergency offer sent to <@${userId}> for ${formattedTeamName}! (${teamInfo?.emergencyContractsUsed ?? 0}/${constants.MAX_EMERGENCY_CONTRACTS_PER_TEAM} used)`, flags: MessageFlags.Ephemeral });

    } catch (error) {
      if (error.code === 50007) {
        await logCommandResult(interaction, {
          type: 'error',
          title: 'Emergency Contract Offer Not Delivered',
          command: 'emergency-contract',
          details: [
            { label: 'Team', value: formattedTeamName, terminalValue: selectedTeam },
            { label: 'Target', value: `**${displayName}** (\`${userId}\`)`, terminalValue: `${displayName} (${userId})` },
          ],
          result: 'The emergency contract offer could not be delivered because the target does not accept DMs.',
          terminalResult: 'Emergency contract DM delivery failed.',
          error,
        });
        return interaction.editReply({ content: `❌ Could not send the offer. **${displayName}** likely has DMs closed.`, flags: MessageFlags.Ephemeral });
      }
      await logCommandResult(interaction, {
        type: 'error',
        title: 'Emergency Contract Failed',
        command: 'emergency-contract',
        details: [
          { label: 'Team', value: formattedTeamName, terminalValue: selectedTeam },
          { label: 'Target', value: `**${displayName}** (\`${userId}\`)`, terminalValue: `${displayName} (${userId})` },
        ],
        result: 'The emergency contract command failed due to an internal error.',
        terminalResult: 'Emergency contract command failed.',
        error,
      });
      return interaction.editReply({ content: '❌ Error processing emergency offer.', flags: MessageFlags.Ephemeral });
    }
  },
};