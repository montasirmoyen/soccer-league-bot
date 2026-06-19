const constants = require('../config/constants');
const { isChairman } = require('../utils/validations');
const { buildPSLEmbed } = require('../utils/embedHelpers');

async function handleAnnounceModal(interaction, emojiMap) {
  console.log(`\n📣 [modalHandler.js] Announcement modal submitted by ${interaction.user.tag}`);

  try {
    const member = interaction.member;

    if (!isChairman(member)) {
      return interaction.reply({ content: '❌ You do not have permission to use this command.', ephemeral: true });
    }

    let message = interaction.fields.getTextInputValue('announcementInput');
    for (const [shortcut, emoji] of Object.entries(emojiMap)) {
      message = message.replaceAll(shortcut, emoji);
    }

    const embed = buildPSLEmbed(interaction.client, '#f2f2f2')
      .setDescription(message)
      .setAuthor({
        name: member.displayName,
        iconURL: member.displayAvatarURL({ extension: 'png', size: 64 }),
      });

    const announceChannel = await interaction.client.channels.fetch(constants.ANNOUNCE_CHANNEL_ID);
    if (announceChannel) {
      await announceChannel.send({ content: '📢 Official Statement', embeds: [embed] });
    }

    await interaction.reply({ content: '✅ Announcement sent!', ephemeral: true });
  } catch (error) {
    console.error('[modalHandler.js] Error handling announcement modal:', error);
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({ content: '❌ An error occurred while sending the announcement.', ephemeral: true });
    } else {
      await interaction.reply({ content: '❌ An error occurred while sending the announcement.', ephemeral: true });
    }
  }
}

module.exports = { handleAnnounceModal };