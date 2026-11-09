const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { getActionChoices } = require('../utils/builder-helpers');
const { requireLeagueAdmin } = require('../utils/validations');
const database = require('../db/database');
const { logCommandResult, logValidationFailure } = require('../utils/log-helpers');

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
            console.log(`⚠️ [VALIDATION] /freeze target ${player.displayName} (${player.id}) is a bot; command terminated.`);
            return interaction.editReply({
                content: '❌ You cannot freeze a bot.',
                flags: MessageFlags.Ephemeral,
            });
        }

        const from = interaction.options.getString('from');
        const userId = player.id;
        const displayName = player.displayName || player.username;

        try {
            const restrictedActions = await database.getPlayerRestrictedActions(userId);

            if (restrictedActions && restrictedActions.includes(from)) {
                await logValidationFailure(interaction, {
                    title: 'Player Already Frozen',
                    command: 'freeze',
                    details: [
                        { label: 'Player', value: `**${displayName}** (\`${userId}\`)` },
                        { label: 'Action', value: `\`${from}\`` },
                    ],
                    terminalDetails: [
                        { label: 'Player', value: `${displayName} (${userId})` },
                        { label: 'Action', value: from },
                    ],
                    result: `The player is already frozen from ${from.toLowerCase()}; no change was made.`,
                });
                return interaction.editReply({ content: `❌ **${displayName}** is already frozen from **${from.toLowerCase()}.**`, MessageFlags: MessageFlags.Ephemeral });
            }

            await database.restrictPlayerAction(userId, from);
            await logCommandResult(interaction, {
                command: 'freeze',
                title: 'Player Restriction Added',
                details: [
                    { label: 'Player', value: `**${displayName}** (\`${userId}\`)`, terminalValue: `${displayName} (${userId})` },
                    { label: 'Action', value: `\`${from}\``, terminalValue: from },
                ],
                result: `The player was frozen from ${from.toLowerCase()}.`,
            });
            return interaction.editReply({ content: `✅ **${displayName}** has been frozen from **${from.toLowerCase()}.**`, MessageFlags: MessageFlags.Ephemeral });
        } catch (error) {
            await logCommandResult(interaction, {
                type: 'error',
                title: 'Player Restriction Could Not Be Added',
                command: 'freeze',
                details: [
                    { label: 'Player', value: `**${displayName}** (\`${userId}\`)`, terminalValue: `${displayName} (${userId})` },
                    { label: 'Action', value: `\`${from}\``, terminalValue: from },
                ],
                result: `The freeze operation for **${displayName}** could not be completed. Verify the restriction state before retrying.`,
                terminalResult: `Could not freeze ${displayName} (${userId}) from ${from}; verify current state.`,
                error,
            });
            return interaction.editReply({ content: '❌ An error occurred while applying this restriction.', flags: MessageFlags.Ephemeral });
        }
    }
}