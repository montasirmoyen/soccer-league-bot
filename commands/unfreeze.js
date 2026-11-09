const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { getActionChoices } = require('../utils/builder-helpers');
const { requireLeagueAdmin } = require('../utils/validations');
const database = require('../db/database');
const { logCommandResult, logValidationFailure } = require('../utils/log-helpers');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('unfreeze')
        .setDescription('Unfreeze a player from a regular action (e.g. releases)')
        .addUserOption((option) =>
            option
                .setName('player')
                .setDescription('Player to unfreeze')
                .setRequired(true)
        )
        .addStringOption((option) =>
            option
                .setName('from')
                .setDescription('Action to unfreeze the player from')
                .setRequired(true)
                .addChoices(getActionChoices())
        ),

    async execute(interaction) {
        if (!await requireLeagueAdmin(interaction)) return;

        const player = interaction.options.getMember('player');
        if (player.user.bot) {
            console.log(`⚠️ [VALIDATION] /unfreeze target ${player.displayName} (${player.id}) is a bot; command terminated.`);
            return interaction.editReply({
                content: '❌ You cannot unfreeze a bot.',
                flags: MessageFlags.Ephemeral,
            });
        }

        const from = interaction.options.getString('from');
        const userId = player.id;
        const displayName = player.displayName || player.username;

        try {
            const restrictedActions = await database.getPlayerRestrictedActions(userId);

            if (restrictedActions && !restrictedActions.includes(from)) {
                await logValidationFailure(interaction, {
                    title: 'Player Not Frozen',
                    command: 'unfreeze',
                    details: [
                        { label: 'Player', value: `**${displayName}** (\`${userId}\`)` },
                        { label: 'Action', value: `\`${from}\`` },
                    ],
                    terminalDetails: [
                        { label: 'Player', value: `${displayName} (${userId})` },
                        { label: 'Action', value: from },
                    ],
                    result: `The player is not frozen from ${from.toLowerCase()}; no change was made.`,
                });
                return interaction.editReply({ content: `❌ **${displayName}** is not frozen from **${from.toLowerCase()}.**`, MessageFlags: MessageFlags.Ephemeral });
            }

            await database.unrestrictPlayerAction(userId, from);
            await logCommandResult(interaction, {
                command: 'unfreeze',
                title: 'Player Restriction Removed',
                details: [
                    { label: 'Player', value: `**${displayName}** (\`${userId}\`)`, terminalValue: `${displayName} (${userId})` },
                    { label: 'Action', value: `\`${from}\``, terminalValue: from },
                ],
                result: `The player was unfrozen from ${from.toLowerCase()}.`,
            });
            return interaction.editReply({ content: `✅ **${displayName}** has been unfrozen from **${from.toLowerCase()}.**`, MessageFlags: MessageFlags.Ephemeral });
        } catch (error) {
            await logCommandResult(interaction, {
                type: 'error',
                title: 'Player Restriction Could Not Be Removed',
                command: 'unfreeze',
                details: [
                    { label: 'Player', value: `**${displayName}** (\`${userId}\`)`, terminalValue: `${displayName} (${userId})` },
                    { label: 'Action', value: `\`${from}\``, terminalValue: from },
                ],
                result: `The unfreeze operation for **${displayName}** could not be completed. Verify the restriction state before retrying.`,
                terminalResult: `Could not unfreeze ${displayName} (${userId}) from ${from}; verify current state.`,
                error,
            });
            return interaction.editReply({ content: '❌ An error occurred while removing this restriction.', flags: MessageFlags.Ephemeral });
        }
    }
}