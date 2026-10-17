const { SlashCommandBuilder, MessageFlags, ChannelType } = require('discord.js');
const { requireLeagueAdmin } = require('../utils/validations');

const MAX_MESSAGE_LENGTH = 2000;

module.exports = {
    data: new SlashCommandBuilder()
        .setName('echo')
        .setDescription('Send a message to a specified channel')
        .addChannelOption(option =>
            option
                .setName('channel')
                .setDescription('The channel to send the message to')
                .setRequired(true)
                .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
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

        const channel = interaction.options.getChannel('channel');
        const message = interaction.options.getString('message');

        let sentMessage;
        try {
            sentMessage = await channel.send(message);
        } catch (error) {
            console.error(`Error sending message: ${error}`);
            return interaction.editReply({ content: '❌ Failed to send the message. Please check the bot\'s permissions and try again.', flags: MessageFlags.Ephemeral });
        }

        const successMessage = `✅ Message sent successfully to ${channel}`

        if (channel.type === ChannelType.GuildAnnouncement) {
            try {
                await sentMessage.crosspost();
            } catch (cpError) {
                console.error(`❌ Error crossposting message: ${cpError}`);
                await interaction.editReply({ content: `${successMessage}, but failed to crosspost.`, flags: MessageFlags.Ephemeral });
            }
        }

        await interaction.editReply({ content: `${successMessage}!`, flags: MessageFlags.Ephemeral });
    }
};