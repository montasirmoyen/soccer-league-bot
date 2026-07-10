require('dotenv').config();

const {
  Client,
  Collection,
  GatewayIntentBits,
  ActivityType,
  Events,
} = require('discord.js');
const { loadCommands }             = require('./bot/load-commands');
const { registerCommands }         = require('./bot/register-commands');
const { startHealthServer }        = require('./web/health-server');
const database                     = require('./db/database');
const constants                    = require('./config/constants');
const { safeReply, safeDeferReply } = require('./utils/discord-helpers');
const { logError, replyWithError } = require('./utils/error-handler');
const { registerVerifierHandler }  = require('./handlers/verifier-handler');
const { createContractAcceptanceHandler } = require('./handlers/contract-acceptance');
const { updateTeamsRoster }        = require('./utils/roster-updater');
const guildMemberRemoveEvent       = require('./events/guild-member-remove');

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

const userCooldowns    = new Map();
const buttonCooldowns  = new Map();
const playerOperations = new Map();

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
  const sent = await safeReply(interaction, payload);
  if (!sent) {
    console.error('❌ Failed to send response to user.');
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

  const allTeams = await database.getAllTeams();
  if (!allTeams?.length) {
    console.error('❌ No teams found in the database after seeding. Exiting.');
    process.exit(1);
  }

  for (const team of allTeams) {
    const players = await database.getPlayersByTeam(team.name);
    for (const player of players) {
      const userId = player.userId;
      const guild  = await client.guilds.fetch(constants.GUILD_ID).catch(() => null);
      if (!guild) continue;
      const member = await guild.members.fetch(userId).catch(() => null);
      if (!member) {
        await database.releasePlayer(userId);
        console.log(`[index.js] Released ${userId} from ${team.name} due to leaving the guild.`);
      }
    }
  }

  const commands = loadCommands(client);
  await registerCommands(commands);

  registerVerifierHandler(client);

  const contractAcceptance = createContractAcceptanceHandler({
    database,
    builderHelpers: require('./utils/builder-helpers'),
    updateTeamsRoster,
    withTimeout,
    timers: TIMERS,
    buttonCooldowns,
    playerOperations,
    hasButtonCooldown,
    setButtonCooldown,
    checkPlayerOperationConflict,
    recordPlayerOperation,
    clearPlayerOperation,
  });

  client.on(guildMemberRemoveEvent.name, (...args) => guildMemberRemoveEvent.execute(...args));

  setInterval(cleanupExpiredEntries, TIMERS.CLEANUP_INTERVAL_MS).unref();

  client.once(Events.ClientReady, () => {
    console.log(`\n🤖 Bot online as: ${client.user.tag} (${client.user.id})`);
    client.user.setPresence({
      status:     'dnd',
      activities: [{ name: '/help', type: ActivityType.Listening }],
    });
    updateTeamsRoster(client);
  });

  client.on('interactionCreate', async (interaction) => {
    if (interaction.isButton()) {
      await contractAcceptance.handleButtonInteraction(interaction, client);
      return;
    }

    if (!interaction.isChatInputCommand()) return;

    const userId   = interaction.user.id;
    const command  = interaction.commandName;
    const cooldown = MANAGING_COMMANDS.includes(command)
      ? TIMERS.MANAGING_COMMAND_COOLDOWN_MS
      : TIMERS.DEFAULT_COMMAND_COOLDOWN_MS;

    if (hasUserCooldown(userId, command)) {
      return safeReply(interaction, {
        content:   `⏳ Please wait before using /${command} again.`,
        ephemeral: true,
      });
    }

    console.log(`\n⚡ /${interaction.commandName} by ${interaction.user.tag}`);

    const commandData = client.commands.get(interaction.commandName);
    if (!commandData) return;

    try {
      if (!interaction.deferred && !interaction.replied && interaction.commandName !== 'announce') {
        await safeDeferReply(interaction, { ephemeral: true });
      }

      await withTimeout(
        commandData.execute(interaction),
        TIMERS.COMMAND_EXECUTION_TIMEOUT_MS,
        'Command took too long to execute'
      );

      setUserCooldown(userId, command, cooldown);
    } catch (error) {
      if (error instanceof UserFacingError) {
        await logError(error, client, { userId, command, context: 'USER_FACING_COMMAND_ERROR' });
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

      await logError(error, client, { userId, command, context: 'SLASH_COMMAND_EXECUTION_ERROR' });
      await safeRespond(interaction, {
        content:   '❌ Something went wrong on our end. Please try again, and let staff know if it keeps happening.',
        ephemeral: true,
      });
    }
  });

  await client.login(process.env.TOKEN || process.env.DISCORD_TOKEN);
}

bootstrap().catch((err) => {
  console.error('❌ Startup failed:', err);
  process.exit(1);
});