const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const database = require('../db/database');
const constants = require('../config/constants');
const { requireLeagueAdmin, requireOfficialGuild } = require('../utils/validations');
const { buildPSLEmbed } = require('../utils/embed-helpers');
const { logCommandResult, logValidationFailure } = require('../utils/log-helpers');

const LEAGUE_EMBED_TITLE = '⚽ League Status';

async function updateLeagueStatusEmbed(client, targetLeagueStatus) {
  try {
    const channel = await client.channels.fetch(constants.LEAGUE_STATUS_CHANNEL_ID);
    if (!channel) {
      console.warn('[league-status.js] Could not update league status channel: channel unavailable.');
      return false;
    }

    const embed = buildPSLEmbed(client, targetLeagueStatus ? constants.SUCCESS_COLOR : constants.ERROR_COLOR)
      .setTitle(LEAGUE_EMBED_TITLE)
      .setDescription(
        targetLeagueStatus
          ? 'The league is now **STARTED**! Individual contracts are counting.'
          : 'The league is now **CLOSED**! Individual contracts are not counting.'
      );

    const messagePayload = { content: targetLeagueStatus ? '🟢' : '🔴', embeds: [embed] };
    const recent = await channel.messages.fetch({ limit: 10 });
    const existing = recent.find(
      (msg) => msg.author.id === client.user.id && msg.embeds[0]?.title === LEAGUE_EMBED_TITLE
    );

    if (existing) {
      await existing.edit(messagePayload);
    } else {
      await channel.send(messagePayload);
    }
    return true;
  } catch (logError) {
    console.warn('[league-status.js] Could not update league status channel:', logError.message);
    return false;
  }
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('league-status')
    .setDescription('Update the league status')
    .addBooleanOption((option) =>
      option
          .setName('status')
          .setDescription('True = Start, False = Close')
          .setRequired(true)
    ),

  async execute(interaction) {
    if (!await requireOfficialGuild(interaction)) return;

    if (!await requireLeagueAdmin(interaction)) return;

    const targetLeagueStatus = interaction.options.getBoolean('status');

    try {
      const currentLeagueStatus = await database.getLeagueState();
      if (currentLeagueStatus === targetLeagueStatus) {
        await logValidationFailure(interaction, {
          title: 'League Status Unchanged',
          command: 'league-status',
          details: [{ label: 'Requested Status', value: targetLeagueStatus ? '`Started`' : '`Closed`' }],
          terminalDetails: [{ label: 'Requested Status', value: targetLeagueStatus ? 'Started' : 'Closed' }],
          result: `The league was already ${targetLeagueStatus ? 'started' : 'closed'}; no change was made.`,
        });
        return interaction.editReply({
          content: targetLeagueStatus
            ? '🔓 The league is already **STARTED**. No changes made.'
            : '🔒 The league is already **CLOSED**. No changes made.',
          flags: MessageFlags.Ephemeral
        });
      }

      await database.setLeagueState(targetLeagueStatus);
      await logCommandResult(interaction, {
        command: 'league-status',
        title: 'League Status Changed',
        details: [
          { label: 'Previous Status', value: currentLeagueStatus ? '`Started`' : '`Closed`', terminalValue: currentLeagueStatus ? 'Started' : 'Closed' },
          { label: 'New Status', value: targetLeagueStatus ? '`Started`' : '`Closed`', terminalValue: targetLeagueStatus ? 'Started' : 'Closed' },
        ],
        result: `The league status was changed to ${targetLeagueStatus ? 'started' : 'closed'}.`,
      });

      await interaction.editReply({
        content: targetLeagueStatus
          ? '🔓 The league is now officially **STARTED**!'
          : '🔒 The league is now officially **CLOSED**!',
        flags: MessageFlags.Ephemeral
      });

      const statusEmbedUpdated = await updateLeagueStatusEmbed(interaction.client, targetLeagueStatus);
      if (!statusEmbedUpdated) {
        await logCommandResult(interaction, {
          type: 'error',
          title: 'League Status Changed With Announcement Failure',
          command: 'league-status',
          details: [{ label: 'New Status', value: targetLeagueStatus ? '`Started`' : '`Closed`', terminalValue: targetLeagueStatus ? 'Started' : 'Closed' }],
          result: `The league status was changed to ${targetLeagueStatus ? 'started' : 'closed'}, but the status announcement could not be updated.`,
          terminalResult: 'League status changed, but its Discord status announcement failed.',
        });
      }

    } catch (dbError) {
      await logCommandResult(interaction, {
        type: 'error',
        title: 'League Status Update Failed',
        command: 'league-status',
        details: [{ label: 'Requested Status', value: targetLeagueStatus ? '`Started`' : '`Closed`', terminalValue: targetLeagueStatus ? 'Started' : 'Closed' }],
        result: 'The league status could not be updated due to an internal failure.',
        terminalResult: 'League status update failed.',
        error: dbError,
      });
      if (!interaction.replied) {
        interaction.editReply({ content: '❌ Internal database error while toggling the league status.', flags: MessageFlags.Ephemeral });
      }
    }
  },
  updateLeagueStatusEmbed
};