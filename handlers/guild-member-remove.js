const { Events } = require('discord.js');
const { getRobloxUserProfile, getGroupMembership, updateGroupRoleset } = require('../utils/roblox-helpers');
const { buildPSLEmbed } = require('../utils/embed-helpers');
const { updateTeamsRoster } = require('../utils/roster-updater');
const builderHelpers = require('../utils/builder-helpers');
const database = require('../db/database');
const constants = require('../config/constants');

const ROLE_IDS_TO_NOT_REMOVE = ['655167005', '467994038'];
const UNASSIGN_INTERVAL = 600;

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

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
          const isManager = teamInfo.manager === userId;
          const isAssistant = teamInfo.assistantManager === userId;

          const formattedTeamName = `**${builderHelpers.getFormattedTeamName(activeContract.teamName)}**`;
          const staffMentions = [
            teamInfo.manager && !isManager ? `<@${teamInfo.manager}>` : null,
            teamInfo.assistantManager && !isAssistant ? `<@${teamInfo.assistantManager}>` : null
          ].filter(Boolean);
          const mentionContent = staffMentions.length > 0 ? staffMentions.join(' ') : null;

          const embed = buildPSLEmbed(member.client, role?.color || constants.DEFAULT_EMBED_COLOR)
            .setTitle(`${formattedTeamName} Automatic Release`)
            .setThumbnail(member.user.displayAvatarURL({ dynamic: true }))
            .addFields({
              name: 'Player Released',
              value: `**${displayName}** has left the server and has been automatically released from ${formattedTeamName}. 📋`,
            })

          await releasesChannel.send({ content: mentionContent || undefined, embeds: [embed] }).catch(console.warn);
        }
      }

      const staffPosition = await database.isUserStaffAnywhere(userId);
      if (staffPosition) {
        const teamInfo = await database.getTeamInfo(staffPosition.name);
        if (teamInfo) {
          const isManager = teamInfo.manager === userId;
          const isAssistant = teamInfo.assistantManager === userId;
          const staffRole = isManager ? 'manager' : 'assistant';
          const roleLabel = isManager ? 'Manager' : 'Assistant Manager';

          await database.appointStaff(staffPosition.name, null, staffRole);
          console.log(`[guild-member-remove.js] Cleared ${roleLabel} for ${staffPosition.name} (user: ${userId}).`);
          rosterNeedsUpdate = true;

          const appointmentsChannel = await member.client.channels.fetch(constants.APPOINTMENTS_CHANNEL_ID).catch(() => null);
          if (appointmentsChannel) {
            const role = await builderHelpers.getTeamRole(member.client, staffPosition.name).catch(() => null);
            const formattedTeamName = `**${builderHelpers.getFormattedTeamName(staffPosition.name)}**`;
            const staffMentions = [
              teamInfo.manager && !isManager ? `<@${teamInfo.manager}>` : null,
              teamInfo.assistantManager && !isAssistant ? `<@${teamInfo.assistantManager}>` : null,
              teamInfo.roleId ? `<@&${teamInfo.roleId}>` : null,
            ].filter(Boolean);
            const mentionContent = staffMentions.length > 0 ? staffMentions.join(' ') : null;

            const embed = buildPSLEmbed(member.client, role?.color || constants.DEFAULT_EMBED_COLOR)
              .setTitle(`${formattedTeamName} Automatic Staff Clearance`)
              .setThumbnail(member.user.displayAvatarURL({ dynamic: true }))
              .addFields({
                name: 'Position Cleared',
                value: `**${displayName}** has left the server and their **${roleLabel}** position for ${formattedTeamName} has been automatically vacated. 📋`,
              })

            await appointmentsChannel.send({ content: mentionContent || undefined, embeds: [embed] }).catch(console.warn);
          }
        }
      }

      const userResponse = await getRobloxUserProfile(displayName);
      if (userResponse) {
        const robloxUserId = userResponse.id;
        const groupMembership = await getGroupMembership(constants.ROBLOX_GROUP_ID, robloxUserId);

        const userRoleIds = groupMembership.roles.map(rolePath => rolePath.split('/').pop());
        const roleIdsToRemove = userRoleIds.filter(roleId => !ROLE_IDS_TO_NOT_REMOVE.includes(roleId));

        for (const roleId of roleIdsToRemove) {
          await updateGroupRoleset(constants.ROBLOX_GROUP_ID, groupMembership.path, roleId, 'unassignRole');
          sleep(UNASSIGN_INTERVAL);
        }

        console.log(`[guild-member-remove.js] Unassigned ${roleIdsToRemove.length} roles from Roblox user ${displayName} (${robloxUserId})`);
      }

      if (rosterNeedsUpdate) {
        await updateTeamsRoster(member.client);
      }

    } catch (error) {
      console.error(`[guild-member-remove.js] Error processing leave for ${tag} (${userId}): ${error}`);
    }
  },
};