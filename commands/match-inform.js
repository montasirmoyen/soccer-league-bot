const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const database = require('../db/database');
const builderHelpers = require('../utils/builder-helpers');
const { buildPSLEmbed } = require('../utils/embed-helpers');
const { isRefereeOrAdmin, validateGuild } = require('../utils/validations');
const constants = require('../config/constants');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('match-inform')
    .setDescription('Send a match notification to all players and staff of two teams via DM.')
    .addStringOption((option) =>
      option.setName('team1').setDescription('First team').setRequired(true)
        .addChoices(builderHelpers.getTeamChoices())
    )
    .addStringOption((option) =>
      option.setName('team2').setDescription('Second team').setRequired(true)
        .addChoices(builderHelpers.getTeamChoices())
    )
    .addStringOption((option) =>
      option
        .setName('referee-message')
        .setDescription('Match details, kickoff info, or referee notes')
        .setRequired(false)
        .setMaxLength(1000)
    ),

  async execute(interaction) {
    if (!validateGuild(interaction)) {
      return interaction.editReply({ content: '❌ This command can only be used in the official server.', flags: MessageFlags.Ephemeral });
    }

    if (!isRefereeOrAdmin(interaction.member)) {
      return interaction.editReply({ content: '❌ Only Referees, Chairmen, and Overseers can use this command.', flags: MessageFlags.Ephemeral });
    }

    const team1 = interaction.options.getString('team1');
    const team2 = interaction.options.getString('team2');
    const refereeMessage = interaction.options.getString('referee-message');

    if (team1 === team2) {
      return interaction.editReply({ content: '❌ Both teams cannot be the same.', flags: MessageFlags.Ephemeral });
    }

    console.log(`\n⚽ [match-inform.js] Match inform triggered by ${interaction.user.tag}: ${team1} vs ${team2}`);

    try {
      const [teamInfo1, teamInfo2, squad1, squad2] = await Promise.all([
        database.getTeamInfo(team1),
        database.getTeamInfo(team2),
        database.getPlayersByTeam(team1),
        database.getPlayersByTeam(team2),
      ]);

      const formattedTeam1 = builderHelpers.getFormattedTeamName(team1);
      const formattedTeam2 = builderHelpers.getFormattedTeamName(team2);

      const matchEmbed = buildPSLEmbed(interaction.client, constants.WARNING_COLOR)
        .setTitle('🏆 OFFICIAL MATCH NOTIFICATION')
        .setDescription(
          `**${formattedTeam1}** vs **${formattedTeam2}**\n\n` +
          `📋 **Referee Notes:**\n${refereeMessage}`
        )
        .addFields(
          {
            name: formattedTeam1,
            value: [
              `**M.:** ${teamInfo1?.manager ? `<@${teamInfo1.manager}>` : '*Vacant*'}`,
              `**A.M.:** ${teamInfo1?.assistantManager ? `<@${teamInfo1.assistantManager}>` : '*Vacant*'}`,
              `\`[${squad1.length}/${constants.MAX_ROSTER_SIZE}]\``,
            ].join('\n'),
            inline: true,
          },
          {
            name: formattedTeam2,
            value: [
              `**M.:** ${teamInfo2?.manager ? `<@${teamInfo2.manager}>` : '*Vacant*'}`,
              `**A.M.:** ${teamInfo2?.assistantManager ? `<@${teamInfo2.assistantManager}>` : '*Vacant*'}`,
              `\`[${squad2.length}/${constants.MAX_ROSTER_SIZE}]\``,
            ].join('\n'),
            inline: true,
          },
          {
            name: '🏁 Issued by',
            value: `<@${interaction.user.id}>`,
            inline: false,
          }
        );

      const recipientIds = new Set();

      for (const contract of [...squad1, ...squad2]) {
        if (contract.userId) recipientIds.add(contract.userId);
      }
      for (const teamInfo of [teamInfo1, teamInfo2]) {
        if (teamInfo?.manager) recipientIds.add(teamInfo.manager);
        if (teamInfo?.assistantManager) recipientIds.add(teamInfo.assistantManager);
      }

      await interaction.editReply({
        content: `📨 Sending match info to **${recipientIds.size}** participant(s) across both teams…`,
        flags: MessageFlags.Ephemeral,
      });

      let sent = 0;
      let failed = 0;

      for (const userId of recipientIds) {
        try {
          const user = await interaction.client.users.fetch(userId);
          await user.send({ content: `<@${userId}>`, embeds: [matchEmbed] });
          sent++;
        } catch {
          failed++;
        }
      }

      return interaction.editReply({
        content: `✅ Done! **${sent}** delivered, **${failed}** failed (likely closed DMs).`,
        flags: MessageFlags.Ephemeral,
      });

    } catch (error) {
      console.error('❌ Error in /match-inform:', error);
      return interaction.editReply({ content: '❌ An error occurred while sending match info.', flags: MessageFlags.Ephemeral });
    }
  },
};