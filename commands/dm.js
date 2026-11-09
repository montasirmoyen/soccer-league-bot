const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { requireLeagueAdmin } = require('../utils/validations');
const constants = require('../config/constants');
const { logCommandResult, logValidationFailure } = require('../utils/log-helpers');

const MAX_MESSAGE_LENGTH = 2000;
const BATCH_SIZE = 40;
const BATCH_INTERVAL = 8000;
const DM_INTERVAL = 200;

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

module.exports = {
    data: new SlashCommandBuilder()
        .setName('dm')
        .setDescription('Send a direct message to a user or members of a role')
        .addMentionableOption(option =>
            option
                .setName('target')
                .setDescription('The user or role to send the direct message to')
                .setRequired(true)
        )
        .addStringOption(option =>
            option
                .setName('message')
                .setDescription('The message to send')
                .setRequired(true)
                .setMaxLength(MAX_MESSAGE_LENGTH)
        ),

    async execute(interaction) {
        if (!await requireLeagueAdmin(interaction)) return;

        const message = interaction.options.getString('message');
        const mention = interaction.options.getMentionable('target');

        if (mention.constructor.name === 'Role') {
            const guild = await interaction.client.guilds.fetch(constants.GUILD_ID).catch(() => null);

            if (!guild) {
                await logCommandResult(interaction, {
                    type: 'error',
                    title: 'Bulk DM Failed',
                    command: 'dm',
                    details: [{ label: 'Target Role', value: `**${mention.name}** (\`${mention.id}\`)`, terminalValue: `${mention.name} (${mention.id})` }],
                    result: 'The configured server could not be found; no direct messages were sent.',
                    terminalResult: 'Configured guild was unavailable for bulk DM.',
                });
                return interaction.editReply({
                    content: `❌ Error: Guild not found with ID ${constants.GUILD_ID}.`,
                    flags: MessageFlags.Ephemeral
                });
            }

            if (!mention.id || !guild.roles.cache.has(mention.id)) {
                await logValidationFailure(interaction, {
                    title: 'Bulk DM Role Invalid',
                    command: 'dm',
                    details: [{ label: 'Target Role', value: `**${mention.name}** (\`${mention.id || 'No role ID'}\`)` }],
                    terminalDetails: [{ label: 'Target Role', value: `${mention.name} (${mention.id || 'no ID'})` }],
                    result: 'The selected role could not be verified in the server; no direct messages were sent.',
                });
                return interaction.editReply({
                    content: `❌ Error: The selected role **${mention.name}** is invalid or could not be found in this guild cache.`,
                    flags: MessageFlags.Ephemeral
                });
            }

            await interaction.editReply({
                content: `⏳ Fetching server members to find those with the role **${mention.name}**...`,
                flags: MessageFlags.Ephemeral
            });

            let fetchedMembers;
            try {
                fetchedMembers = await guild.members.fetch();
            } catch (error) {
                await logCommandResult(interaction, {
                    type: 'error',
                    title: 'Bulk DM Recipient Lookup Failed',
                    command: 'dm',
                    details: [{ label: 'Target Role', value: `**${mention.name}** (\`${mention.id}\`)`, terminalValue: `${mention.name} (${mention.id})` }],
                    result: 'Server members could not be fetched, so no direct messages were sent.',
                    terminalResult: 'Failed to fetch members for bulk DM.',
                    error,
                });
                return interaction.editReply({
                    content: `❌ Could not fetch server members to verify the role **${mention.name}**. No DMs were sent.`,
                    flags: MessageFlags.Ephemeral
                });
            }

            const roleMembers = mention.id === guild.id
                ? fetchedMembers
                : fetchedMembers.filter(member => member.roles.cache.has(mention.id));

            if (roleMembers.size === 0) {
                await logValidationFailure(interaction, {
                    title: 'Bulk DM Role Has No Members',
                    command: 'dm',
                    details: [{ label: 'Target Role', value: `**${mention.name}** (\`${mention.id}\`)` }],
                    terminalDetails: [{ label: 'Target Role', value: `${mention.name} (${mention.id})` }],
                    result: 'The selected role has no members; no direct messages were sent.',
                });
                return interaction.editReply({
                    content: `⚠️ The role **${mention.name}** does not contain members. No DMs will be sent.`,
                    flags: MessageFlags.Ephemeral
                });
            }

            const membersWithRole = roleMembers.filter(member => !member.user.bot);
            const totalMembers = membersWithRole.size;

            if (totalMembers === 0) {
                await logValidationFailure(interaction, {
                    title: 'Bulk DM Role Contains Only Bots',
                    command: 'dm',
                    details: [{ label: 'Target Role', value: `**${mention.name}** (\`${mention.id}\`)` }],
                    terminalDetails: [{ label: 'Target Role', value: `${mention.name} (${mention.id})` }],
                    result: 'The selected role contains only bots; no direct messages were sent.',
                });
                return interaction.editReply({
                    content: `⚠️ The role **${mention.name}** only contains bots. No DMs will be sent.`,
                    flags: MessageFlags.Ephemeral
                });
            }

            await interaction.editReply({
                content: `⏳ Starting DM sending process to \`${totalMembers}\` human members...`,
                flags: MessageFlags.Ephemeral
            });

            let successfullySent = 0;
            let errors = 0;
            let batchCounter = 0;
            const deliveryFailures = new Map();

            for (const [memberId, member] of membersWithRole) {
                try {
                    await member.send({ content: message });
                    successfullySent++;
                } catch (error) {
                    errors++;
                    const failureType = error?.code
                        ? `Discord error ${error.code}`
                        : error?.status
                            ? `HTTP ${error.status}`
                            : error?.name || 'Unknown error';
                    deliveryFailures.set(failureType, (deliveryFailures.get(failureType) || 0) + 1);
                }

                batchCounter++;

                if (batchCounter >= BATCH_SIZE && (successfullySent + errors) < totalMembers) {
                    batchCounter = 0;
                    await interaction.editReply({
                        content: `⏳ Progress: **${successfullySent + errors}/${totalMembers}** sent.\nEntering API cooldown pause for ${BATCH_INTERVAL / 1000}s...`
                    }).catch(() => { });
                    await sleep(BATCH_INTERVAL);
                } else {
                    await sleep(DM_INTERVAL);
                }
            }

            await logCommandResult(interaction, {
                type: errors ? 'error' : 'success',
                title: errors ? 'Bulk DM Completed With Failures' : 'Bulk DM Completed',
                command: 'dm',
                details: [
                    { label: 'Target Role', value: `**${mention.name}** (\`${mention.id}\`)`, terminalValue: `${mention.name} (${mention.id})` },
                    { label: 'Recipients', value: String(totalMembers), terminalValue: String(totalMembers) },
                    { label: 'Sent', value: String(successfullySent), terminalValue: String(successfullySent) },
                    { label: 'Failed', value: String(errors), terminalValue: String(errors) },
                    ...(errors ? [{
                        label: 'Failure Reasons',
                        value: [...deliveryFailures].map(([reason, count]) => `${reason}: ${count}`).join('\n'),
                        terminalValue: [...deliveryFailures].map(([reason, count]) => `${reason}: ${count}`).join('; '),
                    }] : []),
                ],
                result: errors
                    ? `The bulk DM operation finished: ${successfullySent} message(s) sent and ${errors} failed. Message content is not included.`
                    : `The bulk DM operation finished successfully: ${successfullySent} message(s) sent. Message content is not included.`,
                terminalResult: `Bulk DM finished: ${successfullySent} sent, ${errors} failed.`,
            });
            return interaction.editReply({
                content: `📢 Mass send successfully concluded!\n\n✅ **Successfully sent:** ${successfullySent} \n❌ **Fails** (Likely closed DMs): ${errors}\n**Target Role:** ${mention}`,
                flags: MessageFlags.Ephemeral
            });
        }

        const user = mention;
        const targetUser = user.user || user;
        const userId = targetUser.id;

        if (targetUser.bot) {
            console.log(`⚠️ [VALIDATION] /dm target ${targetUser.username} (${userId}) is a bot; command terminated.`);
            return interaction.editReply({
                content: '❌ You cannot send a direct message to a bot.',
                flags: MessageFlags.Ephemeral
            });
        }

        try {
            await targetUser.send(message);
        } catch (error) {
            await logCommandResult(interaction, {
                type: 'error',
                title: 'Direct Message Not Delivered',
                command: 'dm',
                details: [{ label: 'Target', value: `**${targetUser.username}** (\`${userId}\`)`, terminalValue: `${targetUser.username} (${userId})` }],
                result: 'The direct message could not be delivered. Its content is not included in this audit log.',
                terminalResult: 'Direct message delivery failed.',
                error,
            });
            return interaction.editReply({
                content: '❌ Failed to send the direct message. Please check the bot\'s permissions and try again.',
                flags: MessageFlags.Ephemeral
            });
        }

        await logCommandResult(interaction, {
            command: 'dm',
            title: 'Direct Message Sent',
            details: [{ label: 'Target', value: `**${targetUser.username}** (\`${userId}\`)`, terminalValue: `${targetUser.username} (${userId})` }],
            result: 'The direct message was successfully delivered. Its content is not included in this audit log.',
        });
        return interaction.editReply({
            content: `✅ Direct message sent successfully to <@${userId}>!`,
            flags: MessageFlags.Ephemeral
        });
    }
};