require('dotenv').config();

const {
  Client,
  Collection,
  GatewayIntentBits,
  ActivityType,
  ActionRowBuilder,
  ButtonBuilder,
} = require('discord.js');
const { loadCommands }          = require('./bot/load-commands');
const { registerCommands }      = require('./bot/register-commands');
const { startHealthServer }     = require('./web/health-server');
const database                  = require('./db/database');
const constants                 = require('./config/constants');
const builderHelpers            = require('./utils/builder-helpers');
const { buildPSLEmbed }         = require('./utils/embed-helpers');
const { safeRoleAdd }           = require('./utils/discord-helpers');
const { logError, replyWithError } = require('./utils/error-handler');
const { registerVerifierHandler }  = require('./handlers/verifier-handler');
const { updateTeamsRoster }        = require('./utils/roster-updater');

class UserFacingError extends Error {
  constructor(message) {
    super(message);
    this.name = 'UserFacingError';
  }
}

class TimeoutError extends Error {
  constructor(message) {
    super(message);
    this.name = 'TimeoutError';
  }
}

const TIMERS = {
  DEFAULT_COMMAND_COOLDOWN_MS:  2000,
  MANAGING_COMMAND_COOLDOWN_MS: 4000,
  BUTTON_COOLDOWN_MS:           1000,
  COMMAND_EXECUTION_TIMEOUT_MS: 30000,
  ACCEPT_FLOW_TIMEOUT_MS:       25000,
  DB_CHECK_TIMEOUT_MS:          8000,
  GUILD_FETCH_TIMEOUT_MS:       8000,
  MEMBER_FETCH_TIMEOUT_MS:      5000,
  DB_SAVE_TIMEOUT_MS:           5000,
  ROLE_ASSIGNMENT_TIMEOUT_MS:   5000,
  NOTIFICATION_TIMEOUT_MS:      5000,
  PLAYER_OPERATION_LOCK_MS:     30000,
  CLEANUP_INTERVAL_MS:          10 * 60 * 1000,
};

const MANAGING_COMMANDS = [
  'contract', 'emergency-sign', 'release', 'scout', 'scrim', 'appoint', 'announce',
];

const userCooldowns     = new Map();
const buttonCooldowns   = new Map();
const playerOperations  = new Map();

function hasUserCooldown(userId, command) {
  const key  = `${userId}:${command}`;
  const data = userCooldowns.get(key);
  if (!data) return false;
  if (Date.now() < data.coolUntilMs) return true;
  userCooldowns.delete(key);
  return false;
}

function setUserCooldown(userId, command, cooldownMs = TIMERS.DEFAULT_COMMAND_COOLDOWN_MS) {
  userCooldowns.set(`${userId}:${command}`, { coolUntilMs: Date.now() + cooldownMs });
}

function hasButtonCooldown(userId, messageId) {
  const key       = `${userId}:${messageId}`;
  const timestamp = buttonCooldowns.get(key);
  if (!timestamp) return false;
  if (Date.now() - timestamp < TIMERS.BUTTON_COOLDOWN_MS) return true;
  buttonCooldowns.delete(key);
  return false;
}

function setButtonCooldown(userId, messageId) {
  buttonCooldowns.set(`${userId}:${messageId}`, Date.now());
}

function checkPlayerOperationConflict(playerId) {
  const existing = playerOperations.get(playerId);
  if (!existing) return null;
  if (existing.expiresAt > Date.now()) return existing;
  playerOperations.delete(playerId);
  return null;
}

function recordPlayerOperation(playerId, operation, teamName) {
  playerOperations.set(playerId, {
    operation,
    teamName,
    expiresAt: Date.now() + TIMERS.PLAYER_OPERATION_LOCK_MS,
  });
}

function clearPlayerOperation(playerId) {
  playerOperations.delete(playerId);
}

function cleanupExpiredEntries() {
  const now = Date.now();
  for (const [key, data] of userCooldowns) {
    if (now >= data.coolUntilMs) userCooldowns.delete(key);
  }
  for (const [key, timestamp] of buttonCooldowns) {
    if (now - timestamp >= TIMERS.BUTTON_COOLDOWN_MS) buttonCooldowns.delete(key);
  }
  for (const [key, data] of playerOperations) {
    if (now >= data.expiresAt) playerOperations.delete(key);
  }
}

function withTimeout(promise, ms, timeoutMessage) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new TimeoutError(timeoutMessage)), ms)
    ),
  ]);
}

async function safeRespond(interaction, payload) {
  try {
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(payload).catch(() => {});
    } else {
      await interaction.reply(payload).catch(() => {});
    }
  } catch (err) {
    console.error('❌ Failed to send response to user:', err.message);
  }
}

function buildLockedRow(existingComponents) {
  return existingComponents.map((row) => {
    const newRow = new ActionRowBuilder();
    newRow.addComponents(
      row.components.map((component) =>
        ButtonBuilder.from(component).setDisabled(true)
      )
    );
    return newRow;
  });
}

async function fetchTeamAndGuild(client, teamName) {
  const guild    = await client.guilds.fetch(constants.GUILD_ID);
  const teamInfo = await database.getTeamInfo(teamName);
  const role     = await builderHelpers.getTeamRole(client, teamName);
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

function buildStaffMentions(userId, staffManager, staffAssistant) {
  return [
    `<@${userId}>`,
    staffManager  ? `<@${staffManager}>`  : null,
    staffAssistant ? `<@${staffAssistant}>` : null,
  ]
    .filter(Boolean)
    .join(' ');
}

async function postSigningToChannel(client, signingEmbed, userId, teamManager, teamAssistant) {
  const signingsChannel = await client.channels.fetch(constants.SIGNINGS_CHANNEL_ID).catch(() => null);
  if (signingsChannel) {
    const mentions = buildStaffMentions(userId, teamManager, teamAssistant);
    await signingsChannel.send({ content: mentions, embeds: [signingEmbed] });
  }
}

async function notifyOfferingStaff(client, issuerId, playerId, teamName, accepted, isEmergency) {
  if (!issuerId) return;
  try {
    const issuer            = await client.users.fetch(issuerId);
    const formattedTeamName = `**${builderHelpers.getFormattedTeamName(teamName).toUpperCase()}**`;
    const offerType         = isEmergency ? 'emergency contract' : 'contract';
    const responseEmbed     = buildPSLEmbed(
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
    console.warn('[index.js] Could not send offer response to issuer:', dmError.message);
  }
}

async function bootstrap() {
  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
  });
  client.commands = new Collection();

  startHealthServer();

  await database.connectMongo();
  console.log('✅ Connected to MongoDB');

  await database.seedTeamsIfNeeded();

  const commands = loadCommands(client);
  await registerCommands(commands);

  registerVerifierHandler(client);

  setInterval(cleanupExpiredEntries, TIMERS.CLEANUP_INTERVAL_MS).unref();

  client.once('clientReady', () => {
    console.log(`\n🤖 Bot online as: ${client.user.tag} (${client.user.id})`);
    client.user.setPresence({
      status:     'dnd',
      activities: [{ name: '/help', type: ActivityType.Listening }],
    });

    updateTeamsRoster(client)
  });

  client.on('interactionCreate', async (interaction) => {
    if (interaction.isButton()) {
      await handleButtonInteraction(interaction, client);
      return;
    }

    if (!interaction.isChatInputCommand()) return;

    const userId   = interaction.user.id;
    const command  = interaction.commandName;
    const cooldown = MANAGING_COMMANDS.includes(command)
      ? TIMERS.MANAGING_COMMAND_COOLDOWN_MS
      : TIMERS.DEFAULT_COMMAND_COOLDOWN_MS;

    if (hasUserCooldown(userId, command)) {
      return interaction.reply({
        content:   `⏳ Please wait before using /${command} again.`,
        ephemeral: true,
      });
    }

    console.log(`\n⚡ /${interaction.commandName} by ${interaction.user.tag}`);

    const commandData = client.commands.get(interaction.commandName);
    if (!commandData) return;

    try {
      if (!interaction.deferred && !interaction.replied) {
        if (interaction.commandName !== 'announce') {
          await interaction.deferReply({ ephemeral: true }).catch(() => {});
        }
      }

      await withTimeout(
        commandData.execute(interaction),
        TIMERS.COMMAND_EXECUTION_TIMEOUT_MS,
        'Command took too long to execute'
      );

      setUserCooldown(userId, command, cooldown);
    } catch (error) {
      if (error instanceof UserFacingError) {
        logError(error, { userId, command });
        return await replyWithError(interaction, error);
      }

      if (error instanceof TimeoutError) {
        console.warn(`⏱️  /${command} timed out for ${interaction.user.tag}`);
        await safeRespond(interaction, {
          content:   '⏱️ This is taking longer than expected. Please try again in a moment.',
          ephemeral: true,
        });
        return;
      }

      console.error(`❌ Error in /${interaction.commandName}:`, error.message);
      setUserCooldown(userId, command, cooldown);
      await safeRespond(interaction, {
        content:   '❌ Something went wrong on our end. Please try again, and let staff know if it keeps happening.',
        ephemeral: true,
      });
    }
  });

  await client.login(process.env.TOKEN || process.env.DISCORD_TOKEN);
}

async function handleButtonInteraction(interaction, client) {
  const [action, teamName, targetPlayerId, issuerId] = interaction.customId.split('_');
  const userId = interaction.user.id;

  if (userId !== targetPlayerId) {
    return interaction.reply({ content: '❌ This button is not for you.', ephemeral: true });
  }

  const messageId = interaction.message.id;
  if (hasButtonCooldown(userId, messageId)) {
    return interaction.reply({
      content:   '⏳ You already responded to this offer.',
      ephemeral: true,
    });
  }
  setButtonCooldown(userId, messageId);

  const lockedComponents = buildLockedRow(interaction.message.components);
  try {
    await interaction.update({ components: lockedComponents });
  } catch (updateErr) {
    console.warn('[handleButtonInteraction] Could not lock buttons:', updateErr.message);
    return;
  }

  const conflict = checkPlayerOperationConflict(userId);
  if (conflict) {
    await interaction.message
      .edit({ content: '❌ Another action is already processing. Please try again.', components: [] })
      .catch(console.warn);
    return;
  }
  recordPlayerOperation(userId, action, teamName);

  console.log(`\n🖱️ Button [${action}] by ${userId} for team: ${teamName}`);

  const isEmergency = action.startsWith('emergency');
  const isRefuse    = action === 'refuse' || action === 'emergencyrefuse';

  try {
    if (isRefuse) {
      await handleRefusal(interaction, client, teamName, userId, issuerId, isEmergency);
    } else {
      await withTimeout(
        processAcceptance(interaction, client, teamName, userId, issuerId, isEmergency),
        TIMERS.ACCEPT_FLOW_TIMEOUT_MS,
        'Acceptance flow took too long'
      );
    }
  } catch (error) {
    logError(error, { userId, teamName, action });
    await interaction.message
      .edit({ content: '❌ An error occurred processing your response. Please contact staff.', components: [] })
      .catch(console.warn);
  } finally {
    clearPlayerOperation(userId);
  }
}

async function handleRefusal(interaction, client, teamName, userId, issuerId, isEmergency) {
  const formattedTeamName = `**${builderHelpers.getFormattedTeamName(teamName).toUpperCase()}**`;
  const offerType         = isEmergency ? 'emergency contract' : 'contract';

  const refuseEmbed = buildPSLEmbed(client, constants.DEFAULT_EMBED_COLOR)
    .setTitle('❌ Offer Declined')
    .setDescription(
      `You have declined the ${offerType} offer from ${formattedTeamName}.\n\nThis decision is final.`
    );

  await interaction.message
    .edit({ embeds: [refuseEmbed], components: [] })
    .catch(console.warn);

  await withTimeout(
    notifyOfferingStaff(client, issuerId, userId, teamName, false, isEmergency),
    TIMERS.NOTIFICATION_TIMEOUT_MS,
    'Notification timeout'
  ).catch(console.warn);
}

async function processAcceptance(interaction, client, teamName, userId, issuerId, isEmergency) {
  const message           = interaction.message;
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
      TIMERS.GUILD_FETCH_TIMEOUT_MS,
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

    Promise.all([
      (async () => {
        try {
          const { manager, assistant } = await fetchTeamStaff(teamName);
          const capacityText           = await builderHelpers.getDisplayedPlayersAmount(teamName);

          const signingEmbed = buildPSLEmbed(client, embedColor).setTitle(
            isEmergency
              ? `🚨 ${formattedTeamName} EMERGENCY SIGNING`
              : `${formattedTeamName} OFFICIAL SIGNING`
          );

          if (isEmergency) {
            const emergencySignsUsed =
              updatedTeamInfo?.emergencySignsUsed ?? (teamInfo?.emergencySignsUsed + 1);
            signingEmbed.addFields(
              { name: 'Player Signed',         value: `<@${userId}> has accepted an emergency contract with ${formattedTeamName}! 🚨` },
              { name: 'Team Capacity',          value: `**${capacityText}**` },
              { name: 'Emergency Spots Used',   value: `**${emergencySignsUsed}/${constants.MAX_EMERGENCY_SIGNS_PER_TEAM}**` }
            );
          } else {
            signingEmbed.addFields(
              { name: 'Player Signed', value: `<@${userId}> has officially joined ${formattedTeamName}! 🎉` },
              { name: 'Team Capacity', value: `**${capacityText}**` }
            );
          }

          await postSigningToChannel(client, signingEmbed, userId, manager, assistant);
        } catch (err) {
          logError(err, { userId, teamName, action: 'POST_SIGNING_TO_CHANNEL' });
        }
      })(),
      (async () => {
        try {
          await notifyOfferingStaff(client, issuerId, userId, teamName, true, isEmergency);
        } catch (err) {
          logError(err, { userId, teamName, action: 'NOTIFY_OFFERING_STAFF' });
        }
      })(),
      (async () => {
        try {
          await updateTeamsRoster(client);
        } catch (err) {
          logError(err, { userId, teamName, action: 'UPDATE_TEAMS_ROSTER' });
        }
      })(),
    ]).catch(() => {});

  } catch (error) {
    console.error(`❌ processAcceptance error (Emergency: ${isEmergency}):`, error.message);
    await message
      .edit({ content: '❌ Error processing your signing. Please contact staff.', components: [] })
      .catch(console.warn);
  }
}

bootstrap().catch((err) => {
  console.error('❌ Startup failed:', err);
  process.exit(1);
});