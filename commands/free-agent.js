const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const database = require('../db/database');
const constants = require('../config/constants');
const builderHelpers = require('../utils/builder-helpers');
const { buildPSLEmbed } = require('../utils/embed-helpers');

const cooldowns = new Map();

module.exports = {
  data: new SlashCommandBuilder()
    .setName('free-agent')
    .setDescription('Register yourself as a free agent')
    .addStringOption((option) =>
      option
        .setName('position')
        .setDescription('Your preferred position')
        .setRequired(true)
        .addChoices(builderHelpers.getPositionChoices())
    )
    .addStringOption((option) =>
      option
        .setName('region')
        .setDescription('Your timezone/region')
        .setRequired(true)
        .addChoices(builderHelpers.getTimezoneChoices())
    ),

  async execute(interaction) {
    const user = interaction.user;
    const displayName = user.displayName;
    const userId = user.id;
    const position = interaction.options.getString('position');
    const region = interaction.options.getString('region');

    console.log(`\n🏃 [freeagent.js] Free agent registration by ${user.tag}`);

    try {
      const contract = await database.getContractedTeam(userId);
      if (contract) {
        const formattedTeamName = builderHelpers.getFormattedTeamName(contract.teamName);
        return interaction.editReply({
          content: `❌ You are already contracted to **${formattedTeamName}**.`,
          flags: MessageFlags.Ephemeral
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
            content: `⏰ You're on cooldown! Try again in ${hours}h ${minutes}m.`,
            flags: MessageFlags.Ephemeral,
          });
        }
      }

      cooldowns.set(userId, now);
      setTimeout(() => cooldowns.delete(userId), cooldownAmount);

      const embed = buildPSLEmbed(interaction.client, constants.DEFAULT_EMBED_COLOR)
        .setTitle('🏃 Free Agent Registration')
        .setDescription(
          `**${displayName}** has registered as a free agent!\n\n` +
          `📍 **Position**: ${position}\n` +
          `🌍 **Region**: ${region}\n\n` +
          `Managers can send contracts to this player using \`/contract\``
        )
        .setThumbnail(user.displayAvatarURL());

      const targetChannel = await interaction.client.channels.fetch(constants.FREEAGENT_CHANNEL_ID);
      if (!targetChannel) {
        return interaction.editReply({
          content: '⚠️ Could not find the free agent channel.',
          flags: MessageFlags.Ephemeral,
        });
      }

      await targetChannel.send({ content: `<@${userId}>`, embeds: [embed] });
      await interaction.editReply({
        content: '✅ You have been registered as a free agent!',
        flags: MessageFlags.Ephemeral,
      });
    } catch (error) {
      console.error('❌ Error in /freeagent:', error);
      return interaction.editReply({ content: '❌ An error occurred while registering as a free agent.', flags: MessageFlags.Ephemeral });
    }
  },
};