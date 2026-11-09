const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const database = require('../db/database');
const constants = require('../config/constants');
const builderHelpers = require('../utils/builder-helpers');
const { buildPSLEmbed } = require('../utils/embed-helpers');
const { safeRoleAdd, safeRoleRemove, safeFetchMember } = require('../utils/discord-helpers');
const { canManageTeam, isLeagueAdmin, isTeamManager, requireOfficialGuild, isRegistered } = require('../utils/validations');
const { updateTeamsRoster } = require('../utils/roster-updater');
const { logCommandResult, logValidationFailure } = require('../utils/log-helpers');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('appoint')
    .setDescription('Appoint or remove a manager / assistant manager for a team')
    .addStringOption((option) =>
      option
        .setName('team')
        .setDescription('Select the team')
        .setRequired(true)
        .addChoices(builderHelpers.getTeamChoices()),
    )
    .addStringOption((option) =>
      option
        .setName('role')
        .setDescription('Select the management role')
        .setRequired(true)
        .addChoices(
          { name: 'Manager', value: 'manager' },
          { name: 'Assistant Manager', value: 'assistant' },
        ),
    )
    .addUserOption((option) =>
      option
        .setName('appointee')
        .setDescription('User to appoint (leave empty to remove current staff)')
        .setRequired(false),
    ),

  async execute(interaction) {
    if (!await requireOfficialGuild(interaction)) return;

    const selectedTeam = interaction.options.getString('team');
    const selectedRole = interaction.options.getString('role');
    const appointee = interaction.options.getMember('appointee');
    let displayName;
    let appointeeId;
    const auditTarget = appointee
      ? `**${appointee.displayName}** (\`${appointee.id}\`)`
      : '\`None\`';

    const teamInfo = await database.getTeamInfo(selectedTeam);
    if (!teamInfo) {
      await logValidationFailure(interaction, {
        title: 'Team Not Found',
        command: 'appoint',
        details: [
          { label: 'Team', value: `**${builderHelpers.getFormattedTeamName(selectedTeam)}**` },
          { label: 'Position', value: `\`${selectedRole}\`` },
          { label: 'Target', value: auditTarget },
        ],
        result: 'The selected team does not exist in the database; no appointment change was made.',
        terminalDetails: [
          { label: 'Team', value: selectedTeam },
          { label: 'Position', value: selectedRole },
          { label: 'Target', value: appointee ? `${appointee.displayName} (${appointee.id})` : 'None' },
        ],
      });

      return interaction.editReply({ content: '❌ Team not found.', flags: MessageFlags.Ephemeral });
    }

    const formattedTeamName = `${builderHelpers.getFormattedTeamName(selectedTeam)}`;

    if (!canManageTeam(interaction.member, teamInfo)) {
      return interaction.editReply({ content: '❌ You do not have permission to use this command.', flags: MessageFlags.Ephemeral });
    }

    const isAssistantAppointment = selectedRole === 'assistant';
    const isManager = interaction.user.id === teamInfo.manager;

    if (!isLeagueAdmin(interaction.member) && isManager && !isAssistantAppointment) {
      return interaction.editReply({
        content: '❌ Managers can only appoint their **assistant manager**.',
        flags: MessageFlags.Ephemeral
      });
    }

    const isRoleManager = selectedRole === 'manager';
    const currentStaffId = isRoleManager ? teamInfo.manager : teamInfo.assistantManager;
    const currentStaffMember = currentStaffId ? await safeFetchMember(interaction.guild, currentStaffId) : null;
    const currentStaffDisplayName = currentStaffId ? currentStaffMember?.displayName || 'Unknown member' : '*Vacant*';
    const globalRoleId = isRoleManager ? constants.MANAGER_ROLE_ID : constants.ASSISTANT_MANAGER_ROLE_ID;
    const roleName = isRoleManager ? 'Manager' : 'Assistant Manager';

    try {
      if (!appointee) {
        if (!currentStaffId) {
          await logValidationFailure(interaction, {
            title: 'Position Already Empty',
            command: 'appoint',
            details: [
              { label: 'Team', value: `**${formattedTeamName}**` },
              { label: 'Position', value: `\`${roleName}\`` },
              { label: 'Target', value: '\`None\`' },
            ],
            result: 'The position was already empty; no appointment change was made.',
            terminalDetails: [
              { label: 'Team', value: selectedTeam },
              { label: 'Position', value: roleName },
              { label: 'Target', value: 'None' },
            ],
          });

          return interaction.editReply({
            content: `❌ The **${roleName}** position for **${formattedTeamName}** is already empty.`,
            flags: MessageFlags.Ephemeral
          });
        }

        await database.appointStaff(selectedTeam, null, selectedRole);

        await logCommandResult(interaction, {
          command: 'appoint',
          title: 'Staff Position Cleared',
          details: [
            { label: 'Team', value: `**${formattedTeamName}**`, terminalValue: selectedTeam },
            { label: 'Position', value: roleName, terminalValue: roleName },
            { label: 'Former Staff', value: `**${currentStaffDisplayName}** (\`${currentStaffId}\`)`, terminalValue: `${currentStaffDisplayName} (${currentStaffId})` },
          ],
          result: `The ${roleName} position for **${formattedTeamName}** was cleared.`,
          terminalResult: `${roleName} position cleared for ${selectedTeam}.`,
        });

        await interaction.editReply({
          content: `🧹 The **${roleName}** position for **${formattedTeamName}** has been cleared.`,
          flags: MessageFlags.Ephemeral
        });

        (async () => {
          try {
            const followUpIssues = [];
            const [oldMember, clearedUser, role] = await Promise.all([
              safeFetchMember(interaction.guild, currentStaffId),
              interaction.client.users.fetch(currentStaffId).catch(() => null),
              builderHelpers.getTeamRole(interaction.client, selectedTeam)
            ]);

            if (oldMember) {
              const roleRemoved = await safeRoleRemove(oldMember, globalRoleId);
              if (!roleRemoved) followUpIssues.push('The former staff member retained the global staff role.');
              console.log(`[appoint.js] Revoked staff roles from ${currentStaffId} (unappoint).`);
            }

            const appointmentsChannel = await interaction.client.channels
              .fetch(constants.APPOINTMENTS_CHANNEL_ID)
              .catch(() => null);
            if (appointmentsChannel) {
              const clearEmbed = buildPSLEmbed(interaction.client, role?.color || constants.DEFAULT_EMBED_COLOR)
                .setTitle(`**${formattedTeamName}** Official Staff Clearance 🧹`)
                .addFields({
                  name: 'Position Cleared',
                  value: clearedUser
                    ? `**${currentStaffDisplayName}** has been removed from the **${roleName}** role for **${formattedTeamName}**. 📋`
                    : `The **${roleName}** position has been cleared and all associated roles have been revoked. 📋`,
                });

              if (clearedUser) {
                clearEmbed.setThumbnail(clearedUser.displayAvatarURL({ dynamic: true }));
              }

              const mention = `<@&${teamInfo.roleId}>`;
              await appointmentsChannel.send({ content: mention, embeds: [clearEmbed] }).catch(() => {
                followUpIssues.push('The public staff-clearance announcement could not be sent.');
              });
            } else {
              followUpIssues.push('The staff-clearance announcement channel was unavailable.');
            }

            await updateTeamsRoster(interaction.client);
            if (followUpIssues.length) {
              await logCommandResult(interaction, {
                type: 'error',
                title: 'Position Cleared With Follow-Up Issues',
                command: 'appoint',
                details: [
                  { label: 'Team', value: `**${formattedTeamName}**`, terminalValue: selectedTeam },
                  { label: 'Position', value: roleName, terminalValue: roleName },
                  { label: 'Former Staff', value: `**${currentStaffDisplayName}** (\`${currentStaffId}\`)`, terminalValue: `${currentStaffDisplayName} (${currentStaffId})` },
                  { label: 'Follow-Up Issues', value: followUpIssues.join('\n'), terminalValue: followUpIssues.join('; ') },
                ],
                result: 'The database position was cleared, but one or more Discord role or announcement follow-ups failed.',
                terminalResult: `Position cleared for ${selectedTeam}; follow-up issues: ${followUpIssues.join('; ')}.`,
              });
            }
          } catch (backgroundError) {
            await logCommandResult(interaction, {
              type: 'error',
              title: 'Position Cleared With Follow-Up Failure',
              command: 'appoint',
              details: [
                { label: 'Team', value: `**${formattedTeamName}**`, terminalValue: selectedTeam },
                { label: 'Position', value: roleName, terminalValue: roleName },
                { label: 'Former Staff', value: `**${currentStaffDisplayName}** (\`${currentStaffId}\`)`, terminalValue: `${currentStaffDisplayName} (${currentStaffId})` },
              ],
              result: 'The database position was cleared, but a follow-up role, roster, or announcement operation failed. Manual review may be required.',
              terminalResult: `Position cleared for ${selectedTeam}, but a follow-up operation failed.`,
              error: backgroundError,
            });
          }
        })();

        return;
      }

      if (appointee.user.bot) {
        console.log(`⚠️ [VALIDATION] /appoint target ${appointee.user.tag} (${appointee.id}) is a bot; command terminated.`);

        return interaction.editReply({ content: '❌ You cannot appoint a bot.', flags: MessageFlags.Ephemeral });
      }

      displayName = appointee.displayName;
      appointeeId = appointee.id;

      if (!(await isRegistered(appointee))) {
        await logValidationFailure(interaction, {
          title: 'Player Not Registered',
          command: 'appoint',
          details: [
            { label: 'Team', value: `**${formattedTeamName}**` },
            { label: 'Position', value: `\`${roleName}\`` },
            { label: 'Target', value: `**${displayName}** (\`${appointeeId}\`)` },
          ],
          result: 'The selected player is not registered; no appointment change was made.',
          terminalDetails: [
            { label: 'Team', value: selectedTeam },
            { label: 'Position', value: roleName },
            { label: 'Target', value: `${displayName} (${appointeeId})` },
          ],
        });

        return interaction.editReply({
          content: `❌ <@${appointeeId}> has not registered themselves yet.`,
          flags: MessageFlags.Ephemeral
        });
      }

      if (isRoleManager) {
        const restrictedActions = await database.getPlayerRestrictedActions(appointeeId);
        if (restrictedActions && restrictedActions.includes('MANAGING')) {
          await logValidationFailure(interaction, {
            title: 'Frozen From Managing',
            command: 'appoint',
            details: [
              { label: 'Team', value: `**${formattedTeamName}**` },
              { label: 'Position', value: `\`${roleName}\`` },
              { label: 'Target', value: `**${displayName}** (\`${appointeeId}\`)` },
            ],
            result: 'The selected player is restricted from managing a team; no appointment change was made.',
            terminalDetails: [
              { label: 'Team', value: selectedTeam },
              { label: 'Position', value: roleName },
              { label: 'Target', value: `${displayName} (${appointeeId})` },
            ],
          });

          return interaction.editReply({
            content: `❌ <@${appointeeId}> is currently frozen from managing a team.`,
            flags: MessageFlags.Ephemeral
          });
        }
      }

      const [isStaffElsewhere, existingContract] = await Promise.all([
        database.isUserStaffAnywhere(appointeeId),
        database.getContractedTeam(appointeeId)
      ]);

      if (currentStaffId) {
        await logValidationFailure(interaction, {
          title: 'Already In Management',
          command: 'appoint',
          details: [
            { label: 'Team', value: `**${formattedTeamName}**` },
            { label: 'Position', value: `\`${roleName}\`` },
            { label: 'Target', value: `**${displayName}** (\`${appointeeId}\`)` },
            { label: 'Current Occupant', value: `**${currentStaffDisplayName}** (\`${currentStaffId}\`)` },
          ],
          result: 'The position is already occupied; no appointment change was made.',
          terminalDetails: [
            { label: 'Team', value: selectedTeam },
            { label: 'Position', value: roleName },
            { label: 'Target', value: `${displayName} (${appointeeId})` },
            { label: 'Current Occupant', value: `${currentStaffDisplayName} (${currentStaffId})` },
          ],
        });

        return interaction.editReply({
          content: `❌ <@${currentStaffId}> is already in the management of another position for this team. Clear their current role first.`,
          flags: MessageFlags.Ephemeral
        });
      }

      if (isStaffElsewhere) {
        const formattedStaffTeam = builderHelpers.getFormattedTeamName(isStaffElsewhere.name);

        await logValidationFailure(interaction, {
          title: 'Staff Elsewhere',
          command: 'appoint',
          details: [
            { label: 'Team', value: `**${formattedTeamName}**` },
            { label: 'Position', value: `\`${roleName}\`` },
            { label: 'Target', value: `**${displayName}** (\`${appointeeId}\`)` },
          ],
          result: `The selected player is already staff for **${builderHelpers.getFormattedTeamName(isStaffElsewhere.name)}**; no appointment change was made.`,
          terminalResult: `The selected player is already staff for ${isStaffElsewhere.name}; no appointment change was made.`,
          terminalDetails: [
            { label: 'Team', value: selectedTeam },
            { label: 'Position', value: roleName },
            { label: 'Target', value: `${displayName} (${appointeeId})` },
          ],
        });

        return interaction.editReply({
          content: `❌ <@${appointeeId}> is already staff for **${formattedStaffTeam}**.`,
          flags: MessageFlags.Ephemeral
        });
      }

      if (existingContract && existingContract.teamName !== selectedTeam) {
        const otherTeam = builderHelpers.getFormattedTeamName(existingContract.teamName);

        await logValidationFailure(interaction, {
          title: 'Player Elsewhere',
          command: 'appoint',
          details: [
            { label: 'Team', value: `**${formattedTeamName}**` },
            { label: 'Position', value: `\`${roleName}\`` },
            { label: 'Target', value: `**${displayName}** (\`${appointeeId}\`)` },
          ],
          result: `The selected player is already contracted to **${builderHelpers.getFormattedTeamName(existingContract.teamName)}**; no appointment change was made.`,
          terminalResult: `The selected player is already contracted to ${existingContract.teamName}; no appointment change was made.`,
          terminalDetails: [
            { label: 'Team', value: selectedTeam },
            { label: 'Position', value: roleName },
            { label: 'Target', value: `${displayName} (${appointeeId})` },
          ],
        });

        return interaction.editReply({
          content: `❌ <@${appointeeId}> is a registered player for **${otherTeam}**.`,
          flags: MessageFlags.Ephemeral
        });
      }

      await database.appointStaff(selectedTeam, appointeeId, selectedRole);
      if (!existingContract || existingContract.teamName !== selectedTeam) {
        await database.contractPlayer(appointeeId, selectedTeam, false);
      }

      await logCommandResult(interaction, {
        command: 'appoint',
        title: 'Staff Appointment Completed',
        details: [
          { label: 'Team', value: `**${formattedTeamName}**`, terminalValue: selectedTeam },
          { label: 'Position', value: roleName, terminalValue: roleName },
          { label: 'Appointee', value: `**${displayName}** (\`${appointeeId}\`)`, terminalValue: `${displayName} (${appointeeId})` },
          ...(currentStaffId ? [{
            label: 'Replaced Staff',
            value: `**${currentStaffDisplayName}** (\`${currentStaffId}\`)`,
            terminalValue: `${currentStaffDisplayName} (${currentStaffId})`,
          }] : []),
        ],
        result: `${displayName} was appointed as ${roleName} for **${formattedTeamName}**.`,
        terminalResult: `${displayName} (${appointeeId}) appointed as ${roleName} for ${selectedTeam}.`,
      });

      await interaction.editReply({
        content: `✅ <@${appointeeId}> has been appointed as **${roleName}** for **${formattedTeamName}**.`,
        flags: MessageFlags.Ephemeral
      });

      (async () => {
        try {
          const followUpIssues = [];
          if (currentStaffId && currentStaffId !== appointeeId) {
            const oldMember = await safeFetchMember(interaction.guild, currentStaffId);
            if (oldMember) {
              const outgoingRoleResults = await Promise.all([
                safeRoleRemove(oldMember, globalRoleId),
                safeRoleRemove(oldMember, teamInfo.roleId),
              ]);
              if (outgoingRoleResults.some(roleRemoved => !roleRemoved)) {
                followUpIssues.push('One or more Discord staff/team roles remained on the former occupant.');
              }
              console.log(`[appoint.js] Stripped outgoing staff roles from ${currentStaffId}.`);
            }
          }

          const [targetMember, role, teamCapacity] = await Promise.all([
            safeFetchMember(interaction.guild, appointeeId),
            builderHelpers.getTeamRole(interaction.client, selectedTeam),
            builderHelpers.getDisplayedPlayersAmount(selectedTeam)
          ]);

          if (targetMember) {
            const assignedRoleResults = await Promise.all([
              safeRoleAdd(targetMember, globalRoleId),
              safeRoleAdd(targetMember, teamInfo.roleId),
            ]);
            if (assignedRoleResults.some(roleAdded => !roleAdded)) {
              followUpIssues.push('One or more Discord staff/team roles could not be assigned to the appointee.');
            }
          } else {
            followUpIssues.push('The appointee could not be found in the server to assign Discord roles.');
          }

          const appointmentsChannel = await interaction.client.channels
            .fetch(constants.APPOINTMENTS_CHANNEL_ID)
            .catch(() => null);
          if (appointmentsChannel) {
            const appointEmbed = buildPSLEmbed(interaction.client, role?.color || constants.DEFAULT_EMBED_COLOR)
              .setTitle(`**${formattedTeamName}** Official Staff Appointment`)
              .setThumbnail(appointee.displayAvatarURL({ dynamic: true }))
              .addFields(
                {
                  name: 'Staff Appointed',
                  value: `**${displayName}** has been officially appointed as **${roleName}** for **${formattedTeamName}**! 📝`,
                },
                {
                  name: 'Team Capacity',
                  value: teamCapacity,
                },
              );

            const mentions = `<@${appointeeId}> <@&${teamInfo.roleId}>`;
            await appointmentsChannel.send({ content: mentions, embeds: [appointEmbed] }).catch(() => {
              followUpIssues.push('The public staff-appointment announcement could not be sent.');
            });
          } else {
            followUpIssues.push('The staff-appointment announcement channel was unavailable.');
          }

          await updateTeamsRoster(interaction.client);
          if (followUpIssues.length) {
            await logCommandResult(interaction, {
              type: 'error',
              title: 'Staff Appointment Completed With Follow-Up Issues',
              command: 'appoint',
              details: [
                { label: 'Team', value: `**${formattedTeamName}**`, terminalValue: selectedTeam },
                { label: 'Position', value: roleName, terminalValue: roleName },
                { label: 'Appointee', value: `**${displayName}** (\`${appointeeId}\`)`, terminalValue: `${displayName} (${appointeeId})` },
                { label: 'Follow-Up Issues', value: followUpIssues.join('\n'), terminalValue: followUpIssues.join('; ') },
              ],
              result: 'The database appointment was completed, but one or more Discord role or announcement follow-ups failed.',
              terminalResult: `Appointment completed for ${selectedTeam}; follow-up issues: ${followUpIssues.join('; ')}.`,
            });
          }
        } catch (backgroundError) {
          await logCommandResult(interaction, {
            type: 'error',
            title: 'Staff Appointment Completed With Follow-Up Failure',
            command: 'appoint',
            details: [
              { label: 'Team', value: `**${formattedTeamName}**`, terminalValue: selectedTeam },
              { label: 'Position', value: roleName, terminalValue: roleName },
              { label: 'Appointee', value: `**${displayName}** (\`${appointeeId}\`)`, terminalValue: `${displayName} (${appointeeId})` },
            ],
            result: 'The database appointment was completed, but a Discord role, roster, or announcement follow-up failed. Manual review may be required.',
            terminalResult: `Appointment completed for ${selectedTeam}, but a follow-up operation failed.`,
            error: backgroundError,
          });
        }
      })();

    } catch (error) {
      await logCommandResult(interaction, {
        type: 'error',
        title: 'Staff Appointment Failed',
        command: 'appoint',
        details: [
          { label: 'Team', value: `**${formattedTeamName}**`, terminalValue: selectedTeam },
          { label: 'Position', value: roleName, terminalValue: roleName },
          ...(appointeeId ? [{
            label: 'Target',
            value: `**${displayName}** (\`${appointeeId}\`)`,
            terminalValue: `${displayName} (${appointeeId})`,
          }] : []),
        ],
        result: 'The staff appointment operation failed unexpectedly. Verify the team position and member roles before retrying.',
        terminalResult: `Staff appointment failed for ${selectedTeam} (${roleName}).`,
        error,
      });

      if (error.code === 50013 && !interaction.replied) {
        return interaction.editReply({
          content: "❌ **Hierarchy Error:** Move the bot's role higher in Server Settings.",
          flags: MessageFlags.Ephemeral,
        });
      }
      if (!interaction.replied) {
        interaction.editReply({
          content: '❌ An unexpected error occurred during this appointment.',
          flags: MessageFlags.Ephemeral,
        });
      }
    }
  },
};