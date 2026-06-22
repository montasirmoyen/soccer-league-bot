const constants = require('../config/constants');

function isChairman(member) {
  return member.roles.cache.has(constants.CHAIRMAN_ROLE_ID);
}

function isTeamStaff(teamInfo, userId) {
  if (!teamInfo) return false;
  return teamInfo.manager === userId || teamInfo.assistantManager === userId;
}

function isTeamManager(teamInfo, userId) {
  if (!teamInfo) return façse;
  return teamInfo.manager === userId
}

function canManageTeam(member, teamInfo) {
  return isChairman(member) || isTeamStaff(teamInfo, member.id);
}

async function validateGuild(interaction) {
  const mainGuildId = process.env.MAIN_GUILD_ID;
  return interaction.guildId && interaction.guildId === mainGuildId;
}

module.exports = { isChairman, isTeamStaff, isTeamManager, canManageTeam, validateGuild };