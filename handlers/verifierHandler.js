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
let cachedGroupRoles = null;

process.on('unhandledRejection', (reason) => console.error('[FATAL ERROR] Unhandled Rejection:', reason));
process.on('uncaughtException', (error) => console.error('[FATAL ERROR] Uncaught Exception:', error));

const handleShutdown = () => {
  if (promotionQueue.length > 0) {
    console.warn(`[SHUTDOWN WARN] Process ended with ${promotionQueue.length} items pending on queue.`);
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
      await new Promise(res => setTimeout(res, delayMs));
    }
  }
}

async function sendLog(client, embed) {
  try {
    const channel = await client.channels.fetch(LOG_CHANNEL_ID);
    if (channel?.isTextBased()) await channel.send({ embeds: [embed] }).catch(() => { });
  } catch (err) {
    console.error('[LOG ERROR] Fail sending log to channel:', err.message);
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
      const robloxId = await withRetry(() => fetchRobloxUserId(newMember.guild.id, newMember.id, config.roverApiKey));

      if (robloxId) {
        const currentRankNumber = await withRetry(() => noblox.getRankInGroup(config.groupId, robloxId));

        if (currentRankNumber !== 0 && currentRankNumber !== targetRank) {
          const robloxUsername = await withRetry(() => noblox.getUsernameFromId(robloxId));
          const groupRoles = await getGroupRoles(config.groupId);

          const targetRoleName = groupRoles.find(r => r.rank === targetRank)?.name || 'Unknown';
          const currentRoleName = groupRoles.find(r => r.rank === currentRankNumber)?.name || 'Unknown';

          await withRetry(() => noblox.setRank(config.groupId, robloxId, targetRank));

          const successEmbed = new EmbedBuilder()
            .setColor('#7CB559')
            .setAuthor({
              name: 'System Promotion Management',
              iconURL: client.user.displayAvatarURL()
            })
            .setTitle('✅ Successfully Promoted')
            .setThumbnail(client.user.displayAvatarURL())
            .addFields(
              { name: '👤 Discord User', value: `**${message.author.username}**`, inline: true },
              { name: '🆔 Discord ID', value: `\`${message.author.id}\``, inline: true },
              { name: '\u200B', value: '\u200B', inline: true },
              { name: '🎮 Roblox Name', value: `[${robloxUsername}](https://roblox.com{robloxId}/profile)`, inline: true },
              { name: '🆔 Roblox ID', value: `\`${robloxId}\``, inline: true },
              { name: '\u200B', value: '\u200B', inline: true },
              { name: '🔑 Rank Update', value: `\`${currentRoleName} (${currentRankNumber})\` ➔ **${targetRoleName} (${targetRank})**`, inline: false }
            )
            .setFooter({
              text: 'Promoted by PSL Verification System',
              iconURL: client.user.displayAvatarURL()
            })
            .setTimestamp();

          await sendLog(client, successEmbed);
        }
      }
    } catch (err) {
      const errorEmbed = new EmbedBuilder()
        .setColor('#DE3449')
        .setAuthor({
          name: 'System Promotion Management',
          iconURL: client.user.displayAvatarURL()
        })
        .setTitle('❌ Critical Sync Failure')
        .setThumbnail(newMember.user.displayAvatarURL({ dynamic: true }))
        .addFields(
          { name: '👤 Affected User', value: `${newMember.user}`, inline: true },
          { name: '🆔 Discord ID', value: `\`${newMember.id}\``, inline: true },
          { name: '\u200B', value: '\u200B', inline: true },
          { name: '⚠️ Error Details', value: `\`\`\`x86asm\n${err.message}\n\`\`\``, inline: false },
          { name: '📊 Status Code', value: `\`${err.response?.status || err.statusCode || '500'}\``, inline: true },
          { name: '🛠️ Action', value: '`Auto-Retry Initiated`', inline: true }
        )
        .setFooter({
          text: 'Attempted by PSL Verification System',
          iconURL: client.user.displayAvatarURL()
        })
        .setTimestamp();

      await sendLog(client, errorEmbed);
    }

    await new Promise(res => setTimeout(res, 10000));
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
    console.warn('[SYSTEM WARN] Missing API keys or Group ID. Verification disabled.');
    return;
  }

  client.once(Events.ClientReady, async () => {
    try {
      await noblox.setCookie(config.robloxCookie);
      robloxInitialized = true;
      console.log('[SYSTEM] Authenticated with Roblox API.');
    } catch (err) {
      console.error('[FATAL ERROR] Roblox Auth Error:', err.message);
    }
  });

  client.on(Events.GuildMemberUpdate, async (oldMember, newMember) => {
    const gainedVerified = !oldMember.roles.cache.has(config.roleIdVerified) && newMember.roles.cache.has(config.roleIdVerified);
    const gainedUnverified = !oldMember.roles.cache.has(config.roleIdUnverified) && newMember.roles.cache.has(config.roleIdUnverified);

    if ((gainedVerified || gainedUnverified) && robloxInitialized) {
      const targetRank = gainedVerified ? config.rankIdVerified : config.rankIdUnverified;
      promotionQueue.push({ config, newMember, targetRank });
      processQueue(client);
    }
  });
}

module.exports = { registerVerifierHandler };