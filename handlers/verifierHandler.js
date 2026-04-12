const { Events, EmbedBuilder } = require('discord.js');
const noblox = require('noblox.js');
const axios = require('axios');

const DEFAULT_GROUP_ID = 151319009;
const DEFAULT_ROLE_ID_VERIFIED = '1480572500315209870';
const DEFAULT_RANK_ID_VERIFIED = 3;
const DEFAULT_ROLE_ID_UNVERIFIED = '1480574659459022890';
const DEFAULT_RANK_ID_UNVERIFIED = 2;
const LOG_CHANNEL_ID = '1492610327190179940';

let robloxInitialized = false;
let promotionQueue = [];
let isProcessing = false;

process.on('unhandledRejection', (reason) => {
  console.error('[FATAL ERROR] Unhandled Rejection:', reason);
});

process.on('uncaughtException', (error) => {
  console.error('[FATAL ERROR] Uncaught Exception:', error);
});

const handleShutdown = () => {
  if (promotionQueue.length > 0) {
    console.warn(`[SHUTDOWN WARN] Process ended with ${promotionQueue.length} items pending on queue.`);
  }

  process.exit(0);
};

process.on('SIGINT', handleShutdown);
process.on('SIGTERM', handleShutdown);

async function withRetry(fn, maxRetries = 3, delayMs = 5000) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      const status = error.response?.status;
      if (status >= 400 && status < 500 && status !== 429) {
        throw error;
      }
      if (i === maxRetries - 1) {
        throw error;
      }
      console.log(`[RETRY] Try ${i + 1} failed. Retrying in ${delayMs / 1000}s...`);
      await new Promise(res => setTimeout(res, delayMs));
    }
  }
}

async function sendLog(client, embed) {
  try {
    const channel = await client.channels.fetch(LOG_CHANNEL_ID);
    if (channel && channel.isTextBased()) {
      await channel.send({ embeds: [embed] }).catch(() => {});
    }
  } catch (err) {
    console.error('[LOG ERROR] Fail sending log to channel:', err.message);
  }
}

async function processQueue(client) {
  if (isProcessing || promotionQueue.length === 0) return;
  isProcessing = true;

  while (promotionQueue.length > 0) {
    const task = promotionQueue.shift();
    const { config, newMember, targetRank } = task;

    try {
      const robloxId = await withRetry(() => fetchRobloxUserId(newMember.guild.id, newMember.id, config.roverApiKey));

      if (!robloxId) {
        console.log(`[WARN] No robloxId found for ${newMember.user.tag}`);
        
        const warnEmbed = new EmbedBuilder()
          .setTitle('⚠️ Sync Warning')
          .setDescription(`No robloxId found for **${newMember.user.tag}**`)
          .setColor('#FFA500')
          .setTimestamp();
        await sendLog(client, warnEmbed);
      } else {
        await withRetry(() => noblox.setRank(config.groupId, Number.parseInt(String(robloxId), 10), targetRank));
        console.log(`[SUCCESS] Ranked ${newMember.user.tag} (RBX: ${robloxId}) to Rank ${targetRank}`);

        const successEmbed = new EmbedBuilder()
          .setTitle('✅ Rank Updated')
          .addFields(
            { name: 'User', value: `${newMember.user.tag}`, inline: true },
            { name: 'Roblox ID', value: `${robloxId}`, inline: true },
            { name: 'New Rank', value: `${targetRank}`, inline: true }
          )
          .setColor('#00FF00')
          .setTimestamp();
        await sendLog(client, successEmbed);
      }
    } catch (err) {
      let errorMessage = err.message;
      let errorCode = 'SYSTEM_ERROR';

      if (err.response) {
        const errorData = err.response.data || {};
        errorCode = errorData.errorCode || err.response.status;
        errorMessage = errorData.message || 'No message provided';
        
        console.error(`[API ERROR] Code: ${errorCode}`);
        console.error(`[MESSAGE]: ${errorMessage}`);
      } else {
        console.error('[SYSTEM ERROR]', err.message);
      }

      const errorEmbed = new EmbedBuilder()
        .setTitle('❌ Sync Error')
        .addFields(
          { name: 'User', value: `${newMember.user.tag}` },
          { name: 'Code', value: `${errorCode}` },
          { name: 'Message', value: `${errorMessage}` }
        )
        .setColor('#FF0000')
        .setTimestamp();
      await sendLog(client, errorEmbed);
    }

    await new Promise(res => setTimeout(res, 10000));
  }

  isProcessing = false;
  if (promotionQueue.length > 0) processQueue(client);
}

function parseIntEnv(name) {
  const raw = process.env[name];
  if (!raw) return null;
  const parsed = Number.parseInt(raw, 10);
  return Number.isNaN(parsed) ? null : parsed;
}

function parseRoleIdEnv(name, fallback) {
  const raw = process.env[name];
  if (!raw) return fallback;
  return String(raw).trim();
}

function getVerifierConfig() {
  return {
    robloxCookie: process.env.ROBLOX_COOKIE,
    roverApiKey: process.env.ROVER_API_KEY,
    groupId: parseIntEnv('GROUP_ID') || DEFAULT_GROUP_ID,
    roleIdVerified: parseRoleIdEnv('ROLE_ID_VERIFIED', DEFAULT_ROLE_ID_VERIFIED),
    roleIdUnverified: parseRoleIdEnv('ROLE_ID_UNVERIFIED', DEFAULT_ROLE_ID_UNVERIFIED),
    rankIdVerified: parseIntEnv('RANK_ID_VERIFIED') || DEFAULT_RANK_ID_VERIFIED,
    rankIdUnverified: parseIntEnv('RANK_ID_UNVERIFIED') || DEFAULT_RANK_ID_UNVERIFIED,
  };
}

function hasRequiredConfig(config) {
  return Boolean(
    config.robloxCookie && config.roverApiKey && config.groupId && 
    config.roleIdVerified && config.roleIdUnverified && 
    config.rankIdVerified && config.rankIdUnverified
  );
}

async function initRoblox(config) {
  if (robloxInitialized) return;
  await noblox.setCookie(config.robloxCookie);
  robloxInitialized = true;
  console.log('✅ Authenticated with Roblox');
}

async function fetchRobloxUserId(guildId, memberId, roverApiKey) {
  const apiUrl = `https://registry.rover.link/api/guilds/${guildId}/discord-to-roblox/${memberId}`;
  const response = await axios.get(apiUrl, {
    headers: {
      Authorization: `Bearer ${roverApiKey}`,
      Accept: 'application/json',
    },
  });
  return response.data?.robloxId;
}

function registerVerifierHandler(client) {
  const config = getVerifierConfig();

  if (!hasRequiredConfig(config)) {
    console.warn('⚠️ Verifier handler disabled: missing environment variables');
    return;
  }

  client.once(Events.ClientReady, async () => {
    try {
      await initRoblox(config);
    } catch (err) {
      console.error('❌ Roblox Auth Error:', err.message);
    }
  });

  client.on(Events.GuildMemberUpdate, async (oldMember, newMember) => {
    const gainedVerified = !oldMember.roles.cache.has(config.roleIdVerified) && newMember.roles.cache.has(config.roleIdVerified);
    const gainedUnverified = !oldMember.roles.cache.has(config.roleIdUnverified) && newMember.roles.cache.has(config.roleIdUnverified);

    if (!gainedVerified && !gainedUnverified) return;
    if (!robloxInitialized) return;

    const targetRank = gainedVerified ? config.rankIdVerified : config.rankIdUnverified;

    promotionQueue.push({ config, newMember, targetRank });
    processQueue(client);
  });
}

module.exports = { registerVerifierHandler };