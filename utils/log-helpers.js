const { buildPSLEmbed } = require('./embed-helpers');
const constants = require('../config/constants');

function truncateText(value, maxLength) {
    const text = String(value ?? '');
    return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

async function logAction(type, data, client) {
    const { title, description, fields } = data;

    let logColor = constants.WARNING_COLOR;
    let emojiPrefix = '⚠️';

    switch (type) {
        case 'success':
            logColor = constants.SUCCESS_COLOR;
            emojiPrefix = '✅';
            break;
        case 'validation':
            logColor = constants.WARNING_COLOR;
            emojiPrefix = '⚠️';
            break;
        case 'error':
            logColor = constants.ERROR_COLOR;
            emojiPrefix = '❌';
            break;
    }

    try {
        const channelId = constants.BOT_LOGS_CHANNEL_ID;
        const channel = await client.channels.fetch(channelId);
        if (!channel) {
            console.error(`❌ [ERROR] Could not fetch log channel with ID: ${channelId}`);
            return;
        }

        const fullTitle = `${emojiPrefix} ${title}`;

        const safeTitle = truncateText(fullTitle, 256);
        const safeDescription = truncateText(description, 4096);
        const actionEmbed = buildPSLEmbed(client, logColor)
            .setTitle(safeTitle)
            .setDescription(safeDescription)

        if (fields?.length) {
            let remainingCharacters = 5500 - safeTitle.length - safeDescription.length;
            const safeFields = [];
            for (const { name, value, inline } of fields.slice(0, 25)) {
                if (remainingCharacters < 2) break;
                const safeName = truncateText(name, Math.min(256, remainingCharacters - 1));
                const safeValue = truncateText(value, Math.min(1024, remainingCharacters - safeName.length));
                remainingCharacters -= safeName.length + safeValue.length;
                safeFields.push({ name: safeName, value: safeValue || '\u200b', inline });
            }
            if (safeFields.length) actionEmbed.addFields(safeFields);
        }

        await channel.send({ embeds: [actionEmbed] });

    } catch (logError) {
        console.error(`❌ [ERROR] Failed to execute logAction: ${logError.message}`);
    }
}

async function logValidationFailure(interaction, {
    title,
    command,
    commandLabel = `/${command}`,
    details,
    result,
    terminalResult,
    terminalDetails = [],
}) {
    const actorDisplayName = interaction.member?.displayName
        || interaction.user.displayName
        || interaction.user.username;
    const fields = [
        {
            name: 'Executed By',
            value: `**${actorDisplayName}** (\`${interaction.user.id}\`)`,
            inline: false,
        },
        {
            name: 'Command',
            value: `\`${commandLabel}\``,
            inline: false,
        },
        ...details.map(({ label, value }) => ({
            name: label,
            value,
            inline: false,
        })),
    ];
    const terminalContext = terminalDetails
        .map(({ label, value }) => `${label}: ${value}`)
        .join(' | ');

    console.log(`⚠️ [VALIDATION] ${commandLabel}${terminalContext ? ` | ${terminalContext}` : ''}: ${terminalResult || 'Validation failed; no changes were made.'}`);
    await logAction('validation', {
        title,
        description: `*${result}*`,
        fields,
    }, interaction.client);
}

async function logCommandResult(interaction, {
    type = 'success',
    title,
    command,
    commandLabel = `/${command}`,
    details = [],
    result,
    terminalResult,
    error,
}) {
    const emojiPrefix = type === 'success' ? '✅' : '❌';
    const actorDisplayName = interaction.member?.displayName
        || interaction.user.displayName
        || interaction.user.username;
    const fields = [
        {
            name: 'Executed By',
            value: `**${actorDisplayName}** (\`${interaction.user.id}\`)`,
            inline: false,
        },
        {
            name: 'Command',
            value: `\`${commandLabel}\``,
            inline: false,
        },
        ...details.map(({ label, value }) => ({
            name: label,
            value,
            inline: false,
        })),
    ];
    const terminalContext = details
        .map(({ label, terminalValue }) => terminalValue ? `${label}: ${terminalValue}` : null)
        .filter(Boolean)
        .join(' | ');
    const defaultTerminalResult = type === 'error'
        ? 'Command failed or completed with errors.'
        : 'Command completed successfully.';
    const terminalMessage = `${emojiPrefix} [${type.toUpperCase()}] ${commandLabel} by ${actorDisplayName} (${interaction.user.id})` +
        `${terminalContext ? ` | ${terminalContext}` : ''}: ${terminalResult || defaultTerminalResult}`;

    if (type === 'error') {
        console.error(terminalMessage, error || '');
    } else {
        console.log(terminalMessage);
    }

    await logAction(type, {
        title,
        description: `*${result}*`,
        fields,
    }, interaction.client);
}

module.exports = { logAction, logValidationFailure, logCommandResult };