const { SlashCommandBuilder } = require('discord.js');
const database = require('../db/database');
const constants = require('../config/constants');
const { getPositionChoices } = require('../utils/builder-helpers');
const { buildPSLEmbed } = require('../utils/embed-helpers');
const { isChairman } = require('../utils/validations');

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
        .addChoices(getPositionChoices())
    )
    .addStringOption((option) =>
      option
        .setName('message')
        .setDescription('Your scouting message')
        .setRequired(true)
        .setMaxLength(1000)
    ),

  async execute(interaction) {
    const userId = interaction.user.id;
    const position = interaction.options.getString('position');
    const message = interaction.options.getString('message');

    console.log(`\n🔍 [scout.js] Scout posted by ${interaction.user.tag}`);

    try {
      const staffRecord = await database.isUserStaffAnywhere(userId);
      const adminOverride = isChairman(interaction.member);

      if (!staffRecord && !adminOverride) {
        return interaction.editReply({ content: '❌ You are not an authorized manager.', ephemeral: true });
      }

      const cooldownAmount = 3 * 60 * 60 * 1000;
      const now = Date.now();

      if (cooldowns.has(userId)) {
        const expirationTime = cooldowns.get(userId) + cooldownAmount;
        if (now < expirationTime) {
          const timeLeft = expirationTime - now;
          const hours = Math.floor(timeLeft / 3600000);
          const minutes = Math.floor((timeLeft % 3600000) / 60000);
          return interaction.editReply({
            content: `⏰ You're on cooldown! You can scout again in ${hours}h ${minutes}m.`,
            ephemeral: true,
          });
        }
      }

      cooldowns.set(userId, now);
      setTimeout(() => cooldowns.delete(userId), cooldownAmount);

      const scoutingTeamName = staffRecord ? staffRecord.name : 'PSL Staff';

      const embed = buildPSLEmbed(interaction.client, constants.DEFAULT_EMBED_COLOR)
        .setTitle('🔍 Player Scout')
        .setDescription(
          `**${scoutingTeamName}** is scouting for players!\n\n` +
          `📌 **Position**: ${position}\n\n` +
          `💬 **Message**:\n${message}\n\n` +
          `*If you're interested and available, feel free to DM <@${userId}>!*`
        )
        .setAuthor({
          name: interaction.user.displayName,
          iconURL: interaction.user.displayAvatarURL(),
        });

      const targetChannel = await interaction.client.channels.fetch(constants.SCOUT_CHANNEL_ID);
      if (targetChannel) {
        await targetChannel.send({ embeds: [embed] });
        await interaction.editReply({ content: '✅ Your scouting message has been posted!', ephemeral: true });
      } else {
        await interaction.editReply({ content: '⚠️ Could not find the scouting channel.', ephemeral: true });
      }
    } catch (error) {
      console.error('❌ Error in /scout:', error);
      return interaction.editReply({ content: '❌ An error occurred while posting your scout.', ephemeral: true });
    }
  },
};