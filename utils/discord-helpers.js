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

async function safeFetchMember(guild, userId) {
  try {
    return await guild.members.fetch(userId);
  } catch {
    return null;
  }
}

module.exports = { safeRoleAdd, safeRoleRemove, safeFetchMember };