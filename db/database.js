const mongoose = require('mongoose');
const Contract = require('./models/player-contract');
const Team = require('./models/team');
const Configuration = require('./models/configuration');
const PlayerHistory = require('./models/player-history');
const configTeams = require('../config/teams');
const constants = require('../config/constants')
const { logError } = require('../utils/error-handler');

async function connectMongo() {
  await mongoose.connect(constants.MONGODB_URI);
}

module.exports = {
  connectMongo,

  // ── Contracts ─────────────────────────────────────────────────────────────

  getContractedTeam: (userId) => Contract.findOne({ userId }).exec(),

  getIndividualContractsCount: async (userId) => {
    const history = await PlayerHistory.findOne({ userId }).exec();
    return history ? history.contractsUsed : 0;
  },

  setIndividualContractsCount: (userId, newValue) =>
    PlayerHistory.findOneAndUpdate(
      { userId },
      { $set: { contractsUsed: newValue } },
      { new: true, upsert: true }
    ),

  contractPlayer: async (userId, teamName, countContract = true) => {
    if (countContract) {
      await PlayerHistory.findOneAndUpdate(
        { userId },
        {
          $inc: { contractsUsed: 1 },
          $setOnInsert: { userId }
        },
        { new: true, upsert: true }
      ).exec();
    }

    const newContract = new Contract({ userId, teamName: teamName.toUpperCase() });
    return newContract.save();
  },

  releasePlayer: (userId) => Contract.deleteOne({ userId }),

  getPlayersByTeam: (teamName) => Contract.find({ teamName: teamName.toUpperCase() }).exec(),

  getAllContracts: () => Contract.find({}).exec(),

  // ── Teams ──────────────────────────────────────────────────────────────────

  getTeamInfo: (teamName) =>
    Team.findOne({ name: teamName.toUpperCase() }).exec(),

  getTeamStaff: (teamName, roleType) =>
    Team.findOne({ name: teamName.toUpperCase() }, { [roleType]: 1 }).exec(),

  isUserStaffAnywhere: (userId) =>
    Team.findOne({ $or: [{ manager: userId }, { assistantManager: userId }] }).exec(),

  disbandTeam: async (teamName) => {
    await Contract.deleteMany({ teamName: teamName.toUpperCase() }).exec();
    return Team.findOneAndUpdate(
      { name: teamName.toUpperCase() },
      { $set: { manager: null, assistantManager: null } },
      { new: true }
    );
  },

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

  getTeamEmergencyContractsCount: async (teamName) => {
    const team = await Team.findOne({ name: teamName.toUpperCase() }).exec();
    return team ? team.emergencyContractsUsed : 0;
  },

  incrementEmergencyContract: (teamName) =>
    Team.findOneAndUpdate(
      { name: teamName.toUpperCase() },
      { $inc: { emergencyContractsUsed: 1 } },
      { new: true }
    ),

  setEmergencyContractsCount: (teamName, newValue) =>
    Team.findOneAndUpdate(
      { name: teamName.toUpperCase() },
      { $set: { emergencyContractsUsed: newValue } },
      { new: true }
    ),

  getAllTeams: () => Team.find({}).sort({ name: 1 }).exec(),

  // ── Player History ─────────────────────────────────────────────────────────

  getPlayerDemandsCount: async (userId) => {
    const history = await PlayerHistory.findOne({ userId }).exec();
    return history ? history.demandsUsed : 0;
  },

  getPendingDemand: async (userId) => {
    const history = await PlayerHistory.findOne({ userId }, { pendingDemand: 1 }).exec();
    return history?.pendingDemand || null;
  },

  createPendingDemand: async (userId, teamName, reason) => {
    try {
      return await PlayerHistory.findOneAndUpdate(
        {
          userId,
          $or: [
            { pendingDemand: { $exists: false } },
            { pendingDemand: null }
          ]
        },
        {
          $set: {
            pendingDemand: {
              teamName: teamName.toUpperCase(),
              reason,
              status: 'pending',
              requestedAt: new Date()
            }
          },
          $setOnInsert: { userId }
        },
        { new: true, upsert: true }
      ).exec();
    } catch (error) {
      if (error.code === 11000 && (error.keyPattern?.userId || error.keyValue?.userId)) {
        return null;
      }
      throw error;
    }
  },

  claimPendingDemand: (userId, teamName) =>
    PlayerHistory.findOneAndUpdate(
      {
        userId,
        'pendingDemand.teamName': teamName.toUpperCase(),
        'pendingDemand.status': 'pending'
      },
      { $set: { 'pendingDemand.status': 'processing' } },
      { new: true }
    ).exec(),

  clearPendingDemand: (userId, teamName) =>
    PlayerHistory.findOneAndUpdate(
      {
        userId,
        ...(teamName ? { 'pendingDemand.teamName': teamName.toUpperCase() } : {})
      },
      { $unset: { pendingDemand: 1 } },
      { new: true }
    ).exec(),

  restorePendingDemand: (userId, teamName) =>
    PlayerHistory.findOneAndUpdate(
      {
        userId,
        'pendingDemand.teamName': teamName.toUpperCase(),
        'pendingDemand.status': 'processing'
      },
      { $set: { 'pendingDemand.status': 'pending' } },
      { new: true }
    ).exec(),

  acceptPendingDemand: (userId, teamName) =>
    PlayerHistory.findOneAndUpdate(
      {
        userId,
        'pendingDemand.teamName': teamName.toUpperCase(),
        'pendingDemand.status': 'processing'
      },
      {
        $inc: { demandsUsed: 1 },
        $unset: { pendingDemand: 1 }
      },
      { new: true }
    ).exec(),

  incrementPlayerDemand: (userId) =>
    PlayerHistory.findOneAndUpdate(
      { userId },
      { $inc: { demandsUsed: 1 } },
      { new: true, upsert: true }
    ),

  setPlayerDemandsCount: (userId, newValue) =>
    PlayerHistory.findOneAndUpdate(
      { userId },
      { $set: { demandsUsed: newValue } },
      { new: true, upsert: true }
    ),

  getPlayerRestrictedActions: async (userId) => {
    const history = await PlayerHistory.findOne({ userId }).exec();
    return history ? history.restrictedActions || [] : [];
  },

  restrictPlayerAction: (userId, action) =>
    PlayerHistory.findOneAndUpdate(
      { userId },
      { $addToSet: { restrictedActions: action } },
      { new: true, upsert: true }
    ),

  unrestrictPlayerAction: (userId, action) =>
    PlayerHistory.findOneAndUpdate(
      { userId },
      { $pull: { restrictedActions: action } },
      { new: true, upsert: true }
    ),

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

  getTransferWindowConfig: async () => {
    let config = await Configuration.findOne({ key: 'global' });
    if (!config) {
      config = new Configuration({ key: 'global' });
      await config.save();
    }
    return config;
  },

  addTransferWindowAllowedTeam: (teamName) =>
    Configuration.findOneAndUpdate(
      { key: 'global' },
      { $addToSet: { transferWindowAllowedTeams: teamName } },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    ),

  removeTransferWindowAllowedTeam: (teamName) =>
    Configuration.findOneAndUpdate(
      { key: 'global' },
      { $pull: { transferWindowAllowedTeams: teamName } },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    ),

  addTransferWindowDeniedTeam: (teamName) =>
    Configuration.findOneAndUpdate(
      { key: 'global' },
      { $addToSet: { transferWindowDeniedTeams: teamName } },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    ),

  removeTransferWindowDeniedTeam: (teamName) =>
    Configuration.findOneAndUpdate(
      { key: 'global' },
      { $pull: { transferWindowDeniedTeams: teamName } },
      { new: true, upsert: true, setDefaultsOnInsert: true }
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
        emergencyContractsUsed: 0,
      }));

      await Team.insertMany(teamsToCreate);
      console.log(`✅ [Seed] All ${Object.keys(configTeams.teams).length} teams registered.`);
    } catch (error) {
      logError(error, null, { context: 'DB_SEEDING' });
    }
  },
};