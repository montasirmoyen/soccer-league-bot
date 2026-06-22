const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const database = require('../db/database');
const constants = require('../config/constants');
const builderHelpers = require('../utils/builder-helpers');
const { buildPSLEmbed } = require('../utils/embed-helpers');
const { canManageTeam } = require('../utils/validations');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('contract')
    .setDescription('Sends a contract offer to a player\'s DM.')
    .addStringOption((option) =>
      option.setName('team').setDescription('Select your national team').setRequired(true)
        .addChoices(builderHelpers.getTeamChoices())
    )
    .addUserOption((option) =>
      option.setName('signee').setDescription('Player to offer the contract').setRequired(true)
    ),

  async execute(interaction) {
    const selectedTeam = interaction.options.getString('team');
    const targetUser = interaction.options.getUser('signee');

    if (targetUser.bot) {
      return interaction.editReply({ content: '❌ You cannot send a contract to a bot.', flags: MessageFlags.Ephemeral });
    }

    try {
      const [isWindowOpen, teamInfo, isStaffSomewhere, activeContract, currentSquad] = await Promise.all([
        database.getTransferWindowState(),
        database.getTeamInfo(selectedTeam),
        database.isUserStaffAnywhere(targetUser.id),
        database.getContractedTeam(targetUser.id),
        database.getPlayersByTeam(selectedTeam)
      ]);

      const formattedTeamName = `**${builderHelpers.getFormattedTeamName(selectedTeam).toUpperCase()}**`;

      if (!isWindowOpen) {
        return interaction.editReply({ content: '🔒 The transfer window is currently **CLOSED**. Offers cannot be sent.', flags: MessageFlags.Ephemeral });
      }
      if (!canManageTeam(interaction.member, teamInfo)) {
        return interaction.editReply({ content: `❌ You do not have permission to offer contracts for ${formattedTeamName}.`, flags: MessageFlags.Ephemeral });
      }
      if (isStaffSomewhere) {
        return interaction.editReply({ content: `❌ <@${targetUser.id}> is management staff for **${isStaffSomewhere.name}** and cannot sign as a player.`, flags: MessageFlags.Ephemeral });
      }
      if (activeContract) {
        return interaction.editReply({ content: `❌ <@${targetUser.id}> already has a contract with **${builderHelpers.getFormattedTeamName(activeContract.teamName).toUpperCase()}**.`, flags: MessageFlags.Ephemeral });
      }
      if (currentSquad.length >= constants.MAX_ROSTER_SIZE) {
        return interaction.editReply({ content: `❌ **Roster limit reached!** ${formattedTeamName} already has ${constants.MAX_ROSTER_SIZE} registered players.`, flags: MessageFlags.Ephemeral });
      }

      const role = await builderHelpers.getTeamRole(interaction.client, selectedTeam);
      const contractEmbed = buildPSLEmbed(interaction.client, role?.color || constants.DEFAULT_EMBED_COLOR)
        .setTitle('📜 NEW CONTRACT OFFER!')
        .setDescription(`Hello, <@${targetUser.id}>,\n${formattedTeamName} has officially offered you a contract for this season.\n\nReview and make your choice below:`);

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`accept_${selectedTeam}_${targetUser.id}_${interaction.user.id}`).setLabel('🤝 Accept Contract').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`refuse_${selectedTeam}_${targetUser.id}_${interaction.user.id}`).setLabel('❌ Refuse').setStyle(ButtonStyle.Danger)
      );

      await targetUser.send({ embeds: [contractEmbed], components: [row] });

      return interaction.editReply({ content: `📨 Contract offer sent to <@${targetUser.id}>'s DM for ${formattedTeamName}!`, flags: MessageFlags.Ephemeral });
      
    } catch (error) {
      if (error.code === 50007) {
        return interaction.editReply({ content: `❌ Could not send the offer. <@${targetUser.id}> likely has DMs closed.`, flags: MessageFlags.Ephemeral });
      }
      console.error('❌ Error in /contract:', error);
      return interaction.editReply({ content: '❌ An error occurred while processing the contract offer.', flags: MessageFlags.Ephemeral });
    }
  },
};