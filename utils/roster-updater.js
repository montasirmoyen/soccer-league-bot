const database = require('../db/database');
const constants = require('../config/constants');
const configLeagues = require('../config/leagues');
const configTeams = require('../config/teams');
const builderHelpers = require('./builder-helpers');
const { buildPSLEmbed, formatGuildMemberDisplay } = require('./embed-helpers');
const { safeFetchMember } = require('./discord-helpers');

async function updateTeamsRoster(client) {
  try {
    const channel = await client.channels.fetch(constants.TEAMS_CHANNEL_ID).catch(() => null);
    if (!channel) return;

    const allTeams = await database.getAllTeams();
    if (!allTeams?.length) return;

    allTeams.sort((a, b) => a.name.localeCompare(b.name));

    const guild = channel.guild;
    let memberCollection = null;

    if (guild) {
      const allStaffIds = [];
      for (const team of allTeams) {
        if (team.manager) allStaffIds.push(team.manager);
        if (team.assistantManager) allStaffIds.push(team.assistantManager);
      }
      if (allStaffIds.length > 0) {
        memberCollection = await safeFetchMember(guild, allStaffIds);
      }
    }

    const resolveDisplayName = async (userId) => {
      if (!userId) return '*Vacant*';

      const cleanId = String(userId).replace(/\D/g, '');
      const cachedMember = memberCollection?.get(cleanId);
      if (cachedMember?.displayName) return `${cachedMember.displayName}`;

      return formatGuildMemberDisplay(guild, userId);
    };

    const embeds = [];
    for (const [leagueName, leagueData] of Object.entries(configLeagues.leagues)) {
      if (!leagueData || !Array.isArray(leagueData.teams)) continue;

      const embedColor = leagueData.COLOR || constants.DEFAULT_EMBED_COLOR;
      
      const titleString = `${builderHelpers.getFormattedLeagueName(leagueName)}`.trim();

      const embed = buildPSLEmbed(client, embedColor)
        .setTitle(titleString);

      const fields = [];

      for (const teamName of leagueData.teams) {
        const team = allTeams.find((t) => t.name === teamName);
        if (!team) continue; 

        const staticTeamConfig = configTeams?.teams?.[teamName];
        const teamEmoji = staticTeamConfig?.EMOJI_ID ? `${staticTeamConfig.EMOJI_ID} ` : '';

        const label = `${builderHelpers.getFormattedTeamName(team.name)}`;
        
        const managerId = team.manager ? String(team.manager).replace(/\D/g, '') : null;
        const assistantManagerId = team.assistantManager ? String(team.assistantManager).replace(/\D/g, '') : null;

        const manager = team.manager ? await resolveDisplayName(managerId) : '*Vacant*';
        const assistant = team.assistantManager ? await resolveDisplayName(assistantManagerId) : '*Vacant*';
        const teamCapacity = await builderHelpers.getDisplayedPlayersAmount(team.name);

        fields.push({
          name: `${label}`,
          value: `\`[${teamCapacity}]\`\n**M.:** ${manager}\n**A.M.:** ${assistant}\n\u200b`,
          inline: false
        });
      }

      if (fields.length > 0) {
        embed.addFields(fields);
      }
      
      embeds.push(embed);
    }

    if (embeds.length > 0) {
      const messages = await channel.messages.fetch({ limit: 20 });
      
      let existingEmbedsMsg = messages.find(
        (msg) => msg.author.id === client.user.id && msg.embeds.length > 0
      );

      let finalEmbedsMsg;

      const messagePayload = { content: '# ⚽ PSL S3 Teams', embeds: embeds };
      if (existingEmbedsMsg) {
        finalEmbedsMsg = await existingEmbedsMsg.edit(messagePayload);
      } else {
        finalEmbedsMsg = await channel.send(messagePayload);
      }

      const topMessageLink = finalEmbedsMsg.url;
      const jumpText = `[Come back to the top](${topMessageLink})`;

      const existingShortcutMsg = messages.find(
        (msg) => msg.author.id === client.user.id && msg.content.includes('Come back to the top')
      );

      if (!existingShortcutMsg || !finalEmbedsMsg) {
        await channel.send({ content: jumpText });
      }
    }

  } catch (error) {
    console.error(`[roster-updater.js] Unexpected error: ${error}`);
  }
}

module.exports = { updateTeamsRoster };