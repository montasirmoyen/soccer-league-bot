const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const database = require('../db/database');
const constants = require('../config/constants');
const builderHelpers = require('../utils/builder-helpers');
const { buildPSLEmbed } = require('../utils/embed-helpers');

const cooldowns = new Map();
const COOLDOWN_TIME = 0 //30 * 60 * 1000;

module.exports = {
  data: new SlashCommandBuilder()
    .setName('friendly')
    .setDescription('Announce that you are looking for a friendly match')
    .addStringOption((option) =>
      option
        .setName('region')
        .setDescription('Your region')
        .setRequired(true)
        .addChoices(builderHelpers.getTimezoneChoices())
    )
    .addStringOption((option) =>
      option
        .setName('type')
        .setDescription('Type of friendly')
        .setRequired(true)
        .addChoices(builderHelpers.getFriendlyChoices())
    )
    .addAttachmentOption((option) =>
      option
        .setName('image')
        .setDescription('Upload an image (required if type is "IN-GAME")')
        .setRequired(false)
    ),

  async execute(interaction) {
    const user = interaction.user;
    const userId = user.id;
    const now = Date.now();

    console.log(`\n⚽ [friendly.js] Friendly announcement by ${user.tag}`);

    const cooldownState = builderHelpers.getCooldownState(userId, cooldowns, COOLDOWN_TIME, now);
    if (cooldownState.isCoolingDown) {
      return interaction.editReply({
        content: `⏳ Please wait **${builderHelpers.formatCooldownDuration(cooldownState.timeLeftMs)}** before using this command again.`,
        flags: MessageFlags.Ephemeral
      });
    }

    const region = interaction.options.getString('region');
    const type = interaction.options.getString('type');
    const image = interaction.options.getAttachment('image');

    if (type === 'IN-GAME' && !image) {
      return interaction.editReply({
        content: '❌ You must upload an image when type is "IN-GAME".',
        flags: MessageFlags.Ephemeral
      });
    }

    cooldowns.set(userId, now);

    try {
      const staffRecord = await database.isUserStaffAnywhere(userId);
      const isTeamStaff = !!staffRecord;
      const member = await interaction.guild.members.fetch(userId).catch(() => null);
      const displayName = builderHelpers.getDiscordDisplayName(member, user);

      const pingString = `<@${userId}> <@&${constants.FRIENDLY_ROLE_ID}>`;
      const informationMessage = type === 'DM' ? `DM **${displayName}** if you want to friendly!` : 'Team is in a server waiting to friendly!';
      const statusMessage = type === 'IN-GAME' ? 'In Game' : 'DM to Play';
      const agentName = isTeamStaff ? builderHelpers.getFormattedTeamName(staffRecord.name) : displayName;
      const embedColor = isTeamStaff ? (await builderHelpers.getTeamRole(interaction.client, staffRecord.name)).color : constants.DEFAULT_EMBED_COLOR;

      const embed = buildPSLEmbed(interaction.client, embedColor)
        .setThumbnail(user.displayAvatarURL());
      embed.setTitle(`**${agentName}** is Looking for a Friendly!`)
        .addFields(
          { name: 'Region', value: region, inline: true },
          { name: 'Status', value: statusMessage, inline: true },
          { name: 'Information', value: informationMessage, inline: false }
        );

      if (type === 'IN-GAME' && image) {
        embed.setImage(image.url);
      }

      const channel = await interaction.client.channels.fetch(constants.FRIENDLY_CHANNEL_ID);
      await channel.send({ content: pingString, embeds: [embed] });
      await interaction.editReply({ content: '✅ Your friendly announcement has been sent! **Best of luck!**', flags: MessageFlags.Ephemeral });
    } catch (error) {
      console.error('❌ Error in /friendly:', error);
      cooldowns.delete(userId);
      await interaction.editReply({ content: '❌ Failed to send friendly announcement.', flags: MessageFlags.Ephemeral });
    }
  },
};