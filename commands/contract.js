const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const database = require('../db/database');
const constants = require('../config/constants');
const builderHelpers = require('../utils/builderHelpers');
const { buildPSLEmbed } = require('../utils/embedHelpers');
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

    console.log(`\n💼 [contract.js] ${interaction.user.tag} → ${targetUser.tag} for ${selectedTeam}`);

    try {
      if (targetUser.bot) {
        return interaction.reply({ content: '❌ You cannot send a contract to a bot.', ephemeral: true });
      }

      const isWindowOpen = await database.getTransferWindowState();
      if (!isWindowOpen) {
        return interaction.reply({
          content: '🔒 The transfer window is currently **CLOSED**. Offers cannot be sent.',
          ephemeral: true,
        });
      }

      const teamInfo = await database.getTeamInfo(selectedTeam);
      const formattedTeamName = `**${builderHelpers.getFormattedTeamName(selectedTeam).toUpperCase()}**`;

      if (!canManageTeam(interaction.member, teamInfo)) {
        return interaction.reply({
          content: `❌ You do not have permission to offer contracts for ${formattedTeamName}.`,
          ephemeral: true,
        });
      }

      const isStaffSomewhere = await database.isUserStaffAnywhere(targetUser.id);
      if (isStaffSomewhere) {
        return interaction.reply({
          content: `❌ <@${targetUser.id}> is management staff for **${isStaffSomewhere.name}** and cannot sign as a player.`,
          ephemeral: true,
        });
      }

      const activeContract = await database.getContractedTeam(targetUser.id);
      if (activeContract) {
        return interaction.reply({
          content: `❌ <@${targetUser.id}> already has a contract with **${builderHelpers.getFormattedTeamName(activeContract.teamName).toUpperCase()}**.`,
          ephemeral: true,
        });
      }

      const currentSquad = await database.getPlayersByTeam(selectedTeam);
      if (currentSquad.length >= constants.MAX_ROSTER_SIZE) {
        return interaction.reply({
          content: `❌ **Roster limit reached!** ${formattedTeamName} already has ${constants.MAX_ROSTER_SIZE} registered players.`,
          ephemeral: true,
        });
      }

      const role = await builderHelpers.getTeamRole(interaction.client, selectedTeam);
      const embedColor = role ? role.color : constants.DEFAULT_EMBED_COLOR;

      const contractEmbed = buildPSLEmbed(interaction.client, embedColor)
        .setTitle('📜 NEW CONTRACT OFFER!')
        .setDescription(
          `Hello, <@${targetUser.id}>,\n${formattedTeamName} has officially offered you a contract for this season.\n\nReview and make your choice below:`
        );

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`accept_${selectedTeam}_${targetUser.id}_${interaction.user.id}`)
          .setLabel('🤝 Accept Contract')
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId(`refuse_${selectedTeam}_${targetUser.id}_${interaction.user.id}`)
          .setLabel('❌ Refuse')
          .setStyle(ButtonStyle.Danger)
      );

      try {
        await targetUser.send({ embeds: [contractEmbed], components: [row] });
      } catch (dmError) {
        console.warn('[contract.js] DM failed:', dmError.message);
        return interaction.reply({
          content: `❌ Could not send the offer. <@${targetUser.id}> likely has DMs closed.`,
          ephemeral: true,
        });
      }

      return interaction.reply({
        content: `📨 Contract offer sent to <@${targetUser.id}>'s DM for ${formattedTeamName}!`,
        ephemeral: true,
      });
    } catch (error) {
      console.error('❌ Error in /contract:', error);
      return interaction.reply({ content: '❌ An error occurred while processing the contract offer.', ephemeral: true });
    }
  },
};