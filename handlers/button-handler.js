const database = require('../db/database');
const constants = require('../config/constants');

async function handleEmergencyButton(interaction, customIdParts) {
  const [, emergencyAction, teamName, signeeId] = customIdParts;

  if (interaction.user.id !== signeeId) {
    return interaction.reply({ content: '❌ You cannot respond to someone else\'s contract!', ephemeral: true });
  }

  const member = interaction.user;

  try {
    if (emergencyAction === 'accept') {
      const existingContract = await database.getContractedTeam(member.id);
      if (existingContract) {
        console.log(`[button-handler.js] Emergency signing: ${member.id} moved from ${existingContract.teamName} to ${teamName}`);
      }

      await database.contractPlayer(member.id, teamName);
      const signingChannel = await interaction.client.channels.fetch(constants.SIGNINGS_CHANNEL_ID);
      if (signingChannel) {
        await signingChannel.send(`🚨 **EMERGENCY SIGNING** | <@${member.id}> has joined **${teamName}**`);
      }

      return interaction.update({
        content: `✅ Emergency contract signed with **${teamName}**.`,
        components: [],
        embeds: [],
      });
    }

    if (emergencyAction === 'refuse') {
      return interaction.update({
        content: `❌ <@${member.id}> has declined the emergency contract.`,
        components: [],
        embeds: [],
      });
    }
  } catch (error) {
    console.error('[button-handler.js] Error in emergency button:', error);
    return interaction.update({
      content: '❌ An error occurred processing your response.',
      components: [],
      embeds: [],
    });
  }
}

async function handleContractButton(interaction, customIdParts) {
  const [action, teamName, signeeId] = customIdParts;

  if (interaction.user.id !== signeeId) {
    return interaction.reply({ content: '❌ You cannot respond to someone else\'s contract!', ephemeral: true });
  }

  const member = interaction.user;

  try {
    if (action === 'accept') {
      const existingContract = await database.getContractedTeam(member.id);
      if (existingContract) {
        return interaction.update({
          content: `❌ You are already contracted to **${existingContract.teamName}**.`,
          components: [],
          embeds: [],
        });
      }

      await database.contractPlayer(member.id, teamName);
      const signingChannel = await interaction.client.channels.fetch(constants.SIGNINGS_CHANNEL_ID);
      if (signingChannel) {
        await signingChannel.send(`🔔 <@${member.id}> has joined **${teamName}**`);
      }

      return interaction.update({
        content: `✅ Contract signed with **${teamName}**.`,
        components: [],
        embeds: [],
      });
    }

    if (action === 'refuse') {
      return interaction.update({
        content: `❌ <@${member.id}> has declined the contract.`,
        components: [],
        embeds: [],
      });
    }
  } catch (error) {
    console.error('[button-handler.js] Error in contract button:', error);
    return interaction.update({
      content: '❌ An error occurred processing your response.',
      components: [],
      embeds: [],
    });
  }
}

async function handleButton(interaction) {
  console.log(`\n🔘 [button-handler.js] Button clicked by ${interaction.user.tag}: ${interaction.customId}`);

  try {
    const customIdParts = interaction.customId.split('_');

    if (customIdParts[0] === 'emergency') {
      return handleEmergencyButton(interaction, customIdParts);
    }

    if (customIdParts[0] === 'accept' || customIdParts[0] === 'refuse') {
      return handleContractButton(interaction, customIdParts);
    }

    console.warn(`[button-handler.js] Unknown button type: ${customIdParts[0]}`);
  } catch (error) {
    console.error('[button-handler.js] Error in handleButton:', error);
  }
}

module.exports = { handleButton };