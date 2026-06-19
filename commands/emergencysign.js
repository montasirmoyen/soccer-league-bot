const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const database = require('../db/database');
const constants = require('../config/constants');
const builderHelpers = require('../utils/builderHelpers');
const { canManageTeam } = require('../utils/validations');
const { buildPSLEmbed } = require('../utils/embedHelpers');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('emergencysign')
    .setDescription(`Emergency signing while window is CLOSED (Limit: ${constants.MAX_EMERGENCY_SIGNS_PER_TEAM}/team).`)
    .addStringOption((option) =>
      option.setName('team').setDescription('Select the national team').setRequired(true)
        .addChoices(builderHelpers.getTeamChoices())
    )
    .addUserOption((option) =>
      option.setName('player').setDescription('Player to sign').setRequired(true)
    ),

  async execute(interaction) {
    const selectedTeam = interaction.options.getString('team');
    const targetUser = interaction.options.getUser('player');

    console.log(`\n🚨 [emergencysign.js] ${interaction.user.tag} → ${targetUser.tag} for ${selectedTeam}`);

    try {
      if (targetUser.bot) {
        return interaction.reply({ content: '❌ You cannot sign a bot.', ephemeral: true });
      }

      const isWindowOpen = await database.getTransferWindowState();
      if (isWindowOpen) {
        return interaction.reply({
          content: '❌ The window is **OPEN**. Use `/contract` instead.',
          ephemeral: true,
        });
      }

      const teamInfo = await database.getTeamInfo(selectedTeam);
      const formattedTeamName = `**${builderHelpers.getFormattedTeamName(selectedTeam).toUpperCase()}**`;

      if (!canManageTeam(interaction.member, teamInfo)) {
        return interaction.reply({
          content: `❌ You do not have permission to sign players for ${formattedTeamName}.`,
          ephemeral: true,
        });
      }

      if (teamInfo && teamInfo.emergencySignsUsed >= constants.MAX_EMERGENCY_SIGNS_PER_TEAM) {
        return interaction.reply({
          content: `❌ **Emergency limit reached!** ${formattedTeamName} has used all ${constants.MAX_EMERGENCY_SIGNS_PER_TEAM} emergency signings.`,
          ephemeral: true,
        });
      }

      const currentSquad = await database.getPlayersByTeam(selectedTeam);
      if (currentSquad.length >= constants.MAX_ROSTER_SIZE) {
        return interaction.reply({
          content: `❌ Roster full (${constants.MAX_ROSTER_SIZE}/${constants.MAX_ROSTER_SIZE}).`,
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
          content: `❌ <@${targetUser.id}> already has a contract with **${activeContract.teamName}**.`,
          ephemeral: true,
        });
      }

      const role = await builderHelpers.getTeamRole(interaction.client, selectedTeam);
      const embedColor = role ? role.color : constants.DEFAULT_EMBED_COLOR;

      const emergencySignEmbed = buildPSLEmbed(interaction.client, embedColor)
        .setTitle('🚨 EMERGENCY CONTRACT OFFER!')
        .setDescription(
          `Hello <@${targetUser.id}>,\n${formattedTeamName} has sent you an **Emergency Contract** while the window is closed.\n\nReview and make your choice below:`
        );

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`emergencyaccept_${selectedTeam}_${targetUser.id}_${interaction.user.id}`)
          .setLabel('🤝 Accept Emergency Contract')
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId(`emergencyrefuse_${selectedTeam}_${targetUser.id}_${interaction.user.id}`)
          .setLabel('❌ Refuse')
          .setStyle(ButtonStyle.Danger)
      );

      try {
        await targetUser.send({ embeds: [emergencySignEmbed], components: [row] });
      } catch (dmError) {
        console.warn('[emergencysign.js] DM failed:', dmError.message);
        return interaction.reply({
          content: `❌ Could not send the offer. <@${targetUser.id}> likely has DMs closed.`,
          ephemeral: true,
        });
      }

      return interaction.reply({
        content: `📨 Emergency offer sent to <@${targetUser.id}> for ${formattedTeamName}! (${teamInfo?.emergencySignsUsed ?? 0}/${constants.MAX_EMERGENCY_SIGNS_PER_TEAM} used)`,
        ephemeral: true,
      });
    } catch (error) {
      console.error('❌ Error in /emergencysign:', error);
      return interaction.reply({ content: '❌ Error processing emergency offer.', ephemeral: true });
    }
  },
};