require('dotenv').config();

const { Client, GatewayIntentBits, Events, Partials } = require('discord.js');
const axios = require('axios');
const constants = require('../config/constants');
const { buildPSLEmbed } = require('../utils/embed-helpers');
const { logError, SystemError } = require('../utils/error-handler');
const { syncMemberRoles, buildVerificationRoleChangePlan } = require('../utils/discord-helpers');

const REQUIRED_ENV_VARS = ['DISCORD_TOKEN', 'ROBLOX_API_KEY'];
for (const key of REQUIRED_ENV_VARS) {
  if (!process.env[key]) {
    throw new Error(`[verifier-handler.js] Missing required env var: ${key}`);
  }
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers
  ],
  partials: [
    Partials.GuildMember,
    Partials.User
  ]
});

const APP_CONFIG = {
  groupId: 151319009,

  discord: {
    unverifiedRole: constants.UNVERIFIED_ROLE_ID,
    registeredRole: constants.REGISTERED_ROLE_ID,
    assistantManagerRole: constants.ASSISTANT_MANAGER_ROLE_ID,
    managerRole: constants.MANAGER_ROLE_ID,
    mediaRole: constants.MEDIA_ROLE_ID,
    refereeRole: constants.REFEREE_ROLE_ID,
    moderatorRole: constants.MODERATOR_ROLE_ID,
    staffRole: constants.STAFF_ROLE_ID,
    overseerRole: constants.OVERSEER_ROLE_ID,
  },

  roblox: {
    unverifiedRole: { id: '467994038', name: 'Unverified', rank: 2 },
    registeredRole: { id: '655167005', name: 'Registered', rank: 3 },
    teamManagementRole: { id: '466820038', name: 'Team Management', rank: 50 },
    mediaRole: { id: '692453049', name: 'Media', rank: 100 },
    refereeRole: { id: '468518027', name: 'Referee', rank: 150 },
    moderatorRole: { id: '692831042', name: 'Moderator', rank: 251 },
    staffRole: { id: '466720029', name: 'Staff', rank: 252 },
    overseerRole: { id: '468116031', name: 'Overseer', rank: 253 }
  }
};

const KNOWN_ROBLOX_ROLES = new Map([
  [APP_CONFIG.roblox.registeredRole.id, APP_CONFIG.roblox.registeredRole],
  [APP_CONFIG.roblox.unverifiedRole.id, APP_CONFIG.roblox.unverifiedRole],
  [APP_CONFIG.roblox.mediaRole.id, APP_CONFIG.roblox.mediaRole],
  [APP_CONFIG.roblox.teamManagementRole.id, APP_CONFIG.roblox.teamManagementRole],
  [APP_CONFIG.roblox.refereeRole.id, APP_CONFIG.roblox.refereeRole],
  [APP_CONFIG.roblox.moderatorRole.id, APP_CONFIG.roblox.moderatorRole],
  [APP_CONFIG.roblox.staffRole.id, APP_CONFIG.roblox.staffRole],
  [APP_CONFIG.roblox.overseerRole.id, APP_CONFIG.roblox.overseerRole]
]);

const DISCORD_TO_ROBLOX_MAP = [
  { roblox: APP_CONFIG.roblox.registeredRole, discord: [APP_CONFIG.discord.registeredRole] },
  { roblox: APP_CONFIG.roblox.unverifiedRole, discord: [APP_CONFIG.discord.unverifiedRole] },
  {
    roblox: APP_CONFIG.roblox.teamManagementRole,
    discord: [
      APP_CONFIG.discord.managerRole,
      APP_CONFIG.discord.assistantManagerRole
    ]
  },
  { roblox: APP_CONFIG.roblox.mediaRole, discord: [APP_CONFIG.discord.mediaRole] },
  { roblox: APP_CONFIG.roblox.refereeRole, discord: [APP_CONFIG.discord.refereeRole] },
  { roblox: APP_CONFIG.roblox.moderatorRole, discord: [APP_CONFIG.discord.moderatorRole] },
  { roblox: APP_CONFIG.roblox.staffRole, discord: [APP_CONFIG.discord.staffRole] },
  { roblox: APP_CONFIG.roblox.overseerRole, discord: [APP_CONFIG.discord.overseerRole] },
];

const robloxHttp = axios.create({
  timeout: 10000,
  headers: {
    'x-api-key': process.env.ROBLOX_API_KEY,
    'Content-Type': 'application/json'
  }
});

let syncQueue = [];
let isProcessing = false;

process.on('unhandledRejection', (reason) => logError(reason, null, { context: 'GLOBAL_UNHANDLED_REJECTION' }));
process.on('uncaughtException', (error) => logError(error, null, { context: 'GLOBAL_UNCAUGHT_EXCEPTION' }));

async function ensureFullMember(member) {
  if (!member) return member;

  if (member.partial) {
    console.log(`🔄 Member profile (${member.id}) is partial. Fetching full data...`);
    try {
      return await member.fetch();
    } catch (error) {
      console.error(`❌ [FETCH ERROR] It wasn't possible fetching the member ${member.id}:`, error.message);
      return member;
    }
  }
  return member;
}

async function withRetry(func, maxRetries = 3, baseDelayMs = 3000) {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await func();
    } catch (error) {
      const status = error.response?.status || error.statusCode;
      const isNonRetryableClientError = status >= 400 && status < 500 && status !== 429;

      if (isNonRetryableClientError || attempt === maxRetries - 1) throw error;

      const delay = baseDelayMs * 2 ** attempt + Math.floor(Math.random() * 500);
      await new Promise((res) => setTimeout(res, delay));
    }
  }
}

async function sendLog(client, embed) {
  try {
    const verifyLogChannel = await client.channels.fetch(constants.VERIFICATION_LOG_CHANNEL_ID);
    if (!verifyLogChannel?.isTextBased()) return;
    await verifyLogChannel.send({ embeds: [embed] });
  } catch (error) {
    await logError(new SystemError(error.message, 'VERIFIER_SEND_LOG_FAIL'), client);
  }
}

function calculateDesiredRobloxRoles(discordRoleIds) {
  const desiredRoles = [];

  for (const map of DISCORD_TO_ROBLOX_MAP) {
    const hasRequirement = map.discord.some(id => discordRoleIds.includes(id));

    if (hasRequirement) {
      desiredRoles.push(map.roblox);
    }
  }

  return desiredRoles;
}

function enqueueSync(newMember, desiredRoles) {
  syncQueue = syncQueue.filter(({ newMember: queuedMember }) => queuedMember.id !== newMember.id);
  syncQueue.push({ newMember, desiredRoles });
}

async function sendSyncSkippedLog(client, newMember, reason, robloxData = null) {
  const details = robloxData?.id
    ? `Roblox: ${robloxData.name} (${robloxData.id})`
    : 'Roblox account: not linked';

  const skipEmbed = buildPSLEmbed(client, constants.WARNING_COLOR)
    .setTitle('Sync Skipped')
    .setDescription(`${newMember.user.tag} skipped Roblox synchronization.`)
    .addFields({ name: 'Reason', value: reason }, { name: 'Details', value: details });

  await sendLog(client, skipEmbed);
}

async function getRobloxUserProfile(robloxUsername) {
  const response = await robloxHttp.post('https://users.roblox.com/v1/usernames/users', {
    usernames: [robloxUsername]
  });

  return response.data.data[0] || null;
}

async function getGroupMembership(robloxUserId) {
  const url = `https://apis.roblox.com/cloud/v2/groups/${APP_CONFIG.groupId}/memberships`;

  const response = await robloxHttp.get(url, {
    params: { filter: `user=='users/${robloxUserId}'` }
  });

  const memberships = response.data.groupMemberships;
  return memberships?.[0] || null;
}

async function updateGroupRoleset(membershipPath, targetRoleId, action) {
  const allowedActions = ['assignRole', 'unassignRole'];
  if (!allowedActions.includes(action)) {
    throw new Error(`Invalid action. Must be one of: ${allowedActions.join(', ')}`);
  }

  const url = `https://apis.roblox.com/cloud/v2/${membershipPath}:${action}`;

  try {
    const response = await robloxHttp.post(url, {
      role: `groups/${APP_CONFIG.groupId}/roles/${targetRoleId}`
    });

    return { success: true, data: response.data };
  } catch (error) {
    const status = error.response?.status;
    const message = error.response?.data?.message?.toLowerCase() || '';

    if (action === 'assignRole' && (status === 409 || message.includes('already'))) {
      return { success: true, alreadyOwned: true };
    }
    if (action === 'unassignRole' && (status === 404 || message.includes('not found'))) {
      return { success: true, notAssigned: true };
    }

    throw error;
  }
}

async function processSingleSync(client, newMember, desiredRoles) {
  if (!newMember?.guild || !newMember.user) {
    console.warn('[verifier-handler.js] Refusing malformed sync queue item.');
    return;
  }

  try {
    const memberGuildDisplayName = newMember.displayName;
    const robloxData = await withRetry(() => getRobloxUserProfile(memberGuildDisplayName));

    if (!robloxData?.id) {
      console.warn(`[verifier-handler.js] No linked Roblox account found for Discord user ${newMember.user.tag}`);
      await sendSyncSkippedLog(client, newMember, 'Could not find a linked Roblox account.');
      return;
    }

    const robloxId = robloxData.id;
    const robloxUsername = robloxData.name;

    const membership = await withRetry(() => getGroupMembership(robloxId));
    if (!membership) {
      console.warn(`[verifier-handler.js] User ${robloxId} is not in group ${APP_CONFIG.groupId}`);
      await sendSyncSkippedLog(client, newMember, 'The Roblox user is not in the configured group.', robloxData);
      return;
    }

    const assignedRolePaths = membership.roles || [];
    const assignedRoleIds = assignedRolePaths.map(r => r.split('/').pop());

    if (membership.role) {
      const primaryRoleId = membership.role.split('/').pop();
      if (primaryRoleId && !assignedRoleIds.includes(primaryRoleId)) {
        assignedRoleIds.push(primaryRoleId);
      }
    }

    const desiredRoleIds = desiredRoles.map(r => r.id);
    const rolesToAdd = desiredRoleIds.filter(id => !assignedRoleIds.includes(id));
    const rolesToRemove = assignedRoleIds.filter(id => KNOWN_ROBLOX_ROLES.has(id) && !desiredRoleIds.includes(id));

    let changesMade = false;
    const actionLog = [];

    for (const roleId of rolesToRemove) {
      await withRetry(() => updateGroupRoleset(membership.path, roleId, 'unassignRole'));
      const roleData = KNOWN_ROBLOX_ROLES.get(roleId);
      actionLog.push(`🧹 **Removed:** \`${roleData.name}\``);
      changesMade = true;
      console.log(`[verifier-handler.js] 🧹 Clearing deprecated/conflicting role '${roleData.name}' in Roblox...`);
    }

    for (const roleId of rolesToAdd) {
      await withRetry(() => updateGroupRoleset(membership.path, roleId, 'assignRole'));
      const roleData = KNOWN_ROBLOX_ROLES.get(roleId);
      actionLog.push(`✅ **Added:** \`${roleData.name}\``);
      changesMade = true;
      console.log(`[verifier-handler.js] ✅ Assigning target role '${roleData.name}' in Roblox...`);
    }

    if (!changesMade) {
      console.log('[verifier-handler.js] 🛑 Member already is with the correct synced roles. Nothing was done.');
      return;
    }

    console.log(`[verifier-handler.js] ✅ Successfully synced Roblox roles (v2) for ${newMember.user.tag}`);

    const successEmbed = buildPSLEmbed(client, constants.SUCCESS_COLOR)
      .setTitle('✅ Roblox Roles Synced')
      .setThumbnail(newMember.user.displayAvatarURL())
      .addFields(
        { name: '👤 Discord User', value: `**${newMember.user.username}**`, inline: true },
        { name: '🆔 Discord ID', value: `\`${newMember.id}\``, inline: true },
        { name: '\u200B', value: '\u200B', inline: true },
        { name: '🎮 Roblox Name', value: `[${robloxUsername}](https://www.roblox.com/users/${robloxId}/profile)`, inline: true },
        { name: '🆔 Roblox ID', value: `\`${robloxId}\``, inline: true },
        { name: '\u200B', value: '\u200B', inline: true },
        { name: '🔑 Sync Details', value: actionLog.join('\n'), inline: false }
      );

    await sendLog(client, successEmbed);
  } catch (syncError) {
    await logError(syncError, client, {
      context: 'ROBLOX_API_PROMOTION_ERROR_V2',
      userId: newMember.id,
      userTag: newMember.user.tag,
      robloxResponse: syncError.response?.data,
    });

    const errorEmbed = buildPSLEmbed(client, constants.ERROR_COLOR)
      .setTitle('❌ Critical Sync Failure (Open Cloud v2)')
      .setDescription(`\`\`\`${syncError.message}\`\`\``);
    await sendLog(client, errorEmbed);
  }
}

async function processQueue(client) {
  if (isProcessing) return;
  isProcessing = true;

  try {
    while (syncQueue.length > 0) {
      const { newMember, desiredRoles } = syncQueue.shift();
      await processSingleSync(client, newMember, desiredRoles);
      await new Promise((res) => setTimeout(res, 3000));
    }
  } finally {
    isProcessing = false;
  }
}

function registerGroupRankingHandler(client) {
  client.once(Events.ClientReady, () => {
    console.log('[verifier-handler.js] 🌐 Roblox Open Cloud API Engine (v2) initialized.');
  });

  client.on(Events.GuildMemberUpdate, async (oldMember, newMember) => {
    try {
      if (!newMember?.guild || !newMember.user) return;

      newMember = await ensureFullMember(newMember);
      if (!newMember?.guild || !newMember.user) return;

      if (!oldMember.partial) {
        const rolesChanged = !oldMember.roles.cache.equals(newMember.roles.cache);
        if (!rolesChanged) return;
      }

      const currentRoleIds = [...newMember.roles.cache.keys()];
      const previousRoleIds = oldMember.partial ? [] : [...oldMember.roles.cache.keys()];

      const currentHasReg = currentRoleIds.includes(APP_CONFIG.discord.registeredRole);
      const currentHasUnv = currentRoleIds.includes(APP_CONFIG.discord.unverifiedRole);

      if (currentHasReg && currentHasUnv) {
        console.warn(`[verifier-handler.js] Refusing ambiguous verification roles for ${newMember.user.tag}`);
        return;
      }

      const verificationTargetId = currentHasReg ? APP_CONFIG.roblox.registeredRole.id
        : currentHasUnv ? APP_CONFIG.roblox.unverifiedRole.id
          : null;

      const prevVerificationTargetId = oldMember.partial ? null
        : previousRoleIds.includes(APP_CONFIG.discord.registeredRole) ? APP_CONFIG.roblox.registeredRole.id
          : previousRoleIds.includes(APP_CONFIG.discord.unverifiedRole) ? APP_CONFIG.roblox.unverifiedRole.id
            : null;

      if (verificationTargetId !== prevVerificationTargetId) {
        const plan = buildVerificationRoleChangePlan(currentRoleIds, verificationTargetId, {
          registeredRoleId: APP_CONFIG.discord.registeredRole,
          unverifiedRoleId: APP_CONFIG.discord.unverifiedRole,
        });
        await syncMemberRoles(newMember, plan);
      }

      const currentDesiredRoles = calculateDesiredRobloxRoles(currentRoleIds);
      const previousDesiredRoles = oldMember.partial ? [] : calculateDesiredRobloxRoles(previousRoleIds);

      const robloxStateChanged =
        oldMember.partial ||
        currentDesiredRoles.length !== previousDesiredRoles.length ||
        currentDesiredRoles.some(role => !previousDesiredRoles.find(r => r.id === role.id));

      if (!robloxStateChanged) return;

      console.log(`[verifier-handler.js] 📝 Queuing Open Cloud API v2 sync for ${newMember.user.tag}`);
      enqueueSync(newMember, currentDesiredRoles);

      processQueue(client).catch((error) =>
        logError(error, client, { context: 'ROBLOX_SYNC_QUEUE_ERROR' })
      );
    } catch (guildUpdateError) {
      await logError(guildUpdateError, client, { context: 'GUILD_MEMBER_UPDATE_EVENT_FAIL', userId: newMember?.id });
    }
  });
}

module.exports = { registerGroupRankingHandler };