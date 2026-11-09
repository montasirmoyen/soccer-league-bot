const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const database = require('../db/database');
const builderHelpers = require('../utils/builder-helpers');
const { buildPSLEmbed } = require('../utils/embed-helpers');
const { isRefereeOrAdmin, requireOfficialGuild } = require('../utils/validations');
const constants = require('../config/constants');
const { logCommandResult, logValidationFailure } = require('../utils/log-helpers');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

module.exports = {
  data: new SlashCommandBuilder()
    .setName('match-inform')
    .setDescription('Send a match notification to all players and staff of two teams via DM')
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
        .setDescription('Match details, kickoff info, or referee notes (Max. 1000 characters)')
        .setRequired(false)
        .setMaxLength(1000)
    ),

  async execute(interaction) {
    if (!await requireOfficialGuild(interaction, '❌ This command can only be used in the official server.')) return;

    if (!await isRefereeOrAdmin(interaction, interaction.member)) return;

    const team1 = interaction.options.getString('team1');
    const team2 = interaction.options.getString('team2');
    const refereeMessage = interaction.options.getString('referee-message') || 'N/A';

    if (team1 === team2) {
      await logValidationFailure(interaction, {
        title: 'Match Notification Rejected',
        command: 'match-inform',
        details: [{ label: 'Team', value: `**${builderHelpers.getFormattedTeamName(team1)}**` }],
        terminalDetails: [{ label: 'Team', value: team1 }],
        result: 'Both selected teams were the same; no match notifications were sent.',
      });
      return interaction.editReply({ content: '❌ Both teams cannot be the same.', flags: MessageFlags.Ephemeral });
    }

    const team1Players = await database.getPlayersByTeam(team1);
    const team2Players = await database.getPlayersByTeam(team2);

    if (team1Players.length + team2Players.length === 0) {
      await logValidationFailure(interaction, {
        title: 'Match Notification Rejected',
        command: 'match-inform',
        details: [
          { label: 'Team 1', value: `**${builderHelpers.getFormattedTeamName(team1)}**` },
          { label: 'Team 2', value: `**${builderHelpers.getFormattedTeamName(team2)}**` },
        ],
        terminalDetails: [
          { label: 'Team 1', value: team1 },
          { label: 'Team 2', value: team2 },
        ],
        result: 'Neither team has registered players; no match notifications were sent.',
      });
      return interaction.editReply({ content: '❌ Both teams have no registered players.', flags: MessageFlags.Ephemeral });
    }

    try {
      const [teamInfo1, teamInfo2, squad1, squad2] = await Promise.all([
        database.getTeamInfo(team1),
        database.getTeamInfo(team2),
        database.getPlayersByTeam(team1),
        database.getPlayersByTeam(team2),
      ]);

      const formattedTeam1 = builderHelpers.getFormattedTeamName(team1);
      const formattedTeam2 = builderHelpers.getFormattedTeamName(team2);
      const issuer = interaction.member;
      const issuerDisplayName = issuer.displayName || issuer.username;

      const matchEmbed = buildPSLEmbed(interaction.client, constants.WARNING_COLOR)
        .setTitle('🏆 Official Match Notification')
        .setDescription(
          `**${formattedTeam1}** ⚔ **${formattedTeam2}**\n\n` +
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
            value: `${issuerDisplayName}`,
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
      const deliveryFailures = new Map();

      for (const userId of recipientIds) {
        try {
          const user = await interaction.client.users.fetch(userId);
          await user.send({ content: `<@${userId}>`, embeds: [matchEmbed] });
          sent++;

          await sleep(250);
        } catch (error) {
          failed++;
          const failureType = error?.code
            ? `Discord error ${error.code}`
            : error?.status
              ? `HTTP ${error.status}`
              : error?.name || 'Unknown error';
          deliveryFailures.set(failureType, (deliveryFailures.get(failureType) || 0) + 1);
        }
      }

      await logCommandResult(interaction, {
        type: failed ? 'error' : 'success',
        title: failed ? 'Match Notifications Partially Delivered' : 'Match Notifications Delivered',
        command: 'match-inform',
        details: [
          { label: 'Team 1', value: `**${formattedTeam1}**`, terminalValue: team1 },
          { label: 'Team 2', value: `**${formattedTeam2}**`, terminalValue: team2 },
          { label: 'Recipients', value: String(recipientIds.size), terminalValue: String(recipientIds.size) },
          { label: 'Delivered', value: String(sent), terminalValue: String(sent) },
          { label: 'Failed', value: String(failed), terminalValue: String(failed) },
          ...(failed ? [{
            label: 'Failure Reasons',
            value: [...deliveryFailures].map(([reason, count]) => `${reason}: ${count}`).join('\n'),
            terminalValue: [...deliveryFailures].map(([reason, count]) => `${reason}: ${count}`).join('; '),
          }] : []),
        ],
        result: failed
          ? `Match notifications were delivered to ${sent} of ${recipientIds.size} participants; ${failed} delivery attempt(s) failed. Referee notes are not included in this audit log.`
          : `Match notifications were delivered to all ${sent} participants. Referee notes are not included in this audit log.`,
        terminalResult: `Match notifications: ${sent} delivered, ${failed} failed.`,
      });
      return interaction.editReply({
        content: `✅ Done! **${sent}** delivered, **${failed}** failed (likely closed DMs).`,
        flags: MessageFlags.Ephemeral
      });

    } catch (error) {
      await logCommandResult(interaction, {
        type: 'error',
        title: 'Match Notification Failed',
        command: 'match-inform',
        details: [
          { label: 'Team 1', value: `**${builderHelpers.getFormattedTeamName(team1)}**`, terminalValue: team1 },
          { label: 'Team 2', value: `**${builderHelpers.getFormattedTeamName(team2)}**`, terminalValue: team2 },
        ],
        result: 'The match notification command failed unexpectedly. Referee notes are not included in this audit log.',
        terminalResult: 'Match notification command failed.',
        error,
      });
      return interaction.editReply({ content: '❌ An error occurred while sending match info.', flags: MessageFlags.Ephemeral });
    }
  },
};