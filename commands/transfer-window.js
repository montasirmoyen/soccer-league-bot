const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const database = require('../db/database');
const constants = require('../config/constants');
const builderHelpers = require('../utils/builder-helpers');
const { isChairman, validateGuild } = require('../utils/validations');
const { buildPSLEmbed } = require('../utils/embed-helpers');

const WINDOW_EMBED_TITLE = '⚽ Transfer Window Status';

function getTeamListDisplay(teamNames) {
  return teamNames.length
    ? teamNames.map((teamName) => builderHelpers.getFormattedTeamName(teamName)).join('\n')
    : 'None';
}

async function updateTransferWindowEmbed(client, isOpen) {
  const channel = await client.channels.fetch(constants.TRANSFER_WINDOW_CHANNEL_ID).catch(() => null);
  if (!channel) return;

  const config = await database.getTransferWindowConfig();
  const relevantTeams = isOpen ? config.transferWindowDeniedTeams : config.transferWindowAllowedTeams;
  const embed = buildPSLEmbed(client, isOpen ? constants.SUCCESS_COLOR : constants.ERROR_COLOR)
    .setTitle(WINDOW_EMBED_TITLE)
    .setDescription(
      isOpen
        ? 'The transfer window is now **OPEN**! Teams can register contracts and release players.'
        : 'The transfer window is now **CLOSED**! Allowed teams can register regular contracts; other teams may use emergency contracts.'
    )
    .addFields({
      name: isOpen ? 'Signings denied' : 'Signings allowed',
      value: getTeamListDisplay(relevantTeams),
    });

  const messagePayload = { content: isOpen ? '🟢' : '🔴', embeds: [embed] };

  try {
    const recent = await channel.messages.fetch({ limit: 10 });
    const existing = recent.find(
      (message) => message.author.id === client.user.id && message.embeds[0]?.title === WINDOW_EMBED_TITLE,
    );

    if (existing) {
      await existing.edit(messagePayload);
    } else {
      await channel.send(messagePayload);
    }
  } catch (error) {
    console.warn('[transfer-window.js] Could not update transfer window channel:', error.message);
  }
}

function getTeamOption(option) {
  return option
    .setName('team')
    .setDescription('Select the team')
    .setRequired(true)
    .addChoices(builderHelpers.getTeamChoices());
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('transfer-window')
    .setDescription('Manage the league transfer window and signing permissions.')
    .addSubcommand((subcommand) =>
      subcommand
        .setName('status')
        .setDescription('Open or close the transfer window.')
        .addStringOption((option) =>
          option
            .setName('state')
            .setDescription('Set the transfer window state.')
            .setRequired(true)
            .addChoices(
              { name: 'Open', value: 'open' },
              { name: 'Closed', value: 'closed' },
            ),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('allow')
        .setDescription('Allow a team to use regular contracts while the window is closed')
        .addStringOption(getTeamOption),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('disallow')
        .setDescription('Remove a team from the closed-window allowed list')
        .addStringOption(getTeamOption),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('deny')
        .setDescription('Prohibit a team from using regular contracts.')
        .addStringOption(getTeamOption),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('undeny')
        .setDescription('Remove a team from the regular-contract denied list.')
        .addStringOption(getTeamOption),
    )
    .addSubcommand((subcommand) =>
      subcommand.setName('list').setDescription('Show the current signing permission lists.'),
    ),

  async execute(interaction) {
    if (!validateGuild(interaction)) {
      return interaction.editReply({
        content: '❌ You can only execute this command in the official server.',
        flags: MessageFlags.Ephemeral,
      });
    }

    if (!isChairman(interaction.member)) {
      return interaction.editReply({
        content: '❌ Only Chairmen and Overseers are allowed to manage the transfer window.',
        flags: MessageFlags.Ephemeral,
      });
    }

    const action = interaction.options.getSubcommand();
    const selectedTeam = interaction.options.getString('team');

    try {
      if (action === 'status') {
        const targetStatus = interaction.options.getString('state') === 'open';
        const currentStatus = await database.getTransferWindowState();
        if (currentStatus === targetStatus) {
          await updateTransferWindowEmbed(interaction.client, targetStatus);
          return interaction.editReply({
            content: targetStatus
              ? '🔓 The transfer window is already **OPEN**. No changes made.'
              : '🔒 The transfer window is already **CLOSED**. No changes made.',
            flags: MessageFlags.Ephemeral,
          });
        }

        await database.setTransferWindowState(targetStatus);
        await updateTransferWindowEmbed(interaction.client, targetStatus);
        return interaction.editReply({
          content: targetStatus
            ? '🔓 The transfer window is now officially **OPEN**!'
            : '🔒 The transfer window is now officially **CLOSED**!',
          flags: MessageFlags.Ephemeral,
        });
      }

      const config = await database.getTransferWindowConfig();
      if (action === 'list') {
        return interaction.editReply({
          content:
            `✅ **Signings allowed while closed:**\n${getTeamListDisplay(config.transferWindowAllowedTeams)}\n\n` +
            `🚫 **Signings denied:**\n${getTeamListDisplay(config.transferWindowDeniedTeams)}`,
          flags: MessageFlags.Ephemeral,
        });
      }

      const isAllowedListAction = action === 'allow' || action === 'disallow';
      const listName = isAllowedListAction ? 'transferWindowAllowedTeams' : 'transferWindowDeniedTeams';
      const isAdding = action === 'allow' || action === 'deny';
      const currentList = config[listName];
      const alreadyInList = currentList.includes(selectedTeam);

      if ((isAdding && alreadyInList) || (!isAdding && !alreadyInList)) {
        return interaction.editReply({
          content: isAdding
            ? `ℹ️ **${builderHelpers.getFormattedTeamName(selectedTeam)}** is already on that list.`
            : `ℹ️ **${builderHelpers.getFormattedTeamName(selectedTeam)}** is not on that list.`,
          flags: MessageFlags.Ephemeral,
        });
      }

      if (action === 'allow') await database.addTransferWindowAllowedTeam(selectedTeam);
      if (action === 'disallow') await database.removeTransferWindowAllowedTeam(selectedTeam);
      if (action === 'deny') await database.addTransferWindowDeniedTeam(selectedTeam);
      if (action === 'undeny') await database.removeTransferWindowDeniedTeam(selectedTeam);

      const isOpen = await database.getTransferWindowState();
      await updateTransferWindowEmbed(interaction.client, isOpen);
      return interaction.editReply({
        content: `✅ **${builderHelpers.getFormattedTeamName(selectedTeam)}** was ${isAdding ? 'added to' : 'removed from'} the ${isAllowedListAction ? 'allowed' : 'denied'} list.`,
        flags: MessageFlags.Ephemeral,
      });
    } catch (error) {
      console.error('❌ Database error in /transfer-window:', error);
      return interaction.editReply({
        content: '❌ Internal database error while managing the transfer window.',
        flags: MessageFlags.Ephemeral,
      });
    }
  },
};