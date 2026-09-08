const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const database = require('../db/database');
const constants = require('../config/constants');
const builderHelpers = require('../utils/builder-helpers')
const { buildPSLEmbed } = require('../utils/embed-helpers');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('help')
    .setDescription('Complete guide to all PSL bot commands and features'),

  async execute(interaction) {
    console.log(`\n❓ [help.js] Help command requested by ${interaction.user.tag}`);

    try {
      const positionChoices = builderHelpers.getPositionChoices();
      let positionChoicesField = ``;
      for (const position of positionChoices) {
        positionChoicesField += ` ${position.name}`;
      }

      const regionChoices = builderHelpers.getTimezoneChoices();
      let regionChoicesField = ``;
      for (const region of regionChoices) {
        regionChoicesField += ` ${region.name}`;
      }

      const mainEmbed = buildPSLEmbed(interaction.client, constants.DEFAULT_EMBED_COLOR)
        .setTitle('⚽ PSL COMPLETE COMMAND GUIDE')
        .setDescription('**Pure Soccer League Bot** - All Commands in one place')
        .setThumbnail(interaction.client.user.avatarURL());

      mainEmbed.addFields(
        {
          name: '📝 `/free-agent [position] [region]`',
          value: '**Purpose:** Register yourself as an available free agent\n**When to use:** After being released or starting season\n**Requirements:** No active contract',
          inline: false,
        },
        {
          name: '⚽ `/friendly [region] [option]`',
          value: `**Purpose:** Find friendly matches for practice\n**Regions:** ${regionChoicesField}\n**Options:** DM TO PLAY, IN GAME ALREADY`,
          inline: false,
        },
        {
          name: '📊 `/roster [team_name]`',
          value: '**Purpose:** View current players on a team\n**Shows:** All contracted players with their positions\n**Usage:** Check team depth before joining',
          inline: false,
        },
        {
          name: '📋 `/contract [team_name] [player]`',
          value: '**Purpose:** Send contract offer to player\n**Requirements:** Transfer window OPEN\n**Roster:** Team must have space (Max: ' + constants.MAX_ROSTER_SIZE + ')\n**Cooldown:** 4 seconds between sends\n**Result:** DM sent to player | Posted to https://discord.com/channels/1480550964762251445/1480569415622725662',
          inline: false,
        },
        {
          name: '🚨 `/emergency-contract [team_name] [player]`',
          value: '**Purpose:** Sign player when transfer window is CLOSED\n**Limit:** ' + constants.MAX_EMERGENCY_SIGNS_PER_TEAM + ' per team per season\n**Roster:** Team must have space\n**Cooldown:** 4 seconds between sends\n**Result:** DM sent to player | Posted to https://discord.com/channels/1480550964762251445/1480569415622725662 with emergency badge',
          inline: false,
        },
        {
          name: '🔍 `/scout [position] [message]`',
          value: '**Purpose:** Post wanted ad for specific player position\n**Message:** Custom recruitment note\n**Result:** Posted to https://discord.com/channels/1480550964762251445/1480569441241665620 for free agents to see\n**Cooldown:** 4 seconds',
          inline: false,
        },
        {
          name: '🧹 `/release [player]`',
          value: '**Purpose:** Remove player from team\n**Effect:** Player becomes free agent immediately\n**Result:** Posted to https://discord.com/channels/1480550964762251445/1480772400894447678 with team capacity',
          inline: false,
        },
        {
          name: '🎯 `/scrim [name] [region] [code] [sinfo]`',
          value: '**Purpose:** Host scrims and invite community to play\n**Result:** Posted to https://discord.com/channels/1480550964762251445/1480569639233786027\n**Cooldown:** 1 hour',
          inline: false,
        },
        {
          name: '🏆 `/appoint [team_name] [role] [player]`',
          value: '**Purpose:** Assign manager or assistant manager\n**Roles:** manager, assistantManager\n**Requirement:** Staff role on team\n**Result:** Staff role assignment updated',
          inline: false,
        },
        {
          name: '⚽ `/match-inform [team1] [team2] [notes]`',
          value: '**Purpose:** Send a match notification to all players and staff of two teams\n**Permissions:** Referee, Chairman, Overseer\n**Result:** Polished match embed delivered to every player\'s DMs',
          inline: false,
        },
        {
          name: '📍 Available Positions',
          value: `${positionChoicesField}`,
          inline: false,
        },
        {
          name: '🕐 Key Constraints',
          value: '• **Roster Size:** ' + constants.MAX_ROSTER_SIZE + ' players max per team\n' +
            '• **Emergency Signings:** ' + constants.MAX_EMERGENCY_SIGNS_PER_TEAM + ' per season (window closed only)\n' +
            '• **Releases:** ' + constants.MAX_RELEASES_PER_TEAM + ' per season\n' +
            '• **Transfer Window:** Must be OPEN to use `/contract`\n',
          inline: false,
        },
        {
          name: '💬 Need Further Assistance?',
          value: 'Contact us through tickets for clarification on specific rules or features.',
          inline: false,
        }
      );

      await interaction.editReply({ embeds: [mainEmbed], flags: MessageFlags.Ephemeral });
    } catch (error) {
      console.error('❌ Error in /help:', error);
      return interaction.editReply({ content: '❌ An error occurred generating help.', flags: MessageFlags.Ephemeral });
    }
  },
};