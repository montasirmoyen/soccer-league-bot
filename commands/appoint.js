const { SlashCommandBuilder } = require('discord.js');
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
      return interaction.reply({ content: '❌ Only Chairmen can use this command.', ephemeral: true });
    }

    const selectedTeam = interaction.options.getString('team');
    const selectedRole = interaction.options.getString('role');
    const appointee = interaction.options.getUser('appointee');

    if (appointee?.bot) {
      return interaction.reply({ content: '❌ You cannot appoint a bot.', ephemeral: true });
    }

    try {
      const teamInfo = await database.getTeamInfo(selectedTeam);
      if (!teamInfo) {
        return interaction.reply({ content: '❌ Team not found in database.', ephemeral: true });
      }

      const currentStaffId = selectedRole === 'manager' ? teamInfo.manager : teamInfo.assistantManager;
      const globalRoleId = selectedRole === 'manager' ? constants.MANAGER_ROLE_ID : constants.ASSISTANT_MANAGER_ROLE_ID;
      const formattedTeamName = `**${builderHelpers.getFormattedTeamName(selectedTeam).toUpperCase()}**`;
      const roleName = selectedRole === 'manager' ? 'Manager' : 'Assistant Manager';

      if (!appointee) {
        if (!currentStaffId) {
          return interaction.reply({
            content: `❌ The **${roleName}** position for ${formattedTeamName} is already empty.`,
            ephemeral: true,
          });
        }

        const oldMember = await safeFetchMember(interaction.guild, currentStaffId);
        if (oldMember) {
          await safeRoleRemove(oldMember, globalRoleId);
          await safeRoleRemove(oldMember, teamInfo.roleId);
        }

        await database.appointStaff(selectedTeam, null, selectedRole);
        return interaction.reply({
          content: `🧹 The **${roleName}** position for ${formattedTeamName} has been cleared.`,
          ephemeral: true,
        });
      }

      if (selectedRole === 'manager' && teamInfo.manager === appointee.id) {
        return interaction.reply({ content: `❌ <@${appointee.id}> is already the **Manager** of ${formattedTeamName}.`, ephemeral: true });
      }
      if (selectedRole === 'assistant' && teamInfo.assistantManager === appointee.id) {
        return interaction.reply({ content: `❌ <@${appointee.id}> is already the **Assistant Manager** of ${formattedTeamName}.`, ephemeral: true });
      }
      if (selectedRole === 'manager' && teamInfo.assistantManager === appointee.id) {
        return interaction.reply({ content: `❌ <@${appointee.id}> is currently the Assistant Manager of this team. Demote them first.`, ephemeral: true });
      }
      if (selectedRole === 'assistant' && teamInfo.manager === appointee.id) {
        return interaction.reply({ content: `❌ <@${appointee.id}> is currently the Manager of this team. Demote them first.`, ephemeral: true });
      }

      const isStaffElsewhere = await database.isUserStaffAnywhere(appointee.id);
      if (isStaffElsewhere) {
        return interaction.reply({
          content: `❌ <@${appointee.id}> is already staff for **${isStaffElsewhere.name}**.`,
          ephemeral: true,
        });
      }

      const existingContract = await database.getContractedTeam(appointee.id);
      if (existingContract) {
        return interaction.reply({
          content: `❌ <@${appointee.id}> is a registered player for **${existingContract.teamName}**. Release them first.`,
          ephemeral: true,
        });
      }

      if (currentStaffId) {
        const oldMember = await safeFetchMember(interaction.guild, currentStaffId);
        if (oldMember) {
          await safeRoleRemove(oldMember, globalRoleId);
          await safeRoleRemove(oldMember, teamInfo.roleId);
          console.log(`[appoint.js] Stripped old staff roles from ${currentStaffId}.`);
        }
      }

      const targetMember = await interaction.guild.members.fetch(appointee.id);
      await safeRoleAdd(targetMember, globalRoleId);
      await safeRoleAdd(targetMember, teamInfo.roleId);

      await database.appointStaff(selectedTeam, appointee.id, selectedRole);
      console.log(`[appoint.js] ${appointee.tag} appointed as ${roleName} for ${selectedTeam}.`);

      const role = await builderHelpers.getTeamRole(interaction.client, selectedTeam);
      const embedColor = role ? role.color : constants.DEFAULT_EMBED_COLOR;

      const appointEmbed = buildPSLEmbed(interaction.client, embedColor)
        .setTitle(`${formattedTeamName} OFFICIAL APPOINTMENT`)
        .setThumbnail(appointee.displayAvatarURL({ dynamic: true }))
        .addFields({
          name: 'Staff Appointed',
          value: `<@${appointee.id}> has been officially appointed as **${roleName}** for ${formattedTeamName}! 📝`,
        });

      try {
        const appointmentsChannel = await interaction.client.channels.fetch(constants.APPOINTMENTS_CHANNEL_ID);
        const mentions = [
          `<@${appointee.id}>`,
          interaction.user ? `<@${interaction.user.id}>` : null,
        ].filter(Boolean).join(' ');
        if (appointmentsChannel) await appointmentsChannel.send({ content: mentions, embeds: [appointEmbed] });
      } catch (logError) {
        console.warn('[appoint.js] Could not post to appointments channel:', logError.message);
      }

      return interaction.reply({ content: `✅ <@${appointee.id}> has been appointed as **${roleName}** for ${formattedTeamName}.`, ephemeral: true });
    } catch (error) {
      console.error('❌ Critical error in /appoint:', error);
      if (interaction.replied || interaction.deferred) return;
      if (error.code === 50013) {
        return interaction.reply({
          content: '❌ **Hierarchy Error:** Move the bot\'s role higher in Server Settings.',
          ephemeral: true,
        });
      }
      return interaction.reply({ content: '❌ An error occurred during appointment.', ephemeral: true });
    }
  },
};