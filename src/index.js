require('dotenv').config();

const { Client, Collection, GatewayIntentBits, ActivityType } = require('discord.js');
const { connectMongo } = require('./db/connect');
const { loadCommands } = require('./bot/loadCommands');
const { registerCommands } = require('./bot/registerCommands');
const { registerInteractionHandler } = require('./handlers/interactionHandler');
const { startHealthServer } = require('./web/healthServer');

const emojiMap = {};

async function bootstrap() {
  const client = new Client({ intents: [GatewayIntentBits.Guilds] });
  client.commands = new Collection();

  startHealthServer();

  await connectMongo();
  console.log('✅ Connected to MongoDB');

  const commands = loadCommands(client);
  await registerCommands(commands);

  client.once('ready', () => {
    console.log(`Logged in as ${client.user.tag}!`);
    client.user.setPresence({
      status: 'dnd',
      activities: [
        {
          name: '/help',
          type: ActivityType.Listening,
        },
      ],
    });
    console.log('Bot status set to DND with /help activity');
  });

  registerInteractionHandler(client, emojiMap);

  await client.login(process.env.TOKEN);
}

bootstrap().catch((err) => {
  console.error('❌ Startup failed:', err);
  process.exit(1);
});
