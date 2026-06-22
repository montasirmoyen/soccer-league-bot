const { SlashCommandBuilder } = require('discord.js');
const database = require('../db/database');
const constants = require('../config/constants');
const { buildPSLEmbed } = require('../utils/embed-helpers');

const cooldowns = new Map();

module.exports = {
  data: new SlashCommandBuilder()
    .setName('scout')
    .setDescription('Scout for players in a specific position')
    .addStringOption((option) =>
      option
        .setName('position')
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
    .addStringOption((option) =>
      option
        .setName('message')
        .setDescription('Your scouting message')
        .setRequired(true)
        .setMaxLength(1000)
    ),

  async execute(interaction) {
    const user = interaction.user.id;
    const position = interaction.options.getString('position');
    const message = interaction.options.getString('message');

    console.log(`\n🔍 [scout.js] Scout posted by ${interaction.user.tag}`);

    try {
      const staffRecord = await database.isUserStaffAnywhere(user);
      if (!staffRecord) {
        return interaction.editReply({ content: '❌ You are not an authorized manager.', ephemeral: true });
      }

      const cooldownAmount = 3 * 60 * 60 * 1000;
      const now = Date.now();

      if (cooldowns.has(user)) {
        const expirationTime = cooldowns.get(user) + cooldownAmount;

        if (now < expirationTime) {
          const timeLeft = (expirationTime - now) / 1000;
          const hours = Math.floor(timeLeft / 3600);
          const minutes = Math.floor((timeLeft % 3600) / 60);

          return interaction.editReply({
            content: `⏰ You're on cooldown! You can scout again in ${hours}h ${minutes}m.`,
            ephemeral: true,
          });
        }
      }

      cooldowns.set(user, now);
      setTimeout(() => {
        cooldowns.delete(user);
      }, cooldownAmount);

      const embed = buildPSLEmbed(interaction.client, constants.DEFAULT_EMBED_COLOR)
        .setTitle('🔍 Player Scout')
        .setDescription(
          `**${staffRecord.name}** is scouting for players!\n\n` +
          `📌 **Position**: ${position}\n\n` +
          `💬 **Message**:\n${message}\n\n` +
          `*If you're interested and available, feel free to DM <@${user}>!*`
        )
        .setAuthor({
          name: interaction.user.displayName,
          iconURL: interaction.user.displayAvatarURL(),
        });

      const targetChannel = await interaction.client.channels.fetch(constants.SCOUT_CHANNEL_ID);
      if (targetChannel) {
        await targetChannel.send({ embeds: [embed] });
        await interaction.editReply({
          content: '✅ Your scouting message has been posted!',
          ephemeral: true,
        });
      } else {
        await interaction.editReply({
          content: '⚠️ Could not find the scouting channel.',
          ephemeral: true,
        });
      }
    } catch (error) {
      console.error('❌ Error in /scout:', error);
      return interaction.editReply({ content: '❌ An error occurred while posting your scout.', ephemeral: true });
    }
  },
};