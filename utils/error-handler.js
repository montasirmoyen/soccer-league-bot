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

async function logError(error, client = null, metadata = {}) {
  const timestamp = new Date().toISOString();
  const context = error.context || 'UNEXPECTED_FATAL_ERROR';
  
  const isCritical = error.isCritical !== undefined ? error.isCritical : true; 
  const severity = isCritical ? '🔴 CRITICAL' : '🟡 WARNING';
  
  console.log(`\n[${timestamp}] ${severity} [${context}]`);
  console.log(`📝 Description: ${error.message || 'No description provided.'}`);
  
  if (Object.keys(metadata).length > 0) {
    console.log(`🔍 Metadata:`, JSON.stringify(metadata, null, 2));
  }

  if (isCritical || !(error instanceof AppError)) {
    console.log(`🛠️ Stack Trace:\n${error.stack}`);
  }
  console.log('-'.repeat(50));

  if (!client || !isCritical || !constants.BOT_ISSUES_LOG_CHANNEL_ID) return;

  try {
    const errorChannel = await client.channels.fetch(constants.BOT_ISSUES_LOG_CHANNEL_ID).catch(() => null);
    if (!errorChannel) return;

    const embed = buildPSLEmbed(client, isCritical ? constants.ERROR_COLOR : constants.WARNING_COLOR)
      .setTitle(`${severity} Error: ${context}`)
      .setDescription(`**Message:**\n\`\`\`${error.message}\`\`\``)

    if (Object.keys(metadata).length > 0) {
      embed.addFields({ name: 'Metadata', value: `\`\`\`json\n${JSON.stringify(metadata, null, 2)}\n\`\`\`` });
    }

    if (error.stack) {
      const truncatedStack = error.stack.substring(0, 1000);
      embed.addFields({ name: 'Stack Trace', value: `\`\`\`js\n${truncatedStack}...\n\`\`\`` });
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
  replyWithError
};