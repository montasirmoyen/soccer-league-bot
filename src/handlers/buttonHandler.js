const db = require('../db/database');
const { managers } = require('../config/managers');
const { SIGNING_CHANNEL_ID } = require('../config/constants');

async function handleEmergencyButton(interaction, customIdParts) {
  const [, emergencyAction, managerId, teamName, signeeId] = customIdParts;

  if (interaction.user.id !== signeeId) {
    return interaction.reply({ content: "❌ You can't respond to someone else's contract!", ephemeral: true });
  }

  const teamData = managers[managerId];
  if (!teamData) {
    return interaction.reply({ content: '❌ Team data is nil.', ephemeral: true });
  }

  const member = interaction.user;

  if (emergencyAction === 'accept') {
    const existingContract = await db.getContractedTeam(member.id);
    if (existingContract) {
      console.log(`Emergency signing: ${member.id} being moved from ${existingContract.teamName} to ${teamName}`);
    }

    await db.contractPlayer(member.id, teamName, teamData.emoji);
    const signingChannel = await interaction.client.channels.fetch(SIGNING_CHANNEL_ID);
    await signingChannel.send(`🚨 **EMERGENCY SIGNING** | <@${member.id}> has joined **${teamData.team}**`);

    return interaction.update({
      content: `✅ Emergency contract signed with **${teamData.team}**.`,
      components: [],
      embeds: [],
    });
  }

  if (emergencyAction === 'decline') {
    return interaction.update({
      content: `❌ | <@${member.id}> has declined the emergency contract.`,
      components: [],
      embeds: [],
    });
  }
}

async function handleContractButton(interaction, customIdParts) {
  const [action, managerId, teamName, signeeId] = customIdParts;

  if (interaction.user.id !== signeeId) {
    return interaction.reply({ content: "❌ You can't respond to someone else's contract!", ephemeral: true });
  }

  const teamData = managers[managerId];
  if (!teamData) {
    return interaction.reply({ content: '❌ Team data is nil.', ephemeral: true });
  }

  const member = interaction.user;

  if (action === 'accept') {
    const row = await db.getContractedTeam(member.id);
    if (row) {
      return interaction.update({ content: `❌ You are already contracted to **${row.team}**.`, components: [], embeds: [] });
    }

    await db.contractPlayer(member.id, teamName, teamData.emoji);
    const signingChannel = await interaction.client.channels.fetch(SIGNING_CHANNEL_ID);
    await signingChannel.send(`🔔 | <@${member.id}> has joined **${teamData.team}**`);

    return interaction.update({ content: `✅ Contract signed with **${teamData.team}**.`, components: [], embeds: [] });
  }

  if (action === 'decline') {
    return interaction.update({ content: `❌ | <@${member.id}> has declined the contract.`, components: [], embeds: [] });
  }
}

async function handleButton(interaction) {
  const customIdParts = interaction.customId.split('_');

  if (customIdParts[0] === 'emergency') {
    return handleEmergencyButton(interaction, customIdParts);
  }

  return handleContractButton(interaction, customIdParts);
}

module.exports = { handleButton };
