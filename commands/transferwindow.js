const { SlashCommandBuilder } = require('discord.js');
const database = require('../db/database');
const constants = require('../config/constants');
const { isChairman } = require('../utils/validations');
const { buildPSLEmbed } = require('../utils/embedHelpers');

const WINDOW_EMBED_TITLE = '⚽ TRANSFER WINDOW STATUS UPDATE';

module.exports = {
  data: new SlashCommandBuilder()
    .setName('transferwindow')
    .setDescription('Opens or closes the league transfer window.')
    .addBooleanOption((option) =>
      option.setName('status').setDescription('True = Open, False = Closed').setRequired(true)
    ),

  async execute(interaction) {
    console.log(`\n🪟 [transferwindow.js] Transfer window toggled by ${interaction.user.tag}`);

    if (!isChairman(interaction.member)) {
      return interaction.reply({
        content: '❌ Only Chairmen are allowed to toggle the transfer window.',
        ephemeral: true,
      });
    }

    const targetStatus = interaction.options.getBoolean('status');
    const currentStatus = await database.getTransferWindowState();

    if (currentStatus === targetStatus) {
      const noChangeMsg = targetStatus
        ? '🔓 The transfer window is already **OPEN**. No changes made.'
        : '🔒 The transfer window is already **CLOSED**. No changes made.';
      return interaction.reply({ content: noChangeMsg, ephemeral: true });
    }

    try {
      await database.setTransferWindowState(targetStatus);

      try {
        const channel = await interaction.client.channels.fetch(constants.TRANSFER_WINDOW_CHANNEL_ID);
        if (channel) {
          const embed = buildPSLEmbed(
            interaction.client,
            targetStatus ? constants.SUCCESS_COLOR : constants.ERROR_COLOR
          )
            .setTitle(WINDOW_EMBED_TITLE)
            .setDescription(
              targetStatus
                ? 'The transfer window is now **OPEN**! Teams can register contracts and release players.'
                : 'The transfer window is now **CLOSED**! No new contracts or releases are permitted.'
            );

          const messagePayload = {
            content: targetStatus ? '🟢' : '🔴',
            embeds: [embed],
          };

          const recent = await channel.messages.fetch({ limit: 10 });
          const existing = recent.find(
            (msg) =>
              msg.author.id === interaction.client.user.id &&
              msg.embeds[0]?.title === WINDOW_EMBED_TITLE
          );

          if (existing) {
            await existing.edit(messagePayload);
          } else {
            await channel.send(messagePayload);
          }
        }
      } catch (logError) {
        console.warn('[transferwindow.js] Could not update transfer window channel:', logError.message);
      }

      const replyMsg = targetStatus
        ? '🔓 The transfer window is now officially **OPEN**!'
        : '🔒 The transfer window is now officially **CLOSED**!';

      return interaction.reply({ content: replyMsg });
    } catch (dbError) {
      console.error('❌ Database error in /transferwindow:', dbError);
      return interaction.reply({
        content: '❌ Internal database error while toggling the transfer window.',
        ephemeral: true,
      });
    }
  },
};