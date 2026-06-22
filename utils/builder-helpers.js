const { Client } = require('discord.js');
const configTeams = require('../config/teams');
const configPositions = require('../config/positions')
const configTimezones = require('../config/timezones')
const constants = require('../config/constants');
const database = require('../db/database');
const countryEmoji = require('country-emoji');

function getFormattedTeamName(teamKey) {
    const formattedName = teamKey
        .toLowerCase()
        .split(' ')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');

    return `${countryEmoji.flag(teamKey) || '🏳️'} ${formattedName}`;
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

async function getDisplayedPlayersAmount(teamKey) {
    const playersAmount = await getTeamPlayersAmount(teamKey);
    return `${playersAmount}/${constants.MAX_ROSTER_SIZE}`;
}

module.exports = {
    getFormattedTeamName,
    getTeamChoices,
    getPositionChoices,
    getTimezoneChoices,
    getTeamRole,
    getTeamPlayersAmount,
    getDisplayedPlayersAmount
};