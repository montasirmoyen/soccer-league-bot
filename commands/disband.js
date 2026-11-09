const {
    SlashCommandBuilder,
    MessageFlags
} = require('discord.js');
const database = require('../db/database');
const constants = require('../config/constants');
const builderHelpers = require('../utils/builder-helpers');
const { safeRoleRemove, safeFetchMember } = require('../utils/discord-helpers');
const { buildPSLEmbed } = require('../utils/embed-helpers');
const { requireOfficialGuild, requireLeagueAdmin } = require('../utils/validations');
const { updateTeamsRoster } = require('../utils/roster-updater');
const { logCommandResult, logValidationFailure } = require('../utils/log-helpers');

const CONFIRMATION_MESSAGE = 'I confirm disbanding this team and accepting the consequences.';

module.exports = {
    data: new SlashCommandBuilder()
        .setName('disband')
        .setDescription('Disband a team and remove all members from the roster')
        .addStringOption((option) =>
            option
                .setName('team')
                .setDescription('Select your team')
                .setRequired(true)
                .addChoices(builderHelpers.getTeamChoices()),
        )
        .addStringOption((option) =>
            option
                .setName('confirmation-message')
                .setDescription(`Send "${CONFIRMATION_MESSAGE}"`)
                .setRequired(true),
        ),

    async execute(interaction) {
        if (!await requireOfficialGuild(interaction)) return;

        if (!await requireLeagueAdmin(interaction)) return;

        const selectedTeam = interaction.options.getString('team');
        const confirmationMessage = interaction.options.getString('confirmation-message');
        const displayName = interaction.member.displayName;
        const formattedTeam = builderHelpers.getFormattedTeamName(selectedTeam);

        if (confirmationMessage !== CONFIRMATION_MESSAGE) {
            await logValidationFailure(interaction, {
                title: 'Team Disband Confirmation Rejected',
                command: 'disband',
                details: [{ label: 'Team', value: `**${formattedTeam}**` }],
                terminalDetails: [{ label: 'Team', value: selectedTeam }],
                result: 'The required confirmation phrase did not match; the team was not disbanded.',
            });
            return interaction.editReply({
                content: `❌ The disband confirmation message does not match. Disband for **${formattedTeam}** was not executed.`,
                flags: MessageFlags.Ephemeral
            });
        }

        let disbandApplied = false;

        try {
            const teamInfo = await database.getTeamInfo(selectedTeam);
            const teamPlayers = await database.getPlayersByTeam(selectedTeam);

            if (!teamInfo) {
                await logValidationFailure(interaction, {
                    title: 'Team Not Found',
                    command: 'disband',
                    details: [{ label: 'Team', value: `**${formattedTeam}**` }],
                    terminalDetails: [{ label: 'Team', value: selectedTeam }],
                    result: 'The selected team does not exist in the database; no disband was performed.',
                });
                return interaction.editReply({
                    content: `❌ **${formattedTeam}** was not found in the database.`,
                    flags: MessageFlags.Ephemeral,
                });
            }

            const teamManager = teamInfo.manager;
            const teamAssistant = teamInfo.assistantManager;

            if (!teamPlayers.length) {
                await logValidationFailure(interaction, {
                    title: 'Team Has No Players',
                    command: 'disband',
                    details: [{ label: 'Team', value: `**${formattedTeam}**` }],
                    terminalDetails: [{ label: 'Team', value: selectedTeam }],
                    result: 'The team has no contracted players; no disband was performed.',
                });
                return interaction.editReply({
                    content: `❌ **${formattedTeam}** has no players to disband.`,
                    flags: MessageFlags.Ephemeral,
                });
            }

            await database.disbandTeam(selectedTeam);
            disbandApplied = true;

            const role = await builderHelpers.getTeamRole(interaction.client, selectedTeam);

            const disbandsChannel = await interaction.guild.channels.fetch(constants.DISBANDS_CHANNEL_ID);
            if (disbandsChannel) {
                const disbandEmbed = buildPSLEmbed(interaction.client, role?.color || constants.DEFAULT_EMBED_COLOR)
                    .setTitle(`${formattedTeam} Official Disband`)
                    .setDescription(`**${displayName}** has disbanded **${formattedTeam}**. All members in the roster have been released from their contracts and/or appointments.`)
                await disbandsChannel.send({ content: `<@&${teamInfo.roleId}>`, embeds: [disbandEmbed] });
            }

            const playerIds = teamPlayers.map(player => player.userId);
            const memberIds = [...new Set([...playerIds, teamManager, teamAssistant].filter(Boolean))];
            const membersMap = await safeFetchMember(interaction.guild, memberIds);
            const failedRoleRemovals = [];

            const removalPromises = playerIds.map(async (player) => {
                const member = membersMap.get(player);
                if (!member) return;

                if (member.roles.cache.has(teamInfo.roleId)) {
                    if (!await safeRoleRemove(member, teamInfo.roleId)) {
                        failedRoleRemovals.push({ userId: player, roleId: teamInfo.roleId });
                    }
                }

                if (player !== teamManager && player !== teamAssistant) return;

                const roleToRemove = player === teamManager
                    ? constants.MANAGER_ROLE_ID
                    : constants.ASSISTANT_MANAGER_ROLE_ID;

                if (member.roles.cache.has(roleToRemove)) {
                    if (!await safeRoleRemove(member, roleToRemove)) {
                        failedRoleRemovals.push({ userId: player, roleId: roleToRemove });
                    }
                }
            });

            await Promise.all(removalPromises);

            await updateTeamsRoster(interaction.client);

            const auditDetails = [
                { label: 'Team', value: `**${formattedTeam}**`, terminalValue: selectedTeam },
                { label: 'Contracted Players', value: String(teamPlayers.length), terminalValue: String(teamPlayers.length) },
                {
                    label: 'Manager',
                    value: teamManager
                        ? `**${membersMap.get(teamManager)?.displayName || 'Unknown member'}** (\`${teamManager}\`)`
                        : 'None',
                    terminalValue: teamManager
                        ? `${membersMap.get(teamManager)?.displayName || 'Unknown member'} (${teamManager})`
                        : 'None',
                },
                {
                    label: 'Assistant Manager',
                    value: teamAssistant
                        ? `**${membersMap.get(teamAssistant)?.displayName || 'Unknown member'}** (\`${teamAssistant}\`)`
                        : 'None',
                    terminalValue: teamAssistant
                        ? `${membersMap.get(teamAssistant)?.displayName || 'Unknown member'} (${teamAssistant})`
                        : 'None',
                },
            ];

            if (failedRoleRemovals.length) {
                const failedRemovalsSummary = failedRoleRemovals
                    .map(({ userId: affectedUserId, roleId }) => {
                        const member = membersMap.get(affectedUserId);
                        return `**${member?.displayName || 'Unknown member'}** (\`${affectedUserId}\`) — role \`${roleId}\``;
                    })
                    .join('\n');
                await logCommandResult(interaction, {
                    type: 'error',
                    title: 'Disband Completed With Role Cleanup Issues',
                    command: 'disband',
                    details: [
                        ...auditDetails,
                        {
                            label: 'Failed Role Removals',
                            value: failedRemovalsSummary,
                            terminalValue: failedRoleRemovals.map(({ userId: affectedUserId, roleId }) => {
                                const member = membersMap.get(affectedUserId);
                                return `${member?.displayName || 'Unknown member'} (${affectedUserId}) — role ${roleId}`;
                            }).join('; '),
                        },
                    ],
                    result: `**${formattedTeam}** was removed from the database, but some Discord roles could not be removed. Manual cleanup may be required.`,
                    terminalResult: `Disband completed; ${failedRoleRemovals.length} Discord role removal(s) failed.`,
                });

                await interaction.editReply({
                    content: `⚠️ **${formattedTeam}** was disbanded, but some Discord roles could not be removed. Staff may need to clean them up manually.`,
                    flags: MessageFlags.Ephemeral,
                });
                return;
            }

            const affectedPlayers = playerIds
                .map((affectedUserId) => {
                    const member = membersMap.get(affectedUserId);
                    const affectedDisplayName = member?.displayName || 'Unknown member';
                    return `\`${affectedDisplayName}\` (\`${affectedUserId}\`)`;
                })
                .join('\n');

            await logCommandResult(interaction, {
                command: 'disband',
                title: 'Team Disbanded',
                details: [
                    ...auditDetails,
                    {
                        label: 'Released Players',
                        value: affectedPlayers || 'None',
                        terminalValue: playerIds.map((affectedUserId) => {
                            const member = membersMap.get(affectedUserId);
                            return `${member?.displayName || 'Unknown member'} (${affectedUserId})`;
                        }).join(', ') || 'None',
                    },
                ],
                result: `**${formattedTeam}** was disbanded successfully. Its contracts and staff appointments were cleared, and team roles were removed.`,
            });

            await interaction.editReply({
                content: `⚠️ Disbanded **${formattedTeam}**. This action is **irreversible**.`,
                flags: MessageFlags.Ephemeral,
            });

        } catch (error) {
            await logCommandResult(interaction, {
                type: 'error',
                title: disbandApplied ? 'Disband Follow-Up Failed' : 'Disband Failed',
                command: 'disband',
                details: [
                    { label: 'Team', value: `**${formattedTeam}**`, terminalValue: selectedTeam },
                ],
                result: disbandApplied
                    ? `The database disband for **${formattedTeam}** completed, but a follow-up notification or cleanup step failed. Manual review may be required.`
                    : `The command failed before completion of the disband for **${formattedTeam}** could be confirmed. Verify the team's state before retrying.`,
                terminalResult: disbandApplied
                    ? 'Database disband completed, but a follow-up operation failed.'
                    : 'Disband failed before completion could be confirmed.',
                error,
            });
            if (!interaction.replied) {
                return interaction.editReply({
                    content: '❌ An unexpected error occurred while processing the disband request.',
                    flags: MessageFlags.Ephemeral,
                });
            }
        }
    },
};