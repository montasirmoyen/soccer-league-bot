const { EmbedBuilder } = require('discord.js');
const { ANNOUNCE_CHANNEL_ID, MINIMUM_ROLE_ID } = require('../config/constants');

async function handleAnnounceModal(interaction, emojiMap) {
  const member = interaction.member;
  const guild = interaction.guild;

  const requiredRole = guild.roles.cache.get(MINIMUM_ROLE_ID);
  if (!requiredRole || member.roles.highest.comparePositionTo(requiredRole) < 0) {
    return interaction.reply({ content: '🚫 You do not have permission.', ephemeral: true });
  }

  let message = interaction.fields.getTextInputValue('announcementInput');
  for (const [shortcut, emoji] of Object.entries(emojiMap)) {
    message = message.replaceAll(shortcut, emoji);
  }

  const embed = new EmbedBuilder()
    .setColor('#f2f2f2')
    .setDescription(message)
    .setTimestamp()
    .setFooter({
      text: member.displayName,
      iconURL: member.displayAvatarURL({ extension: 'png', size: 64 }),
    });

  const announceChannel = await interaction.client.channels.fetch(ANNOUNCE_CHANNEL_ID);
  await announceChannel.send({ content: 'Official Statement', embeds: [embed] });
  await interaction.reply({ content: '✅ Announcement sent!', ephemeral: true });
}

module.exports = { handleAnnounceModal };
