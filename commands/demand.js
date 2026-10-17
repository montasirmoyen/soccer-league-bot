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
const { requireOfficialGuild } = require('../utils/validations');

const cooldowns = new Map();

const ATTACHMENT_OPTION_DESCRIPTION = 'Attach any relevant evidence for the demand';
const COOLDOWN_TIME = 60 * 60 * 1000;
const MAX_ATTACHMENTS = 3;
const MIN_REASON_LENGTH = 100;
const MAX_REASON_LENGTH = 2000;

const builder = new SlashCommandBuilder()
    .setName('demand')
    .setDescription(`Voluntarily leave your team contract (Limit: ${constants.MAX_DEMANDS_PER_PLAYER} per season)`)
    .addStringOption((option) =>
        option
            .setName('reason')
            .setDescription(`State the reason for the demand (Only ${MIN_REASON_LENGTH}-${MAX_REASON_LENGTH} characters allowed)`)
            .setRequired(true)
            .setMinLength(MIN_REASON_LENGTH)
            .setMaxLength(MAX_REASON_LENGTH)
    );

for (let i = 1; i <= MAX_ATTACHMENTS; i++) {
    builder.addAttachmentOption(option =>
        option.setName(`attachment${i}`)
            .setDescription(ATTACHMENT_OPTION_DESCRIPTION)
            .setRequired(false)
    );
}

module.exports = {
    data: builder,
    async execute(interaction) {
        if (!await requireOfficialGuild(interaction)) return;

        const userId = interaction.user.id;
        const restrictedActions = await database.getPlayerRestrictedActions(userId);

        if (restrictedActions && restrictedActions.includes('DEMANDS')) {
            return interaction.editReply({
                content: `❌ You are currently frozen from demand requests.`,
                flags: MessageFlags.Ephemeral
            });
        }

        const now = Date.now();
        let pendingDemandCreated = false;
        let pendingDemandTeam;

        const cooldownState = builderHelpers.getCooldownState(userId, cooldowns, COOLDOWN_TIME, now);
        if (cooldownState.isCoolingDown) {
            return interaction.editReply({
                content: `⏳ Please wait **${builderHelpers.formatCooldownDuration(cooldownState.timeLeftMs)}** before using this command again.`,
                flags: MessageFlags.Ephemeral
            });
        }

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
            pendingDemandTeam = playerTeam;
            const teamInfo = await database.getTeamInfo(playerTeam);
            const isManager = teamInfo?.manager === userId;
            const isAssistant = teamInfo?.assistantManager === userId;
            const isStaff = isManager || isAssistant;
            const formattedTeamName = `**${builderHelpers.getFormattedTeamName(playerTeam)}**`;

            if (isStaff) {
                return interaction.editReply({
                    content: '❌ Managers and assistant managers cannot submit demand requests.',
                    flags: MessageFlags.Ephemeral
                });
            }

            const existingDemand = await database.getPendingDemand(userId);
            if (existingDemand) {
                return interaction.editReply({
                    content: '❌ You already have a demand request under review.',
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
            cooldowns.set(userId, now);

            const attachments = [];
            for (let i = 1; i <= MAX_ATTACHMENTS; i++) {
                const attachment = interaction.options.getAttachment(`attachment${i}`);
                if (attachment) {
                    attachments.push(attachment);
                }
            }
            const displayName = builderHelpers.getDiscordDisplayName(interaction.member, interaction.user);
            const role = await builderHelpers.getTeamRole(interaction.client, playerTeam);
            const errorMessage = '❌ There was an error while forwarding this request to the inquiries team. Please reach the Staff team to proceed.';

            const demandRequestsChannel = await interaction.client.channels.fetch(constants.DEMAND_REQUESTS_CHANNEL_ID).catch(() => null);
            if (demandRequestsChannel) {
                const requestEmbed = buildPSLEmbed(interaction.client, role?.color || constants.DEFAULT_EMBED_COLOR)
                    .setTitle('📜 Demand Request')
                    .setThumbnail(interaction.user.displayAvatarURL({ dynamic: true }))
                    .setDescription(
                        `**${displayName}** has officially requested a demand in order to leave ${formattedTeamName}.\n\n` +
                        `Please review their case thoroughly - analyze the evidence if applicable - and make your decision below:`,
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

                const mentions = `<@&${constants.SENIOR_MODERATOR_ROLE_ID}> <@&${constants.LEAD_MODERATOR_ROLE_ID}> <@&${constants.SUPERVISOR_ROLE_ID}> <@&${constants.OVERSEER_ROLE_ID}> <@&${constants.CHAIRMAN_ROLE_ID}>`;

                const forwardSuccess = await demandRequestsChannel.send({
                    content: mentions,
                    embeds: [requestEmbed],
                    files: attachments,
                    components: [row]
                }).catch(console.warn);

                if (forwardSuccess) {
                    interaction.editReply({ content: `📁 Your demand request has been forwarded to the **inquiries team**. Once a decision is taken, you'll be DMed with the result. Make sure to **open your DMs** to receive it!` });
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
            if (pendingDemandCreated && pendingDemandTeam) {
                await database.clearPendingDemand(userId, pendingDemandTeam).catch(() => null);
            }
            return interaction.editReply({ content: '❌ An internal error occurred while processing your request.' });
        }
    }
};