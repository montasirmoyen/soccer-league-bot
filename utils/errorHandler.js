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

function logError(error, metadata = {}) {
  const timestamp = new Date().toISOString();
  const context = error.context || 'UNEXPECTED_FATAL_ERROR';
  const severity = error.isCritical ? '🔴 CRITICAL' : '🟡 WARNING';
  
  console.log(`\n[${timestamp}] ${severity} [${context}]`);
  
  console.log(`📝 Description: ${error.message || 'No description provided.'}`);
  
  if (Object.keys(metadata).length > 0) {
    console.log(`🔍 Metadata:`, JSON.stringify(metadata, null, 2));
  }

  if (error.isCritical || !(error instanceof AppError)) {
    console.log(`🛠️ Stack Trace:`);
    console.log(error.stack);
  }
  
  console.log('-'.repeat(50));
}

async function replyWithError(interaction, error) {
  try {
    const userMessage = error instanceof UserActionError 
      ? `⚠️ ${error.message}` 
      : '❌ "An internal system error has occurred. Our technical team has already been notified."';

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