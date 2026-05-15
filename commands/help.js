const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { managers } = require('../config/managers');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('help')
    .setDescription('Display all available commands and their descriptions'),

  async execute(interaction) {
    const user = interaction.user.id;
    const isManager = managers[user] ? true : false;

    const PSL_LOGO = 'https://media.discordapp.net/attachments/1480765412651307200/1480765442946629632/PSL_LOGO_WHITE.png?ex=69b0ddc8&is=69af8c48&hm=cc39c00742d3a79f6951870d01481a4d125e94e3dd4abeb3069c6c0ef11a3005&=&format=webp&quality=lossless&width=700&height=700';

    const embed = new EmbedBuilder()
      .setAuthor({
        name: 'Pure Soccer League',
        iconURL: PSL_LOGO
      })
      .setTitle('📋 Command Reference')
      .setDescription('All available commands for the PSL bot.')
      .setColor(0x5865F2)
      .setThumbnail(PSL_LOGO)
      .setFooter({
        text: 'PSL · Pure Soccer League',
        iconURL: PSL_LOGO
      })
      .setTimestamp();

    embed.addFields({
      name: '👥 Player Commands',
      value:
        '`/freeagent` — Register as a free agent\n' +
        '`/friendly` — Look for friendly matches',
      inline: false
    });

    if (isManager) {
      const teamData = managers[user];
      embed.addFields(
        {
          name: '👔 Manager Commands',
          value:
            '`/contract @user` — Send a contract to a player\n' +
            '`/emergencycontract @user` — Emergency signing\n' +
            '`/scout [position] [message]` — Scout for players\n' +
            '`/release @user` — Release a player\n' +
            '`/forcerelease @user` — Force release *(Admin Only)*\n' +
            '`/friendly` — Announce you are looking for a friendly',
          inline: false
        },
        {
          name: '🏆 Your Team',
          value: teamData.team,
          inline: true
        }
      );
    }

    embed.addFields(
      {
        name: '📍 Positions',
        value: 'GK · RB · LB · CB · CDM · CM · RM · LM · CAM · LW · RW · CF · ST',
        inline: false
      },
      {
        name: '🌍 Regions',
        value: 'GMT · BST · EST · CST · PST · UTC · WEST · EET · EEST · MSK · OTHER',
        inline: false
      },
      {
        name: '💡 Tips',
        value:
          '• Free agents are posted in the transfer channel\n' +
          '• Players must be released before signing elsewhere\n' +
          '• Transfer window must be open for contracts\n' +
          '• Upload a screenshot when using "IN GAME ALREADY"',
        inline: false
      }
    );

    await interaction.reply({ embeds: [embed], ephemeral: true });
  }
};