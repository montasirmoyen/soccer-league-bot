const {
  SlashCommandBuilder,
  EmbedBuilder,
  PermissionsBitField,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  Events
} = require('discord.js');

const MINIMUM_ROLE_ID = '1396243487292133518'; // director role id

module.exports = {
  data: new SlashCommandBuilder()
    .setName('announce')
    .setDescription('Open a modal to make a detailed announcement'),

  async execute(interaction) {
    const member = interaction.member;
    const guild = interaction.guild;

    const requiredRole = guild.roles.cache.get(MINIMUM_ROLE_ID);
    if (!requiredRole) {
      return interaction.reply({ content: '❌ Role restriction is misconfigured. Contact an admin.', ephemeral: true });
    }

    const hasPermission = member.roles.highest.comparePositionTo(requiredRole) >= 0;
    if (!hasPermission) {
      return interaction.reply({ content: '🚫 You do not have permission to use this command.', ephemeral: true });
    }

    const modal = new ModalBuilder()
      .setCustomId('announceModal')
      .setTitle('New Announcement');

    const messageInput = new TextInputBuilder()
      .setCustomId('announcementInput')
      .setLabel('Paste your full announcement')
      .setStyle(TextInputStyle.Paragraph)
      .setMaxLength(4000)
      .setRequired(true);

    const row = new ActionRowBuilder().addComponents(messageInput);
    modal.addComponents(row);

    await interaction.showModal(modal);
  }
};
