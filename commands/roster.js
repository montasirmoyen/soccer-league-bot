const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const database = require('../db/database');
const builderHelpers = require('../utils/builder-helpers');
const { buildPSLEmbed } = require('../utils/embed-helpers');
const constants = require('../config/constants');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('roster')
    .setDescription('Displays the official roster for a team.')
    .addStringOption((option) =>
      option.setName('team').setDescription('Select the national team').setRequired(true)
        .addChoices(builderHelpers.getTeamChoices())
    ),
    
  async execute(interaction) {
    const selectedTeam = interaction.options.getString('team');

    try {
      const [teamInfo, contractedPlayers, role] = await Promise.all([
        database.getTeamInfo(selectedTeam),
        database.getPlayersByTeam(selectedTeam),
        builderHelpers.getTeamRole(interaction.client, selectedTeam)
      ]);

      const managerText = teamInfo?.manager ? `<@${teamInfo.manager}>` : '*Vacant*';
      const assistantText = teamInfo?.assistantManager ? `<@${teamInfo.assistantManager}>` : '*Vacant*';
      
      const playerLines = Array.from({ length: constants.MAX_ROSTER_SIZE }, (_, i) =>
        contractedPlayers[i] ? `**P.:** <@${contractedPlayers[i].userId}>` : '**P.:**'
      );

      const formattedTeamName = `**${builderHelpers.getFormattedTeamName(selectedTeam).toUpperCase()}**`;

      const rosterEmbed = buildPSLEmbed(interaction.client, role?.color || constants.DEFAULT_EMBED_COLOR)
        .setTitle(`${formattedTeamName} OFFICIAL ROSTER`)
        .addFields(
          { name: '💼 Management', value: `**M.:** ${managerText}\n**A.M.:** ${assistantText}`, inline: false },
          { name: '⚽ Registered Players', value: playerLines.join('\n'), inline: false },
          { name: '🚨 Emergency Signs', value: `**${teamInfo?.emergencySignsUsed ?? 0}/${constants.MAX_EMERGENCY_SIGNS_PER_TEAM}** used`, inline: true }
        );

      return interaction.editReply({ embeds: [rosterEmbed], flags: MessageFlags.Ephemeral });
    } catch (error) {
      console.error(`❌ Error in /roster for ${selectedTeam}:`, error);
      return interaction.editReply({ content: '❌ Failed to generate team roster.', flags: MessageFlags.Ephemeral });
    }
  },
};