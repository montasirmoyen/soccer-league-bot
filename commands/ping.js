const { SlashCommandBuilder, MessageFlags } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('ping')
        .setDescription('View the bot latency metrics'),
    
    async execute(interaction) {
        const wsPing = interaction.client.ws.ping;

        const sent = await interaction.editReply({ 
            content: 'Pinging...', 
            withResponse: true,
            flags: MessageFlags.Ephemeral
        });

        const roundtripLatency = sent.createdTimestamp - interaction.createdTimestamp;

        await interaction.editReply(
            `🏓 Pong!\n` +
            `• **API Latency (Websocket):** ${wsPing}ms\n` +
            `• **Roundtrip Latency:** ${roundtripLatency}ms`
        );
    },
};