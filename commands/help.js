const { SlashCommandBuilder } = require('discord.js');
const database = require('../db/database');
const constants = require('../config/constants');
const { buildPSLEmbed } = require('../utils/embedHelpers');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('help')
    .setDescription('Complete guide to all PSL commands and features'),

  async execute(interaction) {
    console.log(`\n❓ [help.js] Help command requested by ${interaction.user.tag}`);

    try {
      const userId = interaction.user.id;
      const staffRecord = await database.isUserStaffAnywhere(userId);
      const isManager = !!staffRecord;

      const mainEmbed = buildPSLEmbed(interaction.client, constants.DEFAULT_EMBED_COLOR)
        .setTitle('⚽ PSL COMPLETE COMMAND GUIDE')
        .setDescription('Pure Soccer League - All Commands & Instructions for Players & Managers')
        .setThumbnail(interaction.client.user.avatarURL());

      // ── ALL PLAYER COMMANDS ──────────────────────────────────
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

      // ── ALL MANAGER COMMANDS ─────────────────────────────────
      if (isManager) {
        mainEmbed.addFields({
          name: '👔 MANAGER COMMANDS (Your Team: ' + staffRecord.name + ')',
          value: '═══════════════════════════════════════',
          inline: false,
        });

        mainEmbed.addFields(
          {
            name: '📋 `/contract @player`',
            value: '**Purpose:** Send contract offer to player\n**Requirements:** Transfer window OPEN\n**Roster:** Team must have space (Max: ' + constants.MAX_ROSTER_SIZE + ')\n**Cooldown:** 4 seconds between sends\n**Result:** DM sent to player | Posted to #signings',
            inline: false,
          },
          {
            name: '🚨 `/emergencysign @player`',
            value: '**Purpose:** Sign player when transfer window is CLOSED\n**Limit:** ' + constants.MAX_EMERGENCY_SIGNS_PER_TEAM + ' per team per season\n**Roster:** Team must have space\n**Cooldown:** 4 seconds between sends\n**Result:** DM sent to player | Posted to #signings with emergency badge',
            inline: false,
          },
          {
            name: '🔍 `/scout [position] [message]`',
            value: '**Purpose:** Post wanted ad for specific player position\n**Positions:** GK, RB, LB, CB, CDM, CM, RM, LM, CAM, LW, RW, CF, ST\n**Message:** Custom recruitment note\n**Result:** Posted to #scouting for free agents to see\n**Cooldown:** 4 seconds',
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
          }
        );
      }

      // ── ADMIN COMMANDS ───────────────────────────────────────
      mainEmbed.addFields({
        name: '🔧 ADMIN COMMANDS',
        value: '═══════════════════════════════════════',
        inline: false,
      });

      mainEmbed.addFields(
        {
          name: '📢 `/announce [message]`',
          value: '**Purpose:** Broadcast important server announcements\n**Requirements:** Server admin role\n**Result:** Posted to #announcements',
          inline: false,
        },
        {
          name: '🪟 `/transferwindow [open/close]`',
          value: '**Purpose:** Toggle transfer window status\n**Effect:** Controls if teams can send contracts\n**CLOSED:** Can only use `/emergencysign` (limited)\n**OPEN:** Can use `/contract` freely',
          inline: false,
        }
      );

      // ── QUICK REFERENCE SECTION ──────────────────────────────
      mainEmbed.addFields(
        {
          name: '📍 Available Positions',
          value: '`GK` `RB` `LB` `CB` `CDM` `CM` `RM` `LM` `CAM` `LW` `RW` `CF` `ST`',
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
                  '✅ Staff cannot register as players\n' +
                  '✅ Transfer window affects contract availability\n' +
                  '✅ Free agents posted automatically to #transfer-market\n' +
                  '✅ All signings logged to #signings & #releases',
          inline: false,
        },
        {
          name: '💬 Need More Help?',
          value: 'Contact your server admins or team manager for clarification on specific rules or features.',
          inline: false,
        }
      );

      await interaction.reply({ embeds: [mainEmbed], ephemeral: true });
    } catch (error) {
      console.error('❌ Error in /help:', error);
      return interaction.reply({ content: '❌ An error occurred generating help.', ephemeral: true });
    }
  },
};