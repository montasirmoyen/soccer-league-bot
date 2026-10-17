const configLeagues = require('../config/leagues')
const configTeams = require('../config/teams');
const configPositions = require('../config/positions')
const configTimezones = require('../config/timezones')
const configFriendlies = require('../config/friendlies')
const configActions = require('../config/actions')
const configDataTypes = require('../config/dataTypes')
const constants = require('../config/constants');
const database = require('../db/database');

function toTitleCase(value) {
    return value
        .toLowerCase()
        .split(' ')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
}

function getChoices(items, getName) {
    return Object.entries(items).map(([key, item]) => ({
        name: getName(key, item),
        value: key
    }));
}

function getEmoji(group, key) {
    const objectKey = key?.toUpperCase().trim();
    const emoji = group[objectKey]?.EMOJI_ID || '🏴';
    return emoji;
}

function getFormattedTeamName(teamKey) {
    const formattedName = toTitleCase(teamKey);
    const emojiId = getEmoji(configTeams.teams, teamKey);

    return `${emojiId} ${formattedName}`;
}

function getFormattedLeagueName(leagueKey) {
    const formattedName = toTitleCase(leagueKey);
    const emojiId = getEmoji(configLeagues.leagues, leagueKey);

    return `${emojiId} ${formattedName}`;
}

function getTeamChoices() {
    return getChoices(configTeams.teams, team => `⚽ ${toTitleCase(team)}`);
}

function getPositionChoices() {
    return getChoices(configPositions.positions, (position, data) => `${data.EMOJI} ${position}`);
}

function getTimezoneChoices() {
    return getChoices(configTimezones.timezones, (timezone, data) => `${data.EMOJI} ${timezone}`);
}

function getFriendlyChoices() {
    return getChoices(configFriendlies.friendlies, (friendly, data) => `${data.EMOJI} ${friendly}`);
}

function getActionChoices() {
    return getChoices(configActions.actions, (action, data) => data.NAME);
}

function getPlayerDataChoices() {
    return getChoices(configDataTypes.player, (key, data) => data.NAME);
}

function getTeamDataChoices() {
    return getChoices(configDataTypes.team, (key, data) => data.NAME);
}

function getDiscordDisplayName(member, user) {
    const fallbackUser = member || user;
    return fallbackUser?.displayName || user?.displayName || user?.username || 'Unknown User';
}

function getCooldownState(userId, cooldowns, cooldownAmount, now = Date.now()) {
    if (!cooldowns.has(userId)) {
        return { isCoolingDown: false };
    }

    const expirationTime = cooldowns.get(userId) + cooldownAmount;
    if (now < expirationTime) {
        return { isCoolingDown: true, timeLeftMs: expirationTime - now };
    }

    cooldowns.delete(userId);
    return { isCoolingDown: false };
}

function formatCooldownDuration(timeLeftMs) {
    const totalSeconds = Math.max(1, Math.ceil(timeLeftMs / 1000));
    const days = Math.floor(totalSeconds / 86400);
    const hours = Math.floor((totalSeconds % 86400) / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    const parts = [];
    if (days > 0) parts.push(`${days}d`);
    if (hours > 0 || days > 0) parts.push(`${hours}h`);
    if (minutes > 0 || hours > 0 || days > 0) parts.push(`${minutes}m`);
    if (seconds > 0 && !days && !hours && minutes < 1) parts.push(`${seconds}s`);

    return parts.join(' ');
}

async function getTeamRole(client, teamKey) {
    const teamInfo = configTeams.teams[teamKey];
    if (!teamInfo || !teamInfo.ROLE_ID) return null;

    try {
        const guild = await client.guilds.fetch(constants.GUILD_ID);
        if (!guild) return null;

        const role = await guild.roles.fetch(teamInfo.ROLE_ID);
        return role;
    } catch (error) {
        console.error('❌ Error fetching team role:', error);
        return null;
    }
}

async function getTeamPlayersAmount(teamKey) {
    const squad = await database.getPlayersByTeam(teamKey);
    return Array.isArray(squad) ? squad.length : 0;
}

function formatUsageCount(used, maximum) {
    return `${used}/${maximum}`;
}

async function getDisplayedPlayerContractsAmount(userId) {
    const contractsUsed = await database.getIndividualContractsCount(userId);
    return formatUsageCount(contractsUsed, constants.MAX_CONTRACTS_PER_PLAYER);
}

async function getDisplayedPlayerDemandsAmount(userId) {
    const demandsUsed = await database.getPlayerDemandsCount(userId);
    return formatUsageCount(demandsUsed, constants.MAX_DEMANDS_PER_PLAYER);
}

async function getDisplayedPlayersAmount(teamKey) {
    const playersAmount = await getTeamPlayersAmount(teamKey);
    return formatUsageCount(playersAmount, constants.MAX_ROSTER_SIZE);
}

module.exports = {
    getEmoji,
    getFormattedTeamName,
    getFormattedLeagueName,
    getTeamChoices,
    getPositionChoices,
    getTimezoneChoices,
    getFriendlyChoices,
    getActionChoices,
    getPlayerDataChoices,
    getTeamDataChoices,
    getDiscordDisplayName,
    getCooldownState,
    formatCooldownDuration,
    getTeamRole,
    getDisplayedPlayerContractsAmount,
    getTeamPlayersAmount,
    getDisplayedPlayersAmount,
    getDisplayedPlayerDemandsAmount
};