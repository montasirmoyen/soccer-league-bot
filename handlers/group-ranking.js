require('dotenv').config();

const { Client, GatewayIntentBits, Events, Partials } = require('discord.js');
const constants = require('../config/constants');
const { buildPSLEmbed } = require('../utils/embed-helpers');
const { logError, SystemError } = require('../utils/error-handler');
const { syncMemberRoles, buildVerificationRoleChangePlan } = require('../utils/discord-helpers');
const { getRobloxUserProfile, getGroupMembership, updateGroupRoleset } = require('../utils/roblox-helpers');

const REQUIRED_ENV_VARS = ['PRODUCTION_BOT_TOKEN', 'ROBLOX_API_KEY'];
for (const key of REQUIRED_ENV_VARS) {
  if (!process.env[key]) {
    throw new Error(`[group-ranking.js] Missing required env var: ${key}`);
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
  groupId: constants.ROBLOX_GROUP_ID,

  discord: {
    unverifiedRole: constants.UNVERIFIED_ROLE_ID,
    communityRole: constants.COMMUNITY_ROLE_ID,
    assistantManagerRole: constants.ASSISTANT_MANAGER_ROLE_ID,
    managerRole: constants.MANAGER_ROLE_ID,
    mediaRole: constants.MEDIA_ROLE_ID,
    officialRole: constants.OFFICIAL_ROLE_ID,
    moderatorRole: constants.MODERATOR_ROLE_ID,
    staffRole: constants.STAFF_ROLE_ID,
    overseerRole: constants.OVERSEER_ROLE_ID,
  },

  roblox: {
    unverifiedRole: { id: '467994038', name: 'Unverified' },
    communityRole: { id: '655167005', name: 'Community' },
    assistantManagerRole: { id: '912954001', name: 'Assistant Manager' },
    managerRole: { id: '911296035', name: 'Manager' },
    mediaRole: { id: '692453049', name: 'Media' },
    officialRole: { id: '468518027', name: 'Official' },
    moderatorRole: { id: '692831042', name: 'Moderator' },
    staffRole: { id: '466720029', name: 'Staff' },
    overseerRole: { id: '468116031', name: 'Overseer' }
  }
};

const KNOWN_ROBLOX_ROLES = new Map([
  [APP_CONFIG.roblox.communityRole.id, APP_CONFIG.roblox.communityRole],
  [APP_CONFIG.roblox.unverifiedRole.id, APP_CONFIG.roblox.unverifiedRole],
  [APP_CONFIG.roblox.assistantManagerRole.id, APP_CONFIG.roblox.assistantManagerRole],
  [APP_CONFIG.roblox.managerRole.id, APP_CONFIG.roblox.managerRole],
  [APP_CONFIG.roblox.mediaRole.id, APP_CONFIG.roblox.mediaRole],
  [APP_CONFIG.roblox.officialRole.id, APP_CONFIG.roblox.officialRole],
  [APP_CONFIG.roblox.moderatorRole.id, APP_CONFIG.roblox.moderatorRole],
  [APP_CONFIG.roblox.staffRole.id, APP_CONFIG.roblox.staffRole],
  [APP_CONFIG.roblox.overseerRole.id, APP_CONFIG.roblox.overseerRole]
]);

const DISCORD_TO_ROBLOX_MAP = [
  { roblox: APP_CONFIG.roblox.communityRole, discord: [APP_CONFIG.discord.communityRole] },
  { roblox: APP_CONFIG.roblox.unverifiedRole, discord: [APP_CONFIG.discord.unverifiedRole] },
  { roblox: APP_CONFIG.roblox.assistantManagerRole, discord: [APP_CONFIG.discord.assistantManagerRole] },
  { roblox: APP_CONFIG.roblox.managerRole, discord: [APP_CONFIG.discord.managerRole] },
  { roblox: APP_CONFIG.roblox.mediaRole, discord: [APP_CONFIG.discord.mediaRole] },
  { roblox: APP_CONFIG.roblox.officialRole, discord: [APP_CONFIG.discord.officialRole] },
  { roblox: APP_CONFIG.roblox.moderatorRole, discord: [APP_CONFIG.discord.moderatorRole] },
  { roblox: APP_CONFIG.roblox.staffRole, discord: [APP_CONFIG.discord.staffRole] },
  { roblox: APP_CONFIG.roblox.overseerRole, discord: [APP_CONFIG.discord.overseerRole] },
];

let syncQueue = [];
let isProcessing = false;

function getDiscordIdentity(member) {
  const displayName = member?.displayName || member?.user?.username || 'Unknown user';
  return `${displayName} (${member?.id || 'unknown ID'})`;
}

process.on('unhandledRejection', (reason) => logError(reason, null, { context: 'GLOBAL_UNHANDLED_REJECTION' }));
process.on('uncaughtException', (error) => logError(error, null, { context: 'GLOBAL_UNCAUGHT_EXCEPTION' }));

async function ensureFullMember(member) {
  if (!member) return member;

  if (member.partial) {
    console.log(`🔄 Member profile for ${getDiscordIdentity(member)} is partial. Fetching full data...`);
    try {
      return await member.fetch();
    } catch (error) {
      console.error(`❌ [FETCH ERROR] It wasn't possible fetching ${getDiscordIdentity(member)}:`, error.message);
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

function enqueueSync(newMember) {
  syncQueue = syncQueue.filter(({ newMember: queuedMember }) => queuedMember.id !== newMember.id);
  syncQueue.push({ newMember });
}

async function sendSyncSkippedLog(client, newMember, reason, robloxData = null) {
  const details = robloxData?.id
    ? `Roblox: ${robloxData.name} (${robloxData.id})`
    : 'Roblox account: not linked';

  const skipEmbed = buildPSLEmbed(client, constants.WARNING_COLOR)
    .setTitle('Sync Skipped')
    .setDescription(`**${newMember.displayName || newMember.user.username}** (\`${newMember.id}\`) skipped Roblox synchronization.`)
    .addFields({ name: 'Reason', value: reason }, { name: 'Details', value: details });

  await sendLog(client, skipEmbed);
}

async function processSingleSync(client, newMember) {
  if (!newMember?.guild || !newMember.user) {
    console.warn('[group-ranking.js] Refusing malformed sync queue item.');
    return;
  }

  try {
    newMember = await newMember.guild.members.fetch({ user: newMember.id, force: true });
    const desiredRoles = calculateDesiredRobloxRoles([...newMember.roles.cache.keys()]);
    const memberGuildDisplayName = newMember.displayName;
    const robloxData = await withRetry(() => getRobloxUserProfile(memberGuildDisplayName));

    if (!robloxData?.id) {
      console.warn(`[group-ranking.js] No linked Roblox account found for Discord user ${getDiscordIdentity(newMember)}`);
      await sendSyncSkippedLog(client, newMember, 'Could not find a linked Roblox account.');
      return;
    }

    const robloxId = robloxData.id;
    const robloxUsername = robloxData.name;

    const membership = await withRetry(() => getGroupMembership(APP_CONFIG.groupId, robloxId));
    if (!membership) {
      console.warn(`[group-ranking.js] Roblox user ${robloxUsername} (${robloxId}) is not in group ${APP_CONFIG.groupId}`);
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
      await withRetry(() => updateGroupRoleset(APP_CONFIG.groupId, membership.path, roleId, 'unassignRole'));
      const roleData = KNOWN_ROBLOX_ROLES.get(roleId);
      actionLog.push(`🧹 **Removed:** \`${roleData.name}\``);
      changesMade = true;
      console.log(`[group-ranking.js] 🧹 Clearing deprecated/conflicting role '${roleData.name}' in Roblox...`);
    }

    for (const roleId of rolesToAdd) {
      await withRetry(() => updateGroupRoleset(APP_CONFIG.groupId, membership.path, roleId, 'assignRole'));
      const roleData = KNOWN_ROBLOX_ROLES.get(roleId);
      actionLog.push(`✅ **Added:** \`${roleData.name}\``);
      changesMade = true;
      console.log(`[group-ranking.js] ✅ Assigning target role '${roleData.name}' in Roblox...`);
    }

    if (!changesMade) {
      console.log(`[group-ranking.js] 🛑 Roblox roles already match the latest Discord roles for ${getDiscordIdentity(newMember)}. Nothing was changed.`);
      return;
    }

    console.log(`[group-ranking.js] ✅ Successfully synced Roblox roles (v2) for ${getDiscordIdentity(newMember)}`);

    const successEmbed = buildPSLEmbed(client, constants.SUCCESS_COLOR)
      .setTitle('✅ Roblox Roles Synced')
      .setThumbnail(newMember.user.displayAvatarURL())
      .addFields(
        { name: '👤 Discord User', value: `**${newMember.user.tag}** (\`${newMember.id}\`)`, inline: false },
        { name: '🎮 Roblox User', value: `**[${robloxUsername}](https://www.roblox.com/users/${robloxId}/profile)** (\`${robloxId}\`)`, inline: false },
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
      const { newMember } = syncQueue.shift();
      await processSingleSync(client, newMember);
      await new Promise((res) => setTimeout(res, 3000));
    }
  } finally {
    isProcessing = false;
  }
}

function registerGroupRankingHandler(client) {
  client.once(Events.ClientReady, () => {
    console.log('[group-ranking.js] 🌐 Roblox Open Cloud API Engine (v2) initialized.');
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

      const currentHasReg = currentRoleIds.includes(APP_CONFIG.discord.communityRole);
      const currentHasUnv = currentRoleIds.includes(APP_CONFIG.discord.unverifiedRole);

      if (currentHasReg && currentHasUnv) {
        console.warn(`[group-ranking.js] Refusing ambiguous verification roles for ${getDiscordIdentity(newMember)}`);
        return;
      }

      const verificationTargetId = currentHasReg ? APP_CONFIG.roblox.communityRole.id
        : currentHasUnv ? APP_CONFIG.roblox.unverifiedRole.id
          : null;

      const prevVerificationTargetId = oldMember.partial ? null
        : previousRoleIds.includes(APP_CONFIG.discord.communityRole) ? APP_CONFIG.roblox.communityRole.id
          : previousRoleIds.includes(APP_CONFIG.discord.unverifiedRole) ? APP_CONFIG.roblox.unverifiedRole.id
            : null;

      if (verificationTargetId !== prevVerificationTargetId) {
        const plan = buildVerificationRoleChangePlan(currentRoleIds, verificationTargetId, {
          communityRoleId: APP_CONFIG.discord.communityRole,
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

      const addedRoleNames = currentDesiredRoles
        .filter(role => !previousDesiredRoles.some(previousRole => previousRole.id === role.id))
        .map(role => role.name);
      const removedRoleNames = previousDesiredRoles
        .filter(role => !currentDesiredRoles.some(currentRole => currentRole.id === role.id))
        .map(role => role.name);

      console.log(
        `[group-ranking.js] 📝 Queuing Open Cloud API v2 sync for ${getDiscordIdentity(newMember)}` +
        ` (Roblox roles added: ${addedRoleNames.join(', ') || 'none'}; removed: ${removedRoleNames.join(', ') || 'none'})`
      );
      enqueueSync(newMember);

      processQueue(client).catch((error) =>
        logError(error, client, { context: 'ROBLOX_SYNC_QUEUE_ERROR' })
      );
    } catch (guildUpdateError) {
      await logError(guildUpdateError, client, { context: 'GUILD_MEMBER_UPDATE_EVENT_FAIL', userId: newMember?.id });
    }
  });
}

module.exports = { registerGroupRankingHandler };