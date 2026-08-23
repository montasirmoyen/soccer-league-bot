const mongoose = require('mongoose');
const Contract = require('./models/player-contract');
const Team = require('./models/team');
const Configuration = require('./models/configuration');
const PlayerHistory = require('./models/player-history');
const configTeams = require('../config/teams');
const { logError } = require('../utils/error-handler');

async function connectMongo() {
  await mongoose.connect(process.env.MONGODB_URI);
}

module.exports = {
  connectMongo,

  // ── Contracts ─────────────────────────────────────────────────────────────

  getContractedTeam: (userId) => Contract.findOne({ userId }).exec(),

  getPlayerSigningsCount: async (userId) => {
    const history = await PlayerHistory.findOne({ userId }).exec();
    return history ? history.signingsUsed : 0;
  },

  contractPlayer: async (userId, teamName, countSigning = true) => {
    if (countSigning) {
      await PlayerHistory.findOneAndUpdate(
        { userId },
        {
          $inc: { signingsUsed: 1 },
          $setOnInsert: { userId }
        },
        { new: true, upsert: true }
      ).exec();
    }

    const newContract = new Contract({ userId, teamName });
    return newContract.save();
  },

  releasePlayer: (userId) => Contract.deleteOne({ userId }),

  getPlayersByTeam: (teamName) => Contract.find({ teamName }).exec(),

  getAllContracts: () => Contract.find({}).exec(),

  // ── Teams ──────────────────────────────────────────────────────────────────

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

  incrementTeamRelease: (teamName) =>
    Team.findOneAndUpdate(
      { name: teamName.toUpperCase() },
      { $inc: { releasesUsed: 1 } },
      { new: true }
    ),

  getAllTeams: () => Team.find({}).sort({ name: 1 }).exec(),

  // ── League Configuration ────────────────────────────────────────────────────────

  getTransferWindowState: async () => {
    let config = await Configuration.findOne({ key: 'global' });
    if (!config) {
      config = new Configuration({ key: 'global', transferWindowOpened: false });
      await config.save();
    }
    return config.transferWindowOpened;
  },

  setTransferWindowState: (isOpen) =>
    Configuration.findOneAndUpdate(
      { key: 'global' },
      { $set: { transferWindowOpened: isOpen } },
      { new: true, upsert: true }
    ),

  getLeagueState: async () => {
    let config = await Configuration.findOne({ key: 'global' });
    if (!config) {
      config = new Configuration({ key: 'global', leagueStarted: true });
      await config.save();
    }
    return config.leagueStarted;
  },

  setLeagueState: (isStarted) =>
    Configuration.findOneAndUpdate(
      { key: 'global' },
      { $set: { leagueStarted: isStarted } },
      { new: true, upsert: true }
    ),

  // ── Seed ───────────────────────────────────────────────────────────────────

  seedTeamsIfNeeded: async () => {
    try {
      const count = await Team.countDocuments();
      if (count > 0) {
        console.log(`ℹ️  [Seed] ${count} teams already seeded. Skipping.`);
        return;
      }

      console.log(`🌱 [Seed] Empty database. Seeding ${Object.keys(configTeams.teams).length} teams...`);

      const teamsToCreate = Object.entries(configTeams.teams).map(([teamName, teamData]) => ({
        name: teamName,
        roleId: teamData.ROLE_ID,
        manager: null,
        assistantManager: null,
        emergencySignsUsed: 0,
      }));

      await Team.insertMany(teamsToCreate);
      console.log(`✅ [Seed] All ${Object.keys(configTeams.teams).length} teams registered.`);
    } catch (error) {
      logError(error, null, { context: 'DB_SEEDING' });
    }
  },
};