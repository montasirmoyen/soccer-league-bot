const database = require('../db/database');
const constants = require('../config/constants');
const builderHelpers = require('./builder-helpers');
const { buildPSLEmbed } = require('./embed-helpers');

async function updateTeamsRoster(client) {
  try {
    const channel = await client.channels.fetch(constants.TEAMS_CHANNEL_ID).catch(() => null);
    if (!channel) return;

    const allTeams = await database.getAllTeams();
    if (!allTeams?.length) return;

    allTeams.sort((a, b) => a.name.localeCompare(b.name));

    const embed = buildPSLEmbed(client, constants.DEFAULT_EMBED_COLOR)
      .setTitle('👑 PSL26 WORLD CUP TEAMS 👑');

    const fields = [];

    for (const team of allTeams) {
      const label = builderHelpers.getFormattedTeamName(team.name);
      
      const manager = team.manager ? `<@${team.manager}>` : '*Vacant*';
      const assistant = team.assistantManager ? `<@${team.assistantManager}>` : '*Vacant*';
      const teamCapacity = await builderHelpers.getDisplayedPlayersAmount(team.name);

      fields.push({
        name: `${label}`,
        value: `\`[${teamCapacity}]\`\n**M.:** ${manager}\n**A.M.:** ${assistant}\n\u200b`,
        inline: true
      });
    }

    embed.addFields(fields);

    const messages = await channel.messages.fetch({ limit: 20 });
    const existing = messages.find(
      (msg) => msg.author.id === client.user.id && msg.embeds.length > 0,
    );

    if (existing) {
      await existing.edit({ embeds: [embed] });
    } else {
      await channel.send({ embeds: [embed] });
    }
  } catch (err) {
    console.error('[roster-updater.js] Unexpected error:', err);
  }
}

module.exports = { updateTeamsRoster };