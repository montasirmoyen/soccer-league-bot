const { Events } = require('discord.js');
const database = require('../db/database');
const constants = require('../config/constants');
const builderHelpers = require('../utils/builder-helpers');
const { buildPSLEmbed } = require('../utils/embed-helpers');
const { updateTeamsRoster } = require('../utils/roster-updater');

module.exports = {
  name: Events.GuildMemberRemove,

  async execute(member) {
    if (member.guild.id !== constants.GUILD_ID) return;

    const userId = member.user.id;
    const tag = member.user.tag;
    const displayName = member.displayName;
    let rosterNeedsUpdate = false;

    try {
      const activeContract = await database.getContractedTeam(userId);
      if (activeContract) {
        await database.releasePlayer(userId);
        console.log(`[guild-member-remove.js] Released ${tag} (${userId}) from ${activeContract.teamName}.`);
        rosterNeedsUpdate = true;

        const releasesChannel = await member.client.channels.fetch(constants.RELEASES_CHANNEL_ID).catch(() => null);
        if (releasesChannel) {
          const [teamInfo, role] = await Promise.all([
            database.getTeamInfo(activeContract.teamName).catch(() => null),
            builderHelpers.getTeamRole(member.client, activeContract.teamName).catch(() => null)
          ]);
          const formattedTeamName = `**${builderHelpers.getFormattedTeamName(activeContract.teamName).toUpperCase()}**`;
          const staffMentions = [
            teamInfo?.manager ? `<@${teamInfo.manager}>` : null,
            teamInfo?.assistantManager ? `<@${teamInfo.assistantManager}>` : null,
          ].filter(Boolean);
          const mentionContent = staffMentions.length > 0 ? staffMentions.join(' ') : null;

          const embed = buildPSLEmbed(member.client, role?.color || constants.DEFAULT_EMBED_COLOR)
            .setTitle(`${formattedTeamName} AUTOMATIC RELEASE`)
            .setThumbnail(member.user.displayAvatarURL({ dynamic: true }))
            .addFields({
              name: 'Player Released',
              value: `**${displayName}** has left the server and has been automatically released from ${formattedTeamName}. 📋`,
            })
            .setTimestamp();

          await releasesChannel.send({ content: mentionContent || undefined, embeds: [embed] }).catch(console.warn);
        }
      }

      const staffPosition = await database.isUserStaffAnywhere(userId);
      if (staffPosition) {
        const teamInfo = await database.getTeamInfo(staffPosition.name);
        if (teamInfo) {
          const isManager = teamInfo.manager === userId;
          const staffRole = isManager ? 'manager' : 'assistant';
          const roleLabel = isManager ? 'Manager' : 'Assistant Manager';

          await database.appointStaff(staffPosition.name, null, staffRole);
          console.log(`[guild-member-remove.js] Cleared ${roleLabel} for ${staffPosition.name} (user: ${userId}).`);
          rosterNeedsUpdate = true;

          const appointmentsChannel = await member.client.channels.fetch(constants.APPOINTMENTS_CHANNEL_ID).catch(() => null);
          if (appointmentsChannel) {
            const role = await builderHelpers.getTeamRole(member.client, staffPosition.name).catch(() => null);
            const formattedTeamName = `**${builderHelpers.getFormattedTeamName(staffPosition.name).toUpperCase()}**`;
            const staffMentions = [
              teamInfo.manager ? `<@${teamInfo.manager}>` : null,
              teamInfo.assistantManager ? `<@${teamInfo.assistantManager}>` : null,
              teamInfo.roleId ? `<@&${teamInfo.roleId}>` : null,
            ].filter(Boolean);
            const mentionContent = staffMentions.length > 0 ? staffMentions.join(' ') : null;

            const embed = buildPSLEmbed(member.client, role?.color || constants.DEFAULT_EMBED_COLOR)
              .setTitle(`${formattedTeamName} AUTOMATIC STAFF CLEARANCE`)
              .setThumbnail(member.user.displayAvatarURL({ dynamic: true }))
              .addFields({
                name: 'Position Cleared',
                value: `**${displayName}** has left the server and their **${roleLabel}** position for ${formattedTeamName} has been automatically vacated. 📋`,
              })
              .setTimestamp();

            await appointmentsChannel.send({ content: mentionContent || undefined, embeds: [embed] }).catch(console.warn);
          }
        }
      }

      if (rosterNeedsUpdate) {
        await updateTeamsRoster(member.client);
      }

    } catch (err) {
      console.error(`[guild-member-remove.js] Error processing leave for ${tag} (${userId}):`, err);
    }
  },
};