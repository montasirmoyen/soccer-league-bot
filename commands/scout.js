const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const database = require('../db/database');
const constants = require('../config/constants');
const builderHelpers = require('../utils/builder-helpers');
const { buildPSLEmbed } = require('../utils/embed-helpers');
const { logCommandResult } = require('../utils/log-helpers');

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
        .addChoices(builderHelpers.getPositionChoices())
    )
    .addStringOption((option) =>
      option
        .setName('message')
        .setDescription('Your scouting message')
        .setRequired(true)
        .setMaxLength(1000)
    ),

  async execute(interaction) {
    const user = interaction.user;
    const displayName = builderHelpers.getDiscordDisplayName(interaction.member, user);
    const userId = user.id;
    const position = interaction.options.getString('position');
    let staffRecord;

    try {
      staffRecord = await database.isUserStaffAnywhere(userId);
      if (!staffRecord) {
        return interaction.editReply({ content: '❌ You are not an authorized manager.', flags: MessageFlags.Ephemeral });
      }

      const cooldownAmount = 3 * 60 * 60 * 1000;
      const now = Date.now();
      const cooldownState = builderHelpers.getCooldownState(userId, cooldowns, cooldownAmount, now);

      if (cooldownState.isCoolingDown) {
        return interaction.editReply({
          content: `⏰ You're on cooldown! You can scout again in **${builderHelpers.formatCooldownDuration(cooldownState.timeLeftMs)}**.`,
          flags: MessageFlags.Ephemeral
        });
      }

      cooldowns.set(userId, now);
      setTimeout(() => cooldowns.delete(userId), cooldownAmount);

      const role = await builderHelpers.getTeamRole(interaction.client, staffRecord.name);
      const formattedTeamName = builderHelpers.getFormattedTeamName(staffRecord.name);
      const message = interaction.options.getString('message');
      const embed = buildPSLEmbed(interaction.client, role?.color || constants.DEFAULT_EMBED_COLOR)
        .setTitle('🔍 Player Scout')
        .setDescription(
          `**${formattedTeamName}** is scouting for players!\n\n` +
          `📌 **Position**: ${position}\n\n` +
          `💬 **Message**:\n\`\`\`${message}\`\`\`\n` +
          `*If you're interested and available, feel free to DM **${displayName}**!*`
        )
        .setThumbnail(user.displayAvatarURL());

      const targetChannel = await interaction.client.channels.fetch(constants.SCOUT_CHANNEL_ID);
      if (targetChannel) {
        await targetChannel.send({ content: `<@${userId}>`, embeds: [embed] });
        await logCommandResult(interaction, {
          command: 'scout',
          title: 'Team Scouting Announcement Posted',
          details: [
            { label: 'Manager', value: `**${displayName}** (\`${userId}\`)`, terminalValue: `${displayName} (${userId})` },
            { label: 'Team', value: `**${formattedTeamName}**`, terminalValue: staffRecord.name },
            { label: 'Position', value: position, terminalValue: position },
          ],
          result: 'The team scouting announcement was posted. The manager-provided message is not included in this audit log.',
        });
        await interaction.editReply({ content: '✅ Your scouting message has been posted!', flags: MessageFlags.Ephemeral });
      } else {
        await logCommandResult(interaction, {
          type: 'error',
          title: 'Scouting Channel Unavailable',
          command: 'scout',
          details: [
            { label: 'Manager', value: `**${displayName}** (\`${userId}\`)`, terminalValue: `${displayName} (${userId})` },
            { label: 'Team', value: `**${formattedTeamName}**`, terminalValue: staffRecord.name },
            { label: 'Position', value: position, terminalValue: position },
          ],
          result: 'The scouting channel could not be found; no announcement was posted.',
          terminalResult: 'Scouting channel was unavailable.',
        });
        await interaction.editReply({ content: '⚠️ Could not find the scouting channel.', flags: MessageFlags.Ephemeral });
      }
    } catch (error) {
      await logCommandResult(interaction, {
        type: 'error',
        title: 'Scouting Announcement Failed',
        command: 'scout',
        details: [
          { label: 'Manager', value: `**${displayName}** (\`${userId}\`)`, terminalValue: `${displayName} (${userId})` },
          ...(staffRecord ? [{
            label: 'Team',
            value: `**${builderHelpers.getFormattedTeamName(staffRecord.name)}**`,
            terminalValue: staffRecord.name,
          }] : []),
          { label: 'Position', value: position, terminalValue: position },
        ],
        result: 'The scouting announcement failed unexpectedly. The user-provided message is not included in this audit log.',
        terminalResult: 'Scouting announcement failed.',
        error,
      });
      return interaction.editReply({ content: '❌ An error occurred while posting your scout.', flags: MessageFlags.Ephemeral });
    }
  },
};