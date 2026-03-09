const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { managers } = require('../config/managers');

const cooldowns = new Map();

module.exports = {
  data: new SlashCommandBuilder()
    .setName('scout')
    .setDescription('Scout for players in a specific position')
    .addStringOption(option =>
      option.setName('position')
        .setDescription('Position you are scouting for')
        .setRequired(true)
        .addChoices(
          { name: 'ALL', value: 'ALL' },
          { name: 'GK', value: 'GK' },
          { name: 'LB', value: 'LB' },
          { name: 'RB', value: 'RB' },
          { name: 'CB', value: 'CB' },
          { name: 'CDM', value: 'CDM' },
          { name: 'CM', value: 'CM' },
          { name: 'RM', value: 'RM' },
          { name: 'LM', value: 'LM' },
          { name: 'CAM', value: 'CAM' },
          { name: 'RW', value: 'RW' },
          { name: 'LW', value: 'LW' },
          { name: 'CF', value: 'CF' },
          { name: 'ST', value: 'ST' }
        )
    )
    .addStringOption(option =>
      option.setName('message')
        .setDescription('Your scouting message')
        .setRequired(true)
        .setMaxLength(1000)
    ),

  async execute(interaction) {
    const user = interaction.user.id;
    const position = interaction.options.getString('position');
    const message = interaction.options.getString('message');

    const teamData = managers[user];

    if (!teamData) {
      return interaction.reply({ content: '❌ You are not an authorized manager.', ephemeral: true });
    }

    const cooldownAmount = 3 * 60 * 60 * 1000;
    const now = Date.now();

    if (cooldowns.has(user)) {
      const expirationTime = cooldowns.get(user) + cooldownAmount;

      if (now < expirationTime) {
        const timeLeft = (expirationTime - now) / 1000;
        const hours = Math.floor(timeLeft / 3600);
        const minutes = Math.floor((timeLeft % 3600) / 60);

        return interaction.reply({
          content: `⏰ You're on cooldown! You can scout again in ${hours}h ${minutes}m.`,
          ephemeral: true
        });
      }
    }

    cooldowns.set(user, now);

    setTimeout(() => {
      cooldowns.delete(user);
    }, cooldownAmount);

    const embed = new EmbedBuilder()
      .setTitle('🔍 Player Scout')
      .setDescription(
        `**${teamData.team}** is scouting for players!\n\n` +
        `📌 **Position**: ${position}\n\n` +
        `💬 **Message**:\n${message}\n\n` +
        `*If you're interested and available, feel free to DM <@${user}>!*`
      )
      .setAuthor({
        name: interaction.user.displayName,
        iconURL: interaction.user.displayAvatarURL()
      })
      .setFooter({
        text: '[PSL] Pure Soccer League - ' + new Date().toLocaleString(),
        iconURL: 'https://media.discordapp.net/attachments/1396248400122613861/1415814787044081805/PSL_LOGO_WHITE.png?ex=68c493c5&is=68c34245&hm=bdc17b94895be0ce7e1591c3d284af2ae772dbc9e692fac34e1114b8be73ea52&=&format=webp&quality=lossless&width=1440&height=1440'
      })
      .setColor(0x00ff00)
      .setTimestamp();

    const targetChannel = interaction.client.channels.cache.get('1396552846303953106');
    if (targetChannel) {
      await targetChannel.send({ embeds: [embed] });
      await interaction.reply({ content: '✅ Your scouting message has been posted!', ephemeral: true });
    } else {
      await interaction.reply({ content: '⚠️ Could not find the scouting channel.', ephemeral: true });
    }
  }
};