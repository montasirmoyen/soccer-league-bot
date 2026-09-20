const {
    SlashCommandBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    MessageFlags
} = require('discord.js');
const database = require('../db/database');
const constants = require('../config/constants');
const builderHelpers = require('../utils/builder-helpers');
const { buildPSLEmbed } = require('../utils/embed-helpers');
const { validateGuild } = require('../utils/validations');

const cooldowns = new Map();

module.exports = {
    data: new SlashCommandBuilder()
        .setName('demand')
        .setDescription(`Voluntarily leave your team contract (Limit: ${constants.MAX_DEMANDS_PER_PLAYER} per season).`)
        .addStringOption((option) =>
            option
                .setName('reason')
                .setDescription('State the reason for the demand and link the desired evidence')
                .setRequired(true)
                //.setMinLength(100)
                .setMaxLength(2000)
        ),

    async execute(interaction) {
        if (!validateGuild(interaction)) {
            return interaction.editReply({ content: '❌ You can only execute this command in the official server.', flags: MessageFlags.Ephemeral });
        }

        const userId = interaction.user.id;
        let pendingDemandCreated = false;

        try {
            const activeContract = await database.getContractedTeam(userId);
            if (!activeContract) {
                return interaction.editReply({ content: '❌ You do not have an active contract; you are already a free agent.', flags: MessageFlags.Ephemeral });
            }

            const demandsUsed = await database.getPlayerDemandsCount(userId);
            if (demandsUsed >= constants.MAX_DEMANDS_PER_PLAYER) {
                return interaction.editReply({
                    content: `❌ **Demand limit reached!** You have used all available demands this season (${constants.MAX_DEMANDS_PER_PLAYER}).`,
                    flags: MessageFlags.Ephemeral
                });
            }

            const demandReason = interaction.options.getString('reason');

            const playerTeam = activeContract.teamName;
            const teamInfo = await database.getTeamInfo(playerTeam);
            const isManager = teamInfo?.manager === userId;
            const isAssistant = teamInfo?.assistantManager === userId;
            const isStaff = isManager || isAssistant;
            const formattedTeamName = `**${builderHelpers.getFormattedTeamName(playerTeam)}**`;

            if (isStaff) {
                return interaction.editReply({
                    content: '❌ Team managers and assistant managers cannot submit demand requests.',
                    flags: MessageFlags.Ephemeral
                });
            }

            const pendingDemand = await database.createPendingDemand(userId, playerTeam, demandReason);
            if (!pendingDemand) {
                return interaction.editReply({
                    content: '❌ You already have a demand request under review.',
                    flags: MessageFlags.Ephemeral
                });
            }
            pendingDemandCreated = true;

            const displayName = builderHelpers.getDiscordDisplayName(interaction.member, interaction.user);
            const role = await builderHelpers.getTeamRole(interaction.client, playerTeam);
            const errorMessage = '❌ There was an error while forwarding this request to the inquiries team. Please reach the Staff team to proceed.'

            const demandRequestsChannel = await interaction.client.channels.fetch(constants.DEMAND_REQUESTS_CHANNEL_ID).catch(() => null);
            if (demandRequestsChannel) {
                const requestEmbed = buildPSLEmbed(interaction.client, role?.color || constants.DEFAULT_EMBED_COLOR)
                    .setTitle('📜 Demand Request')
                    .setThumbnail(interaction.user.displayAvatarURL({ dynamic: true }))
                    .setDescription(
                        `**${displayName}** has officially requested a demand in order to leave ${formattedTeamName}.\n\n` +
                        `Please review their case thoroughly and make your decision below:`,
                    );

                const reasonChunks = demandReason.match(/.{1,1000}/gs) || ['No reason provided.'];
                requestEmbed.addFields(reasonChunks.map((chunk, index) => ({
                    name: index === 0 ? 'Demand Reason' : 'Demand Reason (continued)',
                    value: chunk
                })));

                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId(`demand_accept_${userId}_${playerTeam}`)
                        .setLabel('✅ Accept')
                        .setStyle(ButtonStyle.Success),
                    new ButtonBuilder()
                        .setCustomId(`demand_reject_${userId}_${playerTeam}`)
                        .setLabel('❌ Reject')
                        .setStyle(ButtonStyle.Danger),
                );

                const mentions = `<@&${constants.SENIOR_MODERATOR_ROLE_ID}> <@&${constants.LEAD_MODERATOR_ROLE_ID}> <@&${constants.OVERSEER_ROLE_ID}> <@&${constants.CHAIRMAN_ROLE_ID}>`

                const forwardSuccess = await demandRequestsChannel.send({ content: mentions, embeds: [requestEmbed], components: [row] }).catch(console.warn);
                if (forwardSuccess) {
                    interaction.editReply({ content: `📁 Your demand request has been **forwarded to the inquiries team**. Once a decision is taken, you'll be DMed with the result. Make sure to **open your DMs** to receive it!` });
                } else {
                    await database.clearPendingDemand(userId, playerTeam);
                    return interaction.editReply({ content: errorMessage });
                }
            } else {
                await database.clearPendingDemand(userId, playerTeam);
                return interaction.editReply({ content: errorMessage });
            }
        } catch (error) {
            console.error('❌ Error in /demand:', error);
            if (pendingDemandCreated) {
                await database.clearPendingDemand(userId).catch(() => {});
            }
            if (!interaction.replied) {
                interaction.editReply({ content: '❌ An error occurred processing your demand.', flags: MessageFlags.Ephemeral });
            }
        }
    },
};