const { Client } = require('discord.js');
const configTeams = require('../config/teams');
const configPositions = require('../config/positions')
const configTimezones = require('../config/timezones')
const configFriendlies = require('../config/friendlies')
const constants = require('../config/constants');
const database = require('../db/database');
const countryEmoji = require('country-emoji');

function getTeamFlag(teamKey) {
    const key = teamKey?.toLowerCase().trim();

    if (key === 'england') {
        return '🏴󠁧󠁢󠁥󠁮󠁧󠁿';
    }

    return countryEmoji.flag(teamKey) || '🏳️';
}

function getFormattedTeamName(teamKey) {
    const formattedName = teamKey
        .toLowerCase()
        .split(' ')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
    const teamFlag = getTeamFlag(teamKey)

    return `${teamFlag} ${formattedName}`;
}

function getTeamChoices() {
    const teamKeys = Object.keys(configTeams.teams);
    return teamKeys.map(team => {
        const formattedName = team
            .toLowerCase()
            .split(' ')
            .map(word => word.charAt(0).toUpperCase() + word.slice(1))
            .join(' ');

        return {
            name: getFormattedTeamName(team),
            value: team
        };
    });
}

function getPositionChoices() {
    const positionKeys = Object.keys(configPositions.positions);
    return positionKeys.map(position => {
        const emoji = configPositions.positions[position].EMOJI;
        return {
            name: `${emoji} ${position}`,
            value: position
        };
    });
}

function getTimezoneChoices() {
    const timezoneKeys = Object.keys(configTimezones.timezones)
    return timezoneKeys.map(timezone => {
        const emoji = configTimezones.timezones[timezone].EMOJI;
        return {
            name: `${emoji} ${timezone}`,
            value: timezone
        }
    });
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

function getFriendlyChoices() {
    const friendlyKeys = Object.keys(configFriendlies.friendlies);
    return friendlyKeys.map(friendly => {
        const emoji = configFriendlies.friendlies[friendly].EMOJI;
        return {
            name: `${emoji} ${friendly}`,
            value: friendly
        };
    });
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

async function getDisplayedReleasesAmount(teamKey) {
    const teamInfo = await database.getTeamInfo(teamKey);
    const releasesUsed = teamInfo.releasesUsed || 0;
    return `${releasesUsed}/${constants.MAX_RELEASES_PER_TEAM}`;
}

async function getTeamPlayersAmount(teamKey) {
    const squad = await database.getPlayersByTeam(teamKey);
    return Array.isArray(squad) ? squad.length : 0;
}

async function getDisplayedPlayersAmount(teamKey) {
    const playersAmount = await getTeamPlayersAmount(teamKey);
    return `${playersAmount}/${constants.MAX_ROSTER_SIZE}`;
}

async function getDisplayedPlayerSigningsAmount(userId) {
    const signingsUsed = await database.getPlayerSigningsCount(userId);
    return `${signingsUsed}/${constants.MAX_SIGNINGS_PER_PLAYER}`;
}

module.exports = {
    getTeamFlag,
    getFormattedTeamName,
    getTeamChoices,
    getPositionChoices,
    getTimezoneChoices,
    getDiscordDisplayName,
    getCooldownState,
    formatCooldownDuration,
    getFriendlyChoices,
    getTeamRole,
    getDisplayedReleasesAmount,
    getDisplayedPlayerSigningsAmount,
    getTeamPlayersAmount,
    getDisplayedPlayersAmount
};