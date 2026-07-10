const MISSING_PERMISSIONS_CODE = 50013;

function normalizeRoleIds(roleIds = []) {
  return [...new Set((roleIds || []).filter(Boolean).map((roleId) => String(roleId)))];
}

function buildVerificationRoleChangePlan(currentRoleIds = [], targetRoleId, { registeredRoleId, unverifiedRoleId } = {}) {
  const currentIds = new Set(normalizeRoleIds(currentRoleIds));
  const addRoleIds = [];
  const removeRoleIds = [];

  if (!targetRoleId) return { addRoleIds, removeRoleIds };

  if (targetRoleId === registeredRoleId) {
    if (!currentIds.has(registeredRoleId)) addRoleIds.push(registeredRoleId);
    if (currentIds.has(unverifiedRoleId)) removeRoleIds.push(unverifiedRoleId);
  } else if (targetRoleId === unverifiedRoleId) {
    if (!currentIds.has(unverifiedRoleId)) addRoleIds.push(unverifiedRoleId);
    if (currentIds.has(registeredRoleId)) removeRoleIds.push(registeredRoleId);
  }

  return { addRoleIds, removeRoleIds };
}

async function safeRoleAdd(member, roleId) {
  if (!member || !roleId || member.roles?.cache?.has(roleId)) return true;

  const guild = member.guild;
  const role = guild?.roles?.cache?.get(roleId);
  if (!role) {
    console.warn(`[Role Warning] Cannot add role ${roleId} to ${member.id}: role does not exist in this guild.`);
    return false;
  }

  const botMember = guild.members.me;
  if (botMember && botMember.roles.highest.comparePositionTo(role) <= 0) {
    console.warn(`[Role Warning] Cannot add role ${roleId} to ${member.id}: bot role is not high enough.`);
    return false;
  }

  try {
    await member.roles.add(roleId);
    return true;
  } catch (error) {
    if (error.code === MISSING_PERMISSIONS_CODE) {
      console.warn(`[Role Warning] Cannot add role ${roleId} to ${member.id}: Hierarchy error.`);
    } else {
      console.error(`[Role Error] Failed to add role ${roleId} to ${member.id}:`, error);
    }
    return false;
  }
}

async function safeRoleRemove(member, roleId) {
  if (!member || !roleId || !member.roles?.cache?.has(roleId)) return true;

  const guild = member.guild;
  const role = guild?.roles?.cache?.get(roleId);
  if (!role) {
    console.warn(`[Role Warning] Cannot remove role ${roleId} from ${member.id}: role does not exist in this guild.`);
    return false;
  }

  const botMember = guild.members.me;
  if (botMember && botMember.roles.highest.comparePositionTo(role) <= 0) {
    console.warn(`[Role Warning] Cannot remove role ${roleId} from ${member.id}: bot role is not high enough.`);
    return false;
  }

  try {
    await member.roles.remove(roleId);
    return true;
  } catch (error) {
    if (error.code === MISSING_PERMISSIONS_CODE) {
      console.warn(`[Role Warning] Cannot remove role ${roleId} from ${member.id}: Hierarchy error.`);
    } else {
      console.error(`[Role Error] Failed to remove role ${roleId} from ${member.id}:`, error);
    }
    return false;
  }
}

async function syncMemberRoles(member, { addRoleIds = [], removeRoleIds = [] } = {}) {
  if (!member) return { added: [], removed: [] };

  const normalizedAdd = normalizeRoleIds(addRoleIds);
  const normalizedRemove = normalizeRoleIds(removeRoleIds);

  const [added, removed] = await Promise.all([
    Promise.all(normalizedAdd.map((roleId) => safeRoleAdd(member, roleId))),
    Promise.all(normalizedRemove.map((roleId) => safeRoleRemove(member, roleId))),
  ]);

  return {
    added: normalizedAdd.filter((_, index) => added[index]),
    removed: normalizedRemove.filter((_, index) => removed[index]),
  };
}

async function safeReply(interaction, payload) {
  try {
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(payload).catch(() => {});
    } else {
      await interaction.reply(payload).catch(() => {});
    }
    return true;
  } catch (error) {
    console.error('[discord-helpers] Failed to send interaction response:', error.message);
    return false;
  }
}

async function safeDeferReply(interaction, options = {}) {
  if (interaction.deferred || interaction.replied) return true;

  try {
    await interaction.deferReply(options);
    return true;
  } catch (error) {
    console.warn('[discord-helpers] Unable to defer reply:', error.message);
    return false;
  }
}

async function safeEditReply(interaction, payload) {
  try {
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply(payload).catch(() => {});
    } else {
      await interaction.reply(payload).catch(() => {});
    }
    return true;
  } catch (error) {
    console.error('[discord-helpers] Failed to edit interaction reply:', error.message);
    return false;
  }
}

async function safeFetchMember(guild, userIds) {
  if (!guild || !userIds) return null;

  const isArrayInput = Array.isArray(userIds);
  const idsArray = isArrayInput ? userIds : [userIds];

  const cleanIds = idsArray
    .map((id) => (id ? String(id).replace(/\D/g, '') : null))
    .filter(Boolean);

  if (cleanIds.length === 0) return isArrayInput ? new Map() : null;

  try {
    const fetchedMembers = await guild.members.fetch({ user: cleanIds });

    if (isArrayInput) {
      return fetchedMembers;
    }

    return fetchedMembers.get(cleanIds[0]) || null;
  } catch (error) {
    await Promise.allSettled(cleanIds.map((id) => guild.members.fetch(id).catch(() => null)));

    if (isArrayInput) {
      return guild.members.cache.filter((member) => cleanIds.includes(member.id));
    }

    return guild.members.cache.get(cleanIds[0]) || null;
  }
}

module.exports = {
  buildVerificationRoleChangePlan,
  safeRoleAdd,
  safeRoleRemove,
  syncMemberRoles,
  safeReply,
  safeDeferReply,
  safeEditReply,
  safeFetchMember,
};