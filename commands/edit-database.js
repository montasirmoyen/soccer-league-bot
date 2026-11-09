const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { getPlayerDataChoices, getTeamChoices, getTeamDataChoices } = require('../utils/builder-helpers');
const { requireLeagueAdmin } = require('../utils/validations');
const builderHelpers = require('../utils/builder-helpers');
const database = require('../db/database');
const { logCommandResult, logValidationFailure } = require('../utils/log-helpers');

const dataFunctions = {
    get: {
        'INDIVIDUAL_CONTRACTS': database.getIndividualContractsCount,
        'DEMANDS': database.getPlayerDemandsCount,
        'EMERGENCY_CONTRACTS': database.getTeamEmergencyContractsCount
    },
    set: {
        'INDIVIDUAL_CONTRACTS': database.setIndividualContractsCount,
        'DEMANDS': database.setPlayerDemandsCount,
        'EMERGENCY_CONTRACTS': database.setEmergencyContractsCount
    }
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('edit-database')
        .setDescription('Edit a player / team data in the database')
        .addSubcommand(subcommand =>
            subcommand
                .setName('player')
                .setDescription('Edit a player data')
                .addUserOption((option) =>
                    option
                        .setName('player')
                        .setDescription('Player to edit')
                        .setRequired(true)
                )
                .addStringOption((option) =>
                    option
                        .setName('data')
                        .setDescription('Data to edit')
                        .setRequired(true)
                        .addChoices(getPlayerDataChoices())
                )
                .addIntegerOption((option) =>
                    option
                        .setName('value')
                        .setDescription('Value to set')
                        .setRequired(true)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('team')
                .setDescription('Edit a team data')
                .addStringOption((option) =>
                    option
                        .setName('team')
                        .setDescription('Team to edit')
                        .setRequired(true)
                        .addChoices(getTeamChoices())
                )
                .addStringOption((option) =>
                    option
                        .setName('data')
                        .setDescription('Data to edit')
                        .setRequired(true)
                        .addChoices(getTeamDataChoices())
                )
                .addIntegerOption((option) =>
                    option
                        .setName('value')
                        .setDescription('Value to set')
                        .setRequired(true)
                )
        ),

    async execute(interaction) {
        if (!await requireLeagueAdmin(interaction)) return;

        const action = interaction.options.getSubcommand();
        const data = interaction.options.getString('data');
        const value = interaction.options.getInteger('value');

        const getFunction = dataFunctions.get[data];
        const setFunction = dataFunctions.set[data];

        if (!getFunction || !setFunction) {
            return interaction.editReply({ content: `❌ Invalid data type.` });
        }

        let targetId;
        let displayName;

        if (action === 'player') {
            const player = interaction.options.getMember('player');
            if (player.user.bot) {
                console.log(`⚠️ [VALIDATION] /edit-database target ${player.displayName} (${player.id}) is a bot; command terminated.`);
                return interaction.editReply({ content: `❌ You cannot change a bot's data.` });
            }

            targetId = player.id;
            displayName = player.displayName || player.user.username;
        } else if (action === 'team') {
            targetId = interaction.options.getString('team');
            displayName = builderHelpers.getFormattedTeamName(targetId);
        }

        const targetDetails = action === 'player'
            ? { label: 'Player', value: `**${displayName}** (\`${targetId}\`)`, terminalValue: `${displayName} (${targetId})` }
            : { label: 'Team', value: `**${displayName}**`, terminalValue: targetId };
        const dataNameFormatted = data.toLowerCase().replaceAll('_', ' ');

        try {
            const currentData = await getFunction(targetId);
            if (currentData === value) {
                await logValidationFailure(interaction, {
                    title: 'Database Value Already Set',
                    command: 'edit-database',
                    details: [
                        targetDetails,
                        { label: 'Data', value: `\`${data}\`` },
                        { label: 'Value', value: `\`${value}\`` },
                    ],
                    terminalDetails: [
                        { label: targetDetails.label, value: targetDetails.terminalValue },
                        { label: 'Data', value: data },
                        { label: 'Value', value: String(value) },
                    ],
                    result: 'The database value already matched the requested value; no change was made.',
                });
                return interaction.editReply({
                    content: `❌ The current amount of the selected data is already \`${value}\`.`
                });
            }

            await setFunction(targetId, value);

            await logCommandResult(interaction, {
                command: 'edit-database',
                title: 'Database Value Updated',
                details: [
                    targetDetails,
                    { label: 'Data', value: `\`${data}\``, terminalValue: data },
                    { label: 'Previous Value', value: `\`${currentData}\``, terminalValue: String(currentData) },
                    { label: 'New Value', value: `\`${value}\``, terminalValue: String(value) },
                ],
                result: `The ${dataNameFormatted} value was updated from ${currentData} to ${value}.`,
            });
            return interaction.editReply({
                content: `✅ **${displayName}**'s ${dataNameFormatted} value has been updated from \`${currentData}\` to \`${value}\`.`
            });
        } catch (error) {
            await logCommandResult(interaction, {
                type: 'error',
                title: 'Database Value Update Failed',
                command: 'edit-database',
                details: [
                    targetDetails,
                    { label: 'Data', value: `\`${data}\``, terminalValue: data },
                    { label: 'Requested Value', value: `\`${value}\``, terminalValue: String(value) },
                ],
                result: `The ${dataNameFormatted} value could not be updated. Verify the stored value before retrying.`,
                terminalResult: `Could not update ${targetDetails.terminalValue} ${data} to ${value}; verify current value.`,
                error,
            });
            return interaction.editReply({
                content: '❌ An error occurred while updating the database value.',
                flags: MessageFlags.Ephemeral,
            });
        }
    }
}