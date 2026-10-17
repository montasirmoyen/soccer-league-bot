const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const database = require('../db/database');
const constants = require('../config/constants');
const { requireLeagueAdmin, requireOfficialGuild } = require('../utils/validations');
const { buildPSLEmbed } = require('../utils/embed-helpers');

const LEAGUE_EMBED_TITLE = '⚽ League Status';

async function updateLeagueStatusEmbed(client, targetLeagueStatus) {
  const channel = await client.channels.fetch(constants.LEAGUE_STATUS_CHANNEL_ID).catch(() => null);
  if (!channel) return;

  const embed = buildPSLEmbed(client, targetLeagueStatus ? constants.SUCCESS_COLOR : constants.ERROR_COLOR)
    .setTitle(LEAGUE_EMBED_TITLE)
    .setDescription(
      targetLeagueStatus
        ? 'The league is now **STARTED**! Individual contracts are counting.'
        : 'The league is now **CLOSED**! Individual contracts are not counting.'
    );

  const messagePayload = { content: targetLeagueStatus ? '🟢' : '🔴', embeds: [embed] };

  try {
    const recent = await channel.messages.fetch({ limit: 10 });
    const existing = recent.find(
      (msg) => msg.author.id === client.user.id && msg.embeds[0]?.title === LEAGUE_EMBED_TITLE
    );

    if (existing) {
      await existing.edit(messagePayload);
    } else {
      await channel.send(messagePayload);
    }
  } catch (logError) {
    console.warn('[league-status.js] Could not update league status channel:', logError.message);
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
        return interaction.editReply({
          content: targetLeagueStatus
            ? '🔓 The league is already **STARTED**. No changes made.'
            : '🔒 The league is already **CLOSED**. No changes made.',
          flags: MessageFlags.Ephemeral
        });
      }

      await database.setLeagueState(targetLeagueStatus);

      interaction.editReply({
        content: targetLeagueStatus
          ? '🔓 The league is now officially **STARTED**!'
          : '🔒 The league is now officially **CLOSED**!',
        flags: MessageFlags.Ephemeral
      });

      await updateLeagueStatusEmbed(interaction.client, targetLeagueStatus);

    } catch (dbError) {
      console.error('❌ Database error in /league-status:', dbError);
      if (!interaction.replied) {
        interaction.editReply({ content: '❌ Internal database error while toggling the league status.', flags: MessageFlags.Ephemeral });
      }
    }
  },
  updateLeagueStatusEmbed
};