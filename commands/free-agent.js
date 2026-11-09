const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const database = require('../db/database');
const constants = require('../config/constants');
const builderHelpers = require('../utils/builder-helpers');
const { buildPSLEmbed } = require('../utils/embed-helpers');
const { logCommandResult } = require('../utils/log-helpers');

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
        .setName('timezone')
        .setDescription('Your timezone')
        .setRequired(true)
        .addChoices(builderHelpers.getTimezoneChoices())
    ),

  async execute(interaction) {
    const user = interaction.user;
    const displayName = builderHelpers.getDiscordDisplayName(interaction.member, user);
    const userId = user.id;
    const position = interaction.options.getString('position');
    const timezone = interaction.options.getString('timezone');

    try {
      const contract = await database.getContractedTeam(userId);
      if (contract) {
        const formattedTeamName = builderHelpers.getFormattedTeamName(contract.teamName);
        return interaction.editReply({
          content: `❌ You have an active contract with **${formattedTeamName}**.`,
          flags: MessageFlags.Ephemeral
        });
      }

      const cooldownAmount = 3 * 24 * 60 * 60 * 1000;
      const now = Date.now();
      const cooldownState = builderHelpers.getCooldownState(userId, cooldowns, cooldownAmount, now);

      if (cooldownState.isCoolingDown) {
        return interaction.editReply({
          content: `⏰ You're on cooldown! Try again in ${builderHelpers.formatCooldownDuration(cooldownState.timeLeftMs)}.`,
          flags: MessageFlags.Ephemeral
        });
      }

      cooldowns.set(userId, now);
      setTimeout(() => cooldowns.delete(userId), cooldownAmount);

      const embed = buildPSLEmbed(interaction.client, constants.DEFAULT_EMBED_COLOR)
        .setTitle('🏃 Free Agent Registration')
        .setDescription(
          `**${displayName}** has registered as a free agent!\n\n` +
          `📍 **Position**: ${position}\n` +
          `🌍 **Timezone**: ${timezone}\n\n` +
          `Managers can send contracts to this player using \`/contract\` or \`/emergency-contract\``
        )
        .setThumbnail(user.displayAvatarURL());

      const targetChannel = await interaction.client.channels.fetch(constants.FREEAGENT_CHANNEL_ID);
      if (!targetChannel) {
        await logCommandResult(interaction, {
          type: 'error',
          title: 'Free Agent Registration Failed',
          command: 'free-agent',
          details: [{ label: 'Player', value: `**${displayName}** (\`${userId}\`)`, terminalValue: `${displayName} (${userId})` }],
          result: 'The free agent channel could not be found; the registration announcement was not posted.',
          terminalResult: 'Free agent channel was unavailable.',
        });
        return interaction.editReply({
          content: '⚠️ Could not find the free agent channel.',
          flags: MessageFlags.Ephemeral
        });
      }

      await targetChannel.send({ content: `<@${userId}>`, embeds: [embed] });
      await interaction.editReply({
        content: '✅ You have been registered as a free agent!',
        flags: MessageFlags.Ephemeral
      });
    } catch (error) {
      await logCommandResult(interaction, {
        type: 'error',
        title: 'Free Agent Registration Failed',
        command: 'free-agent',
        details: [{ label: 'Player', value: `**${displayName}** (\`${userId}\`)`, terminalValue: `${displayName} (${userId})` }],
        result: 'The free agent registration failed unexpectedly.',
        terminalResult: 'Free agent registration failed.',
        error,
      });
      return interaction.editReply({ content: '❌ An error occurred while registering as a free agent.', flags: MessageFlags.Ephemeral });
    }
  },
};