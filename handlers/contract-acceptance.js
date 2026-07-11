const { ActionRowBuilder, ButtonBuilder } = require('discord.js');
const constants = require('../config/constants');
const { buildPSLEmbed } = require('../utils/embed-helpers');
const { safeFetchMember, safeRoleAdd } = require('../utils/discord-helpers');
const { logError } = require('../utils/error-handler');

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

  async function postSigningToChannel(client, guild, signingEmbed, teamManager, teamAssistant) {
    const signingsChannel = await client.channels.fetch(constants.SIGNINGS_CHANNEL_ID).catch(() => null);
    if (!signingsChannel?.isTextBased?.()) return;

    const mentions = await buildStaffMentions(guild, teamManager, teamAssistant);
    await signingsChannel.send({ content: mentions, embeds: [signingEmbed] });
  }

  async function notifyOfferingStaff(client, issuerId, playerId, teamName, accepted, isEmergency) {
    if (!issuerId) return;

    try {
      const issuer = await client.users.fetch(issuerId);
      const formattedTeamName = `**${builderHelpers.getFormattedTeamName(teamName).toUpperCase()}**`;
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

      await issuer.send({ embeds: [responseEmbed] });
    } catch (dmError) {
      console.warn(`[contract-acceptance] Could not send offer response to issuer: ${dmError.message}`);
    }
  }

  async function handleRefusal(interaction, client, teamName, userId, issuerId, isEmergency) {
    const formattedTeamName = `**${builderHelpers.getFormattedTeamName(teamName).toUpperCase()}**`;
    const offerType = isEmergency ? 'emergency contract' : 'contract';

    const refuseEmbed = buildPSLEmbed(client, constants.DEFAULT_EMBED_COLOR)
      .setTitle('❌ Offer Declined')
      .setDescription(
        `You have declined the ${offerType} offer from ${formattedTeamName}.\n\nThis decision is final.`
      );

    await interaction.message.edit({ embeds: [refuseEmbed], components: [] }).catch(console.warn);

    await withTimeout(
      notifyOfferingStaff(client, issuerId, userId, teamName, false, isEmergency),
      timers.NOTIFICATION_TIMEOUT_MS,
      'Notification timeout'
    ).catch(console.warn);
  }

  async function processAcceptance(interaction, client, teamName, userId, issuerId, isEmergency) {
    const message = interaction.message;
    const formattedTeamName = `**${builderHelpers.getFormattedTeamName(teamName).toUpperCase()}**`;

    const failWithEmbed = async (title, description) => {
      await message
        .edit({
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

      if (isEmergency && teamInfo && teamInfo.emergencySignsUsed >= constants.MAX_EMERGENCY_SIGNS_PER_TEAM) {
        return failWithEmbed('❌ Signing Failed', `${formattedTeamName} has used all available emergency signing spots.`);
      }

      const [isWindowOpen, activeContract, squadSize] = await Promise.all([
        database.getTransferWindowState(),
        database.getContractedTeam(userId),
        database.getPlayersByTeam(teamName),
      ]);

      if (!isEmergency && !isWindowOpen) {
        return failWithEmbed('❌ Signing Failed', 'The transfer window **closed** while you were reviewing this offer.');
      }

      if (activeContract) {
        return failWithEmbed(
          '❌ Signing Failed',
          `You are already registered with **${builderHelpers.getFormattedTeamName(activeContract.teamName).toUpperCase()}**.`
        );
      }

      if (squadSize.length >= constants.MAX_ROSTER_SIZE) {
        return failWithEmbed('❌ Signing Failed', `${formattedTeamName}'s roster has since reached its limit.`);
      }

      const targetMember = await guild.members.fetch(userId);
      await database.contractPlayer(userId, teamName);

      let updatedTeamInfo = teamInfo;
      if (isEmergency) {
        updatedTeamInfo = await database.incrementEmergencySign(teamName);
      }

      await safeRoleAdd(targetMember, teamInfo.roleId);

      const successEmbed = buildPSLEmbed(client, embedColor)
        .setTitle(isEmergency ? '🚨 Emergency Contract Accepted!' : '✅ Contract Accepted!')
        .setDescription(
          isEmergency
            ? `You have officially joined ${formattedTeamName} via Emergency Signing! Good luck! 🏆`
            : `Welcome to ${formattedTeamName}! You are now an officially registered squad member. Good luck this season! 🏆`
        );

      await message.edit({ embeds: [successEmbed], components: [] }).catch(console.warn);

      await Promise.all([
        (async () => {
          try {
            const { manager, assistant } = await fetchTeamStaff(teamName);
            const capacityText = await builderHelpers.getDisplayedPlayersAmount(teamName);
            const signingsText = await builderHelpers.getDisplayedPlayerSigningsAmount(userId);

            const signingEmbed = buildPSLEmbed(client, embedColor).setTitle(
              isEmergency
                ? `🚨 ${formattedTeamName} EMERGENCY SIGNING`
                : `${formattedTeamName} OFFICIAL SIGNING`
            );

            const displayName = targetMember.displayName;
            if (isEmergency) {
              const emergencySignsUsed = updatedTeamInfo?.emergencySignsUsed ?? (teamInfo?.emergencySignsUsed + 1);
              signingEmbed.addFields(
                { name: 'Player Signed', value: `**${displayName}** has accepted an emergency contract with ${formattedTeamName}! 🚨` },
                { name: 'Team Capacity', value: `**${capacityText}**` },
                { name: 'Emergency Contracts Used', value: `**${emergencySignsUsed}/${constants.MAX_EMERGENCY_SIGNS_PER_TEAM}**` },
                { name: 'Player Signings Used', value: `**${signingsText}**` }
              );
            } else {
              signingEmbed.addFields(
                { name: 'Player Signed', value: `**${displayName}** has officially joined ${formattedTeamName}! 🎉` },
                { name: 'Team Capacity', value: `**${capacityText}**` },
                { name: 'Player Signings Used', value: `**${signingsText}**` }
              );
            }

            await postSigningToChannel(client, guild, signingEmbed, manager, assistant);
          } catch (err) {
            await logError(err, client, { userId, teamName, action: 'POST_SIGNING_TO_CHANNEL' });
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

      await message.edit({ content: '❌ Error processing your signing. Please contact staff.', components: [] }).catch(console.warn);
    }
  }

  async function handleButtonInteraction(interaction, client) {
    const [action, teamName, targetPlayerId, issuerId] = interaction.customId.split('_');
    const userId = interaction.user.id;

    if (userId !== targetPlayerId) {
      return interaction.reply({ content: '❌ This button is not for you.', ephemeral: true });
    }

    const messageId = interaction.message.id;
    if (hasButtonCooldown(userId, messageId)) {
      return interaction.reply({ content: '⏳ You already responded to this offer.', ephemeral: true });
    }

    setButtonCooldown(userId, messageId);

    const lockedComponents = buildLockedRow(interaction.message.components);
    try {
      await interaction.update({ components: lockedComponents });
    } catch (updateErr) {
      console.warn('[contract-acceptance] Could not lock buttons:', updateErr.message);
      return;
    }

    const conflict = checkPlayerOperationConflict(userId);
    if (conflict) {
      await interaction.message.edit({ content: '❌ Another action is already processing. Please try again.', components: [] }).catch(console.warn);
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
      await interaction.message.edit({ content: '❌ An error occurred processing your response. Please contact staff.', components: [] }).catch(console.warn);
    } finally {
      clearPlayerOperation(userId);
    }
  }

  return { handleButtonInteraction, handleRefusal, processAcceptance }; 
}

module.exports = { createContractAcceptanceHandler, buildLockedRow };
