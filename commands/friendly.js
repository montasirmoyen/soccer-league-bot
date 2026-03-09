const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const managersDB = require('../config/managers.js');

//const MANAGER_ROLE_ID = '1406827377916641310';
//const ASSISTANT_ROLE_ID = '1406827377916641310';
const FRIENDLY_ROLE_ID = '1396443727580627086';
const FRIENDLY_CHANNEL_ID = '1396559656121405590';

const regions = ['GMT', 'BST', 'EST', 'CST', 'PST', 'OTHER'];
const types = ['DM TO PLAY', 'IN GAME ALREADY'];

const cooldowns = new Map();
const COOLDOWN_TIME = 30 * 60 * 1000;

module.exports = {
  data: new SlashCommandBuilder()
    .setName('friendly')
    .setDescription('Announce that you are looking for a friendly match')
    .addStringOption(option =>
      option
        .setName('region')
        .setDescription('Your region')
        .setRequired(true)
        .addChoices(...regions.map(r => ({ name: r, value: r })))
    )
    .addStringOption(option =>
      option
        .setName('type')
        .setDescription('Type of friendly')
        .setRequired(true)
        .addChoices(...types.map(t => ({ name: t, value: t })))
    )
    .addAttachmentOption(option =>
      option
        .setName('image')
        .setDescription('Upload an image (required if IN GAME ALREADY)')
        .setRequired(false)
    ),

  async execute(interaction) {
    const userId = interaction.user.id;
    const now = Date.now();

    if (cooldowns.has(userId)) {
      const expirationTime = cooldowns.get(userId) + COOLDOWN_TIME;
      if (now < expirationTime) {
        const timeLeft = Math.ceil((expirationTime - now) / 1000);
        return interaction.reply({ content: `⏳ Please wait ${timeLeft} more second(s) before using this command again.`, ephemeral: true });
      }
    }

    const user = interaction.user;
    const region = interaction.options.getString('region');
    const type = interaction.options.getString('type');
    const image = interaction.options.getAttachment('image');

    if (type === 'IN GAME ALREADY' && !image) {
      return interaction.reply({ content: '❌ You must upload an image when type is "IN GAME ALREADY".', ephemeral: true });
    }
    if (type === 'DM TO PLAY' && image) {
      return interaction.reply({ content: '❌ You cannot upload an image when type is "DM TO PLAY".', ephemeral: true });
    }

    cooldowns.set(userId, now);

    const isManager = userId in managersDB.managers;
    const managerData = managersDB.managers[userId];
    const member = interaction.guild.members.cache.get(userId);
    const displayName = member ? member.displayName : user.username;

    //let pingString;
    //if (isManager) {
      //pingString = `<@${userId}> <@&${MANAGER_ROLE_ID}> <@&${ASSISTANT_ROLE_ID}> <@&${FRIENDLY_ROLE_ID}>`;
    //} else {
      let pingString = `<@${userId}> <@&${FRIENDLY_ROLE_ID}>`;
   // }

    const embed = new EmbedBuilder()
      .setColor(0x5865F2)
      .setTimestamp()
      .setFooter({
          text: '[PSL] Pure Soccer League - ' + new Date().toLocaleString(),
          iconURL: 'https://media.discordapp.net/attachments/1396248400122613861/1415814787044081805/PSL_LOGO_WHITE.png?ex=68c493c5&is=68c34245&hm=bdc17b94895be0ce7e1591c3d284af2ae772dbc9e692fac34e1114b8be73ea52&=&format=webp&quality=lossless&width=1440&height=1440'
        })
      .setAuthor({ name: displayName, iconURL: user.displayAvatarURL({ extension: 'png', size: 128 }) });

    if (isManager) {
      embed.setTitle(`**${managerData.team}** is Looking for a Match!`)
        .addFields(
          { name: 'Region', value: region, inline: true },
          { name: 'Status', value: type === 'IN GAME ALREADY' ? 'In Game' : 'DM to Play', inline: true },

          { 
            name: 'Info', 
            value: type === 'DM TO PLAY' 
              ? `DM <@${userId}> if you want to friendly!` 
              : 'Team is in a server waiting to friendly!', 
            inline: false 
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
            inline: false 
          }
        );
    }

    if (type === 'IN GAME ALREADY' && image) {
      embed.setImage(image.url);
    }

    try {
      const channel = await interaction.client.channels.fetch(FRIENDLY_CHANNEL_ID);
      await channel.send({ content: pingString, embeds: [embed] });
      await interaction.reply({ content: '✅ Your friendly announcement has been sent!', ephemeral: true });
    } catch (error) {
      console.error('Error sending friendly message:', error);
      cooldowns.delete(userId);
      await interaction.reply({ content: '⚠️ Failed to send friendly announcement.', ephemeral: true });
    }
  }
};
