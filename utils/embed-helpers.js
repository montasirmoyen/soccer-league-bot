const { EmbedBuilder } = require('discord.js');
const constants = require('../config/constants');

function buildPSLEmbed(client, color = constants.DEFAULT_EMBED_COLOR) {
  const avatarURL = client.user.displayAvatarURL();
  
  const detailedDate = new Date().toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    hour12: true
  });

  return new EmbedBuilder()
    .setColor(color)
    .setThumbnail(avatarURL)
    .setFooter({ 
      text: `Promoted by PSL Management System • ${detailedDate}`, 
      iconURL: avatarURL 
    });
}

async function getGuildMemberDisplayName(guild, userId, fallback = 'Unknown User') {
  if (!guild || !userId) return fallback;

  const cleanId = String(userId).replace(/\D/g, '');
  if (!cleanId) return fallback;

  const cachedMember = guild.members.cache.get(cleanId);
  if (cachedMember) return cachedMember.displayName || fallback;

  try {
    const fetchedMember = await guild.members.fetch(cleanId);
    return fetchedMember?.displayName || fallback;
  } catch {
    return fallback;
  }
}

async function formatGuildMemberDisplay(guild, userId, fallback = '*Vacant*') {
  if (!userId) return fallback;

  const displayName = await getGuildMemberDisplayName(guild, userId);
  return `**${displayName}**`;
}

module.exports = { buildPSLEmbed, getGuildMemberDisplayName, formatGuildMemberDisplay };