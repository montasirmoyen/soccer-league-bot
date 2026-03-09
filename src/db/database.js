const Contract = require('./models/Contract');

module.exports = {
  getContractedTeam: async (userId) => {
    return Contract.findOne({ userId }).exec();
  },

  contractPlayer: async (userId, teamName, emoji) => {
    const newContract = new Contract({ userId, teamName, emoji });
    await newContract.save();
    return newContract;
  },

  releasePlayer: async (userId) => {
    return Contract.deleteOne({ userId });
  },

  getPlayersByTeam: async (teamName) => {
    return Contract.find({ teamName }).exec();
  },
};
