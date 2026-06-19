const { SlashCommandBuilder } = require('discord.js');
const database = require('../db/database');
const builderHelpers = require('../utils/builderHelpers');
const { buildPSLEmbed } = require('../utils/embedHelpers');
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
    console.log(`\n📋 [roster.js] Roster requested for ${selectedTeam}`);

    try {
      const [teamInfo, contractedPlayers] = await Promise.all([
        database.getTeamInfo(selectedTeam),
        database.getPlayersByTeam(selectedTeam),
      ]);

      const managerText = teamInfo?.manager ? `<@${teamInfo.manager}>` : '*Vacant*';
      const assistantText = teamInfo?.assistantManager ? `<@${teamInfo.assistantManager}>` : '*Vacant*';

      const playerLines = Array.from({ length: constants.MAX_ROSTER_SIZE }, (_, i) =>
        contractedPlayers[i] ? `**P.:** <@${contractedPlayers[i].userId}>` : '**P.:**'
      );

      const formattedTeamName = `**${builderHelpers.getFormattedTeamName(selectedTeam).toUpperCase()}**`;
      const role = await builderHelpers.getTeamRole(interaction.client, selectedTeam);
      const embedColor = role ? role.color : constants.DEFAULT_EMBED_COLOR;

      const rosterEmbed = buildPSLEmbed(interaction.client, embedColor)
        .setTitle(`${formattedTeamName} OFFICIAL ROSTER`)
        .addFields(
          { name: '💼 Management', value: `**M.:** ${managerText}\n**A.M.:** ${assistantText}`, inline: false },
          { name: '⚽ Registered Players', value: playerLines.join('\n'), inline: false },
          { name: '🚨 Emergency Signs', value: `**${teamInfo?.emergencySignsUsed ?? 0}/${constants.MAX_EMERGENCY_SIGNS_PER_TEAM}** used`, inline: true }
        );

      return interaction.reply({ embeds: [rosterEmbed], ephemeral: true });
    } catch (error) {
      console.error(`❌ Error in /roster for ${selectedTeam}:`, error);
      return interaction.reply({ content: '❌ Failed to generate team roster.', ephemeral: true });
    }
  },
};