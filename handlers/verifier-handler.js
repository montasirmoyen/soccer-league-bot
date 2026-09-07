const { Events } = require('discord.js');
const axios = require('axios');
const constants = require('../config/constants');
const { buildPSLEmbed } = require('../utils/embed-helpers');
const { logError, SystemError } = require('../utils/error-handler');
const { syncMemberRoles, buildVerificationRoleChangePlan } = require('../utils/discord-helpers');

const APP_CONFIG = {
  groupId: 151319009,

  discord: {
    registeredRole: constants.REGISTERED_ROLE_ID,
    unverifiedRole: constants.UNVERIFIED_ROLE_ID
  },

  roblox: {
    registeredRole: { id: '655167005', name: 'Registered', rank: 3 },
    unverifiedRole: { id: '467994038', name: 'Unverified', rank: 2 }
  }
};

const KNOWN_ROBLOX_ROLES = new Map([
  [APP_CONFIG.roblox.registeredRole.id, APP_CONFIG.roblox.registeredRole],
  [APP_CONFIG.roblox.unverifiedRole.id, APP_CONFIG.roblox.unverifiedRole]
]);

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
  } catch (error) {
    await logError(new SystemError(error.message, 'VERIFIER_SEND_LOG_FAIL'), client);
  }
}

function getDiscordTarget(roleIds, registeredRoleId, unverifiedRoleId) {
  const hasRegisteredRole = roleIds.includes(registeredRoleId);
  const hasUnverifiedRole = roleIds.includes(unverifiedRoleId);

  if (hasRegisteredRole && hasUnverifiedRole) return null;
  if (hasRegisteredRole) return APP_CONFIG.roblox.registeredRole;
  if (hasUnverifiedRole) return APP_CONFIG.roblox.unverifiedRole;
  return null;
}

function isKnownTargetRole(targetRole) {
  return Boolean(targetRole && KNOWN_ROBLOX_ROLES.get(targetRole.id) === targetRole);
}

function enqueuePromotion(newMember, targetRole) {
  promotionQueue = promotionQueue.filter(({ newMember: queuedMember }) => queuedMember.id !== newMember.id);
  promotionQueue.push({ newMember, targetRole });
}

async function sendPromotionSkippedLog(client, newMember, targetRole, reason, robloxData = null) {
  if (targetRole.rank !== APP_CONFIG.roblox.registeredRole.rank) return;

  const details = robloxData?.id
    ? `Roblox: ${robloxData.username} (${robloxData.id})`
    : 'Roblox account: not linked';
  const skipEmbed = buildPSLEmbed(client, constants.WARNING_COLOR)
    .setTitle('Promotion skipped')
    .setDescription(`${newMember.user.tag} was not promoted to ${targetRole.name} (${targetRole.rank}).`)
    .addFields({ name: 'Reason', value: reason }, { name: 'Details', value: details });

  await sendLog(client, skipEmbed);
}

async function getRobloxUserProfile(robloxUsername) {
  try {
    const userLookupUrl = `https://users.roblox.com/v1/usernames/users`;

    const userLookupRes = await axios.post(userLookupUrl,
      {
        usernames: [robloxUsername]
      },
      {
        headers: {
          'x-api-key': apiKey,
          'Content-Type': 'application/json'
        }
      }
    );

    console.log(userLookupRes.data.data[0]);
    return userLookupRes.data.data[0];
  } catch (err) {
    console.error(`❌ Failed looking up username "${robloxUsername}":`, err.response?.data || err.message);
    return null;
  }
}

async function getGroupMembership(robloxUserId) {
  const url = `https://apis.roblox.com/cloud/v2/groups/${APP_CONFIG.groupId}/memberships`;
  try {
    const response = await axios.get(url, {
      params: { filter: `user=='users/${robloxUserId}'` },
      headers: { 'x-api-key': apiKey }
    });

    const memberships = response.data.groupMemberships;
    return (memberships && memberships.length > 0) ? memberships[0] : null;
  } catch (error) {
    console.error(`❌ Error looking up membership for Roblox user ${robloxUserId}: ${error.message}`);
    return null;
  }
}

async function updateGroupRoleset(membershipPath, targetRoleId, action) {
  const allowedActions = ['assignRole', 'unassignRole'];
  if (!allowedActions.includes(action)) {
    throw new Error(`Invalid action. Must be one of: ${allowedActions.join(', ')}`);
  }

  const url = `https://apis.roblox.com/cloud/v2/${membershipPath}:${action}`;

  try {
    const response = await axios.post(
      url,
      {
        role: `groups/${APP_CONFIG.groupId}/roles/${targetRoleId}`
      },
      {
        headers: {
          'x-api-key': apiKey,
          'Content-Type': 'application/json'
        }
      }
    );

    return { success: true, data: response.data };
  } catch (error) {
    const status = error.response?.status;
    const message = error.response?.data?.message?.toLowerCase() || "";

    if (action === 'assignRole' && (status === 409 || message.includes("already"))) {
      return { success: true, alreadyOwned: true };
    }
    if (action === 'unassignRole' && (status === 404 || message.includes("not found"))) {
      return { success: true, notAssigned: true };
    }

    throw error;
  }
}

async function processQueue(client) {
  if (isProcessing || promotionQueue.length === 0) return;

  isProcessing = true;

  while (promotionQueue.length > 0) {
    const { newMember, targetRole } = promotionQueue.shift();

    try {
      if (!newMember?.guild || !newMember.user || !isKnownTargetRole(targetRole)) {
        console.warn('[verifier-handler.js] Refusing malformed promotion queue item.');
        continue;
      }

      const memberGuildDisplayName = newMember.displayName
      console.log(memberGuildDisplayName);

      const robloxData = await withRetry(() =>
        getRobloxUserProfile(memberGuildDisplayName)
      );

      if (!robloxData || !robloxData.id) {
        console.warn(`[verifier-handler.js] No linked Roblox account found for Discord user ${newMember.user.tag}`);
        await sendPromotionSkippedLog(client, newMember, targetRole, 'Could not fetch Roblox profile.');
        continue;
      }

      const robloxId = robloxData.id;
      const robloxUsername = robloxData.username;

      const membership = await withRetry(() =>
        getGroupMembership(robloxId)
      );

      if (!membership) {
        console.warn(`[verifier-handler.js] User ${robloxId} is not in group ${APP_CONFIG.groupId}`);
        await sendPromotionSkippedLog(client, newMember, targetRole, 'The Roblox user is not in the configured group.', robloxData);
        continue;
      }

      if (typeof membership.role !== 'string' || !membership.role.trim()) {
        console.warn(`[verifier-handler.js] Refusing promotion with missing Roblox role for ${newMember.user.tag}`);
        await sendPromotionSkippedLog(client, newMember, targetRole, 'The Roblox membership has no valid current role.', robloxData);
        continue;
      }

      const currentRoleId = membership.role.split('/').pop();

      if (currentRoleId && !KNOWN_ROBLOX_ROLES.has(currentRoleId)) {
        console.warn(`[verifier-handler.js] Refusing to overwrite unknown Roblox role ${currentRoleId} for ${newMember.user.tag}`);
        await sendPromotionSkippedLog(client, newMember, targetRole, `Unknown current Roblox role (${currentRoleId}).`, robloxData);
        continue;
      }

      if (currentRoleId && currentRoleId !== targetRole.id) {
        const currentRole = KNOWN_ROBLOX_ROLES.get(currentRoleId);

        await withRetry(() =>
          updateGroupRoleset(membership.path, targetRole.id, 'assignRole')
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
            { name: '🔑 Rank Update', value: `\`${currentRole.name} (${currentRole.rank})\` ➔ **${targetRole.name} (${targetRole.rank})**`, inline: false }
          );

        await sendLog(client, successEmbed);
      }
    } catch (err) {
      await logError(err, client, {
        context: 'ROBLOX_API_PROMOTION_ERROR_V2',
        userId: newMember.id,
        userTag: newMember.user.tag,
        targetRoleId: targetRole.id,
        robloxResponse: err.response?.data,
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
    processQueue(client);
  }
}

function registerVerifierHandler(client) {
  client.once(Events.ClientReady, () => {
    console.log('[verifier-handler.js] 🌐 Roblox Open Cloud API Engine (v2) initialized.');
  });

  client.on(Events.GuildMemberUpdate, async (oldMember, newMember) => {
    try {
      if (!newMember?.guild || !newMember.user) return;

      const currentRoleIds = [...newMember.roles.cache.keys()];
      const previousRoleIds = [...oldMember.roles.cache.keys()];

      const currentHasRegistered = currentRoleIds.includes(APP_CONFIG.discord.registeredRole);
      const currentHasUnverified = currentRoleIds.includes(APP_CONFIG.discord.unverifiedRole);
      const previousHasRegistered = previousRoleIds.includes(APP_CONFIG.discord.registeredRole);
      const previousHasUnverified = previousRoleIds.includes(APP_CONFIG.discord.unverifiedRole);

      if ((currentHasRegistered && currentHasUnverified) || (previousHasRegistered && previousHasUnverified)) {
        console.warn(`[verifier-handler.js] Refusing ambiguous verification roles for ${newMember.user.tag}`);
        return;
      }

      const currentTarget = getDiscordTarget(currentRoleIds, APP_CONFIG.discord.registeredRole, APP_CONFIG.discord.unverifiedRole);
      const previousTarget = getDiscordTarget(previousRoleIds, APP_CONFIG.discord.registeredRole, APP_CONFIG.discord.unverifiedRole);

      const hasRoleTransition = isKnownTargetRole(currentTarget) && currentTarget.id !== previousTarget?.id;
      if (hasRoleTransition) {
        const plan = buildVerificationRoleChangePlan(currentRoleIds, currentTarget?.id, {
          registeredRoleId: APP_CONFIG.discord.registeredRole,
          unverifiedRoleId: APP_CONFIG.discord.unverifiedRole,
        });

        await syncMemberRoles(newMember, plan);

        console.log(`[verifier-handler.js] 📝 Queuing Open Cloud API v2 sync for ${newMember.user.tag}`);
        enqueuePromotion(newMember, currentTarget);
        processQueue(client).catch((error) =>
          logError(error, client, { context: 'ROBLOX_PROMOTION_QUEUE_ERROR' })
        );
      }
    } catch (err) {
      await logError(err, client, { context: 'GUILD_MEMBER_UPDATE_EVENT_FAIL', userId: newMember?.id });
    }
  });
}

module.exports = { registerVerifierHandler };