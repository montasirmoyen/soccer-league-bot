const { SlashCommandBuilder, MessageFlags, ChannelType } = require('discord.js');
const { requireLeagueAdmin } = require('../utils/validations');
const { logCommandResult } = require('../utils/log-helpers');

const MAX_MESSAGE_LENGTH = 2000;
const MESSAGE_LINK_REGEX = /^https:\/\/(?:ptb\.|canary\.)?discord(?:app)?\.com\/channels\/(\d{17,20})\/(\d{17,20})\/(\d{17,20})\/?$/;

module.exports = {
    data: new SlashCommandBuilder()
        .setName('message')
        .setDescription('Manage bot messages in channels')
        .addSubcommand((subcommand) =>
            subcommand
                .setName('send')
                .setDescription('Send a message to a specified channel')
                .addChannelOption(option =>
                    option
                        .setName('channel')
                        .setDescription('Channel to send the message to')
                        .setRequired(true)
                        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
                )
                .addStringOption(option =>
                    option
                        .setName('message')
                        .setDescription('Message to send')
                        .setRequired(true)
                        .setMaxLength(MAX_MESSAGE_LENGTH)
                ),
        )
        .addSubcommand((subcommand) =>
            subcommand
                .setName('edit')
                .setDescription('Edit a message sent by the bot')
                .addStringOption(option =>
                    option
                        .setName('message_link')
                        .setDescription('Link to the message to edit')
                        .setRequired(true)
                )
                .addStringOption(option =>
                    option
                        .setName('new_message')
                        .setDescription('Updated message to submit')
                        .setRequired(true)
                        .setMaxLength(MAX_MESSAGE_LENGTH)
                ),
        ),

    async execute(interaction) {
        if (!await requireLeagueAdmin(interaction)) return;

        const action = interaction.options.getSubcommand();

        try {
            if (action === 'send') {
                const channel = interaction.options.getChannel('channel');
                const message = interaction.options.getString('message');

                let sentMessage;
                try {
                    sentMessage = await channel.send(message);
                } catch (error) {
                    await logCommandResult(interaction, {
                        type: 'error',
                        title: 'Channel Message Not Sent',
                        command: 'message send',
                        details: [{ label: 'Channel', value: `${channel} (\`${channel.id}\`)`, terminalValue: `${channel.name} (${channel.id})` }],
                        result: 'The message could not be sent to the selected channel. Its contents are excluded from this audit log.',
                        terminalResult: 'Channel message delivery failed.',
                        error,
                    });
                    return interaction.editReply({ content: '❌ Failed to send the message. Please check the bot\'s permissions and try again.', flags: MessageFlags.Ephemeral });
                }

                const successMessage = `✅ Message sent successfully to ${channel}`;

                if (channel.type === ChannelType.GuildAnnouncement) {
                    try {
                        await sentMessage.crosspost();
                    } catch (cpError) {
                        await logCommandResult(interaction, {
                            type: 'error',
                            title: 'Announcement Crosspost Failed',
                            command: 'message send',
                            details: [{ label: 'Channel', value: `${channel} (\`${channel.id}\`)`, terminalValue: `${channel.name} (${channel.id})` }],
                            result: 'The message was posted, but Discord could not crosspost it. Message content is not included in this audit log.',
                            terminalResult: 'Message posted, but crossposting failed.',
                            error: cpError,
                        });
                        return interaction.editReply({ content: `${successMessage}, but failed to crosspost.`, flags: MessageFlags.Ephemeral });
                    }
                }

                await logCommandResult(interaction, {
                    command: 'message send',
                    title: 'Channel Message Sent',
                    details: [{ label: 'Channel', value: `${channel} (\`${channel.id}\`)`, terminalValue: `${channel.name} (${channel.id})` }],
                    result: 'The message was successfully sent to the selected channel. Its contents are excluded from this audit log.',
                });

                return interaction.editReply({ content: `${successMessage}!`, flags: MessageFlags.Ephemeral });
            }

            if (action === 'edit') {
                const messageLink = interaction.options.getString('message_link');
                const newMessage = interaction.options.getString('new_message');

                const match = messageLink.match(MESSAGE_LINK_REGEX);
                if (!match) {
                    return interaction.editReply({ content: '❌ Invalid message link provided. Please ensure it is a valid Discord message link.', flags: MessageFlags.Ephemeral });
                }

                const [, guildId, channelId, messageId] = match;

                if (guildId !== interaction.guildId) {
                    return interaction.editReply({ content: '❌ The provided message link does not belong to this server.', flags: MessageFlags.Ephemeral });
                }

                let channel;
                try {
                    channel = await interaction.guild.channels.fetch(channelId);
                } catch {
                    channel = null;
                }

                if (!channel || (channel.type !== ChannelType.GuildText && channel.type !== ChannelType.GuildAnnouncement)) {
                    return interaction.editReply({ content: '❌ The channel for the provided message link could not be found or is not a text/announcement channel.', flags: MessageFlags.Ephemeral });
                }

                let messageToEdit;
                try {
                    messageToEdit = await channel.messages.fetch(messageId);
                } catch {
                    return interaction.editReply({ content: '❌ The message for the provided link could not be found.', flags: MessageFlags.Ephemeral });
                }

                if (messageToEdit.author.id !== interaction.client.user.id) {
                    return interaction.editReply({ content: '❌ I can only edit messages that were sent by me.', flags: MessageFlags.Ephemeral });
                }

                try {
                    await messageToEdit.edit(newMessage);
                } catch (editError) {
                    await logCommandResult(interaction, {
                        type: 'error',
                        title: 'Message Edit Failed',
                        command: 'message edit',
                        details: [{ label: 'Channel', value: `${channel} (\`${channel.id}\`)`, terminalValue: `${channel.name} (${channel.id})` }],
                        result: 'The message could not be edited in the specified channel. Its contents are excluded from this audit log.',
                        terminalResult: 'Channel message edit failed.',
                        error: editError,
                    });
                    return interaction.editReply({ content: '❌ Failed to edit the message. Please check the bot\'s permissions and try again.', flags: MessageFlags.Ephemeral });
                }

                await logCommandResult(interaction, {
                    command: 'message edit',
                    title: 'Message Edited',
                    details: [
                        { label: 'Channel', value: `${channel} (\`${channel.id}\`)`, terminalValue: `${channel.name} (${channel.id})` },
                        { label: 'Message ID', value: `\`${messageId}\``, terminalValue: messageId }
                    ],
                    result: 'The message was successfully edited. Its content are excluded from this audit log.',
                });

                return interaction.editReply({ content: `✅ Message edited successfully in ${channel}!`, flags: MessageFlags.Ephemeral });
            }
        } catch (error) {
            await logCommandResult(interaction, {
                type: 'error',
                title: 'Message Command Error',
                command: `message ${action}`,
                result: 'An unexpected error occurred while executing the message command.',
                terminalResult: 'Unexpected error during message command execution.',
                error,
            });
            return interaction.editReply({ content: '❌ An unexpected error occurred while executing the command.', flags: MessageFlags.Ephemeral });
        }
    }
};