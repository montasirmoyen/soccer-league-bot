const database = require('../db/database');
const constants = require('../config/constants');
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
      if (cachedMember?.displayName) return `**${cachedMember.displayName}**`;

      return formatGuildMemberDisplay(guild, userId);
    };

    const embed = buildPSLEmbed(client, constants.DEFAULT_EMBED_COLOR)
      .setTitle('👑 PSL26 WORLD CUP TEAMS 👑');

    const fields = [];

    for (const team of allTeams) {
      const label = builderHelpers.getFormattedTeamName(team.name);
      const managerId = team.manager ? String(team.manager).replace(/\D/g, '') : null;
      const assistantManagerId = team.assistantManager ? String(team.assistantManager).replace(/\D/g, '') : null;

      const manager = team.manager ? await resolveDisplayName(managerId) : '*Vacant*';
      const assistant = team.assistantManager ? await resolveDisplayName(assistantManagerId) : '*Vacant*';
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

    const message = { embeds: [embed] };
    if (existing) {
      await existing.edit(message);
    } else {
      await channel.send(message);
    }
  } catch (error) {
    console.error(`[roster-updater.js] Unexpected error: ${error}`);
  }
}

module.exports = { updateTeamsRoster };