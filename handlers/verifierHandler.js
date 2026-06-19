const { Events } = require('discord.js');
const noblox = require('noblox.js');
const axios = require('axios');
const constants = require('../config/constants');
const { buildPSLEmbed } = require('../utils/embedHelpers');

const DEFAULT_GROUP_ID = 151319009;
const DEFAULT_ROLE_ID_VERIFIED = '1480572500315209870';
const DEFAULT_RANK_ID_VERIFIED = 3;
const DEFAULT_ROLE_ID_UNVERIFIED = '1480574659459022890';
const DEFAULT_RANK_ID_UNVERIFIED = 2;
const LOG_CHANNEL_ID = '1492610327190179940';

let robloxInitialized = false;
let promotionQueue = [];
let isProcessing = false;
let cachedGroupRoles = null;

process.on('unhandledRejection', (reason) => console.error('[FATAL ERROR] Unhandled Rejection:', reason));
process.on('uncaughtException', (error) => console.error('[FATAL ERROR] Uncaught Exception:', error));

const handleShutdown = () => {
  if (promotionQueue.length > 0) {
    console.warn(`[verifierHandler.js] Process ended with ${promotionQueue.length} items pending on queue.`);
  }
  process.exit(0);
};

process.on('SIGINT', handleShutdown);
process.on('SIGTERM', handleShutdown);

async function withRetry(fn, maxRetries = 3, delayMs = 5000) {
  for (let retries = 0; retries < maxRetries; retries++) {
    try {
      return await fn();
    } catch (error) {
      const status = error.response?.status || error.statusCode;
      if (status >= 400 && status < 500 && status !== 429) {
        throw error;
      }
      if (retries === maxRetries - 1) throw error;
      await new Promise((res) => setTimeout(res, delayMs));
    }
  }
}

async function sendLog(client, embed) {
  try {
    const channel = await client.channels.fetch(LOG_CHANNEL_ID);
    if (channel?.isTextBased()) await channel.send({ embeds: [embed] }).catch(() => {});
  } catch (err) {
    console.error('[verifierHandler.js] Failed to send log to channel:', err.message);
  }
}

async function getGroupRoles(groupId) {
  if (!cachedGroupRoles) {
    cachedGroupRoles = await withRetry(() => noblox.getRoles(groupId));
  }
  return cachedGroupRoles;
}

async function fetchRobloxUserId(guildId, memberId, roverApiKey) {
  const apiUrl = `https://registry.rover.link/api/guilds/${guildId}/discord-to-roblox/${memberId}`;
  try {
    const response = await axios.get(apiUrl, {
      headers: { Authorization: `Bearer ${roverApiKey}`, Accept: 'application/json' },
    });
    return response.data?.robloxId;
  } catch (error) {
    if (error.response && error.response.status === 404) {
      return null;
    }
    throw error;
  }
}

async function processQueue(client) {
  if (isProcessing || promotionQueue.length === 0) return;

  isProcessing = true;

  while (promotionQueue.length > 0) {
    const { config, newMember, targetRank } = promotionQueue.shift();

    try {
      const robloxId = await withRetry(() =>
        fetchRobloxUserId(newMember.guild.id, newMember.id, config.roverApiKey)
      );

      if (!robloxId) {
        console.warn(
          `[verifierHandler.js] No Roblox account linked for Discord user ${newMember.user.tag} (${newMember.id})`
        );
        const missingRobloxEmbed = buildPSLEmbed(client, '#F0B232')
          .setTitle('⚠️ Promotion Skipped: No Roblox Account Linked')
          .setDescription(`Could not find a Roblox account linked via Rover for ${newMember.user}.`)
          .addFields(
            { name: 'Discord User', value: `${newMember.user.tag} (${newMember.id})`, inline: false },
            { name: 'Guild', value: `${newMember.guild.name} (${newMember.guild.id})`, inline: false },
            { name: 'Target Rank', value: `${targetRank}`, inline: true }
          );
        await sendLog(client, missingRobloxEmbed);
        continue;
      }

      const currentRankNumber = await withRetry(() =>
        noblox.getRankInGroup(config.groupId, robloxId)
      );

      if (currentRankNumber !== 0 && currentRankNumber !== targetRank) {
        const robloxUsername = await withRetry(() => noblox.getUsernameFromId(robloxId));
        const groupRoles = await getGroupRoles(config.groupId);
        const targetRoleName = groupRoles.find((r) => r.rank === targetRank)?.name || 'Unknown';
        const currentRoleName = groupRoles.find((r) => r.rank === currentRankNumber)?.name || 'Unknown';

        await withRetry(() => noblox.setRank(config.groupId, robloxId, targetRank));

        const successEmbed = buildPSLEmbed(client, constants.SUCCESS_COLOR)
          .setTitle('✅ Successfully Promoted')
          .setThumbnail(client.user.displayAvatarURL())
          .addFields(
            { name: '👤 Discord User', value: `**${newMember.user.username}**`, inline: true },
            { name: '🆔 Discord ID', value: `\`${newMember.id}\``, inline: true },
            { name: '\u200B', value: '\u200B', inline: true },
            {
              name: '🎮 Roblox Name',
              value: `[${robloxUsername}](https://www.roblox.com/users/${robloxId}/profile)`,
              inline: true,
            },
            { name: '🆔 Roblox ID', value: `\`${robloxId}\``, inline: true },
            { name: '\u200B', value: '\u200B', inline: true },
            {
              name: '🔑 Rank Update',
              value: `\`${currentRoleName} (${currentRankNumber})\` ➔ **${targetRoleName} (${targetRank})**`,
              inline: false,
            }
          );

        await sendLog(client, successEmbed);
        console.log(
          `[verifierHandler.js] ✅ Promoted ${newMember.user.tag} to ${targetRoleName} (${targetRank})`
        );
      }
    } catch (err) {
      console.error('[verifierHandler.js] Promotion error:', err.message);
      const errorEmbed = buildPSLEmbed(client, constants.ERROR_COLOR)
        .setTitle('❌ Critical Sync Failure')
        .setThumbnail(newMember.user.displayAvatarURL({ dynamic: true }))
        .addFields(
          { name: '👤 Affected User', value: `${newMember.user}`, inline: true },
          { name: '🆔 Discord ID', value: `\`${newMember.id}\``, inline: true },
          { name: '\u200B', value: '\u200B', inline: true },
          { name: '⚠️ Error Details', value: `\`\`\`${err.message}\`\`\``, inline: false },
          { name: '📊 Status Code', value: `\`${err.response?.status || err.statusCode || '500'}\``, inline: true },
          { name: '🛠️ Action', value: '`Retries Exhausted`', inline: true }
        );

      await sendLog(client, errorEmbed);
    }

    await new Promise((res) => setTimeout(res, 10000));
  }

  isProcessing = false;
  processQueue(client);
}

function parseIntEnv(name) {
  const raw = process.env[name];
  if (!raw) return null;
  const parsed = parseInt(raw, 10);
  return isNaN(parsed) ? null : parsed;
}

function getVerifierConfig() {
  return {
    robloxCookie: process.env.ROBLOX_COOKIE,
    roverApiKey: process.env.ROVER_API_KEY,
    groupId: parseIntEnv('GROUP_ID') || DEFAULT_GROUP_ID,
    roleIdVerified: process.env.ROLE_ID_VERIFIED || DEFAULT_ROLE_ID_VERIFIED,
    roleIdUnverified: process.env.ROLE_ID_UNVERIFIED || DEFAULT_ROLE_ID_UNVERIFIED,
    rankIdVerified: parseIntEnv('RANK_ID_VERIFIED') || DEFAULT_RANK_ID_VERIFIED,
    rankIdUnverified: parseIntEnv('RANK_ID_UNVERIFIED') || DEFAULT_RANK_ID_UNVERIFIED,
  };
}

function registerVerifierHandler(client) {
  const config = getVerifierConfig();

  if (!config.robloxCookie || !config.roverApiKey || !config.groupId) {
    console.warn('[verifierHandler.js] Missing API keys or Group ID. Verification disabled.');
    return;
  }

  client.once(Events.ClientReady, async () => {
    try {
      await noblox.setCookie(config.robloxCookie);
      robloxInitialized = true;
      console.log('[verifierHandler.js] ✅ Authenticated with Roblox API.');
    } catch (err) {
      console.error('[verifierHandler.js] Roblox authentication error:', err.message);
    }
  });

  client.on(Events.GuildMemberUpdate, async (oldMember, newMember) => {
    try {
      const gainedVerified =
        !oldMember.roles.cache.has(config.roleIdVerified) &&
        newMember.roles.cache.has(config.roleIdVerified);
      const gainedUnverified =
        !oldMember.roles.cache.has(config.roleIdUnverified) &&
        newMember.roles.cache.has(config.roleIdUnverified);

      if ((gainedVerified || gainedUnverified) && robloxInitialized) {
        const targetRank = gainedVerified ? config.rankIdVerified : config.rankIdUnverified;
        console.log(
          `[verifierHandler.js] 📝 Queuing promotion for ${newMember.user.tag} to rank ${targetRank}`
        );
        promotionQueue.push({ config, newMember, targetRank });
        processQueue(client);
      }
    } catch (err) {
      console.error('[verifierHandler.js] Error in GuildMemberUpdate:', err.message);
    }
  });
}

module.exports = { registerVerifierHandler };