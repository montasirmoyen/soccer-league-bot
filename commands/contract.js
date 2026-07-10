const {
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
} = require('discord.js');
const database = require('../db/database');
const constants = require('../config/constants');
const builderHelpers = require('../utils/builder-helpers');
const { buildPSLEmbed } = require('../utils/embed-helpers');
const { canManageTeam, validateGuild, isRegistered } = require('../utils/validations');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('contract')
    .setDescription("Sends a contract offer to a player's DM.")
    .addStringOption((option) =>
      option
        .setName('team')
        .setDescription('Select your national team')
        .setRequired(true)
        .addChoices(builderHelpers.getTeamChoices()),
    )
    .addUserOption((option) =>
      option
        .setName('signee')
        .setDescription('Player to offer the contract')
        .setRequired(true),
    ),

  async execute(interaction) {
    if (!validateGuild(interaction)) {
      return interaction.editReply({
        content: '❌ You can only execute this command in the official server.',
        flags: MessageFlags.Ephemeral,
      });
    }

    const selectedTeam = interaction.options.getString('team');
    const signee = interaction.options.getMember('signee');
    const userId = signee.id;

    if (signee.bot) {
      return interaction.editReply({
        content: '❌ You cannot send a contract to a bot.',
        flags: MessageFlags.Ephemeral,
      });
    }

    const targetMember = await interaction.guild.members.fetch(userId ).catch(() => null);
    if (!targetMember) {
      return interaction.editReply({
        content: `❌ <@${userId }> is not currently a member of this server.`,
        flags: MessageFlags.Ephemeral,
      });
    }

    if (!(await isRegistered(signee))) {
      return interaction.editReply({
        content: `❌ <@${userId }> has not registered themselves yet.`,
        flags: MessageFlags.Ephemeral
      });
    }

    try {
      const [isWindowOpen, teamInfo, isStaffSomewhere, activeContract, currentSquad] = await Promise.all([
        database.getTransferWindowState(),
        database.getTeamInfo(selectedTeam),
        database.isUserStaffAnywhere(userId ),
        database.getContractedTeam(userId ),
        database.getPlayersByTeam(selectedTeam),
      ]);

      const formattedTeamName = `**${builderHelpers.getFormattedTeamName(selectedTeam).toUpperCase()}**`;

      if (!isWindowOpen) {
        return interaction.editReply({
          content: '🔒 The transfer window is currently **CLOSED**. Use `/emergency-contract` instead.',
          flags: MessageFlags.Ephemeral,
        });
      }
      if (!canManageTeam(interaction.member, teamInfo)) {
        return interaction.editReply({
          content: `❌ You do not have permission to offer contracts for ${formattedTeamName}.`,
          flags: MessageFlags.Ephemeral,
        });
      }
      if (isStaffSomewhere) {
        return interaction.editReply({
          content: `❌ <@${userId }> is management staff for **${isStaffSomewhere.name}** and cannot sign as a player.`,
          flags: MessageFlags.Ephemeral,
        });
      }
      if (activeContract) {
        return interaction.editReply({
          content: `❌ <@${userId }> already has a contract with **${builderHelpers.getFormattedTeamName(activeContract.teamName).toUpperCase()}**.`,
          flags: MessageFlags.Ephemeral,
        });
      }
      if (currentSquad.length >= constants.MAX_ROSTER_SIZE) {
        return interaction.editReply({
          content: `❌ **Roster limit reached!** ${formattedTeamName} already has ${constants.MAX_ROSTER_SIZE} registered players.`,
          flags: MessageFlags.Ephemeral,
        });
      }
      const playerSigningsUsed = await database.getPlayerSigningsCount(userId);
      if (playerSigningsUsed >= constants.MAX_SIGNINGS_PER_PLAYER) {
        return interaction.editReply({
          content: `❌ This player has reached the maximum number of signings allowed.`,
          flags: MessageFlags.Ephemeral
        });
      }

      const role = await builderHelpers.getTeamRole(interaction.client, selectedTeam);
      const embedColor = role?.color || constants.DEFAULT_EMBED_COLOR;

      const contractEmbed = buildPSLEmbed(interaction.client, embedColor)
        .setTitle('📜 NEW CONTRACT OFFER!')
        .setDescription(
          `Hello, <@${userId }>,\n\n` +
          `${formattedTeamName} has officially extended a contract offer to you for this season.\n\n` +
          `Please review and make your decision below:`,
        );

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`accept_${selectedTeam}_${userId }_${interaction.user.id}`)
          .setLabel('🤝 Accept Contract')
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId(`refuse_${selectedTeam}_${userId }_${interaction.user.id}`)
          .setLabel('❌ Refuse')
          .setStyle(ButtonStyle.Danger),
      );

      try {
        await signee.send({ embeds: [contractEmbed], components: [row] });
      } catch (dmError) {
        if (dmError.code === 50007 || dmError.code === 50278 || dmError.status === 403) {
          return interaction.editReply({
            embeds: [
              buildPSLEmbed(interaction.client, constants.DEFAULT_EMBED_COLOR)
                .setTitle('❌ Unable to Deliver Contract')
                .setDescription(
                  `Could not send a Direct Message to <@${userId }>.\n\n` +
                  `Please ask them to enable **DMs from server members** in their Discord Privacy settings and try again.`,
                ),
            ],
            flags: MessageFlags.Ephemeral,
          });
        }
        throw dmError;
      }

      return interaction.editReply({
        content: `📨 Contract offer successfully sent to <@${userId }>'s DMs for ${formattedTeamName}!`,
        flags: MessageFlags.Ephemeral,
      });

    } catch (error) {
      console.error('❌ Error in /contract:', error);
      if (!interaction.replied) {
        return interaction.editReply({
          content: '❌ An unexpected error occurred while processing the contract offer.',
          flags: MessageFlags.Ephemeral,
        });
      }
    }
  },
};