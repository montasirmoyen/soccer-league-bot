const { Events } = require('discord.js');
const axios = require('axios');
const constants = require('../config/constants');
const { buildPSLEmbed } = require('../utils/embed-helpers');
const { logError, SystemError } = require('../utils/error-handler');

const APP_CONFIG = {
  groupId: 151319009,

  discord: {
    registeredRole: '1480572500315209870',
    unverifiedRole: '1480574659459022890'
  },

  roblox: {
    registeredRole: { id: '655167005', name: 'Registered', rank: 1 },
    unverifiedRole: { id: '467994038', name: 'Unverified', rank: 0 }
  }
};

let promotionQueue = [];
let isProcessing = false;

process.on('unhandledRejection', (reason) => logError(reason, null, { context: 'GLOBAL_UNHANDLED_REJECTION' }));
process.on('uncaughtException', (error) => logError(error, null, { context: 'GLOBAL_UNCAUGHT_EXCEPTION' }));

async function withRetry(func, maxRetries = 3, delayMs = 5000) {
  for (let retries = 0; retries < maxRetries; retries++) {
    try {
      return await func();
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
    const verifyLogChannel = await client.channels.fetch(constants.VERIFICATION_LOG_CHANNEL_ID);
    if (verifyLogChannel?.isTextBased()) await verifyLogChannel.send({ embeds: [embed] }).catch(() => { });
  } catch (err) {
    logError(new SystemError(err.message, 'VERIFIER_SEND_LOG_FAIL'), client);
  }
}

async function fetchRobloxUserData(guildId, memberId, roverApiKey) {
  const apiUrl = `https://registry.rover.link/api/guilds/${guildId}/discord-to-roblox/${memberId}`;
  try {
    const response = await axios.get(apiUrl, {
      headers: { Authorization: `Bearer ${roverApiKey}`, Accept: 'application/json' },
    });
    return {
      id: response.data?.robloxId,
      username: response.data?.cachedUsername || 'Unknown'
    };
  } catch (error) {
    if (error.response && error.response.status === 404) {
      return null;
    }
    throw error;
  }
}

async function getRobloxMembership(groupId, robloxId, apiKey) {
  const url = `https://apis.roblox.com/cloud/v2/groups/${groupId}/memberships`;

  const response = await axios.get(url, {
    headers: { 'x-api-key': apiKey },
    params: {
      maxPageSize: 1,
      filter: `user == 'users/${robloxId}'`
    }
  });

  const memberships = response.data?.groupMemberships;
  if (!memberships || memberships.length === 0) {
    return null;
  }

  return memberships[0];
}

async function updateRobloxRole(groupId, membershipPath, targetRoleId, apiKey) {
  const url = `https://apis.roblox.com/cloud/v2/${membershipPath}`;

  const body = {
    role: `groups/${groupId}/roles/${targetRoleId}`
  };

  await axios.patch(url, body, {
    headers: {
      'x-api-key': apiKey,
      'Content-Type': 'application/json'
    }
  });
}

async function processQueue(client, keys) {
  if (isProcessing || promotionQueue.length === 0) return;

  isProcessing = true;

  while (promotionQueue.length > 0) {
    const { newMember, targetRole } = promotionQueue.shift();

    try {
      const robloxData = await withRetry(() =>
        fetchRobloxUserData(newMember.guild.id, newMember.id, keys.roverApiKey)
      );

      if (!robloxData || !robloxData.id) {
        console.warn(`[verifier-handler.js] No linked Roblox account found for Discord user ${newMember.user.tag}`);
        const missingRobloxEmbed = buildPSLEmbed(client, constants.WARNING_COLOR)
          .setTitle('⚠️ Promotion Skipped: No Roblox Account Linked')
          .setDescription(`Could not find a Roblox account linked via Rover for ${newMember.user}.`)
          .addFields(
            { name: 'Discord User', value: `${newMember.user.tag} (${newMember.id})`, inline: false },
            { name: 'Guild', value: `${newMember.guild.name} (${newMember.guild.id})`, inline: false },
            { name: 'Target Rank', value: `${targetRole.rank}`, inline: true }
          );
        await sendLog(client, missingRobloxEmbed);
        continue;
      }

      const robloxId = robloxData.id;
      const robloxUsername = robloxData.username;

      const membership = await withRetry(() =>
        getRobloxMembership(APP_CONFIG.groupId, robloxId, keys.robloxApiKey)
      );

      if (!membership) {
        console.warn(`[verifier-handler.js] User ${robloxId} is not in group ${APP_CONFIG.groupId}`);
        continue;
      }

      const currentRoleId = membership.role ? membership.role.split('/').pop() : null;

      if (currentRoleId && currentRoleId !== targetRole.id) {
        let currentRoleName = 'Unknown';
        let currentRankNumber = '?';

        if (currentRoleId === APP_CONFIG.roblox.registeredRole.id) {
          currentRoleName = APP_CONFIG.roblox.registeredRole.name;
          currentRankNumber = APP_CONFIG.roblox.registeredRole.rank;
        } else if (currentRoleId === APP_CONFIG.roblox.unverifiedRole.id) {
          currentRoleName = APP_CONFIG.roblox.unverifiedRole.name;
          currentRankNumber = APP_CONFIG.roblox.unverifiedRole.rank;
        }

        await withRetry(() =>
          updateRobloxRole(APP_CONFIG.groupId, membership.path, targetRole.id, keys.robloxApiKey)
        );

        console.log(`[verifier-handler.js] ✅ Successfully updated Roblox role (v2) for ${newMember.user.tag}`);

        const successEmbed = buildPSLEmbed(client, constants.SUCCESS_COLOR)
          .setTitle('✅ Successfully Promoted')
          .setThumbnail(client.user.displayAvatarURL())
          .addFields(
            { name: '👤 Discord User', value: `**${newMember.user.username}**`, inline: true },
            { name: '🆔 Discord ID', value: `\`${newMember.id}\``, inline: true },
            { name: '\u200B', value: '\u200B', inline: true },
            { name: '🎮 Roblox Name', value: `[${robloxUsername}](https://www.roblox.com/users/${robloxId}/profile)`, inline: true },
            { name: '🆔 Roblox ID', value: `\`${robloxId}\``, inline: true },
            { name: '\u200B', value: '\u200B', inline: true },
            { name: '🔑 Rank Update', value: `\`${currentRoleName} (${currentRankNumber})\` ➔ **${targetRole.name} (${targetRole.rank})**`, inline: false }
          );

        await sendLog(client, successEmbed);
      }
    } catch (err) {
      logError(err, client, {
        context: 'ROBLOX_API_PROMOTION_ERROR_V2',
        userId: newMember.id,
        userTag: newMember.user.tag,
        targetRoleId: targetRole.id,
        robloxResponse: err.response?.data
      });

      const errorEmbed = buildPSLEmbed(client, constants.ERROR_COLOR)
        .setTitle('❌ Critical Sync Failure (Open Cloud v2)')
        .setDescription(`\`\`\`${err.message}\`\`\``);
      await sendLog(client, errorEmbed);
    }

    await new Promise((res) => setTimeout(res, 3000));
  }

  isProcessing = false;

  if (promotionQueue.length > 0) {
    processQueue(client, keys);
  }
}

function registerVerifierHandler(client) {
  const keys = {
    robloxApiKey: process.env.ROBLOX_API_KEY,
    roverApiKey: process.env.ROVER_API_KEY,
  };

  if (!keys.robloxApiKey || !keys.roverApiKey) {
    console.warn('[verifier-handler.js] ⚠️ Missing sensitive API keys in .env. Verification disabled.');
    return;
  }

  client.once(Events.ClientReady, () => {
    console.log('[verifier-handler.js] 🌐 Roblox Open Cloud Engine (v2) initialized.');
  });

  client.on(Events.GuildMemberUpdate, async (oldMember, newMember) => {
    try {
      const isRegistered = newMember.roles.cache.has(APP_CONFIG.discord.registeredRole);
      const isUnverified = newMember.roles.cache.has(APP_CONFIG.discord.unverifiedRole);

      const wasRegistered = oldMember.roles.cache.has(APP_CONFIG.discord.registeredRole);
      const wasUnverified = oldMember.roles.cache.has(APP_CONFIG.discord.unverifiedRole);

      let currentTarget = null;
      if (isRegistered) {
        currentTarget = APP_CONFIG.roblox.registeredRole;
      } else if (isUnverified) {
        currentTarget = APP_CONFIG.roblox.unverifiedRole;
      }

      let previousTarget = null;
      if (wasRegistered) {
        previousTarget = APP_CONFIG.roblox.registeredRole;
      } else if (wasUnverified) {
        previousTarget = APP_CONFIG.roblox.unverifiedRole;
      }

      if (currentTarget && currentTarget.id !== previousTarget?.id) {
        console.log(`[verifier-handler.js] 📝 Queuing Open Cloud v2 sync for ${newMember.user.tag}`);
        promotionQueue.push({ newMember, targetRole: currentTarget });
        processQueue(client, keys);
      }
    } catch (err) {
      logError(err, client, { context: 'GUILD_MEMBER_UPDATE_EVENT_FAIL', userId: newMember?.id });
    }
  });
}

module.exports = { registerVerifierHandler };