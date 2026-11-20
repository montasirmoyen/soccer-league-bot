const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const constants = require('../config/constants');
const builderHelpers = require('../utils/builder-helpers');
const { buildPSLEmbed } = require('../utils/embed-helpers');
const { logCommandResult } = require('../utils/log-helpers');

const cooldowns = new Map();

const MAX_SUMMARY_LENGTH = 100;
const MAX_NATIONALITY_LENGTH = 9;

module.exports = {
  data: new SlashCommandBuilder()
    .setName('send-information')
    .setDescription('Send your profile information to the market')
    .addStringOption((option) =>
      option
        .setName('position')
        .setDescription('Your preferred position')
        .setRequired(true)
        .addChoices(builderHelpers.getPositionChoices())
    )
    .addStringOption((option) =>
      option
        .setName('timezone')
        .setDescription('Your timezone')
        .setRequired(true)
        .addChoices(builderHelpers.getTimezoneChoices())
    )
    .addStringOption((option) =>
      option
        .setName('nationality')
        .setDescription('Your country flag emoji only (e.g. 🇦🇴)')
        .setRequired(true)
        .setMaxLength(MAX_NATIONALITY_LENGTH)
    )
    .addStringOption((option) =>
      option
        .setName('summary')
        .setDescription('A brief summary about you (Max. 100 characters)')
        .setRequired(true)
        .setMaxLength(MAX_SUMMARY_LENGTH)
    ),

  async execute(interaction) {
    const userId = interaction.user.id;
    const user = interaction.user;
    const displayName = builderHelpers.getDiscordDisplayName(interaction.member, user);

    const position = interaction.options.getString('position');
    const timezone = interaction.options.getString('timezone');
    const nationality = interaction.options.getString('nationality') || 'No nationality provided';
    const summary = interaction.options.getString('summary') || 'No summary provided.';

    try {
      const cooldownAmount = 3 * 24 * 60 * 60 * 1000;
      const now = Date.now();
      const cooldownState = builderHelpers.getCooldownState(userId, cooldowns, cooldownAmount, now);

      if (cooldownState.isCoolingDown) {
        return interaction.editReply({
          content: `⏰ You are on cooldown! Please try again in ${builderHelpers.formatCooldownDuration(cooldownState.timeLeftMs)}.`
        });
      }

      cooldowns.set(userId, now);
      setTimeout(() => cooldowns.delete(userId), cooldownAmount);

      const informationEmbed = buildPSLEmbed(interaction.client, constants.DEFAULT_EMBED_COLOR)
        .setTitle('📝 Player Information Registered')
        .setThumbnail(user.displayAvatarURL({ dynamic: true }))
        .setDescription(`⚽ **${displayName}** is now looking forward for new experiences!\n\nManagers can offer a contract using \`/contract\` or \`/emergency-contract\``)
        .addFields(
          { name: '🏃 Preferred Position', value: position, inline: true },
          { name: '🌐 Timezone', value: timezone, inline: true },
          { name: '🏳️ Nationality', value: nationality, inline: true },
          { name: '💬 Player Statement', value: `\`\`\`text\n${summary}\n\`\`\``, inline: false }
        );

      const playerInformationChannel = await interaction.client.channels.fetch(constants.PLAYER_INFORMATION_CHANNEL_ID);
      if (!playerInformationChannel) {
        await logCommandResult(interaction, {
          type: 'error',
          title: 'Player Information Could Not Be Posted',
          command: 'send-information',
          details: [{ label: 'Player', value: `**${displayName}** (\`${userId}\`)`, terminalValue: `${displayName} (${userId})` }],
          result: 'The player information channel could not be found; no information was posted.',
          terminalResult: 'Player information channel was unavailable.',
        });
        return interaction.editReply({
          content: '⚠️ Free agency market channel not found.'
        });
      }

      await playerInformationChannel.send({ content: `<@${userId}>`, embeds: [informationEmbed] });
      
      await interaction.editReply({
        content: '✅ Your player information has been posted successfully!'
      });

    } catch (error) {
      await logCommandResult(interaction, {
        type: 'error',
        title: 'Player Information Posting Failed',
        command: 'send-information',
        details: [{ label: 'Player', value: `**${displayName}** (\`${userId}\`)`, terminalValue: `${displayName} (${userId})` }],
        result: 'The player information could not be posted. User-provided information is not included in this audit log.',
        terminalResult: 'Player information posting failed.',
        error,
      });
      return interaction.editReply({ 
        content: '❌ An error occurred while processing your information registration.' 
      });
    }
  }
};