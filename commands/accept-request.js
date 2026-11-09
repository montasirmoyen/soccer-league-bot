const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { 
    getRobloxUserProfile,
    getGroupMembership,
    getRobloxUserJoinRequest,
    acceptJoinRequest } = require('../utils/roblox-helpers');
const { requireLeagueStaff } = require('../utils/validations');
const { logCommandResult, logValidationFailure } = require('../utils/log-helpers');
const constants = require('../config/constants');

const MAX_USER_CHARACTERS = 20;
const MIN_USER_CHARACTERS = 3;

module.exports = {
    data: new SlashCommandBuilder()
        .setName('accept-request')
        .setDescription('[Moderator+] Accept a join request of a Roblox user')
        .addStringOption((option) =>
            option
                .setName('user')
                .setDescription('User to accept')
                .setRequired(true)
                .setMinLength(MIN_USER_CHARACTERS)
                .setMaxLength(MAX_USER_CHARACTERS)
        ),

    async execute(interaction) {
        if (!await requireLeagueStaff(interaction)) return;

        const robloxUser = interaction.options.getString('user');

        try {
            const userResponse = await getRobloxUserProfile(robloxUser);
            if (!userResponse) {
                await logValidationFailure(interaction, {
                    title: 'User Not Found',
                    command: 'accept-request',
                    details: [
                        { label: 'Roblox Username', value: `${robloxUser}` },
                    ],
                    result: 'The provided username does not exist on Roblox.',
                    terminalDetails: [
                        { label: 'Roblox Username', value: robloxUser },
                    ],
                });

                return interaction.editReply({
                    content: `❌ Username \`${robloxUser}\` does not exist.`,
                    flags: MessageFlags.Ephemeral
                });
            }

            const robloxUserId = userResponse.id;
            const userGroupMembership = await getGroupMembership(constants.ROBLOX_GROUP_ID, robloxUserId);
            if (userGroupMembership) {
                await logValidationFailure(interaction, {
                    title: 'Already In Group',
                    command: 'accept-request',
                    details: [
                        { label: 'Roblox User', value: `**${userResponse.name}** (\`${robloxUserId}\`)` },
                    ],
                    result: 'The user is already a member of the Roblox group.',
                    terminalDetails: [
                        { label: 'Roblox User', value: `${userResponse.name} (${robloxUserId})` },
                    ],
                });

                return interaction.editReply({
                    content: `ℹ️ User \`${userResponse.name}\` has already joined this group.`,
                    flags: MessageFlags.Ephemeral
                });
            }

            const userJoinRequest = await getRobloxUserJoinRequest(constants.ROBLOX_GROUP_ID, robloxUserId);

            if (!userJoinRequest.hasRequested) {
                await logValidationFailure(interaction, {
                    title: 'No Pending Request',
                    command: 'accept-request',
                    details: [
                        { label: 'Roblox User', value: `**${userResponse.name}** (\`${robloxUserId}\`)` },
                    ],
                    result: 'The user has not requested to join the Roblox group.',
                    terminalDetails: [
                        { label: 'Roblox User', value: `${userResponse.name} (${robloxUserId})` },
                    ],
                });

                return interaction.editReply({
                    content: `❌ User \`${userResponse.name}\` has not requested to join the group yet.`,
                    flags: MessageFlags.Ephemeral
                });
            }

            const acceptanceResponse = await acceptJoinRequest(constants.ROBLOX_GROUP_ID, robloxUserId);
            if (acceptanceResponse.success) {
                await logCommandResult(interaction, {
                    command: 'accept-request',
                    title: 'Join Request Accepted',
                    details: [
                        { label: 'Roblox User', value: `**${userResponse.name}** (\`${robloxUserId}\`)`, terminalValue: `${userResponse.name} (${robloxUserId})` },
                    ],
                    result: 'The user was successfully accepted into the Roblox group.',
                });

                return interaction.editReply({
                    content: `✅ User \`${userResponse.name}\` has been accepted to the group.`,
                    flags: MessageFlags.Ephemeral
                });
            }

        } catch (error) {
            await logCommandResult(interaction, {
                type: 'error',
                title: 'Join Request Acceptance Failed',
                command: 'accept-request',
                details: [
                    { label: 'Roblox Username', value: `\`${robloxUser}\``, terminalValue: robloxUser },
                ],
                result: 'The Roblox join request could not be processed due to an internal failure.',
                terminalResult: 'Roblox join request acceptance failed.',
                error,
            });

            await interaction.editReply({
                content: '❌ An unexpected error occurred during this acceptance.',
                flags: MessageFlags.Ephemeral
            });
        }
    }
}