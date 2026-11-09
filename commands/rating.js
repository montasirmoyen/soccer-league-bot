const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { getRatingChoices } = require('../utils/builder-helpers');
const { isLeagueStaff } = require('../utils/validations');
const { buildPSLEmbed } = require('../utils/embed-helpers');
const { logCommandResult } = require('../utils/log-helpers');
const constants = require('../config/constants');
const database = require('../db/database');

const ratingChoices = getRatingChoices();

const MIN_DESCRIPTION_LENGTH = 20;
const MAX_DESCRIPTION_LENGTH = 200;

module.exports = {
    data: new SlashCommandBuilder()
        .setName('rating')
        .setDescription('Submit or view public feedback about staff members')
        .addSubcommand((subcommand) =>
            subcommand
                .setName('submit')
                .setDescription('Send your public feedback about a staff member')
                .addUserOption(option =>
                    option
                        .setName('staff')
                        .setDescription('Staff member to rate')
                        .setRequired(true)
                )
                .addStringOption(option =>
                    option
                        .setName('rating')
                        .setDescription('Rate the staff member (1-5 stars)')
                        .setRequired(true)
                        .addChoices(ratingChoices)
                )
                .addStringOption(option =>
                    option
                        .setName('description')
                        .setDescription(`Provide a description of your feedback (${MIN_DESCRIPTION_LENGTH}-${MAX_DESCRIPTION_LENGTH})`)
                        .setRequired(false)
                        .setMinLength(MIN_DESCRIPTION_LENGTH)
                        .setMaxLength(MAX_DESCRIPTION_LENGTH)
                ),
        )
        .addSubcommand((subcommand) =>
            subcommand
                .setName('view')
                .setDescription('View the public feedback about a staff member')
                .addUserOption(option =>
                    option
                        .setName('staff')
                        .setDescription('Staff member to view rating')
                        .setRequired(true)
                ),
        ),

    async execute(interaction) {
        const action = interaction.options.getSubcommand();
        const staffMember = interaction.options.getMember('staff');
        let displayName;

        try {
            if (!staffMember) {
                return interaction.editReply({
                    content: '❌ Could not find that member in this server.',
                    flags: MessageFlags.Ephemeral
                });
            }

            if (staffMember.user.bot) {
                return interaction.editReply({
                    content: `❌ You cannot ${action === 'submit' ? 'rate' : 'view the rating of'} a bot.`,
                    flags: MessageFlags.Ephemeral
                });
            }

            if (!isLeagueStaff(staffMember)) {
                return interaction.editReply({
                    content: `❌ You can only ${action === 'submit' ? 'rate' : 'view ratings of'} staff members.`,
                    flags: MessageFlags.Ephemeral
                });
            }

            displayName = staffMember.displayName;
            const userTag = staffMember.user.tag;

            if (action === 'submit') {
                if (staffMember.user.id === interaction.user.id) {
                    return interaction.editReply({
                        content: '❌ You cannot rate yourself.',
                        flags: MessageFlags.Ephemeral
                    });
                }

                const rating = interaction.options.getString('rating');
                const description = interaction.options.getString('description');

                const existingRating = await database.getStaffRatingByRaterId(staffMember.user.id, interaction.user.id);
                const successMessage = existingRating
                    ? '⚠️ You have already rated this staff member. Your rating has been updated.'
                    : '✅ Your rating has been submitted.';

                await database.rateStaff(staffMember.user.id, interaction.user.id, parseInt(rating, 10), description);

                await logCommandResult(interaction, {
                    command: 'rating submit',
                    title: `Rating ${existingRating ? 'Updated' : 'Submitted'}`,
                    details: [
                        { label: 'Staff Member', value: `**${displayName}** (\`${staffMember.user.id}\`)`, terminalValue: `${displayName} (${staffMember.user.id})` },
                    ],
                    result: 'The staff member has been rated successfully.',
                });

                return interaction.editReply({
                    content: successMessage,
                    flags: MessageFlags.Ephemeral
                });
            }

            if (action === 'view') {
                const existingRatings = await database.getStaffRatings(staffMember.user.id);
                if (!existingRatings || existingRatings.length === 0) {
                    return interaction.editReply({
                        content: `❌ **${displayName}** has not been rated yet.`,
                        flags: MessageFlags.Ephemeral
                    });
                }

                const highestStaffRole = staffMember.roles.cache
                    .filter(role => constants.STAFF_ROLES.includes(role.id))
                    .sort((a, b) => b.position - a.position)
                    .first();

                const ratingsEmbed = buildPSLEmbed(interaction.client, highestStaffRole.color || constants.DEFAULT_EMBED_COLOR);
                ratingsEmbed.setTitle(`**${displayName}**'s Ratings Feedback`);
                ratingsEmbed.setThumbnail(staffMember.user.displayAvatarURL());

                ratingsEmbed.addFields({ name: 'Staff Name', value: `**${displayName}** (${userTag})`, inline: false });

                const ratingsField = existingRatings.map(rating => `${ratingChoices[rating.stars - 1].name}\n📝 **Description:** ${rating.description || 'No description provided.'}`).join('\n\n');
                ratingsEmbed.addFields({ name: 'Ratings', value: ratingsField, inline: false });

                return interaction.editReply({ embeds: [ratingsEmbed], flags: MessageFlags.Ephemeral });
            }
        } catch (error) {
            await logCommandResult(interaction, {
                type: 'error',
                title: action === 'submit' ? 'Rating Failed' : 'View Rating Failed',
                command: `rating ${action}`,
                details: staffMember
                    ? [{ label: 'Staff Member', value: `**${displayName}** (\`${staffMember.user.id}\`)`, terminalValue: `${displayName} (${staffMember.user.id})` }]
                    : [],
                result: `The staff ${action === 'submit' ? 'rating' : 'view rating'} request could not be processed due to an internal failure.`,
                terminalResult: `Staff ${action} failed.`,
                error,
            });

            return interaction.editReply({
                content: `❌ An error occurred while processing your ${action === 'submit' ? 'rating' : 'view rating request'}. Please try again later.`,
                flags: MessageFlags.Ephemeral
            });
        }
    }
};