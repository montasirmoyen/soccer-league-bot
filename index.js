require('dotenv').config();

const { Client, Collection, GatewayIntentBits, ActivityType } = require('discord.js');
const { connectMongo } = require('./db/connect');
const { loadCommands } = require('./bot/loadCommands');
const { registerCommands } = require('./bot/registerCommands');
const { startHealthServer } = require('./web/healthServer');
const database = require('./db/database');
const constants = require('./config/constants');
const builderHelpers = require('./utils/builderHelpers');
const { buildPSLEmbed } = require('./utils/embedHelpers');
const { safeRoleAdd } = require('./utils/discordHelpers');

const userCooldowns = new Map();
const buttonCooldowns = new Map();
const playerOperations = new Map();

function hasUserCooldown(userId, command, cooldownMs = 3000) {
  const key = `${userId}:${command}`;
  if (!userCooldowns.has(key)) return false;
  const cooldownData = userCooldowns.get(key);
  if (Date.now() < cooldownData.coolUntilMs) return true;
  userCooldowns.delete(key);
  return false;
}

function setUserCooldown(userId, command, cooldownMs = 3000) {
  const key = `${userId}:${command}`;
  userCooldowns.set(key, { coolUntilMs: Date.now() + cooldownMs });
}

function hasButtonCooldown(userId, buttonId) {
  const key = `${userId}:${buttonId}`;
  if (!buttonCooldowns.has(key)) return false;
  const timestamp = buttonCooldowns.get(key);
  if (Date.now() - timestamp < 1000) return true;
  buttonCooldowns.delete(key);
  return false;
}

function setButtonCooldown(userId, buttonId) {
  const key = `${userId}:${buttonId}`;
  buttonCooldowns.set(key, Date.now());
}

function checkPlayerOperationConflict(playerId, operation, teamName) {
  if (!playerOperations.has(playerId)) return null;
  const existing = playerOperations.get(playerId);
  if (existing.expiresAt > Date.now()) {
    return existing;
  }
  playerOperations.delete(playerId);
  return null;
}

function recordPlayerOperation(playerId, operation, teamName) {
  playerOperations.set(playerId, {
    operation,
    teamName,
    expiresAt: Date.now() + 5000,
  });
}

function clearPlayerOperation(playerId) {
  playerOperations.delete(playerId);
}

function withTimeout(promise, ms, timeoutError) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(timeoutError)), ms)),
  ]);
}

async function safeDefer(interaction) {
  try {
    if (!interaction.deferred && !interaction.replied) {
      await interaction.deferUpdate().catch(() => { });
    }
  } catch (e) {
    console.warn('[index.js] Defer failed:', e.message);
  }
}

async function fetchTeamAndGuild(client, teamName) {
  const guild = await client.guilds.fetch(constants.GUILD_ID);
  const teamInfo = await database.getTeamInfo(teamName);
  const role = await builderHelpers.getTeamRole(client, teamName);
  return {
    guild,
    teamInfo,
    embedColor: role ? role.color : constants.DEFAULT_EMBED_COLOR,
  };
}

async function fetchTeamStaff(teamName) {
  const manager = await database.getTeamStaff(teamName, 'manager');
  const assistant = await database.getTeamStaff(teamName, 'assistantManager');
  return { manager: manager?.manager, assistant: assistant?.assistantManager };
}

function buildStaffMentions(userId, staffManager, staffAssistant) {
  return [
    `<@${userId}>`,
    staffManager ? `<@${staffManager}>` : null,
    staffAssistant ? `<@${staffAssistant}>` : null,
  ].filter(Boolean).join(' ');
}

async function postSigningToChannel(client, signingEmbed, userId, teamManager, teamAssistant) {
  const signingsChannel = await client.channels.fetch(constants.SIGNINGS_CHANNEL_ID);
  if (signingsChannel) {
    const mentions = buildStaffMentions(userId, teamManager, teamAssistant);
    await signingsChannel.send({ content: mentions, embeds: [signingEmbed] });
  }
}

async function notifyOfferingStaff(client, issuerId, playerId, teamName, accepted, isEmergency) {
  if (!issuerId) return;

  try {
    const issuer = await client.users.fetch(issuerId);
    const formattedTeamName = `**${builderHelpers.getFormattedTeamName(teamName).toUpperCase()}**`;
    const responseEmbed = buildPSLEmbed(client, accepted ? constants.SUCCESS_COLOR : constants.ERROR_COLOR)
      .setTitle(accepted ? '🤝 Contract Accepted' : '❌ Contract Refused')
      .setDescription(
        accepted
          ? `<@${playerId}> accepted the ${isEmergency ? 'emergency contract' : 'contract'} offer for ${formattedTeamName}.`
          : `<@${playerId}> refused the ${isEmergency ? 'emergency contract' : 'contract'} offer for ${formattedTeamName}.`
      );

    await issuer.send({ embeds: [responseEmbed] });
  } catch (dmError) {
    console.warn('[index.js] Could not send offer response:', dmError.message);
  }
}

async function bootstrap() {
  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
  });
  client.commands = new Collection();

  startHealthServer();

  await connectMongo();
  console.log('✅ Connected to MongoDB');

  await database.seedTeamsIfNeeded();

  const commands = loadCommands(client);
  await registerCommands(commands);

  client.once('clientReady', () => {
    console.log(`\n🤖 Bot online as: ${client.user.tag} (${client.user.id})`);
    client.user.setPresence({
      status: 'dnd',
      activities: [{ name: '/help', type: ActivityType.Listening }],
    });
  });

  client.on('interactionCreate', async (interaction) => {
    if (interaction.isButton()) {
      await handleButtonInteraction(interaction, client);
      return;
    }

    if (!interaction.isChatInputCommand()) return;

    const userId = interaction.user.id;
    const command = interaction.commandName;
    const managingCommands = ['contract', 'emergencysign', 'release', 'scout', 'scrim', 'appoint', 'announce'];
    const cooldownDuration = managingCommands.includes(command) ? 4000 : 2000;

    if (hasUserCooldown(userId, command, cooldownDuration)) {
      return interaction.reply({
        content: `⏳ Please wait before using /${command} again.`,
        ephemeral: true,
      });
    }

    console.log(`\n⚡ /${interaction.commandName} by ${interaction.user.tag}`);
    const commandData = client.commands.get(interaction.commandName);
    if (!commandData) return;

    try {
      if (!interaction.deferred && !interaction.replied) {
        await interaction.deferReply({ ephemeral: true }).catch(() => { });
      }

      await withTimeout(
        commandData.execute(interaction),
        30000,
        'Command took too long to execute'
      );

      setUserCooldown(userId, command, cooldownDuration);
    } catch (error) {
      console.error(`❌ Error in /${interaction.commandName}:`, error.message);
      const errorPayload = { content: '❌ An error occurred. Please try again.', ephemeral: true };
      try {
        if (interaction.replied || interaction.deferred) {
          await interaction.followUp(errorPayload).catch(() => { });
        } else {
          await interaction.reply(errorPayload).catch(() => { });
        }
      } catch (responseError) {
        console.error('❌ Failed to send error response:', responseError.message);
      }
    }
  });

  await client.login(process.env.TOKEN || process.env.DISCORD_TOKEN);
}

async function handleButtonInteraction(interaction, client) {
  try {
    await safeDefer(interaction);

    const [action, teamName, targetPlayerId, issuerId] = interaction.customId.split('_');
    const userId = interaction.user.id;

    if (userId !== targetPlayerId) {
      return await interaction.followUp({
        content: '❌ This button is not for you.',
        ephemeral: true,
      }).catch(() => { });
    }

    if (hasButtonCooldown(userId, interaction.customId)) {
      return await interaction.followUp({
        content: '⏳ You already interacted with this offer. Please wait.',
        ephemeral: true,
      }).catch(() => { });
    }
    setButtonCooldown(userId, interaction.customId);

    const conflict = checkPlayerOperationConflict(userId, action, teamName);
    if (conflict) {
      return await interaction.followUp({
        content: `❌ Another action is already processing. Please try again.`,
        ephemeral: true,
      }).catch(() => { });
    }
    recordPlayerOperation(userId, action, teamName);

    console.log(`\n🖱️ Button [${action}] by ${userId} for team: ${teamName}`);

    if (action === 'refuse') {
      try {
        await withTimeout(
          notifyOfferingStaff(client, issuerId, userId, teamName, false, false),
          5000,
          'Notification timeout'
        );
        return await interaction.followUp({
          content: `❌ You have **refused** the contract offer from **${teamName}**.`,
          ephemeral: true,
        }).catch(() => { });
      } catch (err) {
        console.warn('[index.js] Refuse error:', err.message);
        return await interaction.followUp({
          content: '✅ Your refusal has been recorded.',
          ephemeral: true,
        }).catch(() => { });
      } finally {
        clearPlayerOperation(userId);
      }
    }

    if (action === 'emergencyrefuse') {
      try {
        const formattedTeamName = builderHelpers.getFormattedTeamName(teamName).toUpperCase();
        await withTimeout(
          notifyOfferingStaff(client, issuerId, userId, teamName, false, true),
          5000,
          'Notification timeout'
        );
        return await interaction.followUp({
          content: `❌ You have **refused** the emergency offer from **${formattedTeamName}**.`,
          ephemeral: true,
        }).catch(() => { });
      } catch (err) {
        console.warn('[index.js] Emergency refuse error:', err.message);
        return await interaction.followUp({
          content: '✅ Your refusal has been recorded.',
          ephemeral: true,
        }).catch(() => { });
      } finally {
        clearPlayerOperation(userId);
      }
    }

    if (action === 'accept') {
      try {
        return await withTimeout(
          handleContractAccept(interaction, client, teamName, userId, issuerId),
          25000,
          'Contract acceptance took too long'
        );
      } catch (error) {
        console.error('[index.js] Contract accept error:', error.message);
        await interaction.followUp({
          content: '❌ Error processing contract. Please try again or contact support.',
          ephemeral: true,
        }).catch(() => { });
      } finally {
        clearPlayerOperation(userId);
      }
    }

    if (action === 'emergencyaccept') {
      try {
        return await withTimeout(
          handleEmergencyAccept(interaction, client, teamName, userId, issuerId),
          25000,
          'Emergency acceptance took too long'
        );
      } catch (error) {
        console.error('[index.js] Emergency accept error:', error.message);
        await interaction.followUp({
          content: '❌ Error processing emergency signing. Please try again or contact support.',
          ephemeral: true,
        }).catch(() => { });
      } finally {
        clearPlayerOperation(userId);
      }
    }
  } catch (error) {
    console.error('[index.js] Critical button handler error:', error.message);
    try {
      await interaction.followUp({
        content: '❌ A critical error occurred. Please try again or contact support.',
        ephemeral: true,
      }).catch(() => { });
    } catch (e) {
      console.error('[index.js] Failed to send error feedback:', e.message);
    }
  }
}

async function handleContractAccept(interaction, client, teamName, userId, issuerId) {
  try {
    // ── Check window, contracts, and squad (with timeout) ──
    const [isWindowOpen, activeContract, squadSize] = await withTimeout(
      Promise.all([
        database.getTransferWindowState(),
        database.getContractedTeam(userId),
        database.getPlayersByTeam(teamName),
      ]),
      8000,
      'Database check timeout'
    );

    if (!isWindowOpen) {
      return await interaction.followUp({
        content: '❌ **Signing failed:** The transfer window closed while reviewing.',
        ephemeral: true,
      }).catch(() => { });
    }

    if (activeContract) {
      return await interaction.followUp({
        content: `❌ **Signing failed:** Already registered with **${activeContract.teamName}**.`,
        ephemeral: true,
      }).catch(() => { });
    }

    if (squadSize.length >= constants.MAX_ROSTER_SIZE) {
      return await interaction.followUp({
        content: `❌ **Signing failed:** **${teamName}** roster is full.`,
        ephemeral: true,
      }).catch(() => { });
    }

    // ── Fetch guild and team info (with timeout) ──
    const { guild, teamInfo, embedColor } = await withTimeout(
      fetchTeamAndGuild(client, teamName),
      8000,
      'Guild fetch timeout'
    );

    // ── Fetch member and process (with timeout) ──
    const targetMember = await withTimeout(
      guild.members.fetch(userId),
      5000,
      'Member fetch timeout'
    );

    await withTimeout(
      database.contractPlayer(userId, teamName, '⚽'),
      5000,
      'Database save timeout'
    );

    await withTimeout(
      safeRoleAdd(targetMember, teamInfo.roleId),
      5000,
      'Role assignment timeout'
    );

    const formattedTeamName = `**${builderHelpers.getFormattedTeamName(teamName).toUpperCase()}**`;

    // ── Post to channels (fire-and-forget, non-blocking) ──
    Promise.all([
      (async () => {
        try {
          const { manager, assistant } = await fetchTeamStaff(teamName);
          const capacityText = await builderHelpers.getDisplayedPlayersAmount(teamName);
          const signingEmbed = buildPSLEmbed(client, embedColor)
            .setTitle(`${formattedTeamName} OFFICIAL SIGNING`)
            .addFields(
              {
                name: 'Player Signed',
                value: `<@${userId}> has officially joined ${formattedTeamName}! 🎉`,
              },
              {
                name: 'Team Capacity',
                value: `**${capacityText}**`,
              }
            );
          await postSigningToChannel(client, signingEmbed, userId, manager, assistant);
        } catch (err) {
          console.warn('[index.js] Could not post to signings channel:', err.message);
        }
      })(),
      (async () => {
        try {
          await notifyOfferingStaff(client, issuerId, userId, teamName, true, false);
        } catch (err) {
          console.warn('[index.js] Could not notify staff:', err.message);
        }
      })(),
    ]).catch(() => { });

    return await interaction.followUp({
      content: `🎉 **Success!** You're now officially part of ${formattedTeamName}!`,
      ephemeral: true,
    }).catch(() => { });
  } catch (error) {
    console.error('❌ Contract accept error:', error.message);
    return await interaction.followUp({
      content: '❌ Error processing contract. Your signing may still have been processed.',
      ephemeral: true,
    }).catch(() => { });
  }
}

async function handleEmergencyAccept(interaction, client, teamName, userId, issuerId) {
  try {
    // ── Check team info (with timeout) ──
    const { guild, teamInfo, embedColor } = await withTimeout(
      fetchTeamAndGuild(client, teamName),
      8000,
      'Guild fetch timeout'
    );

    if (teamInfo && teamInfo.emergencySignsUsed >= constants.MAX_EMERGENCY_SIGNS_PER_TEAM) {
      return await interaction.followUp({
        content: `❌ **Signing failed:** **${teamName}** used all emergency spots.`,
        ephemeral: true,
      }).catch(() => { });
    }

    // ── Check squad and contracts (with timeout) ──
    const [squadSize, activeContract] = await withTimeout(
      Promise.all([
        database.getPlayersByTeam(teamName),
        database.getContractedTeam(userId),
      ]),
      8000,
      'Database check timeout'
    );

    if (squadSize.length >= constants.MAX_ROSTER_SIZE) {
      return await interaction.followUp({
        content: `❌ **Signing failed:** **${teamName}** roster is full.`,
        ephemeral: true,
      }).catch(() => { });
    }

    if (activeContract) {
      return await interaction.followUp({
        content: `❌ **Signing failed:** Already have contract with **${activeContract.teamName}**.`,
        ephemeral: true,
      }).catch(() => { });
    }

    // ── Fetch member and process (with timeout) ──
    const targetMember = await withTimeout(
      guild.members.fetch(userId),
      5000,
      'Member fetch timeout'
    );

    await withTimeout(
      database.contractPlayer(userId, teamName, '⚽'),
      5000,
      'Database save timeout'
    );

    const updatedTeamInfo = await withTimeout(
      database.incrementEmergencySign(teamName),
      5000,
      'Emergency increment timeout'
    );

    await withTimeout(
      safeRoleAdd(targetMember, teamInfo.roleId),
      5000,
      'Role assignment timeout'
    );

    const formattedTeamName = `**${builderHelpers.getFormattedTeamName(teamName).toUpperCase()}**`;

    // ── Post to channels (fire-and-forget, non-blocking) ──
    Promise.all([
      (async () => {
        try {
          const { manager, assistant } = await fetchTeamStaff(teamName);
          const capacityText = await builderHelpers.getDisplayedPlayersAmount(teamName);
          const emergencySignsUsed = updatedTeamInfo?.emergencySignsUsed ?? teamInfo?.emergencySignsUsed + 1;
          const signingEmbed = buildPSLEmbed(client, embedColor)
            .setTitle(`🚨 ${formattedTeamName} EMERGENCY SIGNING`)
            .addFields(
              {
                name: 'Player Signed',
                value: `<@${userId}> has accepted an emergency contract with ${formattedTeamName}! 🚨`,
              },
              {
                name: 'Team Capacity',
                value: `**${capacityText}**`,
              },
              {
                name: 'Emergency Spots Used',
                value: `**${emergencySignsUsed}/${constants.MAX_EMERGENCY_SIGNS_PER_TEAM}**`,
              }
            );
          await postSigningToChannel(client, signingEmbed, userId, manager, assistant);
        } catch (err) {
          console.warn('[index.js] Could not post to signings channel:', err.message);
        }
      })(),
      (async () => {
        try {
          await notifyOfferingStaff(client, issuerId, userId, teamName, true, true);
        } catch (err) {
          console.warn('[index.js] Could not notify staff:', err.message);
        }
      })(),
    ]).catch(() => { });

    return await interaction.followUp({
      content: `🎉 You joined ${formattedTeamName} via Emergency Signing!`,
      ephemeral: true,
    }).catch(() => { });
  } catch (error) {
    console.error('❌ Emergency accept error:', error.message);
    return await interaction.followUp({
      content: '❌ Error processing emergency signing. Your signing may still have been processed.',
      ephemeral: true,
    }).catch(() => { });
  }
}

bootstrap().catch((err) => {
  console.error('❌ Startup failed:', err);
  process.exit(1);
});
