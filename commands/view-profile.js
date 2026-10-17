const { SlashCommandBuilder, MessageFlags } = require('discord.js')
const { buildPSLEmbed } = require('../utils/embed-helpers');
const { 
    getFormattedTeamName,
    getDisplayedPlayerContractsAmount,
    getDisplayedPlayerDemandsAmount,
    getTeamRole } = require('../utils/builder-helpers');
const constants = require('../config/constants');
const database = require('../db/database');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('view-profile')
        .setDescription('View a player\'s profile information')
        .addUserOption((option) =>
            option
                .setName('player')
                .setDescription('Player to view profile')
                .setRequired(true)
        ),

    async execute(interaction) {
        const targetMember = interaction.options.getMember('player');
        if (targetMember.user.bot) {
            return interaction.editReply({ content: '❌ You cannot view a bot\'s profile.', flags: MessageFlags.Ephemeral });
        }

        const displayName = targetMember.displayName || targetMember.username;
        const userTag = targetMember.user.tag;
        const userId = targetMember.id;
        const contract = await database.getContractedTeam(userId);
        const teamRole = await getTeamRole(interaction.client, contract?.teamName);

        const profileEmbed = buildPSLEmbed(interaction.client, teamRole?.color || constants.DEFAULT_EMBED_COLOR);
        profileEmbed.setTitle(`**${displayName}**'s Official Profile`);
        profileEmbed.setThumbnail(targetMember.user.displayAvatarURL());

        try {
            const teamName = contract ? contract.teamName : 'None';
            const formattedTeamName = await getFormattedTeamName(teamName);
            const displayedContractsCount = await getDisplayedPlayerContractsAmount(userId);
            const displayedDemandsCount = await getDisplayedPlayerDemandsAmount(userId);

            profileEmbed.addFields({ name: 'Player Name', value: `**${displayName}** (${userTag})`, inline: false });
            profileEmbed.addFields({ name: 'Current Team', value: `**${formattedTeamName}**`, inline: false });
            profileEmbed.addFields({ name: 'Individual Contracts', value: `**${displayedContractsCount}**`, inline: true });
            profileEmbed.addFields({ name: 'Demands', value: `**${displayedDemandsCount}**`, inline: true });
            
            return interaction.editReply({ embeds: [profileEmbed], flags: MessageFlags.Ephemeral });

        } catch (error) {
            console.error(`Error fetching player profile: ${error}`);
            return interaction.editReply({ content: '❌ Error fetching player profile.', flags: MessageFlags.Ephemeral });
        }
    }
}