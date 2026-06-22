const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const database = require('../db/database');
const constants = require('../config/constants');
const { getPositionChoices, getTimezoneChoices } = require('../utils/builder-helpers');
const { buildPSLEmbed } = require('../utils/embed-helpers');

const cooldowns = new Map();

module.exports = {
  data: new SlashCommandBuilder()
    .setName('send-profile')
    .setDescription('Send your player profile to the market')
    .addStringOption((option) =>
      option
        .setName('position')
        .setDescription('Your preferred position')
        .setRequired(true)
        .addChoices(getPositionChoices())
    )
    .addStringOption((option) =>
      option
        .setName('region')
        .setDescription('Your timezone/region')
        .setRequired(true)
        .addChoices(getTimezoneChoices())
    )
    .addStringOption((option) =>
      option
        .setName('nationality')
        .setDescription('Your country flag emoji only (e.g. 🇧🇷)')
        .setRequired(true)
        .setMaxLength(9)
    )
    .addStringOption((option) =>
      option
        .setName('summary')
        .setDescription('A brief summary about you (Max 100 chars)')
        .setRequired(true)
        .setMaxLength(100)
    ),

  async execute(interaction) {
    const userId = interaction.user.id;
    const user = interaction.user;

    const position = interaction.options.getString('position');
    const region = interaction.options.getString('region');
    const nationality = interaction.options.getString('nationality') || 'No nationality provided';
    const summary = interaction.options.getString('summary') || 'No summary provided.';

    try {
      const isStaff = await database.isUserStaffAnywhere(userId);
      if (isStaff) {
        return interaction.editReply({ 
          content: '❌ Management staff cannot register as free agents.' 
        });
      }

      const cooldownAmount = 3 * 24 * 60 * 60 * 1000;
      const now = Date.now();

      if (cooldowns.has(userId)) {
        const expirationTime = cooldowns.get(userId) + cooldownAmount;

        if (now < expirationTime) {
          const timeLeft = (expirationTime - now) / 1000;
          const hours = Math.floor(timeLeft / 3600);
          const minutes = Math.floor((timeLeft % 3600) / 60);

          return interaction.editReply({
            content: `⏰ You are on cooldown! Please try again in **${hours}**h **${minutes}**m.`
          });
        }
      }

      cooldowns.set(userId, now);
      setTimeout(() => cooldowns.delete(userId), cooldownAmount);

      const profileEmbed = buildPSLEmbed(interaction.client, constants.DEFAULT_EMBED_COLOR)
        .setTitle('📝 Player Profile Registered')
        .setThumbnail(user.displayAvatarURL({ dynamic: true }))
        .setDescription(`⚽ <@${userId}> is now looking forward for new experiences!\n\nManagers can offer a contract using \`/contract\``)
        .addFields(
          { name: '🏃 Preferred Position', value: position, inline: true },
          { name: '🌐 Region / Timezone', value: region, inline: true },
          { name: '🏳️ Nationality', value: nationality, inline: true },
          { name: '💬 Player Statement', value: `\`\`\`text\n${summary}\n\`\`\``, inline: false }
        );

      const playerInformationChannel = await interaction.client.channels.fetch(constants.PLAYER_INFORMATION_CHANNEL_ID);
      if (!playerInformationChannel) {
        return interaction.editReply({
          content: '⚠️ Free agency market channel not found.'
        });
      }

      await playerInformationChannel.send({ content: `<@${userId}>`, embeds: [profileEmbed] });
      
      await interaction.editReply({
        content: '✅ Your player profile has been posted successfully!'
      });

    } catch (error) {
      console.error('❌ Error in /send-profile:', error);
      return interaction.editReply({ 
        content: '❌ An error occurred while processing your profile registration.' 
      });
    }
  }
};