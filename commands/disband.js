const {
    SlashCommandBuilder,
    MessageFlags
} = require('discord.js');
const database = require('../db/database');
const constants = require('../config/constants');
const builderHelpers = require('../utils/builder-helpers');
const { safeRoleRemove, safeFetchMember } = require('../utils/discord-helpers');
const { buildPSLEmbed } = require('../utils/embed-helpers');
const { validateGuild, isChairman } = require('../utils/validations');
const { updateTeamsRoster } = require('../utils/roster-updater');

const CONFIRMATION_MESSAGE = 'I confirm disbanding this team and accepting the consequences.';

module.exports = {
    data: new SlashCommandBuilder()
        .setName('disband')
        .setDescription("Disbands a team and removes all members from the roster.")
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
                .setDescription(`Write "${CONFIRMATION_MESSAGE}"`)
                .setRequired(true),
        ),

    async execute(interaction) {
        if (!validateGuild(interaction)) {
            return interaction.editReply({
                content: '❌ You can only execute this command in the official server.',
                flags: MessageFlags.Ephemeral,
            });
        }

        if (!isChairman(interaction.member)) {
            return interaction.editReply({
                content: `❌ You don't have permission to disband a team.`,
                flags: MessageFlags.Ephemeral,
            });
        }

        const selectedTeam = interaction.options.getString('team');
        const confirmationMessage = interaction.options.getString('confirmation-message');
        const userId = interaction.user.id;
        const displayName = interaction.member.displayName;
        const formattedTeam = builderHelpers.getFormattedTeamName(selectedTeam);

        if (confirmationMessage !== CONFIRMATION_MESSAGE) {
            return interaction.editReply({
                content: `❌ The disband confirmation message does not match. Disband for **${formattedTeam}** was not executed.`,
                flags: MessageFlags.Ephemeral
            });
        }

        try {
            const teamInfo = await database.getTeamInfo(selectedTeam);
            const teamPlayers = await database.getPlayersByTeam(selectedTeam);
            const teamManager = teamInfo.manager;
            const teamAssistant = teamInfo.assistantManager;

            if (!teamPlayers.length) return interaction.editReply({
                content: `❌ **${formattedTeam}** has no players to disband.`,
                flags: MessageFlags.Ephemeral
            });

            await database.disbandTeam(selectedTeam);

            const role = await builderHelpers.getTeamRole(interaction.client, selectedTeam);

            const disbandsChannel = await interaction.guild.channels.fetch(constants.DISBANDS_CHANNEL_ID);
            if (disbandsChannel) {
                const disbandEmbed = buildPSLEmbed(interaction.client, role?.color || constants.DEFAULT_EMBED_COLOR)
                    .setTitle(`${formattedTeam} Official Disband`)
                    .setDescription(`**${displayName}** has disbanded **${formattedTeam}**. All members in the roster have been released from their contracts and / or appointments.`)
                await disbandsChannel.send({ content: `<@&${teamInfo.roleId}>`, embeds: [disbandEmbed] });
            }

            const playerIds = teamPlayers.map(player => player.userId);

            const membersMap = await interaction.guild.members.fetch({ user: playerIds }).catch((fetchError) => {
                console.error(fetchError);
                return new Map();
            });

            const removalPromises = playerIds.map(async (player) => {
                const member = membersMap.get(player);
                if (!member) return;

                if (member.roles.cache.has(teamInfo.roleId)) {
                    await safeRoleRemove(member, teamInfo.roleId);
                }

                if (player !== teamManager && player !== teamAssistant) return;

                const roleToRemove = player === teamManager
                    ? constants.MANAGER_ROLE_ID
                    : constants.ASSISTANT_MANAGER_ROLE_ID;

                if (member.roles.cache.has(roleToRemove)) {
                    await safeRoleRemove(member, roleToRemove);
                }
            });

            await Promise.all(removalPromises);

            interaction.editReply({
                content: `⚠️ Disbanded **${formattedTeam}**. This action is **irreversible**.`,
                flags: MessageFlags.Ephemeral,
            });

            await updateTeamsRoster(interaction.client);

        } catch (error) {
            console.error('❌ Error in /disband:', error);
            if (!interaction.replied) {
                return interaction.editReply({
                    content: '❌ An unexpected error occurred while processing the disband request.',
                    flags: MessageFlags.Ephemeral,
                });
            }
        }
    },
};