const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { requireLeagueAdmin } = require('../utils/validations');

const MAX_MESSAGE_LENGTH = 2000;

module.exports = {
    data: new SlashCommandBuilder()
    .setName('dm')
    .setDescription('Send a direct message to a user')
    .addUserOption(option =>
        option
            .setName('user')
            .setDescription('The user to send the direct message to')
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

        const user = interaction.options.getUser('user');
        if (user.bot) {
            return interaction.editReply({
                content: '❌ You cannot send a direct message to a bot.',
                flags: MessageFlags.Ephemeral
            })
        }

        const message = interaction.options.getString('message');
        const userId = user.id

        try {
            await user.send(message);
        } catch (error) {
            console.error(`❌ Error sending direct message: ${error}`);
            return interaction.editReply({ content: '❌ Failed to send the direct message. Please check the bot\'s permissions and try again.', flags: MessageFlags.Ephemeral });
        }

        await interaction.editReply({ content: `✅ Direct message sent successfully to <@${userId}>!`, flags: MessageFlags.Ephemeral });
    }
};