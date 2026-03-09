const express = require('express');

function startHealthServer() {
  const app = express();
  const port = process.env.PORT || 8080;

  app.get('/', (req, res) => res.send('Bot is online!'));
  app.listen(port, () => console.log(`Uptime server is running on port ${port}`));
}

module.exports = { startHealthServer };
