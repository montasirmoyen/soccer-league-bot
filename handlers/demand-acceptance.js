const { ActionRowBuilder, ButtonBuilder, MessageFlags } = require('discord.js');
const constants = require('../config/constants');
const { buildPSLEmbed } = require('../utils/embed-helpers');
const { safeFetchMember, safeRoleRemove } = require('../utils/discord-helpers');
const { logError } = require('../utils/error-handler');

const DECISION_ROLE_IDS = [
  constants.SENIOR_MODERATOR_ROLE_ID,
  constants.LEAD_MODERATOR_ROLE_ID,
  constants.OVERSEER_ROLE_ID,
  constants.CHAIRMAN_ROLE_ID,
];

function parseDemandButton(customId) {
  const match = /^demand_(accept|reject)_(\d+)_(.+)$/.exec(customId);
  if (!match) return null;

  return {
    action: match[1],
    playerId: match[2],
    teamName: match[3].toUpperCase(),
  };
}

function isDemandButton(customId) {
  return Boolean(parseDemandButton(customId)) || ['accept_button', 'reject_button'].includes(customId);
}

function buildButtonRows(existingComponents = [], disabled) {
  return existingComponents.map((row) => {
    const newRow = new ActionRowBuilder();
    newRow.addComponents(
      row.components.map((component) => ButtonBuilder.from(component).setDisabled(disabled))
    );
    return newRow;
  });
}

function createDemandAcceptanceHandler(dependencies) {
  const {
    database,
    builderHelpers,
    updateTeamsRoster,
    withTimeout,
    timers,
    checkPlayerOperationConflict,
    recordPlayerOperation,
    clearPlayerOperation,
  } = dependencies;

  function hasDecisionPermission(member) {
    return DECISION_ROLE_IDS.some((roleId) => member?.roles?.cache?.has(roleId));
  }

  async function sendPlayerDM(client, playerId, embed) {
    try {
      const player = await client.users.fetch(playerId);
      await player.send({ embeds: [embed] });
      return true;
    } catch (error) {
      console.warn(`[demand-acceptance] Could not DM ${playerId}: ${error.message}`);
      return false;
    }
  }

  async function expireRequest(interaction, client, playerId, teamName, reason) {
    await database.clearPendingDemand(playerId, teamName);

    const formattedTeamName = `**${builderHelpers.getFormattedTeamName(teamName)}**`;
    const expirationEmbed = buildPSLEmbed(client, constants.WARNING_COLOR)
      .setTitle('⚠️ Demand Request Expired')
      .setDescription(
        `Your demand request for ${formattedTeamName} expired because ${reason}. ` +
        'You may submit a new request if you become eligible again.'
      );

    await sendPlayerDM(client, playerId, expirationEmbed);
    await interaction.editReply({
      content: '⚠️ This demand request expired because the player\'s contract status changed.',
      components: [],
    }).catch(console.warn);
  }

  async function validateRequest(playerId, teamName) {
    const [teamInfo, activeContract, demandsUsed] = await Promise.all([
      database.getTeamInfo(teamName),
      database.getContractedTeam(playerId),
      database.getPlayerDemandsCount(playerId),
    ]);

    if (!teamInfo) return { reason: 'the team no longer exists' };
    if (!activeContract) return { reason: 'the player no longer has an active contract' };
    if (activeContract.teamName !== teamName) return { reason: 'the player changed teams' };
    if (teamInfo.manager === playerId || teamInfo.assistantManager === playerId) {
      return { reason: 'the player is now a team manager or assistant manager' };
    }
    if (demandsUsed >= constants.MAX_DEMANDS_PER_PLAYER) {
      return { reason: 'the player has already used their demand' };
    }

    return { teamInfo, activeContract, demandsUsed };
  }

  async function postAcceptedDemand(client, player, teamName, teamInfo, demandsUsed) {
    const demandChannel = await client.channels.fetch(constants.DEMANDS_CHANNEL_ID).catch(() => null);
    if (!demandChannel?.isTextBased?.()) return;

    const role = await builderHelpers.getTeamRole(client, teamName);
    const teamCapacity = await builderHelpers.getDisplayedPlayersAmount(teamName);
    const updatedTeamInfo = await database.getTeamInfo(teamName);
    const formattedTeamName = `**${builderHelpers.getFormattedTeamName(teamName)}**`;
    const displayName = player.globalName || player.username;
    const demandEmbed = buildPSLEmbed(client, role?.color || constants.DEFAULT_EMBED_COLOR)
      .setTitle(`${formattedTeamName} Official Demand`)
      .setThumbnail(player.displayAvatarURL({ dynamic: true }))
      .addFields([
        {
          name: 'Player Demanded Release',
          value: `**${displayName}** has been granted a demand from ${formattedTeamName} and is now a Free Agent. 📋`,
        },
        {
          name: 'Team Capacity',
          value: `**${teamCapacity}**`,
        },
        {
          name: 'Demands Used',
          value: `**${demandsUsed}/${constants.MAX_DEMANDS_PER_PLAYER}**`,
        },
      ]);

    const mentions = [
      updatedTeamInfo?.manager ? `<@${updatedTeamInfo.manager}>` : null,
      updatedTeamInfo?.assistantManager ? `<@${updatedTeamInfo.assistantManager}>` : null,
    ].filter(Boolean).join(' ');

    await demandChannel.send({ content: mentions, embeds: [demandEmbed] }).catch(console.warn);
  }

  async function processAccepted(interaction, client, playerId, teamName, teamInfo, player) {
    const member = await safeFetchMember(interaction.guild, playerId);
    if (!member) throw new Error('Demandee could not be found in the guild.');

    const roleRemoved = await safeRoleRemove(member, teamInfo.roleId);
    if (!roleRemoved) throw new Error('Could not remove the team role from the demandee.');

    await database.releasePlayer(playerId);
    const updatedHistory = await database.acceptPendingDemand(playerId, teamName);
    if (!updatedHistory) throw new Error('Pending demand could not be completed.');

    const formattedTeamName = `**${builderHelpers.getFormattedTeamName(teamName)}**`;
    const acceptanceEmbed = buildPSLEmbed(client, constants.SUCCESS_COLOR)
      .setTitle('✅ Demand Accepted')
      .setDescription(
        `Your demand request for ${formattedTeamName} was accepted. ` +
        'You have been released from your contract and are now a Free Agent.'
      );

    await sendPlayerDM(client, playerId, acceptanceEmbed);
    await interaction.editReply({
      content: '✅ Demand accepted and processed successfully.',
      components: [],
    }).catch(console.warn);

    await postAcceptedDemand(client, player, teamName, teamInfo, updatedHistory.demandsUsed);
    await updateTeamsRoster(client);
  }

  async function processRejected(interaction, client, playerId, teamName, player) {
    const clearedHistory = await database.clearPendingDemand(playerId, teamName);
    if (!clearedHistory) throw new Error('Pending demand could not be cleared.');

    const formattedTeamName = `**${builderHelpers.getFormattedTeamName(teamName)}**`;
    const refusalEmbed = buildPSLEmbed(client, constants.ERROR_COLOR)
      .setTitle('❌ Demand Refused')
      .setDescription(
        `Your demand request for ${formattedTeamName} was refused. ` +
        'Your contract remains active and this decision is final.'
      );

    await sendPlayerDM(client, playerId, refusalEmbed);
    await interaction.editReply({
      content: '❌ Demand refused. The player has been notified.',
      components: [],
    }).catch(console.warn);
  }

  async function handleButtonInteraction(interaction, client) {
    const parsed = parseDemandButton(interaction.customId);
    if (!parsed) {
      if (['accept_button', 'reject_button'].includes(interaction.customId)) {
        await interaction.reply({
          content: '⚠️ This older demand request cannot be processed. Please submit a new demand request if eligible.',
          flags: MessageFlags.Ephemeral,
        });
        return true;
      }
      return false;
    }

    if (interaction.guildId !== constants.GUILD_ID || !hasDecisionPermission(interaction.member)) {
      await interaction.reply({
        content: '❌ You do not have permission to process demand requests.',
        flags: MessageFlags.Ephemeral,
      });
      return true;
    }

    const { action, playerId, teamName } = parsed;
    const userId = interaction.user.id;
    if (checkPlayerOperationConflict(playerId)) {
      await interaction.reply({
        content: '⏳ Another action is already processing for this player.',
        flags: MessageFlags.Ephemeral,
      });
      return true;
    }

    const originalComponents = interaction.message.components;
    const claimedHistory = await database.claimPendingDemand(playerId, teamName);
    if (!claimedHistory) {
      await interaction.reply({
        content: '⚠️ This demand request has already been processed or expired.',
        flags: MessageFlags.Ephemeral,
      });
      return true;
    }

    try {
      await interaction.update({ components: buildButtonRows(originalComponents, true) });
    } catch (error) {
      await database.restorePendingDemand(playerId, teamName);
      console.warn('[demand-acceptance] Could not lock buttons:', error.message);
      return true;
    }

    recordPlayerOperation(playerId, `demand_${action}`, teamName);

    try {
      const validation = await withTimeout(
        validateRequest(playerId, teamName),
        timers.ACCEPT_FLOW_TIMEOUT_MS,
        'Demand validation took too long'
      );
      if (validation.reason) {
        await expireRequest(interaction, client, playerId, teamName, validation.reason);
        return true;
      }

      const player = await client.users.fetch(playerId);
      if (action === 'accept') {
        await processAccepted(interaction, client, playerId, teamName, validation.teamInfo, player);
      } else {
        await processRejected(interaction, client, playerId, teamName, player);
      }
    } catch (error) {
      await database.restorePendingDemand(playerId, teamName);
      await logError(error, client, {
        userId: playerId,
        teamName,
        action: `DEMAND_${action.toUpperCase()}`,
        context: 'DEMAND_BUTTON_INTERACTION_ERROR',
      });
      await interaction.editReply({
        content: '❌ An error occurred processing this demand. The request remains available for review.',
        components: buildButtonRows(originalComponents, false),
      }).catch(console.warn);
    } finally {
      clearPlayerOperation(playerId);
    }

    return true;
  }

  return { handleButtonInteraction };
}

module.exports = {
  createDemandAcceptanceHandler,
  isDemandButton,
  parseDemandButton,
};
