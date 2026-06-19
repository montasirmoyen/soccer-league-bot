const { SlashCommandBuilder } = require('discord.js');
const database = require('../db/database');
const constants = require('../config/constants');
const { buildPSLEmbed } = require('../utils/embedHelpers');

const cooldowns = new Map();

module.exports = {
  data: new SlashCommandBuilder()
    .setName('freeagent')
    .setDescription('Register yourself as a free agent')
    .addStringOption((option) =>
      option
        .setName('position')
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
    .addStringOption((option) =>
      option
        .setName('region')
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

    console.log(`\n🏃 [freeagent.js] Free agent registration by ${user.tag}`);

    try {
      const isStaff = await database.isUserStaffAnywhere(userId);
      if (isStaff) {
        return interaction.editReply({ content: '❌ Management staff cannot register as free agents.', ephemeral: true });
      }

      const cooldownAmount = 6 * 60 * 60 * 1000;
      const now = Date.now();

      if (cooldowns.has(userId)) {
        const expirationTime = cooldowns.get(userId) + cooldownAmount;

        if (now < expirationTime) {
          const timeLeft = (expirationTime - now) / 1000;
          const hours = Math.floor(timeLeft / 3600);
          const minutes = Math.floor((timeLeft % 3600) / 60);

          return interaction.editReply({
            content: `⏰ You're on cooldown! Try again in ${hours}h ${minutes}m.`,
            ephemeral: true,
          });
        }
      }

      const contract = await database.getContractedTeam(userId);
      if (contract) {
        return interaction.editReply({
          content: `❌ You are already contracted to **${contract.teamName}**.`,
          ephemeral: true,
        });
      }

      cooldowns.set(userId, now);
      setTimeout(() => cooldowns.delete(userId), cooldownAmount);

      const embed = buildPSLEmbed(interaction.client, constants.DEFAULT_EMBED_COLOR)
        .setTitle('🏃 Free Agent Registration')
        .setDescription(
          `<@${userId}> has registered as a free agent!\n\n` +
          `📍 **Position**: ${position}\n` +
          `🌍 **Region**: ${region}\n\n` +
          `Managers can send contracts to this player using \`/contract\``
        )
        .setThumbnail(user.displayAvatarURL());

      const targetChannel = await interaction.client.channels.fetch(constants.FREEAGENT_CHANNEL_ID);
      if (!targetChannel) {
        return interaction.editReply({
          content: '⚠️ Could not find the free agent channel.',
          ephemeral: true,
        });
      }

      await targetChannel.send({ content: `<@${userId}>`, embeds: [embed] });
      await interaction.editReply({
        content: '✅ You have been registered as a free agent!',
        ephemeral: true,
      });
    } catch (error) {
      console.error('❌ Error in /freeagent:', error);
      return interaction.editReply({ content: '❌ An error occurred while registering as a free agent.', ephemeral: true });
    }
  },
};