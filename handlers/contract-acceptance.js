const { ActionRowBuilder, ButtonBuilder, MessageFlags } = require('discord.js');
const constants = require('../config/constants');
const { buildPSLEmbed } = require('../utils/embed-helpers');
const { safeFetchMember, safeRoleAdd } = require('../utils/discord-helpers');
const { logError } = require('../utils/error-handler');
const { getTransferWindowContractState } = require('../utils/transfer-window-permissions');

const CONTRACT_BUTTON_ACTIONS = new Set([
  'accept',
  'refuse',
  'emergencyaccept',
  'emergencyrefuse',
]);

function isContractAcceptanceButton(customId) {
  const parts = customId.split('_');
  return parts.length === 4 && CONTRACT_BUTTON_ACTIONS.has(parts[0]);
}

function buildLockedRow(existingComponents = []) {
  return existingComponents.map((row) => {
    const newRow = new ActionRowBuilder();
    newRow.addComponents(
      row.components.map((component) => ButtonBuilder.from(component).setDisabled(true))
    );
    return newRow;
  });
}

function createContractAcceptanceHandler(dependencies) {
  const {
    database,
    builderHelpers,
    updateTeamsRoster,
    withTimeout,
    timers,
    buttonCooldowns,
    playerOperations,
    hasButtonCooldown,
    setButtonCooldown,
    checkPlayerOperationConflict,
    recordPlayerOperation,
    clearPlayerOperation,
  } = dependencies;

  async function fetchTeamAndGuild(client, teamName) {
    const guild = await client.guilds.fetch(constants.GUILD_ID);
    const teamInfo = await database.getTeamInfo(teamName);
    const role = await builderHelpers.getTeamRole(client, teamName);

    return {
      guild,
      teamInfo,
      embedColor: role ? role.color : constants.DEFAULT_EMBED_COLOR,
    };
  }

  async function fetchTeamStaff(teamName) {
    const [manager, assistant] = await Promise.all([
      database.getTeamStaff(teamName, 'manager'),
      database.getTeamStaff(teamName, 'assistantManager'),
    ]);

    return { manager: manager?.manager, assistant: assistant?.assistantManager };
  }

  async function buildStaffMentions(guild, staffManager, staffAssistant) {
    const entries = [
      { id: staffManager, required: false },
      { id: staffAssistant, required: false },
    ].filter((entry) => entry.id);

    const results = await Promise.all(
      entries.map(async ({ id }) => {
        const member = await safeFetchMember(guild, id);
        return member ? `<@${id}>` : null;
      })
    );

    return results.filter(Boolean).join(' ');
  }

  async function postContractToChannel(client, guild, contractEmbed, teamManager, teamAssistant) {
    const contractsChannel = await client.channels.fetch(constants.CONTRACTS_CHANNEL_ID).catch(() => null);
    if (!contractsChannel?.isTextBased?.()) return;

    const mentions = await buildStaffMentions(guild, teamManager, teamAssistant);
    await contractsChannel.send({ content: mentions, embeds: [contractEmbed] });
  }

  async function notifyOfferingStaff(client, issuerId, playerId, teamName, accepted, isEmergency) {
    if (!issuerId) return;

    try {
      const issuer = await client.users.fetch(issuerId);
      const formattedTeamName = `**${builderHelpers.getFormattedTeamName(teamName)}**`;
      const offerType = isEmergency ? 'emergency contract' : 'contract';
      const responseEmbed = buildPSLEmbed(
        client,
        accepted ? constants.SUCCESS_COLOR : constants.ERROR_COLOR
      )
        .setTitle(accepted ? '🤝 Contract Accepted' : '❌ Contract Refused')
        .setDescription(
          accepted
            ? `<@${playerId}> accepted the ${offerType} offer for ${formattedTeamName}.`
            : `<@${playerId}> refused the ${offerType} offer for ${formattedTeamName}.`
        );

      try {
        await issuer.send({ embeds: [responseEmbed] });
      } catch (dmError) {
        console.warn(`[contract-acceptance] Could not send offer response to issuer: ${dmError.message}`);
      }
    } catch (dmError) {
      console.warn(`[contract-acceptance] Could not send offer response to issuer: ${dmError.message}`);
    }
  }

  async function handleRefusal(interaction, client, teamName, userId, issuerId, isEmergency) {
    const formattedTeamName = `**${builderHelpers.getFormattedTeamName(teamName)}**`;
    const offerType = isEmergency ? 'emergency contract' : 'contract';
    const issuerDisplayName = interaction.user.displayName || interaction.user.username;

    const refuseEmbed = buildPSLEmbed(client, constants.ERROR_COLOR)
      .setTitle('❌ Offer Declined')
      .setDescription(
        `You have declined the ${offerType} offer from ${formattedTeamName} made by **${issuerDisplayName}**.\n\nThis decision is final.`
      );

    await interaction.editReply({ embeds: [refuseEmbed], components: [] }).catch(console.warn);

    await withTimeout(
      notifyOfferingStaff(client, issuerId, userId, teamName, false, isEmergency),
      timers.NOTIFICATION_TIMEOUT_MS,
      'Notification timeout'
    ).catch(console.warn);
  }

  async function processAcceptance(interaction, client, teamName, userId, issuerId, isEmergency) {
    const formattedTeamName = `**${builderHelpers.getFormattedTeamName(teamName)}**`;

    const failWithEmbed = async (title, description) => {
      await interaction.editReply({
          embeds: [
            buildPSLEmbed(client, constants.DEFAULT_EMBED_COLOR)
              .setTitle(title)
              .setDescription(description),
          ],
          components: [],
        })
        .catch(console.warn);
    };

    try {
      const { guild, teamInfo, embedColor } = await withTimeout(
        fetchTeamAndGuild(client, teamName),
        timers.GUILD_FETCH_TIMEOUT_MS,
        'Guild fetch timeout'
      );

      if (isEmergency && teamInfo && teamInfo.emergencyContractsUsed >= constants.MAX_EMERGENCY_CONTRACTS_PER_TEAM) {
        return failWithEmbed('❌ Contract Failed', `${formattedTeamName} has used all available emergency contract spots.`);
      }

      const [contractState, isLeagueOpen, activeContract, squadSize] = await Promise.all([
        getTransferWindowContractState(teamName),
        database.getLeagueState(),
        database.getContractedTeam(userId),
        database.getPlayersByTeam(teamName),
      ]);

      if (contractState.isDenied && !isEmergency) {
        return failWithEmbed('❌ Contract Failed', `${formattedTeamName} is currently **denied from regular contracts**.`);
      }

      if (isEmergency && (contractState.isWindowOpen || contractState.isAllowedWhileClosed)) {
        return failWithEmbed(
          '❌ Contract Failed',
          contractState.isWindowOpen
            ? 'The transfer window **opened** while you were reviewing this offer. Use a regular contract instead.'
            : `${formattedTeamName} is allowed to offer contracts freely while the transfer window is closed. Use a regular contract instead.`
        );
      }

      if (!isEmergency && !contractState.isWindowOpen && !contractState.isAllowedWhileClosed) {
        return failWithEmbed('❌ Contract Failed', 'The transfer window is **closed** and this team is not on the allowed list.');
      }

      if (activeContract) {
        return failWithEmbed(
          '❌ Contract Failed',
          `You are already registered with **${builderHelpers.getFormattedTeamName(activeContract.teamName)}**.`
        );
      }

      if (squadSize.length >= constants.MAX_ROSTER_SIZE) {
        return failWithEmbed('❌ Contract Failed', `${formattedTeamName}'s roster has since reached its limit.`);
      }

      const targetMember = await guild.members.fetch(userId);
      await database.contractPlayer(userId, teamName, isLeagueOpen);

      let updatedTeamInfo = teamInfo;
      if (isEmergency) {
        updatedTeamInfo = await database.incrementEmergencyContract(teamName);
      }

      await safeRoleAdd(targetMember, teamInfo.roleId);

      const successEmbed = buildPSLEmbed(client, embedColor)
        .setTitle(isEmergency ? '🚨 Emergency Contract Accepted!' : '✅ Contract Accepted!')
        .setDescription(
          isEmergency
            ? `You have officially joined ${formattedTeamName} via an emergency contract! Good luck! 🏆`
            : `Welcome to ${formattedTeamName}! You are now an officially registered squad member. Good luck this season! 🏆`
        );

      await interaction.editReply({ embeds: [successEmbed], components: [] }).catch(console.warn);

      await Promise.all([
        (async () => {
          try {
            const { manager, assistant } = await fetchTeamStaff(teamName);
            const capacityText = await builderHelpers.getDisplayedPlayersAmount(teamName);
            const contractsText = isLeagueOpen
              ? await builderHelpers.getDisplayedPlayerContractsAmount(userId)
              : null;

            const contractEmbed = buildPSLEmbed(client, embedColor)
            .setTitle(
              isEmergency
                ? `🚨 ${formattedTeamName} Emergency Contract`
                : `${formattedTeamName} Official Contract`
            )
            .setThumbnail(interaction.user.displayAvatarURL());

            const displayName = targetMember.displayName;
            const contractFields = [
              {
                name: 'Player Contracted',
                value: isEmergency
                  ? `**${displayName}** has accepted an emergency contract with ${formattedTeamName}! 🚨`
                  : `**${displayName}** has officially joined ${formattedTeamName}! 🎉`,
              },
              { name: 'Team Capacity', value: `**${capacityText}**` },
            ];

            if (isEmergency) {
              const emergencyContractsUsed = updatedTeamInfo?.emergencyContractsUsed ?? (teamInfo?.emergencyContractsUsed + 1);
              contractFields.push({
                name: 'Emergency Contracts Used',
                value: `**${emergencyContractsUsed}/${constants.MAX_EMERGENCY_CONTRACTS_PER_TEAM}**`,
              });
            }

            if (isLeagueOpen) {
              contractFields.push({ name: 'Individual Contracts Used', value: `**${contractsText}**` });
            }

            contractEmbed.addFields(contractFields);
            await postContractToChannel(client, guild, contractEmbed, manager, assistant);
          } catch (err) {
            await logError(err, client, { userId, teamName, action: 'POST_CONTRACT_TO_CHANNEL' });
          }
        })(),
        (async () => {
          try {
            await notifyOfferingStaff(client, issuerId, userId, teamName, true, isEmergency);
          } catch (err) {
            await logError(err, client, { userId, teamName, action: 'NOTIFY_OFFERING_STAFF' });
          }
        })(),
        (async () => {
          try {
            await updateTeamsRoster(client);
          } catch (err) {
            await logError(err, client, { userId, teamName, action: 'UPDATE_TEAMS_ROSTER' });
          }
        })(),
      ]).catch(() => {});
    } catch (error) {
      await logError(error, client, {
        userId,
        teamName,
        action: isEmergency ? 'EMERGENCY_ACCEPTANCE_FLOW' : 'ACCEPTANCE_FLOW',
        context: 'PROCESS_ACCEPTANCE_ERROR',
      });

      await interaction.editReply({ content: '❌ Error processing your contract. Please contact staff.', components: [] }).catch(console.warn);
    }
  }

  async function handleButtonInteraction(interaction, client) {
    if (!isContractAcceptanceButton(interaction.customId)) return false;

    const [action, teamName, targetPlayerId, issuerId] = interaction.customId.split('_');
    const userId = interaction.user.id;

    if (userId !== targetPlayerId) {
      return interaction.reply({ content: '❌ This button is not for you.', flags: MessageFlags.Ephemeral });
    }

    const teamInfo = await database.getTeamInfo(teamName);
    if (!teamInfo) {
      console.log('[contract-acceptance] Team not found in database:', teamName);
      return interaction.reply({ content: '❌ The team for this contract offer does not exist.', flags: MessageFlags.Ephemeral });
    }

    const messageId = interaction.message.id;
    if (hasButtonCooldown(userId, messageId)) {
      return interaction.reply({ content: '⏳ You already responded to this offer.', flags: MessageFlags.Ephemeral });
    }

    setButtonCooldown(userId, messageId);

    const lockedComponents = buildLockedRow(interaction.message.components);
    try {
      await interaction.update({ components: lockedComponents });
    } catch (updateError) {
      console.warn('[contract-acceptance] Could not lock buttons:', updateError.message);
      return;
    }

    const conflict = checkPlayerOperationConflict(userId);
    if (conflict) {
      await interaction.editReply({ content: '❌ Another action is already processing. Please try again.', components: [] }).catch(console.warn);
      return;
    }

    recordPlayerOperation(userId, action, teamName);

    console.log(`\n🖱️ Button [${action}] by ${userId} for team: ${teamName}`);

    const isEmergency = action.startsWith('emergency');
    const isRefuse = action === 'refuse' || action === 'emergencyrefuse';

    try {
      if (isRefuse) {
        await handleRefusal(interaction, client, teamName, userId, issuerId, isEmergency);
      } else {
        await withTimeout(
          processAcceptance(interaction, client, teamName, userId, issuerId, isEmergency),
          timers.ACCEPT_FLOW_TIMEOUT_MS,
          'Acceptance flow took too long'
        );
      }
    } catch (error) {
      await logError(error, client, { userId, teamName, action, context: 'BUTTON_INTERACTION_ERROR' });
      await interaction.editReply({ content: '❌ An error occurred processing your response. Please contact staff.', components: [] }).catch(console.warn);
    } finally {
      clearPlayerOperation(userId);
    }
  }

  return { handleButtonInteraction, handleRefusal, processAcceptance };
}

module.exports = { createContractAcceptanceHandler, buildLockedRow, isContractAcceptanceButton };