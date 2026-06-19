const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const database = require('../db/database');
const constants = require('../config/constants');
const builderHelpers = require('../utils/builderHelpers');
const { buildPSLEmbed } = require('../utils/embedHelpers');
const { isChairman } = require('../utils/validations');
const { safeRoleAdd, safeRoleRemove, safeFetchMember } = require('../utils/discordHelpers');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('appoint')
    .setDescription('Appoints or removes a Manager / Assistant Manager for a team.')
    .addStringOption((option) =>
      option.setName('team').setDescription('Select the national team').setRequired(true)
        .addChoices(builderHelpers.getTeamChoices())
    )
    .addStringOption((option) =>
      option.setName('role').setDescription('Select the management role').setRequired(true)
        .addChoices(
          { name: 'Manager', value: 'manager' },
          { name: 'Assistant Manager', value: 'assistant' }
        )
    )
    .addUserOption((option) =>
      option.setName('appointee').setDescription('User to appoint (leave empty to remove the current staff)').setRequired(false)
    ),

  async execute(interaction) {
    if (!isChairman(interaction.member)) {
      return interaction.editReply({ content: '❌ Only Chairmen can use this command.', flags: MessageFlags.Ephemeral });
    }

    const selectedTeam = interaction.options.getString('team');
    const selectedRole = interaction.options.getString('role');
    const appointee = interaction.options.getUser('appointee');

    if (appointee?.bot) {
      return interaction.editReply({ content: '❌ You cannot appoint a bot.', flags: MessageFlags.Ephemeral });
    }

    try {
      const [teamInfo, isStaffElsewhere, existingContract] = await Promise.all([
        database.getTeamInfo(selectedTeam),
        appointee ? database.isUserStaffAnywhere(appointee.id) : Promise.resolve(null),
        appointee ? database.getContractedTeam(appointee.id) : Promise.resolve(null)
      ]);

      if (!teamInfo) {
        return interaction.editReply({ content: '❌ Team not found in database.', flags: MessageFlags.Ephemeral });
      }

      const isManager = selectedRole === 'manager';
      const currentStaffId = isManager ? teamInfo.manager : teamInfo.assistantManager;
      const globalRoleId = isManager ? constants.MANAGER_ROLE_ID : constants.ASSISTANT_MANAGER_ROLE_ID;
      const roleName = isManager ? 'Manager' : 'Assistant Manager';
      const formattedTeamName = `**${builderHelpers.getFormattedTeamName(selectedTeam).toUpperCase()}**`;

      if (!appointee) {
        if (!currentStaffId) {
          return interaction.editReply({ content: `❌ The **${roleName}** position for ${formattedTeamName} is already empty.`, flags: MessageFlags.Ephemeral });
        }

        await database.appointStaff(selectedTeam, null, selectedRole);

        safeFetchMember(interaction.guild, currentStaffId).then(oldMember => {
          if (oldMember) {
            Promise.all([
              safeRoleRemove(oldMember, globalRoleId),
              safeRoleRemove(oldMember, teamInfo.roleId)
            ]).catch(console.warn);
          }
        });

        return interaction.editReply({ content: `🧹 The **${roleName}** position for ${formattedTeamName} has been cleared.`, flags: MessageFlags.Ephemeral });
      }

      if (teamInfo.manager === appointee.id || teamInfo.assistantManager === appointee.id) {
        return interaction.editReply({ content: `❌ <@${appointee.id}> is already in the management of this team. Demote or clear them first.`, flags: MessageFlags.Ephemeral });
      }
      if (isStaffElsewhere) {
        return interaction.editReply({ content: `❌ <@${appointee.id}> is already staff for **${isStaffElsewhere.name}**.`, flags: MessageFlags.Ephemeral });
      }
      if (existingContract) {
        return interaction.editReply({ content: `❌ <@${appointee.id}> is a registered player for **${existingContract.teamName}**. Release them first.`, flags: MessageFlags.Ephemeral });
      }

      await database.appointStaff(selectedTeam, appointee.id, selectedRole);
      await interaction.editReply({ content: `✅ <@${appointee.id}> has been appointed as **${roleName}** for ${formattedTeamName}.`, flags: MessageFlags.Ephemeral });

      (async () => {
        if (currentStaffId) {
          const oldMember = await safeFetchMember(interaction.guild, currentStaffId);
          if (oldMember) {
            await Promise.all([
              safeRoleRemove(oldMember, globalRoleId),
              safeRoleRemove(oldMember, teamInfo.roleId)
            ]);
            console.log(`[appoint.js] Stripped old staff roles from ${currentStaffId}.`);
          }
        }

        const targetMember = await safeFetchMember(interaction.guild, appointee.id);
        if (targetMember) {
          await Promise.all([
            safeRoleAdd(targetMember, globalRoleId),
            safeRoleAdd(targetMember, teamInfo.roleId)
          ]);
        }

        const role = await builderHelpers.getTeamRole(interaction.client, selectedTeam);
        const appointEmbed = buildPSLEmbed(interaction.client, role?.color || constants.DEFAULT_EMBED_COLOR)
          .setTitle(`${formattedTeamName} OFFICIAL APPOINTMENT`)
          .setThumbnail(appointee.displayAvatarURL({ dynamic: true }))
          .addFields({
            name: 'Staff Appointed',
            value: `<@${appointee.id}> has been officially appointed as **${roleName}** for ${formattedTeamName}! 📝`,
          });

        const appointmentsChannel = await interaction.client.channels.fetch(constants.APPOINTMENTS_CHANNEL_ID).catch(() => null);
        if (appointmentsChannel) {
          const mentions = [ `<@${appointee.id}>`, interaction.user ? `<@${interaction.user.id}>` : null ].filter(Boolean).join(' ');
          appointmentsChannel.send({ content: mentions, embeds: [appointEmbed] }).catch(console.warn);
        }
      })();

    } catch (error) {
      console.error('❌ Critical error in /appoint:', error);
      if (error.code === 50013 && !interaction.replied) {
        return interaction.editReply({ content: '❌ **Hierarchy Error:** Move the bot\'s role higher in Server Settings.', flags: MessageFlags.Ephemeral });
      }
      if (!interaction.replied) interaction.editReply({ content: '❌ An error occurred during appointment.', flags: MessageFlags.Ephemeral });
    }
  },
};