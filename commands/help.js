const { SlashCommandBuilder } = require('discord.js');
const database = require('../db/database');
const constants = require('../config/constants');
const { buildPSLEmbed } = require('../utils/embed-helpers');
const { isChairman } = require('../utils/validations');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('help')
    .setDescription('Complete guide to all PSL commands and features'),

  async execute(interaction) {
    console.log(`\n❓ [help.js] Help command requested by ${interaction.user.tag}`);

    try {
      const userId = interaction.user.id;
      const staffRecord = await database.isUserStaffAnywhere(userId);
      const isManager = !!staffRecord || isChairman(interaction.member);

      const mainEmbed = buildPSLEmbed(interaction.client, constants.DEFAULT_EMBED_COLOR)
        .setTitle('⚽ PSL COMPLETE COMMAND GUIDE')
        .setDescription('Pure Soccer League - All Commands & Instructions for Players & Managers')
        .setThumbnail(interaction.client.user.avatarURL());

      // ── ALL PLAYER COMMANDS ────────────────────────────────────────────────
      mainEmbed.addFields({
        name: '👤 PLAYER COMMANDS (Available to Everyone)',
        value: '═══════════════════════════════════════',
        inline: false,
      });

      mainEmbed.addFields(
        {
          name: '📝 `/freeagent`',
          value: '**Purpose:** Register yourself as an available free agent\n**When to use:** After being released or starting season\n**Requirements:** No active contract',
          inline: false,
        },
        {
          name: '⚽ `/friendly [region] [option]`',
          value: '**Purpose:** Find friendly matches for practice\n**Regions:** GMT, BST, EST, CST, PST, UTC, WEST, EET, EEST, MSK, OTHER\n**Options:** DM TO PLAY, IN GAME ALREADY\n**Note:** Managers can also use to ping other teams',
          inline: false,
        },
        {
          name: '📜 `/demand`',
          value: '**Purpose:** Voluntarily demand release from your team\n**Cooldown:** Limited to ' + constants.MAX_DEMANDS_PER_SEASON + ' per season\n**Result:** Automatically posted to #releases with capacity display',
          inline: false,
        },
        {
          name: '📊 `/roster [team_name]`',
          value: '**Purpose:** View current players on a team\n**Shows:** All contracted players with their positions\n**Usage:** Check team depth before joining',
          inline: false,
        }
      );

      // ── ALL MANAGER COMMANDS ───────────────────────────────────────────────
      if (isManager) {
        const sectionTitle = staffRecord
          ? `👔 MANAGER COMMANDS (Your Team: ${staffRecord.name})`
          : '👔 MANAGER COMMANDS (Admin)';

        mainEmbed.addFields({ name: sectionTitle, value: '═══════════════════════════════════════', inline: false });

        mainEmbed.addFields(
          {
            name: '📋 `/contract @player`',
            value: '**Purpose:** Send contract offer to player\n**Requirements:** Transfer window OPEN\n**Roster:** Team must have space (Max: ' + constants.MAX_ROSTER_SIZE + ')\n**Cooldown:** 4 seconds between sends\n**Result:** DM sent to player | Posted to #signings',
            inline: false,
          },
          {
            name: '🚨 `/emergency-sign @player`',
            value: '**Purpose:** Sign player when transfer window is CLOSED\n**Limit:** ' + constants.MAX_EMERGENCY_SIGNS_PER_TEAM + ' per team per season\n**Roster:** Team must have space\n**Cooldown:** 4 seconds between sends\n**Result:** DM sent to player | Posted to #signings with emergency badge',
            inline: false,
          },
          {
            name: '🔍 `/scout [position] [message]`',
            value: '**Purpose:** Post wanted ad for specific player position\n**Positions:** GK, RB, LB, CB, CDM, CM, CAM, LW, RW, ST\n**Message:** Custom recruitment note\n**Result:** Posted to #scouting for free agents to see\n**Cooldown:** 4 seconds',
            inline: false,
          },
          {
            name: '❌ `/release @player`',
            value: '**Purpose:** Remove player from team\n**Effect:** Player becomes free agent immediately\n**Result:** Posted to #releases with team capacity\n**Note:** Player can reject team to become free agent instead',
            inline: false,
          },
          {
            name: '🎯 `/scrim @team [score]`',
            value: '**Purpose:** Log scrimmage results against another team\n**Score Format:** Team1-Team2 (e.g., 3-2)\n**Result:** Posted to #matches for record keeping\n**Cooldown:** 4 seconds',
            inline: false,
          },
          {
            name: '🏆 `/appoint [role] @user`',
            value: '**Purpose:** Assign manager or assistant manager\n**Roles:** manager, assistantManager\n**Requirement:** Staff role on team\n**Result:** Staff role assignment updated',
            inline: false,
          },
          {
            name: '⚽ `/match-inform [team1] [team2] [notes]`',
            value: '**Purpose:** Send a match notification to all players and staff of two teams\n**Permissions:** Referee, Chairman, Overseer\n**Result:** Polished match embed delivered to every player\'s DMs',
            inline: false,
          }
        );
      }

      // ── ADMIN COMMANDS ─────────────────────────────────────────────────────
      mainEmbed.addFields({ name: '🔧 ADMIN COMMANDS', value: '═══════════════════════════════════════', inline: false });

      mainEmbed.addFields(
        {
          name: '📢 `/announce [message]`',
          value: '**Purpose:** Broadcast important server announcements\n**Requirements:** Chairman / Overseer\n**Result:** Posted to #announcements',
          inline: false,
        },
        {
          name: '🪟 `/transfer-window [open/close]`',
          value: '**Purpose:** Toggle transfer window status\n**Effect:** Controls if teams can send contracts\n**CLOSED:** Can only use `/emergencysign` (limited)\n**OPEN:** Can use `/contract` freely',
          inline: false,
        },
        {
          name: '📋 `/update-teams`',
          value: '**Purpose:** Refresh the master teams embed in #teams\n**Requirements:** Chairman / Overseer\n**Result:** All 24 teams displayed with live roster counts',
          inline: false,
        }
      );

      // ── QUICK REFERENCE ────────────────────────────────────────────────────
      mainEmbed.addFields(
        {
          name: '📍 Available Positions',
          value: '`GK` `RB` `LB` `CB` `CDM` `CM` `CAM` `LW` `RW` `ST`',
          inline: false,
        },
        {
          name: '🕐 Key Constraints',
          value: '• **Roster Size:** ' + constants.MAX_ROSTER_SIZE + ' players max per team\n' +
            '• **Emergency Signings:** ' + constants.MAX_EMERGENCY_SIGNS_PER_TEAM + ' per season (window closed only)\n' +
            '• **Demands:** ' + constants.MAX_DEMANDS_PER_SEASON + ' per player per season\n' +
            '• **Rate Limits:** Prevents spam (2-4 second cooldowns)',
          inline: false,
        },
        {
          name: '⚠️ Important Rules',
          value: '✅ Players must be released before joining another team\n' +
            '✅ Transfer window affects contract availability\n' +
            '✅ All signings logged to #signings & #releases',
          inline: false,
        },
        {
          name: '💬 Need More Help?',
          value: 'Contact your server admins or team manager for clarification on specific rules or features.',
          inline: false,
        }
      );

      await interaction.editReply({ embeds: [mainEmbed], ephemeral: true });
    } catch (error) {
      console.error('❌ Error in /help:', error);
      return interaction.editReply({ content: '❌ An error occurred generating help.', ephemeral: true });
    }
  },
};