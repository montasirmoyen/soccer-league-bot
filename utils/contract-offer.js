const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { buildPSLEmbed } = require('./embed-helpers');

function buildContractOfferPayload({
  client,
  teamName,
  formattedTeamName,
  userId,
  issuerId,
  issuerDisplayName,
  embedColor,
  isEmergency = false,
}) {
  const contractEmbed = buildPSLEmbed(client, embedColor)
    .setTitle(isEmergency ? '🚨 EMERGENCY CONTRACT OFFER!' : '📜 NEW CONTRACT OFFER!')
    .setDescription(
      isEmergency
        ? `Hello, <@${userId}>,\n\n${formattedTeamName} has sent you an **Emergency Contract** at the request of the staff member **${issuerDisplayName}**.\n\nReview and make your choice below:`
        : `Hello, <@${userId}>,\n\n${formattedTeamName}, at the request of the staff member **${issuerDisplayName}**, has officially extended a contract offer to you for this season.\n\nPlease review and make your decision below:`
    );

  const actionPrefix = isEmergency ? 'emergency' : '';
  const acceptButton = new ButtonBuilder()
    .setCustomId(`${actionPrefix}accept_${teamName}_${userId}_${issuerId}`)
    .setLabel(isEmergency ? '🤝 Accept Emergency' : '🤝 Accept Contract')
    .setStyle(ButtonStyle.Success);
  const refuseButton = new ButtonBuilder()
    .setCustomId(`${actionPrefix}refuse_${teamName}_${userId}_${issuerId}`)
    .setLabel('❌ Refuse')
    .setStyle(ButtonStyle.Danger);
  const actionRow = new ActionRowBuilder().addComponents(acceptButton, refuseButton);

  return { embeds: [contractEmbed], components: [actionRow] };
}

function isDMDeliveryError(error) {
  return error.code === 50007 || error.code === 50278 || error.status === 403;
}

module.exports = { buildContractOfferPayload, isDMDeliveryError };
