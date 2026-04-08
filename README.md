# soccer-league-bot

An efficient yet lightweight Discord bot to manage your virtual soccer leagues.

## What you'll need to deploy your own:
- A Discord account to create an application and a bot associated with it
    - https://discord.com/
    - https://discord.com/developers/applications
- A MongoDB account to create a cluster and connect a driver to it
    - https://www.mongodb.com/
- Connect to a Discord bot called "RoVer" for role bindings/management and to get their API
    - https://rover.link/
    - https://rover.link/guilds/[guild/server-id]/api
- An alternate account on Roblox to automate role control within groups, and the alternate account's cookie
    - https://www.roblox.com/home
    - [How to get the ALT's cookie?](https://devforum.roblox.com/t/about-the-roblosecurity-cookie/2305393)
- A bot hosting service
    - [Would recommend you to try Railway, great interface and performance at just $5/month](https://railway.com/)
    - Or just have a laptop running 24/7 in your basement lol

#### .env file format:
```
TOKEN=<discord-bot-token>
CLIENT_ID=<discord-app/client-id>
MONGODB_URI=<clusters-connection-uri>
ROBLOX_COOKIE=<alt-account-cookie>
ROVER_API_KEY=<rover-api-key>
```