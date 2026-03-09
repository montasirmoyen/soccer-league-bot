const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { managers } = require('../config/managers');
const db = require('../db/database');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('forcerelease')
    .setDescription('Force release a player from their team (Director+)')
    .addUserOption(option =>
      option.setName('releasee')
        .setDescription('User to force release')
        .setRequired(true)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction) {
    const releasee = interaction.options.getUser('releasee');
    const sender = interaction.user.id;

    if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
      return interaction.reply({ content: '❌ You need server administrator permissions to use this command.', ephemeral: true });
    }

    if (managers[releasee.id]) {
      return interaction.reply({ content: '❌ You cannot force release another manager.', ephemeral: true });
    }

    if (releasee.bot) {
      return interaction.reply({ content: '❌ You cannot force release bots.', ephemeral: true });
    }

    try {
      const row = await db.getContractedTeam(releasee.id);
      if (!row) {
        return interaction.reply({ content: `❌ <@${releasee.id}> is not contracted to any team.`, ephemeral: true });
      }

      await db.releasePlayer(releasee.id);

      const releaseChannel = await interaction.client.channels.fetch('1406848569486606486');
      releaseChannel.send(`⚡ | **<@${releasee.id}>** has been **FORCE RELEASED** from **${row.teamName}** by <@${sender}>`);

      await interaction.reply({ content: `✅ <@${releasee.id}> force released from **${row.teamName}**`, ephemeral: true });
    } catch (err) {
      console.error('Database error:', err);
      return interaction.reply({ content: '⚠️ Database error occurred.', ephemeral: true });
    }
  }
};
