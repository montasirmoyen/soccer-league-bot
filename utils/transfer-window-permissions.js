const database = require('../db/database');

async function getTransferWindowContractState(teamName) {
  const config = await database.getTransferWindowConfig();
  const isDenied = config.transferWindowDeniedTeams.includes(teamName);

  return {
    isWindowOpen: config.transferWindowOpened,
    isAllowedWhileClosed: !isDenied && config.transferWindowAllowedTeams.includes(teamName),
    isDenied,
  };
}

module.exports = { getTransferWindowContractState };