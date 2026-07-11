const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const database = require('../db/database');
const builderHelpers = require('../utils/builder-helpers');
const { validateGuild } = require('../utils/validations')
const { buildPSLEmbed, formatGuildMemberDisplay } = require('../utils/embed-helpers');
const { safeFetchMember } = require('../utils/discord-helpers')
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
    if (!validateGuild(interaction)) {
      return interaction.editReply({ content: '❌ You can only execute this command in the official server.', flags: MessageFlags.Ephemeral });
    }

    const selectedTeam = interaction.options.getString('team');
    try {
      const [teamInfo, contractedPlayers, role] = await Promise.all([
        database.getTeamInfo(selectedTeam),
        database.getPlayersByTeam(selectedTeam),
        builderHelpers.getTeamRole(interaction.client, selectedTeam)
      ]);

      const rawIds = contractedPlayers.map(p => p.userId);
      if (teamInfo?.manager) rawIds.push(teamInfo.manager);
      if (teamInfo?.assistantManager) rawIds.push(teamInfo.assistantManager);

      const memberCollection = await safeFetchMember(interaction.guild, rawIds);

      const resolveDisplayName = async (id) => {
        if (!id) return '*Vacant*';

        const cleanId = String(id).replace(/\D/g, '');
        const cachedMember = memberCollection?.get(cleanId);
        if (cachedMember?.displayName) return `${cachedMember.displayName}`;

        return formatGuildMemberDisplay(interaction.guild, id);
      };

      const managerText = await resolveDisplayName(teamInfo?.manager);
      const assistantText = await resolveDisplayName(teamInfo?.assistantManager);
      const playerCapacity = await builderHelpers.getDisplayedPlayersAmount(selectedTeam);

      const playerLines = await Promise.all(
        Array.from({ length: constants.MAX_ROSTER_SIZE }, async (_, i) =>
          contractedPlayers[i]
            ? `**P.:** ${await resolveDisplayName(contractedPlayers[i].userId)}`
            : '**P.:** *Vacant*'
        )
      );

      const formattedTeamName = `**${builderHelpers.getFormattedTeamName(selectedTeam)}**`;

      const rosterEmbed = buildPSLEmbed(interaction.client, role?.color || constants.DEFAULT_EMBED_COLOR)
        .setTitle(`${formattedTeamName} OFFICIAL ROSTER`)
        .addFields(
          { name: '💼 Management', value: `**M.:** ${managerText}\n**A.M.:** ${assistantText}`, inline: false },
          { name: '⚽ Registered Players', value: `\`[${playerCapacity}]\`\n${playerLines.join('\n')}`, inline: false },
          { name: '🚨 Emergency Signs', value: `**${teamInfo?.emergencySignsUsed ?? 0}/${constants.MAX_EMERGENCY_SIGNS_PER_TEAM}** used`, inline: false },
          { name: '🧹 Releases', value: `**${teamInfo?.releasesUsed ?? 0}/${constants.MAX_RELEASES_PER_TEAM}** used`, inline: false }
        );

      return interaction.editReply({ embeds: [rosterEmbed], flags: MessageFlags.Ephemeral });
    } catch (error) {
      console.error(`❌ Error in /roster for ${selectedTeam}:`, error);
      return interaction.editReply({ content: '❌ Failed to generate team roster.', flags: MessageFlags.Ephemeral });
    }
  },
};
