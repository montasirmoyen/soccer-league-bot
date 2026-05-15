const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { managers, enabled } = require('../config/managers');
const db = require('../db/database');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('emergencysign')
    .setDescription('Emergency sign a player (bypasses normal restrictions)')
    .addUserOption(option => 
      option.setName('player')
        .setDescription('Player to emergency sign')
        .setRequired(true)
    )
    .addStringOption(option =>
      option.setName('reason')
        .setDescription('Reason for emergency signing')
        .setRequired(true)
    ),

  async execute(interaction) {
    const sender = interaction.user.id;
    const player = interaction.options.getUser('player');
    const reason = interaction.options.getString('reason');


    if (!managers[sender]) {
      return interaction.reply({ content: '❌ You are not an authorized manager.', ephemeral: true });
    }

    if (managers[player.id]) {
      return interaction.reply({ content: '❌ You cannot sign another manager.', ephemeral: true });
    }

    if (player.id === sender) {
      return interaction.reply({ content: '❌ You cannot sign yourself.', ephemeral: true });
    }

    if (player.bot) {
      return interaction.reply({ content: '❌ You cannot sign bots.', ephemeral: true });
    }

    try {
      const existingContract = await db.getContractedTeam(player.id);
      const teamData = managers[sender];

      const embed = new EmbedBuilder()
        .setAuthor({
          name: interaction.user.displayName || interaction.user.username,
          iconURL: interaction.user.displayAvatarURL()
        })
        .setTitle('🚨 Emergency Signing')
        .setColor(0xED4245)
        .setDescription(`<@${player.id}>, you have received an **emergency contract**. This requires your immediate response.`)
        .addFields(
          ...(existingContract ? [{ name: '⚠️ Current Team', value: existingContract.teamName, inline: true }] : []),
          { name: '🆕 New Team', value: teamData.team, inline: true },
          { name: '🖊️ Authorized By', value: `<@${sender}>`, inline: true },
          { name: '​', value: '​', inline: true },
          { name: '📋 Reason', value: `\`${reason}\``, inline: false },
          { name: '⚠️ Note', value: 'This emergency signing may override your existing contract.', inline: false }
        )
        .setFooter({
          text: 'PSL · Pure Soccer League',
          iconURL: 'https://media.discordapp.net/attachments/1480765412651307200/1480765442946629632/PSL_LOGO_WHITE.png?ex=69b0ddc8&is=69af8c48&hm=cc39c00742d3a79f6951870d01481a4d125e94e3dd4abeb3069c6c0ef11a3005&=&format=webp&quality=lossless&width=700&height=700'
        })
        .setTimestamp();

      const buttons = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`emergency_accept_${sender}_${teamData.team}_${player.id}`)
          .setLabel('Accept Emergency Contract')
          .setStyle(ButtonStyle.Success)
          .setEmoji('🚨'),
        new ButtonBuilder()
          .setCustomId(`emergency_decline_${sender}_${teamData.team}_${player.id}`)
          .setLabel('Decline')
          .setStyle(ButtonStyle.Danger)
      );

      await interaction.reply({ 
        content: `🚨 <@${player.id}> **EMERGENCY CONTRACT** - Immediate response required!`, 
        embeds: [embed], 
        components: [buttons] 
      });

    } catch (err) {
      console.error('Database error:', err);
      return interaction.reply({ content: '⚠️ Database error occurred.', ephemeral: true });
    }
  }
};