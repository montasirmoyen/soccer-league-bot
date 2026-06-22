const { EmbedBuilder } = require('discord.js');
const constants = require('../config/constants');

function buildPSLEmbed(client, color = constants.DEFAULT_EMBED_COLOR) {
  const avatarURL = client.user.displayAvatarURL();
  return new EmbedBuilder()
    .setColor(color)
    .setAuthor({ name: 'PSL Management System', iconURL: avatarURL })
    .setThumbnail(avatarURL)
    .setFooter({ text: 'Promoted by PSL Management System', iconURL: avatarURL })
    .setTimestamp();
}

module.exports = { buildPSLEmbed };