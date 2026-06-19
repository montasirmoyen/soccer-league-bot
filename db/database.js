const Contract = require('./models/Contract');
const Team = require('./models/Team');
const Config = require('./models/Config');
const PlayerHistory = require('./models/PlayerHistory');
const configTeams = require('../config/teams');

module.exports = {
  // ── Contracts ─────────────────────────────────────────────

  getContractedTeam: (userId) => Contract.findOne({ userId }).exec(),

  contractPlayer: async (userId, teamName, emoji) => {
    const newContract = new Contract({ userId, teamName, emoji });
    return newContract.save();
  },

  releasePlayer: (userId) => Contract.deleteOne({ userId }),

  getPlayersByTeam: (teamName) => Contract.find({ teamName }).exec(),

  // ── Teams ──────────────────────────────────────────────────

  getTeamInfo: (teamName) =>
    Team.findOne({ name: teamName.toUpperCase() }).exec(),

  getTeamStaff: (teamName, roleType) =>
    Team.findOne({ name: teamName.toUpperCase() }, { [roleType]: 1 }).exec(),
  
  isUserStaffAnywhere: (userId) =>
    Team.findOne({ $or: [{ manager: userId }, { assistantManager: userId }] }).exec(),

  appointStaff: (teamName, userId, roleType) => {
    const update = roleType === 'manager'
      ? { manager: userId }
      : { assistantManager: userId };

    return Team.findOneAndUpdate(
      { name: teamName.toUpperCase() },
      { $set: update },
      { new: true }
    );
  },

  incrementEmergencySign: (teamName) =>
    Team.findOneAndUpdate(
      { name: teamName.toUpperCase() },
      { $inc: { emergencySignsUsed: 1 } },
      { new: true }
    ),

  // ── Transfer Window ────────────────────────────────────────

  getTransferWindowState: async () => {
    let config = await Config.findOne({ key: 'global' });
    if (!config) {
      config = new Config({ key: 'global', transferWindowOpened: false });
      await config.save();
    }
    return config.transferWindowOpened;
  },

  setTransferWindowState: (isOpen) =>
    Config.findOneAndUpdate(
      { key: 'global' },
      { $set: { transferWindowOpened: isOpen } },
      { new: true, upsert: true }
    ),

  // ── Player History ─────────────────────────────────────────

  getPlayerDemandsCount: async (userId) => {
    const history = await PlayerHistory.findOne({ userId }).exec();
    return history ? history.demandsUsed : 0;
  },

  incrementPlayerDemand: (userId) =>
    PlayerHistory.findOneAndUpdate(
      { userId },
      { $inc: { demandsUsed: 1 } },
      { new: true, upsert: true }
    ),

  // ── Seed ───────────────────────────────────────────────────

  seedTeamsIfNeeded: async () => {
    try {
      const count = await Team.countDocuments();
      if (count > 0) {
        console.log(`ℹ️  [Seed] ${count} teams already seeded. Skipping.`);
        return;
      }

      console.log('🌱 [Seed] Empty database. Seeding 24 national teams...');

      const teamsToCreate = Object.entries(configTeams.teams).map(([teamName, teamData]) => ({
        name: teamName,
        roleId: teamData.ROLE_ID,
        manager: null,
        assistantManager: null,
        emergencySignsUsed: 0,
      }));

      await Team.insertMany(teamsToCreate);
      console.log('✅ [Seed] All 24 national teams registered.');
    } catch (error) {
      console.error('❌ [Seed] Error seeding database:', error);
    }
  },
};