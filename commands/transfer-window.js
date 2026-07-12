const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const database = require('../db/database');
const constants = require('../config/constants');
const { isChairman, validateGuild } = require('../utils/validations');
const { buildPSLEmbed } = require('../utils/embed-helpers');

const WINDOW_EMBED_TITLE = '⚽ TRANSFER WINDOW STATUS UPDATE';

module.exports = {
  data: new SlashCommandBuilder()
    .setName('transfer-window')
    .setDescription('Opens or closes the league transfer window.')
    .addBooleanOption((option) =>
      option.setName('status').setDescription('True = Open, False = Closed').setRequired(true)
    ),

  async execute(interaction) {
    if (!validateGuild(interaction)) {
      return interaction.editReply({ content: '❌ You can only execute this command in the official server.', flags: MessageFlags.Ephemeral });
    }

    if (!isChairman(interaction.member)) {
      return interaction.editReply({ content: '❌ You do not have permission to use this command.', flags: MessageFlags.Ephemeral });
    }

    const targetStatus = interaction.options.getBoolean('status');

    try {
      const currentStatus = await database.getTransferWindowState();
      if (currentStatus === targetStatus) {
        return interaction.editReply({
          content: targetStatus
            ? '🔓 The transfer window is already **OPEN**. No changes made.'
            : '🔒 The transfer window is already **CLOSED**. No changes made.',
          flags: MessageFlags.Ephemeral,
        });
      }

      await database.setTransferWindowState(targetStatus);

      interaction.editReply({
        content: targetStatus
          ? '🔓 The transfer window is now officially **OPEN**!'
          : '🔒 The transfer window is now officially **CLOSED**!',
        flags: MessageFlags.Ephemeral,
      });

      (async () => {
        const channel = await interaction.client.channels.fetch(constants.TRANSFER_WINDOW_CHANNEL_ID).catch(() => null);
        if (!channel) return;

        const embed = buildPSLEmbed(interaction.client, targetStatus ? constants.SUCCESS_COLOR : constants.ERROR_COLOR)
          .setTitle(WINDOW_EMBED_TITLE)
          .setDescription(
            targetStatus
              ? 'The transfer window is now **OPEN**! Teams can now register contracts.'
              : 'The transfer window is now **CLOSED**! No new contracts are permitted. Use `\/emergency-contract`\ to sign players.'
          );

        const messagePayload = { content: targetStatus ? '🟢' : '🔴', embeds: [embed] };

        try {
          const recent = await channel.messages.fetch({ limit: 10 });
          const existing = recent.find(
            (msg) => msg.author.id === interaction.client.user.id && msg.embeds[0]?.title === WINDOW_EMBED_TITLE
          );

          if (existing) {
            await existing.edit(messagePayload);
          } else {
            await channel.send(messagePayload);
          }
        } catch (logError) {
          console.warn('[transfer-window.js] Could not update transfer window channel:', logError.message);
        }
      })();

    } catch (dbError) {
      console.error('❌ Database error in /transfer-window:', dbError);
      if (!interaction.replied) {
        interaction.editReply({ content: '❌ Internal database error while toggling the transfer window.', flags: MessageFlags.Ephemeral });
      }
    }
  },
};