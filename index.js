require('dotenv').config();

const { Client, Collection, GatewayIntentBits, ActivityType } = require('discord.js');
const { loadCommands } = require('./bot/load-commands');
const { registerCommands } = require('./bot/register-commands');
const { startHealthServer } = require('./web/health-server');
const database = require('./db/database');
const constants = require('./config/constants');
const builderHelpers = require('./utils/builder-helpers');
const { buildPSLEmbed } = require('./utils/embed-helpers');
const { safeRoleAdd } = require('./utils/discord-helpers');
const { logError, replyWithError } = require('./utils/error-handler');
const { registerVerifierHandler } = require('./handlers/verifier-handler');

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
  DEFAULT_COMMAND_COOLDOWN_MS: 2000,
  MANAGING_COMMAND_COOLDOWN_MS: 4000,
  BUTTON_COOLDOWN_MS: 1000,
  COMMAND_EXECUTION_TIMEOUT_MS: 30000,
  ACCEPT_FLOW_TIMEOUT_MS: 25000,
  DB_CHECK_TIMEOUT_MS: 8000,
  GUILD_FETCH_TIMEOUT_MS: 8000,
  MEMBER_FETCH_TIMEOUT_MS: 5000,
  DB_SAVE_TIMEOUT_MS: 5000,
  ROLE_ASSIGNMENT_TIMEOUT_MS: 5000,
  NOTIFICATION_TIMEOUT_MS: 5000,
  PLAYER_OPERATION_LOCK_MS: 30000,
  CLEANUP_INTERVAL_MS: 10 * 60 * 1000,
};

const MANAGING_COMMANDS = ['contract', 'emergencysign', 'release', 'scout', 'scrim', 'appoint', 'announce'];

const userCooldowns = new Map();
const buttonCooldowns = new Map();
const playerOperations = new Map();

function hasUserCooldown(userId, command) {
  const key = `${userId}:${command}`;
  const cooldownData = userCooldowns.get(key);
  if (!cooldownData) return false;
  if (Date.now() < cooldownData.coolUntilMs) return true;
  userCooldowns.delete(key);
  return false;
}

function setUserCooldown(userId, command, cooldownMs = TIMERS.DEFAULT_COMMAND_COOLDOWN_MS) {
  const key = `${userId}:${command}`;
  userCooldowns.set(key, { coolUntilMs: Date.now() + cooldownMs });
}

function hasButtonCooldown(userId, buttonId) {
  const key = `${userId}:${buttonId}`;
  const timestamp = buttonCooldowns.get(key);
  if (!timestamp) return false;
  if (Date.now() - timestamp < TIMERS.BUTTON_COOLDOWN_MS) return true;
  buttonCooldowns.delete(key);
  return false;
}

function setButtonCooldown(userId, buttonId) {
  buttonCooldowns.set(`${userId}:${buttonId}`, Date.now());
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
    new Promise((_, reject) => setTimeout(() => reject(new TimeoutError(timeoutMessage)), ms)),
  ]);
}

async function safeDefer(interaction) {
  try {
    if (!interaction.deferred && !interaction.replied) {
      if (interaction.commandName !== 'announce') {
        await interaction.deferReply({ ephemeral: true }).catch(() => { });
      }
    }
  } catch (e) {
    console.warn('[index.js] Defer failed:', e.message);
  }
}

async function safeRespond(interaction, payload) {
  try {
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(payload).catch(() => { });
    } else {
      await interaction.reply(payload).catch(() => { });
    }
  } catch (responseError) {
    console.error('❌ Failed to send response to user:', responseError.message);
  }
}

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
  const manager = await database.getTeamStaff(teamName, 'manager');
  const assistant = await database.getTeamStaff(teamName, 'assistantManager');
  return { manager: manager?.manager, assistant: assistant?.assistantManager };
}

function buildStaffMentions(userId, staffManager, staffAssistant) {
  return [
    `<@${userId}>`,
    staffManager ? `<@${staffManager}>` : null,
    staffAssistant ? `<@${staffAssistant}>` : null,
  ].filter(Boolean).join(' ');
}

async function postSigningToChannel(client, signingEmbed, userId, teamManager, teamAssistant) {
  const signingsChannel = await client.channels.fetch(constants.SIGNINGS_CHANNEL_ID);
  if (signingsChannel) {
    const mentions = buildStaffMentions(userId, teamManager, teamAssistant);
    await signingsChannel.send({ content: mentions, embeds: [signingEmbed] });
  }
}

async function notifyOfferingStaff(client, issuerId, playerId, teamName, accepted, isEmergency) {
  if (!issuerId) return;

  try {
    const issuer = await client.users.fetch(issuerId);
    const formattedTeamName = `**${builderHelpers.getFormattedTeamName(teamName).toUpperCase()}**`;
    const responseEmbed = buildPSLEmbed(client, accepted ? constants.SUCCESS_COLOR : constants.ERROR_COLOR)
      .setTitle(accepted ? '🤝 Contract Accepted' : '❌ Contract Refused')
      .setDescription(
        accepted
          ? `<@${playerId}> accepted the ${isEmergency ? 'emergency contract' : 'contract'} offer for ${formattedTeamName}.`
          : `<@${playerId}> refused the ${isEmergency ? 'emergency contract' : 'contract'} offer for ${formattedTeamName}.`
      );

    await issuer.send({ embeds: [responseEmbed] });
  } catch (dmError) {
    console.warn('[index.js] Could not send offer response:', dmError.message);
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
      status: 'dnd',
      activities: [{ name: '/help', type: ActivityType.Listening }],
    });
  });

  client.on('interactionCreate', async (interaction) => {
    if (interaction.isButton()) {
      await handleButtonInteraction(interaction, client);
      return;
    }

    if (!interaction.isChatInputCommand()) return;

    const userId = interaction.user.id;
    const command = interaction.commandName;
    const cooldownDuration = MANAGING_COMMANDS.includes(command)
      ? TIMERS.MANAGING_COMMAND_COOLDOWN_MS
      : TIMERS.DEFAULT_COMMAND_COOLDOWN_MS;

    if (hasUserCooldown(userId, command)) {
      return interaction.reply({
        content: `⏳ Please wait before using /${command} again.`,
        ephemeral: true,
      });
    }

    console.log(`\n⚡ /${interaction.commandName} by ${interaction.user.tag}`);
    const commandData = client.commands.get(interaction.commandName);
    if (!commandData) return;

    try {
      if (!interaction.deferred && !interaction.replied) {
        if (interaction.commandName !== 'announce') {
          await interaction.deferReply({ ephemeral: true }).catch(() => { });
        }
      }

      await withTimeout(
        commandData.execute(interaction),
        TIMERS.COMMAND_EXECUTION_TIMEOUT_MS,
        'Command took too long to execute'
      );

      setUserCooldown(userId, command, cooldownDuration);
    } catch (error) {
      if (error instanceof UserFacingError) {
        logError(error, { userId, command });
        return await replyWithError(interaction, error);
      }

      if (error instanceof TimeoutError) {
        console.warn(`⏱️  /${command} timed out for ${interaction.user.tag}`);
        await safeRespond(interaction, {
          content: '⏱️ This is taking longer than expected. Please try again in a moment.',
          ephemeral: true,
        });
        return;
      }

      console.error(`❌ Error in /${interaction.commandName}:`, error.message);
      setUserCooldown(userId, command, cooldownDuration);
      await safeRespond(interaction, {
        content: '❌ Something went wrong on our end. Please try again, and let staff know if it keeps happening.',
        ephemeral: true,
      });
    }
  });

  await client.login(process.env.TOKEN || process.env.DISCORD_TOKEN);
}

async function handleButtonInteraction(interaction, client) {
  try {
    await safeDefer(interaction);

    const [action, teamName, targetPlayerId, issuerId] = interaction.customId.split('_');
    const userId = interaction.user.id;

    if (userId !== targetPlayerId) {
      return await safeRespond(interaction, { content: '❌ This button is not for you.', ephemeral: true });
    }

    if (hasButtonCooldown(userId, interaction.customId)) {
      return await safeRespond(interaction, { content: '⏳ You already interacted with this offer. Please wait.', ephemeral: true });
    }
    setButtonCooldown(userId, interaction.customId);

    const conflict = checkPlayerOperationConflict(userId);
    if (conflict) {
      return await safeRespond(interaction, { content: '❌ Another action is already processing. Please try again.', ephemeral: true });
    }
    recordPlayerOperation(userId, action, teamName);

    console.log(`\n🖱️ Button [${action}] by ${userId} for team: ${teamName}`);

    const isEmergency = action.startsWith('emergency');

    if (action === 'refuse' || action === 'emergencyrefuse') {
      try {
        await withTimeout(
          notifyOfferingStaff(client, issuerId, userId, teamName, false, isEmergency),
          TIMERS.NOTIFICATION_TIMEOUT_MS, 'Notification timeout'
        );
        const offerType = isEmergency ? 'emergency offer' : 'contract offer';
        return await safeRespond(interaction, {
          content: `❌ You have **refused** the ${offerType} from **${builderHelpers.getFormattedTeamName(teamName).toUpperCase()}**.`,
          ephemeral: true,
        });
      } catch (error) {
        logError(error, { userId, teamName, action });
        return await safeRespond(interaction, { content: '✅ Your refusal has been recorded.', ephemeral: true });
      } finally {
        clearPlayerOperation(userId);
      }
    }

    if (action === 'accept' || action === 'emergencyaccept') {
      try {
        return await withTimeout(
          processAcceptance(interaction, client, teamName, userId, issuerId, isEmergency),
          TIMERS.ACCEPT_FLOW_TIMEOUT_MS, 'Acceptance flow took too long'
        );
      } catch (error) {
        logError(error, { userId, teamName, action });
        await safeRespond(interaction, {
          content: '❌ Error processing signing. Please try again or contact support.',
          ephemeral: true,
        });
      } finally {
        clearPlayerOperation(userId);
      }
    }

  } catch (error) {
    logError(error, { userId, teamName, action });
    await safeRespond(interaction, { content: '❌ A critical error occurred. Please try again or contact support.', ephemeral: true });
  }
}

async function processAcceptance(interaction, client, teamName, userId, issuerId, isEmergency) {
  try {
    const { guild, teamInfo, embedColor } = await withTimeout(
      fetchTeamAndGuild(client, teamName),
      TIMERS.GUILD_FETCH_TIMEOUT_MS, 'Guild fetch timeout'
    );

    if (isEmergency && teamInfo && teamInfo.emergencySignsUsed >= constants.MAX_EMERGENCY_SIGNS_PER_TEAM) {
      return await safeRespond(interaction, { content: `❌ **Signing failed:** **${teamName}** used all emergency spots.`, ephemeral: true });
    }

    const [isWindowOpen, activeContract, squadSize] = await Promise.all([
      database.getTransferWindowState(),
      database.getContractedTeam(userId),
      database.getPlayersByTeam(teamName),
    ]);

    if (!isEmergency && !isWindowOpen) {
      return await safeRespond(interaction, { content: '❌ **Signing failed:** The transfer window closed while reviewing.', ephemeral: true });
    }
    if (activeContract) {
      return await safeRespond(interaction, { content: `❌ **Signing failed:** Already registered with **${activeContract.teamName}**.`, ephemeral: true });
    }
    if (squadSize.length >= constants.MAX_ROSTER_SIZE) {
      return await safeRespond(interaction, { content: `❌ **Signing failed:** **${teamName}** roster is full.`, ephemeral: true });
    }

    const targetMember = await guild.members.fetch(userId);
    await database.contractPlayer(userId, teamName);

    let updatedTeamInfo = teamInfo;
    if (isEmergency) {
      updatedTeamInfo = await database.incrementEmergencySign(teamName);
    }

    await safeRoleAdd(targetMember, teamInfo.roleId);

    const formattedTeamName = `**${builderHelpers.getFormattedTeamName(teamName).toUpperCase()}**`;

    Promise.all([
      (async () => {
        try {
          const { manager, assistant } = await fetchTeamStaff(teamName);
          const capacityText = await builderHelpers.getDisplayedPlayersAmount(teamName);

          const signingEmbed = buildPSLEmbed(client, embedColor)
            .setTitle(isEmergency ? `🚨 ${formattedTeamName} EMERGENCY SIGNING` : `${formattedTeamName} OFFICIAL SIGNING`);

          if (isEmergency) {
            const emergencySignsUsed = updatedTeamInfo?.emergencySignsUsed ?? (teamInfo?.emergencySignsUsed + 1);
            signingEmbed.addFields(
              { name: 'Player Signed', value: `<@${userId}> has accepted an emergency contract with ${formattedTeamName}! 🚨` },
              { name: 'Team Capacity', value: `**${capacityText}**` },
              { name: 'Emergency Spots Used', value: `**${emergencySignsUsed}/${constants.MAX_EMERGENCY_SIGNS_PER_TEAM}**` }
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
    ]).catch(() => { });

    return await safeRespond(interaction, {
      content: isEmergency
        ? `🎉 You joined ${formattedTeamName} via Emergency Signing!`
        : `🎉 **Success!** You're now officially part of ${formattedTeamName}!`,
      ephemeral: true,
    });

  } catch (error) {
    console.error(`❌ Process accept error (Emergency: ${isEmergency}):`, error.message);
    return await safeRespond(interaction, {
      content: '❌ Error processing contract. Your signing may still have been processed.',
      ephemeral: true,
    });
  }
}

bootstrap().catch((err) => {
  console.error('❌ Startup failed:', err);
  process.exit(1);
});