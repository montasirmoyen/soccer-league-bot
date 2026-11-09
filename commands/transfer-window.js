const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const database = require('../db/database');
const constants = require('../config/constants');
const builderHelpers = require('../utils/builder-helpers');
const { requireLeagueAdmin, requireOfficialGuild } = require('../utils/validations');
const { buildPSLEmbed } = require('../utils/embed-helpers');
const { logCommandResult, logValidationFailure } = require('../utils/log-helpers');

const WINDOW_EMBED_TITLE = '⚽ Transfer Window Status';

function getTeamListDisplay(teamNames) {
  return teamNames.length
    ? teamNames.map((teamName) => builderHelpers.getFormattedTeamName(teamName)).join('\n')
    : 'None';
}

async function updateTransferWindowEmbed(client, isOpen) {
  try {
    const channel = await client.channels.fetch(constants.TRANSFER_WINDOW_CHANNEL_ID);
    if (!channel) {
      console.warn('[transfer-window.js] Could not update transfer window channel: channel unavailable.');
      return false;
    }

    const config = await database.getTransferWindowConfig();
    const relevantTeams = isOpen ? config.transferWindowDeniedTeams : config.transferWindowAllowedTeams;
    const embed = buildPSLEmbed(client, isOpen ? constants.SUCCESS_COLOR : constants.ERROR_COLOR)
      .setTitle(WINDOW_EMBED_TITLE)
      .setDescription(
        isOpen
          ? 'The transfer window is now **OPEN**! Teams can register contracts.'
          : 'The transfer window is now **CLOSED**! Allowed teams can register regular contracts; other teams may use emergency contracts.'
      )
      .addFields({
        name: isOpen ? 'Contracts denied' : 'Contracts allowed',
        value: getTeamListDisplay(relevantTeams),
      });

    const messagePayload = { content: isOpen ? '🟢' : '🔴', embeds: [embed] };
    const recent = await channel.messages.fetch({ limit: 10 });
    const existing = recent.find(
      (message) => message.author.id === client.user.id && message.embeds[0]?.title === WINDOW_EMBED_TITLE,
    );

    if (existing) {
      await existing.edit(messagePayload);
    } else {
      await channel.send(messagePayload);
    }
    return true;
  } catch (error) {
    console.warn('[transfer-window.js] Could not update transfer window channel:', error.message);
    return false;
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
    .setDescription('Manage the league transfer window and contract permissions')
    .addSubcommand((subcommand) =>
      subcommand
        .setName('status')
        .setDescription('Open or close the transfer window')
        .addStringOption((option) =>
          option
            .setName('state')
            .setDescription('Set the transfer window state')
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
        .setDescription('Prohibit a team from using regular contracts')
        .addStringOption(getTeamOption),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('undeny')
        .setDescription('Remove a team from the regular-contract denied list')
        .addStringOption(getTeamOption),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('list')
        .setDescription('Show the current contract permission lists'),
    ),

  async execute(interaction) {
    if (!await requireOfficialGuild(interaction)) return;
    if (!await requireLeagueAdmin(interaction)) return;

    const action = interaction.options.getSubcommand();
    const selectedTeam = interaction.options.getString('team');

    try {
      if (action === 'status') {
        const targetStatus = interaction.options.getString('state') === 'open';
        const currentStatus = await database.getTransferWindowState();
        if (currentStatus === targetStatus) {
          await logValidationFailure(interaction, {
            title: 'Transfer Window Status Unchanged',
            command: 'transfer-window',
            details: [
              { label: 'Action', value: '`status`' },
              { label: 'Status', value: targetStatus ? '`Open`' : '`Closed`' },
            ],
            terminalDetails: [
              { label: 'Action', value: 'status' },
              { label: 'Status', value: targetStatus ? 'Open' : 'Closed' },
            ],
            result: `The transfer window was already ${targetStatus ? 'open' : 'closed'}; no change was made.`,
          });
          const statusEmbedUpdated = await updateTransferWindowEmbed(interaction.client, targetStatus);
          if (!statusEmbedUpdated) {
            await logCommandResult(interaction, {
              type: 'error',
              title: 'Transfer Window Status Announcement Failed',
              command: 'transfer-window',
              details: [
                { label: 'Action', value: '`status`', terminalValue: 'status' },
                { label: 'Status', value: targetStatus ? '`Open`' : '`Closed`', terminalValue: targetStatus ? 'Open' : 'Closed' },
              ],
              result: 'The transfer window status was unchanged, but its Discord status announcement could not be updated.',
              terminalResult: 'Transfer window status was unchanged, but the status announcement failed.',
            });
          }
          return interaction.editReply({
            content: targetStatus
              ? '🔓 The transfer window is already **OPEN**. No changes made.'
              : '🔒 The transfer window is already **CLOSED**. No changes made.',
            flags: MessageFlags.Ephemeral,
          });
        }

        await database.setTransferWindowState(targetStatus);
        await logCommandResult(interaction, {
          command: 'transfer-window',
          title: 'Transfer Window Status Changed',
          details: [
            { label: 'Action', value: '`status`', terminalValue: 'status' },
            { label: 'Previous Status', value: currentStatus ? '`Open`' : '`Closed`', terminalValue: currentStatus ? 'Open' : 'Closed' },
            { label: 'New Status', value: targetStatus ? '`Open`' : '`Closed`', terminalValue: targetStatus ? 'Open' : 'Closed' },
          ],
          result: `The transfer window was changed to ${targetStatus ? 'open' : 'closed'}.`,
        });
        const statusEmbedUpdated = await updateTransferWindowEmbed(interaction.client, targetStatus);
        if (!statusEmbedUpdated) {
          await logCommandResult(interaction, {
            type: 'error',
            title: 'Transfer Window Changed With Announcement Failure',
            command: 'transfer-window',
            details: [
              { label: 'Action', value: '`status`', terminalValue: 'status' },
              { label: 'New Status', value: targetStatus ? '`Open`' : '`Closed`', terminalValue: targetStatus ? 'Open' : 'Closed' },
            ],
            result: `The transfer window was changed to ${targetStatus ? 'open' : 'closed'}, but its Discord status announcement could not be updated.`,
            terminalResult: 'Transfer window status changed, but its Discord announcement failed.',
          });
        }
        return interaction.editReply({
          content: targetStatus
            ? '🔓 The transfer window is now officially **OPEN**!'
            : '🔒 The transfer window is now officially **CLOSED**!',
          flags: MessageFlags.Ephemeral,
        });
      }

      const config = await database.getTransferWindowConfig();
      if (action === 'list') {
        const allowedListEmbed = buildPSLEmbed(interaction.client, constants.SUCCESS_COLOR)
        allowedListEmbed.setTitle('✅ Contracts allowed while closed')

        allowedListEmbed.addFields([{
          name: 'Allowed Teams',
          value: getTeamListDisplay(config.transferWindowAllowedTeams) || 'None'
        }]);

        const deniedListEmbed = buildPSLEmbed(interaction.client, constants.ERROR_COLOR)
        deniedListEmbed.setTitle('🚫 Contracts denied')

        deniedListEmbed.addFields([{
          name: 'Denied Teams',
          value: getTeamListDisplay(config.transferWindowDeniedTeams) || 'None'
        }]);

        return interaction.editReply({
          embeds: [allowedListEmbed, deniedListEmbed],
          flags: MessageFlags.Ephemeral
        });
      }

      const isAllowedListAction = action === 'allow' || action === 'disallow';
      const listName = isAllowedListAction ? 'transferWindowAllowedTeams' : 'transferWindowDeniedTeams';
      const isAdding = action === 'allow' || action === 'deny';
      const currentList = config[listName];
      const alreadyInList = currentList.includes(selectedTeam);

      if ((isAdding && alreadyInList) || (!isAdding && !alreadyInList)) {
        await logValidationFailure(interaction, {
          title: 'Transfer Window Team List Unchanged',
          command: 'transfer-window',
          details: [
            { label: 'Action', value: `\`${action}\`` },
            { label: 'Team', value: `**${builderHelpers.getFormattedTeamName(selectedTeam)}**` },
          ],
          terminalDetails: [
            { label: 'Action', value: action },
            { label: 'Team', value: selectedTeam },
          ],
          result: `The team was ${isAdding ? 'already on' : 'not on'} the requested list; no change was made.`,
        });
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
      await logCommandResult(interaction, {
        command: 'transfer-window',
        title: 'Transfer Window Team Permission Changed',
        details: [
          { label: 'Action', value: `\`${action}\``, terminalValue: action },
          { label: 'Team', value: `**${builderHelpers.getFormattedTeamName(selectedTeam)}**`, terminalValue: selectedTeam },
          { label: 'List', value: isAllowedListAction ? '`Allowed while closed`' : '`Denied from regular contracts`', terminalValue: isAllowedListAction ? 'Allowed while closed' : 'Denied from regular contracts' },
        ],
        result: `**${builderHelpers.getFormattedTeamName(selectedTeam)}** was ${isAdding ? 'added to' : 'removed from'} the ${isAllowedListAction ? 'allowed' : 'denied'} list.`,
      });
      const statusEmbedUpdated = await updateTransferWindowEmbed(interaction.client, isOpen);
      if (!statusEmbedUpdated) {
        await logCommandResult(interaction, {
          type: 'error',
          title: 'Team Permission Changed With Announcement Failure',
          command: 'transfer-window',
          details: [
            { label: 'Action', value: `\`${action}\``, terminalValue: action },
            { label: 'Team', value: `**${builderHelpers.getFormattedTeamName(selectedTeam)}**`, terminalValue: selectedTeam },
          ],
          result: `The contract permission list was changed for **${builderHelpers.getFormattedTeamName(selectedTeam)}**, but the transfer-window announcement could not be updated.`,
          terminalResult: `Transfer permission list changed for ${selectedTeam}, but the announcement failed.`,
        });
      }
      return interaction.editReply({
        content: `✅ **${builderHelpers.getFormattedTeamName(selectedTeam)}** was ${isAdding ? 'added to' : 'removed from'} the ${isAllowedListAction ? 'allowed' : 'denied'} list.`,
        flags: MessageFlags.Ephemeral,
      });
    } catch (error) {
      await logCommandResult(interaction, {
        type: 'error',
        title: 'Transfer Window Update Failed',
        command: 'transfer-window',
        details: [
          { label: 'Action', value: `\`${action}\``, terminalValue: action },
          ...(selectedTeam ? [{
            label: 'Team',
            value: `**${builderHelpers.getFormattedTeamName(selectedTeam)}**`,
            terminalValue: selectedTeam,
          }] : []),
        ],
        result: 'The transfer window command failed due to an internal error.',
        terminalResult: 'Transfer window command failed.',
        error,
      });
      return interaction.editReply({
        content: '❌ Internal database error while managing the transfer window.',
        flags: MessageFlags.Ephemeral,
      });
    }
  },
  updateTransferWindowEmbed
};