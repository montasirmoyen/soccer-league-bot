const constants = require('../config/constants');

function isChairman(member) {
  return (
    member.roles.cache.has(constants.CHAIRMAN_ROLE_ID) ||
    member.roles.cache.has(constants.OVERSEER_ROLE_ID)
  );
}

function isRefereeOrAdmin(member) {
  return (
    member.roles.cache.has(constants.REFEREE_ROLE_ID) ||
    member.roles.cache.has(constants.CHAIRMAN_ROLE_ID) ||
    member.roles.cache.has(constants.OVERSEER_ROLE_ID)
  );
}

function isTeamStaff(teamInfo, userId) {
  if (!teamInfo) return false;
  return teamInfo.manager === userId || teamInfo.assistantManager === userId;
}

function isTeamManager(teamInfo, userId) {
  if (!teamInfo) return false;
  return teamInfo.manager === userId;
}

function canManageTeam(member, teamInfo) {
  return isChairman(member) || isTeamStaff(teamInfo, member.id);
}

function isRosterFull(squad) {
  return squad.length >= constants.MAX_ROSTER_SIZE;
}

function validateGuild(interaction) {
  return interaction.guildId === constants.GUILD_ID;
}

module.exports = {
  isChairman,
  isRefereeOrAdmin,
  isTeamStaff,
  isTeamManager,
  canManageTeam,
  isRosterFull,
  validateGuild,
};