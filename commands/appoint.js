const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const database = require('../db/database');
const constants = require('../config/constants');
const builderHelpers = require('../utils/builder-helpers');
const { buildPSLEmbed } = require('../utils/embed-helpers');
const { safeRoleAdd, safeRoleRemove, safeFetchMember } = require('../utils/discord-helpers');
const { canManageTeam, isChairman, isTeamManager, validateGuild, isRegistered } = require('../utils/validations');
const { updateTeamsRoster } = require('../utils/roster-updater');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('appoint')
    .setDescription('Appoints or removes a Manager / Assistant Manager for a team.')
    .addStringOption((option) =>
      option
        .setName('team')
        .setDescription('Select the national team')
        .setRequired(true)
        .addChoices(builderHelpers.getTeamChoices()),
    )
    .addStringOption((option) =>
      option
        .setName('role')
        .setDescription('Select the management role')
        .setRequired(true)
        .addChoices(
          { name: 'Manager', value: 'manager' },
          { name: 'Assistant Manager', value: 'assistant' },
        ),
    )
    .addUserOption((option) =>
      option
        .setName('appointee')
        .setDescription('User to appoint (leave empty to remove current staff)')
        .setRequired(false),
    ),

  async execute(interaction) {
    if (!validateGuild(interaction)) {
      return interaction.editReply({
        content: '❌ You can only execute this command in the official server.',
        flags: MessageFlags.Ephemeral,
      });
    }

    const selectedTeam = interaction.options.getString('team');
    const selectedRole = interaction.options.getString('role');
    const appointee = interaction.options.getMember('appointee');

    const teamInfo = await database.getTeamInfo(selectedTeam);
    if (!teamInfo) {
      return interaction.editReply({ content: '❌ Team not found.', flags: MessageFlags.Ephemeral });
    }

    const formattedTeamName = `**${builderHelpers.getFormattedTeamName(selectedTeam).toUpperCase()}**`;

    if (!canManageTeam(interaction.member, teamInfo)) {
      return interaction.editReply({ content: '❌ Unauthorized.', flags: MessageFlags.Ephemeral });
    }

    if (appointee?.bot) {
      return interaction.editReply({ content: '❌ You cannot appoint a bot.', flags: MessageFlags.Ephemeral });
    }

    const isAssistantAppointment = selectedRole === 'assistant';
    const isManager = interaction.user.id === teamInfo.manager;

    if (!isChairman(interaction.member) && isManager && !isAssistantAppointment) {
      return interaction.editReply({
        content: '❌ Managers can only appoint Assistant Managers.',
        flags: MessageFlags.Ephemeral,
      });
    }

    const isRoleManager = selectedRole === 'manager';
    const currentStaffId = isRoleManager ? teamInfo.manager : teamInfo.assistantManager;
    const globalRoleId = isRoleManager ? constants.MANAGER_ROLE_ID : constants.ASSISTANT_MANAGER_ROLE_ID;
    const roleName = isRoleManager ? 'Manager' : 'Assistant Manager';

    try {
      if (!appointee) {
        if (!currentStaffId) {
          return interaction.editReply({
            content: `❌ The **${roleName}** position for ${formattedTeamName} is already empty.`,
            flags: MessageFlags.Ephemeral,
          });
        }

        await database.appointStaff(selectedTeam, null, selectedRole);
        await interaction.editReply({
          content: `🧹 The **${roleName}** position for ${formattedTeamName} has been cleared.`,
          flags: MessageFlags.Ephemeral,
        });

        (async () => {
          try {
            const [oldMember, clearedUser, role] = await Promise.all([
              safeFetchMember(interaction.guild, currentStaffId),
              interaction.client.users.fetch(currentStaffId).catch(() => null),
              builderHelpers.getTeamRole(interaction.client, selectedTeam)
            ]);

            if (oldMember) {
              await Promise.all([
                safeRoleRemove(oldMember, globalRoleId),
                safeRoleRemove(oldMember, teamInfo.roleId),
              ]).catch(console.warn);
              console.log(`[appoint.js] Revoked staff roles from ${currentStaffId} (unappoint).`);
            }

            const appointmentsChannel = await interaction.client.channels
              .fetch(constants.APPOINTMENTS_CHANNEL_ID)
              .catch(() => null);

            if (appointmentsChannel) {
              const clearEmbed = buildPSLEmbed(interaction.client, role?.color || constants.DEFAULT_EMBED_COLOR)
                .setTitle(`${formattedTeamName} OFFICIAL STAFF CLEARANCE 🧹`)
                .setDescription(
                  `The **${roleName}** position for ${formattedTeamName} has been officially vacated.`,
                )
                .addFields({
                  name: 'Position Cleared',
                  value: clearedUser
                    ? `<@${currentStaffId}> has been removed from the **${roleName}** role for ${formattedTeamName}. Their team badge and staff role have been revoked. 📋`
                    : `The **${roleName}** position has been cleared and all associated roles have been revoked. 📋`,
                });

              if (clearedUser) {
                clearEmbed.setThumbnail(clearedUser.displayAvatarURL({ dynamic: true }));
              }

              const mentions = [
                clearedUser ? `<@${currentStaffId}>` : null,
                `<@${interaction.user.id}>`,
              ]
                .filter(Boolean)
                .join(' ');

              await appointmentsChannel.send({ content: mentions, embeds: [clearEmbed] }).catch(console.warn);
            }

            await updateTeamsRoster(interaction.client);
          } catch (bgErr) {
            console.error('[appoint.js] Background unappoint error:', bgErr);
          }
        })();

        return;
      }

      const appointeeId = appointee.id;

      if (!(await isRegistered(appointee))) {
        return interaction.editReply({
          content: `❌ <@${appointeeId}> has not registered themselves yet.`,
          flags: MessageFlags.Ephemeral
        });
      }

      const [isStaffElsewhere, existingContract] = await Promise.all([
        database.isUserStaffAnywhere(appointeeId),
        database.getContractedTeam(appointeeId),
      ]);

      if (isTeamManager(teamInfo, appointeeId) && selectedRole !== 'assistant') {
        return interaction.editReply({
          content: '❌ Managers can only appoint their **Assistant Manager**.',
          flags: MessageFlags.Ephemeral
        });
      }

      if (teamInfo.manager === appointeeId || teamInfo.assistantManager === appointeeId) {
        return interaction.editReply({
          content: `❌ <@${appointeeId}> is already in the management of this team. Clear their current role first.`,
          flags: MessageFlags.Ephemeral
        });
      }

      if (isStaffElsewhere) {
        return interaction.editReply({
          content: `❌ <@${appointeeId}> is already staff for **${isStaffElsewhere.name}**.`,
          flags: MessageFlags.Ephemeral
        });
      }

      if (existingContract && existingContract.teamName !== selectedTeam) {
        const otherTeam = builderHelpers.getFormattedTeamName(existingContract.teamName).toUpperCase();
        return interaction.editReply({
          content: `❌ <@${appointeeId}> is a registered player for **${otherTeam}**.`,
          flags: MessageFlags.Ephemeral
        });
      }

      await database.appointStaff(selectedTeam, appointeeId, selectedRole);
      if (!existingContract || existingContract.teamName !== selectedTeam) {
        await database.contractPlayer(appointeeId, selectedTeam);
      }

      await interaction.editReply({
        content: `✅ <@${appointeeId}> has been appointed as **${roleName}** for ${formattedTeamName}.`,
        flags: MessageFlags.Ephemeral
      });

      (async () => {
        try {
          if (currentStaffId && currentStaffId !== appointeeId) {
            const oldMember = await safeFetchMember(interaction.guild, currentStaffId);
            if (oldMember) {
              await Promise.all([
                safeRoleRemove(oldMember, globalRoleId),
                safeRoleRemove(oldMember, teamInfo.roleId),
              ]).catch(console.warn);
              console.log(`[appoint.js] Stripped outgoing staff roles from ${currentStaffId}.`);
            }
          }

          const [targetMember, role, teamCapacity] = await Promise.all([
            safeFetchMember(interaction.guild, appointeeId),
            builderHelpers.getTeamRole(interaction.client, selectedTeam),
            builderHelpers.getDisplayedPlayersAmount(selectedTeam)
          ]);

          if (targetMember) {
            await Promise.all([
              safeRoleAdd(targetMember, globalRoleId),
              safeRoleAdd(targetMember, teamInfo.roleId),
            ]).catch(console.warn);
          }

          const appointmentsChannel = await interaction.client.channels
            .fetch(constants.APPOINTMENTS_CHANNEL_ID)
            .catch(() => null);
          if (appointmentsChannel) {
            const appointEmbed = buildPSLEmbed(interaction.client, role?.color || constants.DEFAULT_EMBED_COLOR)
              .setTitle(`${formattedTeamName} OFFICIAL APPOINTMENT`)
              .setThumbnail(appointee.displayAvatarURL({ dynamic: true }))
              .addFields(
                {
                  name: 'Staff Appointed',
                  value: `<@${appointeeId}> has been officially appointed as **${roleName}** for ${formattedTeamName}! 📝`,
                },
                {
                  name: 'Team Capacity',
                  value: teamCapacity,
                },
              );

            const mentions = [`<@${appointeeId}>`, `<@${interaction.user.id}>`].join(' ');
            await appointmentsChannel.send({ content: mentions, embeds: [appointEmbed] }).catch(console.warn);
          }

          await updateTeamsRoster(interaction.client);
        } catch (bgErr) {
          console.error('[appoint.js] Background appoint error:', bgErr);
        }
      })();

    } catch (error) {
      console.error('❌ Critical error in /appoint:', error);
      if (error.code === 50013 && !interaction.replied) {
        return interaction.editReply({
          content: "❌ **Hierarchy Error:** Move the bot's role higher in Server Settings.",
          flags: MessageFlags.Ephemeral,
        });
      }
      if (!interaction.replied) {
        interaction.editReply({
          content: '❌ An unexpected error occurred during this appointment.',
          flags: MessageFlags.Ephemeral,
        });
      }
    }
  },
};