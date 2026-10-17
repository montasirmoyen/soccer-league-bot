const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { getActionChoices } = require('../utils/builder-helpers');
const { requireLeagueAdmin } = require('../utils/validations');
const database = require('../db/database');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('freeze')
        .setDescription('Freeze a player from a regular action (e.g. contract offers)')
        .addUserOption((option) =>
            option
                .setName('player')
                .setDescription('Player to freeze')
                .setRequired(true)
        )
        .addStringOption((option) =>
            option
                .setName('from')
                .setDescription('Action to freeze the player from')
                .setRequired(true)
                .addChoices(getActionChoices())
        ),

    async execute(interaction) {
        if (!await requireLeagueAdmin(interaction)) return;

        const player = interaction.options.getMember('player');
        if (player.user.bot) {
            return interaction.editReply({
                content: '❌ You cannot freeze a bot.',
                flags: MessageFlags.Ephemeral,
            });
        }

        const from = interaction.options.getString('from');
        const userId = player.id;
        const displayName = player.displayName || player.username;
        const restrictedActions = await database.getPlayerRestrictedActions(userId);

        if (restrictedActions && restrictedActions.includes(from)) {
            return interaction.editReply({ content: `❌ **${displayName}** is already frozen from **${from.toLowerCase()}.**`, MessageFlags: MessageFlags.Ephemeral });
        }

        await database.restrictPlayerAction(userId, from);
        return interaction.editReply({ content: `✅ **${displayName}** has been frozen from **${from.toLowerCase()}.**`, MessageFlags: MessageFlags.Ephemeral });
    }
}