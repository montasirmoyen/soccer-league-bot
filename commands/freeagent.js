const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { managers } = require('../config/managers');
const db = require('../db/database'); 
const cooldowns = new Map();
const { FREEAGENT_CHANNEL_ID } = require('../config/constants');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('freeagent')
    .setDescription('Register yourself as a free agent')
    .addStringOption(option =>
      option.setName('position')
        .setDescription('Your preferred position')
        .setRequired(true)
        .addChoices(
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
      option.setName('region')
        .setDescription('Your timezone/region')
        .setRequired(true)
        .addChoices(
          { name: 'GMT', value: 'GMT' },
          { name: 'BST', value: 'BST' },
          { name: 'EST', value: 'EST' },
          { name: 'CST', value: 'CST' },
          { name: 'PST', value: 'PST' },
          { name: 'UTC', value: 'UTC' },
          { name: 'WEST', value: 'WEST' },
          { name: 'EET', value: 'EET' },
          { name: 'EEST', value: 'EEST' },
          { name: 'MSK', value: 'MSK' },
          { name: 'OTHER', value: 'OTHER' }
        )
    ),

  async execute(interaction) {
    const user = interaction.user;
    const userId = user.id;
    const position = interaction.options.getString('position');
    const region = interaction.options.getString('region');

    if (managers[userId]) {
      return interaction.reply({ content: '❌ Managers cannot register as free agents.', ephemeral: true });
    }

    const cooldownAmount = 6 * 60 * 60 * 1000; 
    const now = Date.now();

    if (cooldowns.has(userId)) {
      const expirationTime = cooldowns.get(userId) + cooldownAmount;

      if (now < expirationTime) {
        const timeLeft = (expirationTime - now) / 1000;
        const hours = Math.floor(timeLeft / 3600);
        const minutes = Math.floor((timeLeft % 3600) / 60);

        return interaction.reply({
          content: `⏰ You're on cooldown! Try again in ${hours}h ${minutes}m.`,
          ephemeral: true
        });
      }
    }

    try {
      const contract = await db.getContractedTeam(userId);
      if (contract) {
        return interaction.reply({
          content: `❌ You are already contracted **${contract.teamName}**`,
          ephemeral: true
        });
      }

      cooldowns.set(userId, now);
      setTimeout(() => cooldowns.delete(userId), cooldownAmount);

      const embed = new EmbedBuilder()
        .setTitle('🏃‍♂️ Free Agent Registration')
        .setDescription(
          `<@${userId}> has registered as a free agent!\n\n` +
          `📍 **Position**: ${position}\n` +
          `🌍 **Region**: ${region}\n\n` +
          `Managers can send contracts to this player using \`/contract\``
        )
        .setThumbnail(user.displayAvatarURL())
        .setFooter({
          text: '[PSL] Pure Soccer League - ' + new Date().toLocaleString(),
          iconURL: 'https://media.discordapp.net/attachments/1480765412651307200/1480765442946629632/PSL_LOGO_WHITE.png?ex=69b0ddc8&is=69af8c48&hm=cc39c00742d3a79f6951870d01481a4d125e94e3dd4abeb3069c6c0ef11a3005&=&format=webp&quality=lossless&width=700&height=700'
        })
        .setColor(0xffa500)
        .setTimestamp();

      const targetChannel = interaction.client.channels.cache.get(FREEAGENT_CHANNEL_ID);

      if (!targetChannel) {
        return interaction.reply({
          content: '⚠️ Could not find the free agent channel.',
          ephemeral: true
        });
      }

      await targetChannel.send({ content: `<@${userId}>`, embeds: [embed] });
      await interaction.reply({
        content: '✅ You have been registered as a free agent!',
        ephemeral: true
      });

    } catch (err) {
      console.error('Free agent error:', err);
      return interaction.reply({ content: '⚠️ Something went wrong. Try again later.', ephemeral: true });
    }
  }
};
