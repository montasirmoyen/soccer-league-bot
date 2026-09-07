const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const database = require('../db/database');
const constants = require('../config/constants');
const { isChairman, validateGuild } = require('../utils/validations');
const { buildPSLEmbed } = require('../utils/embed-helpers');

const LEAGUE_EMBED_TITLE = '⚽ League Status';

module.exports = {
  data: new SlashCommandBuilder()
    .setName('league-start')
    .setDescription('Starts or closes the league')
    .addBooleanOption((option) =>
      option.setName('status').setDescription('True = Started, False = Closed').setRequired(true)
    ),

  async execute(interaction) {
    if (!validateGuild(interaction)) {
      return interaction.editReply({ content: '❌ You can only execute this command in the official server.', flags: MessageFlags.Ephemeral });
    }

    if (!isChairman(interaction.member)) {
      return interaction.editReply({ content: '❌ Only Chairmen and Overseers are allowed to toggle the league status.', flags: MessageFlags.Ephemeral });
    }

    const targetLeagueStatus = interaction.options.getBoolean('status');

    try {
      const currentLeagueStatus = await database.getLeagueState();
      if (currentLeagueStatus === targetLeagueStatus) {
        return interaction.editReply({
          content: targetLeagueStatus
            ? '🔓 The league is already **STARTED**. No changes made.'
            : '🔒 The league is already **CLOSED**. No changes made.',
          flags: MessageFlags.Ephemeral,
        });
      }

      await database.setLeagueState(targetLeagueStatus);

      interaction.editReply({
        content: targetLeagueStatus
          ? '🔓 The league is now officially **STARTED**!'
          : '🔒 The league is now officially **CLOSED**!',
        flags: MessageFlags.Ephemeral,
      });

      (async () => {
        const channel = await interaction.client.channels.fetch(constants.LEAGUE_STATUS_CHANNEL_ID).catch(() => null);
        if (!channel) return;

        const embed = buildPSLEmbed(interaction.client, targetLeagueStatus ? constants.SUCCESS_COLOR : constants.ERROR_COLOR)
          .setTitle(LEAGUE_EMBED_TITLE)
          .setDescription(
            targetLeagueStatus
              ? 'The league is now **STARTED**! Releases and player signings are counting.'
              : 'The league is now **CLOSED**! Team releases and player signings are not counting.'
          );

        const messagePayload = { content: targetLeagueStatus ? '🟢' : '🔴', embeds: [embed] };

        try {
          const recent = await channel.messages.fetch({ limit: 10 });
          const existing = recent.find(
            (msg) => msg.author.id === interaction.client.user.id && msg.embeds[0]?.title === LEAGUE_EMBED_TITLE
          );

          if (existing) {
            await existing.edit(messagePayload);
          } else {
            await channel.send(messagePayload);
          }
        } catch (logError) {
          console.warn('[league-start.js] Could not update league status channel:', logError.message);
        }
      })();

    } catch (dbError) {
      console.error('❌ Database error in /league-start:', dbError);
      if (!interaction.replied) {
        interaction.editReply({ content: '❌ Internal database error while toggling the league status.', flags: MessageFlags.Ephemeral });
      }
    }
  },
};