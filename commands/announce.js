const {
  SlashCommandBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder } = require('discord.js');
const { isChairman } = require('../utils/validations');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('announce')
    .setDescription('Open a modal to make a detailed announcement'),

  async execute(interaction) {
    console.log(`\n📢 [announce.js] Announcement modal triggered by ${interaction.user.tag}`);

    if (!isChairman(interaction.member)) {
      return interaction.reply({ content: '❌ You do not have permission to use this command.', ephemeral: true });
    }

    try {
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
    } catch (error) {
      console.error('❌ Error in /announce:', error);
      if (interaction.replied || interaction.deferred) {
        return interaction.followUp({ content: '❌ An error occurred while opening the announcement modal.', ephemeral: true });
      }
      return interaction.reply({ content: '❌ An error occurred while opening the announcement modal.', ephemeral: true });
    }
  },
};