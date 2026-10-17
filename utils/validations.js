const { MessageFlags } = require('discord.js');
const constants = require('../config/constants');

const NO_PERMISSION = '❌ You do not have permission to use this command.'
const WRONG_GUILD = '❌ You can only execute this command in the official server.';

function isLeagueAdmin(member) {
  return Boolean(
    member?.roles?.cache?.has(constants.CHAIRMAN_ROLE_ID) ||
    member?.roles?.cache?.has(constants.OVERSEER_ROLE_ID) ||
    member?.roles?.cache?.has(constants.SUPERVISOR_ROLE_ID)
  );
}

async function requireLeagueAdmin(interaction, message = NO_PERMISSION) {
  if (isLeagueAdmin(interaction.member)) return true;

  await interaction.editReply({ content: message, flags: MessageFlags.Ephemeral });
  return false;
}

async function isRefereeOrAdmin(interaction, member) {
  if (member?.roles?.cache?.has(constants.REFEREE_ROLE_ID) || isLeagueAdmin(member)) return true;

  await interaction.editReply({ content: NO_PERMISSION, flags: MessageFlags.Ephemeral });
  return false;
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
  return isLeagueAdmin(member) || isTeamStaff(teamInfo, member.id);
}

function isRosterFull(squad) {
  return squad.length >= constants.MAX_ROSTER_SIZE;
}

function validateGuild(interaction) {
  return interaction.guildId === constants.GUILD_ID;
}

async function requireOfficialGuild(interaction, message = WRONG_GUILD) {
  if (validateGuild(interaction)) return true;

  await interaction.editReply({ content: message, flags: MessageFlags.Ephemeral });
  return false;
}

async function isRegistered(member) {
  if (!member) return false;

  try {
    const fetchedMember = await member.guild.members.fetch(member.id);
    return fetchedMember.roles.cache.has(constants.REGISTERED_ROLE_ID);
  } catch (error) {
    console.error(`Error fetching member: ${error}`);
    return false;
  }
}

module.exports = {
  isLeagueAdmin,
  requireLeagueAdmin,
  isRefereeOrAdmin,
  isTeamStaff,
  isTeamManager,
  canManageTeam,
  isRosterFull,
  validateGuild,
  requireOfficialGuild,
  isRegistered
};