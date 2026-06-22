const { SlashCommandBuilder } = require('discord.js');
const database = require('../db/database');
const constants = require('../config/constants');
const { buildPSLEmbed } = require('../utils/embed-helpers');

const regions = ['GMT', 'BST', 'EST', 'CST', 'PST', 'IST', 'OTHER'];
const types = ['DM TO PLAY', 'IN GAME ALREADY'];

const cooldowns = new Map();
const COOLDOWN_TIME = 30 * 60 * 1000;

module.exports = {
  data: new SlashCommandBuilder()
    .setName('friendly')
    .setDescription('Announce that you are looking for a friendly match')
    .addStringOption((option) =>
      option
        .setName('region')
        .setDescription('Your region')
        .setRequired(true)
        .addChoices(...regions.map((r) => ({ name: r, value: r })))
    )
    .addStringOption((option) =>
      option
        .setName('type')
        .setDescription('Type of friendly')
        .setRequired(true)
        .addChoices(...types.map((t) => ({ name: t, value: t })))
    )
    .addAttachmentOption((option) =>
      option
        .setName('image')
        .setDescription('Upload an image (required if IN GAME ALREADY)')
        .setRequired(false)
    ),

  async execute(interaction) {
    const userId = interaction.user.id;
    const now = Date.now();

    console.log(`\n⚽ [friendly.js] Friendly announcement by ${interaction.user.tag}`);

    if (cooldowns.has(userId)) {
      const expirationTime = cooldowns.get(userId) + COOLDOWN_TIME;
      if (now < expirationTime) {
        const timeLeft = Math.ceil((expirationTime - now) / 1000);
        return interaction.editReply({
          content: `⏳ Please wait ${timeLeft} more second(s) before using this command again.`,
          ephemeral: true,
        });
      }
    }

    const user = interaction.user;
    const region = interaction.options.getString('region');
    const type = interaction.options.getString('type');
    const image = interaction.options.getAttachment('image');

    if (type === 'IN GAME ALREADY' && !image) {
      return interaction.editReply({
        content: '❌ You must upload an image when type is "IN GAME ALREADY".',
        ephemeral: true,
      });
    }
    if (type === 'DM TO PLAY' && image) {
      return interaction.editReply({
        content: '❌ You cannot upload an image when type is "DM TO PLAY".',
        ephemeral: true,
      });
    }

    cooldowns.set(userId, now);

    try {
      const staffRecord = await database.isUserStaffAnywhere(userId);
      const isManager = !!staffRecord;
      const member = await interaction.guild.members.fetch(userId).catch(() => null);
      const displayName = member ? member.displayName : user.username;

      let pingString = `<@${userId}> <@&${constants.FRIENDLY_ROLE_ID}>`;

      const embed = buildPSLEmbed(interaction.client, constants.DEFAULT_EMBED_COLOR)
        .setAuthor({ name: displayName, iconURL: user.displayAvatarURL({ extension: 'png', size: 128 }) });

      if (isManager) {
        embed.setTitle(`**${staffRecord.name}** is Looking for a Match!`)
          .addFields(
            { name: 'Region', value: region, inline: true },
            { name: 'Status', value: type === 'IN GAME ALREADY' ? 'In Game' : 'DM to Play', inline: true },
            {
              name: 'Info',
              value: type === 'DM TO PLAY'
                ? `DM <@${userId}> if you want to friendly!`
                : 'Team is in a server waiting to friendly!',
              inline: false,
            }
          );
      } else {
        embed.setTitle(`${displayName} is Looking for a Friendly!`)
          .addFields(
            { name: 'Region', value: region, inline: true },
            { name: 'Status', value: type === 'IN GAME ALREADY' ? 'In Game' : 'DM to Play', inline: true },
            {
              name: 'Info',
              value: type === 'DM TO PLAY'
                ? `DM <@${userId}> if you want to friendly!`
                : 'Team is in a server waiting to friendly!',
              inline: false,
            }
          );
      }

      if (type === 'IN GAME ALREADY' && image) {
        embed.setImage(image.url);
      }

      const channel = await interaction.client.channels.fetch(constants.FRIENDLY_CHANNEL_ID);
      await channel.send({ content: pingString, embeds: [embed] });
      await interaction.editReply({ content: '✅ Your friendly announcement has been sent!', ephemeral: true });
    } catch (error) {
      console.error('❌ Error in /friendly:', error);
      cooldowns.delete(userId);
      await interaction.editReply({ content: '❌ Failed to send friendly announcement.', ephemeral: true });
    }
  },
};