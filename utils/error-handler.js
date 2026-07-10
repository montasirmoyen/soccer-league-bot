const constants = require('../config/constants');
const { buildPSLEmbed } = require('./embed-helpers');

class AppError extends Error {
  constructor(message, context, isCritical = false) {
    super(message);
    this.name = this.constructor.name;
    this.context = context;
    this.isCritical = isCritical;
  }
}

class UserActionError extends AppError {
  constructor(message, context = 'USER_ACTION') {
    super(message, context, false);
  }
}

class SystemError extends AppError {
  constructor(message, context) {
    super(message, context, true);
  }
}

function normalizeError(error) {
  if (error instanceof Error) return error;
  return new Error(typeof error === 'string' ? error : 'Unknown error occurred');
}

async function logError(error, client = null, metadata = {}) {
  const normalizedError = normalizeError(error);
  const timestamp = new Date().toISOString();
  const context = normalizedError.context || metadata.context || 'UNEXPECTED_FATAL_ERROR';
  const isCritical = normalizedError.isCritical !== undefined ? normalizedError.isCritical : true;
  const severity = isCritical ? '🔴 CRITICAL' : '🟡 WARNING';

  console.log(`\n[${timestamp}] ${severity} [${context}]`);
  console.log(`📝 Description: ${normalizedError.message || 'No description provided.'}`);

  if (Object.keys(metadata).length > 0) {
    console.log('🔍 Metadata:', JSON.stringify(metadata, null, 2));
  }

  if (isCritical || !(normalizedError instanceof AppError)) {
    console.log(`🛠️ Stack Trace:\n${normalizedError.stack || 'No stack trace available.'}`);
  }
  console.log('-'.repeat(50));

  if (!client || !constants.BOT_ISSUES_LOG_CHANNEL_ID) return;

  try {
    const errorChannel = await client.channels.fetch(constants.BOT_ISSUES_LOG_CHANNEL_ID).catch(() => null);
    if (!errorChannel?.isTextBased?.()) return;

    const embed = buildPSLEmbed(client, isCritical ? constants.ERROR_COLOR : constants.WARNING_COLOR)
      .setTitle(`${severity} Error: ${context}`)
      .setDescription(`**Message:**\n\`\`\`${normalizedError.message}\`\`\``);

    if (Object.keys(metadata).length > 0) {
      embed.addFields({ name: 'Metadata', value: `\`\`\`json\n${JSON.stringify(metadata, null, 2)}\n\`\`\`` });
    }

    if (normalizedError.stack) {
      const truncatedStack = normalizedError.stack.substring(0, 1000);
      embed.addFields({ name: 'Stack Trace', value: `\`\`\`js\n${truncatedStack}${truncatedStack.length >= 1000 ? '...' : ''}\n\`\`\`` });
    }

    await errorChannel.send({ embeds: [embed] });
  } catch (discordErr) {
    console.error('🔴 Failed to send error to Discord log channel:', discordErr.message);
  }
}

async function replyWithError(interaction, error) {
  try {
    const userMessage = error instanceof UserActionError
      ? `⚠️ ${error.message}`
      : '❌ An internal system error has occurred. Our technical team has already been notified.';

    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({ content: userMessage, ephemeral: true }).catch(() => {});
    } else {
      await interaction.reply({ content: userMessage, ephemeral: true }).catch(() => {});
    }
  } catch (fallbackError) {
    console.error('🔴 Catastrophic failure while trying to send an error message to the user:', fallbackError.message);
  }
}

module.exports = {
  AppError,
  UserActionError,
  SystemError,
  logError,
  replyWithError,
};