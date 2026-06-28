const MISSING_PERMISSIONS_CODE = 50013;

async function safeRoleAdd(member, roleId) {
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

async function safeFetchMember(guild, userIds) {
  if (!guild || !userIds) return null;

  const isArrayInput = Array.isArray(userIds);
  const idsArray = isArrayInput ? userIds : [userIds];

  const cleanIds = idsArray
    .map(id => id ? String(id).replace(/\D/g, '') : null)
    .filter(Boolean);

  if (cleanIds.length === 0) return isArrayInput ? new Map() : null;

  try {
    const fetchedMembers = await guild.members.fetch({ user: cleanIds });

    if (isArrayInput) {
      return fetchedMembers;
    } else {
      return fetchedMembers.get(cleanIds[0]) || null;
    }
  } catch (error) {
    await Promise.allSettled(
      cleanIds.map(id => guild.members.fetch(id).catch(() => null))
    );

    if (isArrayInput) {
      return guild.members.cache.filter(member => cleanIds.includes(member.id));
    } else {
      return guild.members.cache.get(cleanIds[0]) || null;
    }
  }
}

module.exports = { safeRoleAdd, safeRoleRemove, safeFetchMember };