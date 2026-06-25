const { Events } = require('discord.js');
const database   = require('../db/database');
const constants  = require('../config/constants');
const { updateTeamsRoster } = require('../utils/roster-updater');

module.exports = {
  name: Events.GuildMemberRemove,

  async execute(member) {
    if (member.guild.id !== constants.GUILD_ID) return;

    const userId = member.user.id;
    const tag    = member.user.tag;
    let rosterNeedsUpdate = false;
    const logLines        = [`🚪 **${tag}** (\`${userId}\`) has left the server.`];

    try {
      const activeContract = await database.getContractedTeam(userId);
      if (activeContract) {
        await database.releasePlayer(userId);
        logLines.push(`📋 Contract with **${activeContract.teamName}** has been terminated.`);
        console.log(`[guildMemberRemove] Released ${tag} (${userId}) from ${activeContract.teamName}.`);
      }

      const staffPosition = await database.isUserStaffAnywhere(userId);
      if (staffPosition) {
        const teamInfo = await database.getTeamInfo(staffPosition.name);
        if (teamInfo) {
          const isManager = teamInfo.manager === userId;
          const staffRole = isManager ? 'manager' : 'assistant';
          const roleLabel = isManager ? 'Manager'  : 'Assistant Manager';

          await database.appointStaff(staffPosition.name, null, staffRole);
          logLines.push(`🧹 **${roleLabel}** position cleared from **${staffPosition.name}**.`);
          console.log(
            `[guildMemberRemove] Cleared ${roleLabel} position for ${staffPosition.name} (user: ${userId}).`,
          );
          rosterNeedsUpdate = true;
        }
      }

      if (rosterNeedsUpdate) {
        await updateTeamsRoster(member.client);
      }

    } catch (err) {
      console.error(`[guildMemberRemove] Error processing leave for ${tag} (${userId}):`, err);
    }
  },
};