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

  if (!client || !constants.BOT_LOGS_CHANNEL_ID) return;

  try {
    const errorChannel = await client.channels.fetch(constants.BOT_LOGS_CHANNEL_ID);
    if (!errorChannel?.isTextBased?.()) {
      console.error(`🔴 Error log channel ${constants.BOT_LOGS_CHANNEL_ID} is unavailable or not text-based.`);
      return;
    }

    const embed = buildPSLEmbed(client, isCritical ? constants.ERROR_COLOR : constants.WARNING_COLOR)
      .setTitle(`${severity} Error: ${context}`)
      .setDescription('An internal error occurred. Technical details are available in the bot process logs.');

    const metadataFields = [
      ['Command', metadata.command],
      ['Action', metadata.action],
      ['Team', metadata.teamName],
    ]
      .filter(([, value]) => typeof value === 'string' && value.length > 0)
      .map(([name, value]) => ({ name, value: value.slice(0, 1024), inline: true }));
    if (metadataFields.length) embed.addFields(metadataFields);

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