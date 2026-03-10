const { SlashCommandBuilder } = require('discord.js');
const { managers } = require('../config/managers');
const { RELEASE_CHANNEL_ID } = require('../config/constants');
const db = require('../db/database');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('release')
    .setDescription('Release a player from your team')
    .addUserOption(option => option.setName('releasee').setDescription('User to release').setRequired(true)),

  async execute(interaction) {
    const releasee = interaction.options.getUser('releasee');
    const senderId = interaction.user.id;

    if (!managers[senderId]) {
      return interaction.reply({ content: '❌ You are not an authorized manager.', ephemeral: true });
    }

    if (managers[releasee.id]) {
      return interaction.reply({ content: '❌ You cannot release another manager.', ephemeral: true });
    }

    if (releasee.id === senderId) {
      return interaction.reply({ content: '❌ You cannot release yourself.', ephemeral: true });
    }

    if (releasee.bot) {
      return interaction.reply({ content: '❌ You cannot release bots.', ephemeral: true });
    }

    const senderTeam = managers[senderId].team;

    try {
      const contract = await db.getContractedTeam(releasee.id);

      if (!contract) {
        return interaction.reply({ content: `❌ <@${releasee.id}> is not contracted to any team.`, ephemeral: true });
      }

      if (contract.teamName !== senderTeam) {
        return interaction.reply({ content: `❌ You can only release players contracted to your own team (${senderTeam}).`, ephemeral: true });
      }

      await db.releasePlayer(releasee.id);

      const releaseChannel = await interaction.client.channels.fetch(RELEASE_CHANNEL_ID);
      await releaseChannel.send(`🔔 | **<@${releasee.id}>** has been released from **${contract.teamName}**`);

      await interaction.reply({ content: `✅ <@${releasee.id}> released from **${contract.teamName}**`, ephemeral: true });
    } catch (error) {
      console.error('Release command error:', error);
      return interaction.reply({ content: '⚠️ Something went wrong. Please try again later.', ephemeral: true });
    }
  }
};
