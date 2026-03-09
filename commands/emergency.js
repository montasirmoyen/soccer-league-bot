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
        .setTitle('🚨 PSL Emergency Contract')
        .setDescription(
          `**EMERGENCY SIGNING**\n` +
          `By accepting this emergency contract, <@${player.id}>, you agree to join the team immediately.\n\n` +
          `${existingContract ? `⚠️ **Current Team**: *${existingContract.teamName}**\n` : ''}` +
          `🆕 **New Team**: **${teamData.team}**\n\n` +
          `📋 **Emergency Reason**\n\`${reason}\`\n\n` +
          `🖊️ **Authorized By**\n<@${sender}>\n\n` +
          `⚠️ **Note**: This is an emergency signing that may override existing contracts.`
        )
        .setFooter({
          text: '[PSL] Pure Soccer League - ' + new Date().toLocaleString(),
          iconURL: 'https://media.discordapp.net/attachments/1396248400122613861/1415814787044081805/PSL_LOGO_WHITE.png?ex=68c493c5&is=68c34245&hm=bdc17b94895be0ce7e1591c3d284af2ae772dbc9e692fac34e1114b8be73ea52&=&format=webp&quality=lossless&width=1440&height=1440'
        })
        .setColor(0xff6b6b); 

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