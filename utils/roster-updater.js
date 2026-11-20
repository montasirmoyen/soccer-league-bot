const database = require('../db/database');
const constants = require('../config/constants');
const configLeagues = require('../config/leagues');
const builderHelpers = require('./builder-helpers');
const { buildPSLEmbed, formatGuildMemberDisplay } = require('./embed-helpers');
const { safeFetchMember } = require('./discord-helpers');

const VACANT_LABEL = '*Vacant*';

function normalizeDiscordId(userId) {
  return userId ? String(userId).replace(/\D/g, '') : null;
}

function getStaffIds(teams) {
  return [
    ...new Set(
      teams.flatMap((team) => [team.manager, team.assistantManager])
        .map(normalizeDiscordId)
        .filter(Boolean)
    )
  ];
}

async function fetchStaffMembers(guild, teams) {
  if (!guild) return null;

  const staffIds = getStaffIds(teams);
  return staffIds.length > 0
    ? safeFetchMember(guild, staffIds)
    : new Map();
}

async function resolveDisplayName(guild, memberCollection, userId) {
  if (!userId) return VACANT_LABEL;

  const cleanId = normalizeDiscordId(userId);
  const cachedMember = memberCollection?.get(cleanId);
  if (cachedMember?.displayName) return cachedMember.displayName;

  return formatGuildMemberDisplay(guild, userId);
}

async function buildTeamField(guild, memberCollection, team) {
  const [manager, assistant, teamCapacity] = await Promise.all([
    resolveDisplayName(guild, memberCollection, team.manager),
    resolveDisplayName(guild, memberCollection, team.assistantManager),
    builderHelpers.getDisplayedPlayersAmount(team.name)
  ]);

  return {
    name: builderHelpers.getFormattedTeamName(team.name),
    value: `\`[${teamCapacity}]\`\n**M.:** ${manager}\n**A.M.:** ${assistant}\n\u200b`,
    inline: false
  };
}

async function buildTeamFields(guild, memberCollection, teams) {
  return Promise.all(
    teams.map((team) => buildTeamField(guild, memberCollection, team))
  );
}

function buildLeagueEmbeds(client, fields) {
  return Object.entries(configLeagues.leagues)
    .filter(([, leagueData]) => Boolean(leagueData))
    .map(([leagueName, leagueData]) => {
      const embed = buildPSLEmbed(
        client,
        leagueData.COLOR || constants.DEFAULT_EMBED_COLOR
      ).setTitle(builderHelpers.getFormattedLeagueName(leagueName).trim());

      return fields.length > 0 ? embed.addFields(fields) : embed;
    });
}

async function publishTeamRoster(channel, client, embeds) {
  if (embeds.length === 0) return;

  const messages = await channel.messages.fetch({ limit: 20 });
  const existingRosterMessage = messages.find(
    (message) => message.author.id === client.user.id && message.embeds.length > 0
  );

  const payload = { content: '# ⚽ PSL S4 Teams', embeds };
  const rosterMessage = existingRosterMessage
    ? await existingRosterMessage.edit(payload)
    : await channel.send(payload);

  const jumpText = `[Come back to the top](${rosterMessage.url})`;
  const existingShortcutMessage = messages.find(
    (message) => message.author.id === client.user.id
      && message.content.includes('Come back to the top')
  );

  if (!existingShortcutMessage) {
    await channel.send({ content: jumpText });
  }
}

async function updateTeamsRoster(client) {
  try {
    const channel = await client.channels.fetch(constants.TEAMS_CHANNEL_ID).catch(() => null);
    if (!channel) return;

    const teams = await database.getAllTeams();
    if (!teams?.length) return;

    const sortedTeams = [...teams].sort((a, b) => a.name.localeCompare(b.name));
    const guild = channel.guild;
    const memberCollection = await fetchStaffMembers(guild, sortedTeams);
    const fields = await buildTeamFields(guild, memberCollection, sortedTeams);
    const embeds = buildLeagueEmbeds(client, fields);

    await publishTeamRoster(channel, client, embeds);
  } catch (error) {
    console.error(`[roster-updater.js] Unexpected error: ${error}`);
  }
}

module.exports = { updateTeamsRoster };