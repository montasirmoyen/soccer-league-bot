const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const {
	SCRIM_HOSTER_ROLE_ID,
	STAFF_ROLE_ID,
	SCRIM_PING_ROLE_ID,
	SCRIM_CHANNEL_ID,
} = require('../config/constants');

const cooldowns = new Map();
const COOLDOWN_TIME = 60 * 60 * 1000;

module.exports = {
	data: new SlashCommandBuilder()
		.setName('scrim')
		.setDescription('Announce that you are hosting a scrim')
		.addStringOption((option) =>
			option
				.setName('name')
				.setDescription('What is the name of the server? Type :sinfo in-game to find it.')
				.setRequired(true)
		)
		.addStringOption((option) =>
			option
				.setName('region')
				.setDescription('What is the region of the server? Type :sinfo in-game to find it.')
				.setRequired(true)
		)
		.addStringOption((option) =>
			option
				.setName('code')
				.setDescription('OPTIONAL: Is there a code to enter the server?')
				.setRequired(false)
		)
		.addAttachmentOption((option) =>
			option
				.setName('sinfo')
				.setDescription('OPTIONAL: Screenshot of server info gui.')
				.setRequired(false)
		),

	async execute(interaction) {
		const userId = interaction.user.id;
		const member = interaction.guild.members.cache.get(userId);

		if (
			!member ||
			(!member.roles.cache.has(SCRIM_HOSTER_ROLE_ID) && !member.roles.cache.has(STAFF_ROLE_ID))
		) {
			return interaction.reply({
				content: '❌ You do not have permission to use this command.',
				ephemeral: true,
			});
		}

		const now = Date.now();
		if (cooldowns.has(userId)) {
			const expirationTime = cooldowns.get(userId) + COOLDOWN_TIME;
			if (now < expirationTime) {
				const timeLeft = Math.ceil((expirationTime - now) / 1000);
				return interaction.reply({
					content: `⏳ Please wait ${timeLeft} more second(s) before using this command again.`,
					ephemeral: true,
				});
			}
		}

		const user = interaction.user;
		const serverName = interaction.options.getString('name');
		const serverRegion = interaction.options.getString('region');
		const serverCode = interaction.options.getString('code');
		const sinfoImage = interaction.options.getAttachment('sinfo');

		cooldowns.set(userId, now);

		const displayName = member.displayName || user.username;
		const pingString = `<@${userId}> <@&${SCRIM_PING_ROLE_ID}>`;

		const embed = new EmbedBuilder()
			.setAuthor({
				name: displayName,
				iconURL: user.displayAvatarURL({ extension: 'png', size: 128 }),
			})
			.setTitle('\ud83c\udfae Scrim Hosted')
			.setColor(0x3af3e3)
			.addFields(
				{ name: '\ud83d\udda5\ufe0f Server Name', value: serverName, inline: true },
				{ name: '\ud83c\udf0d Region', value: serverRegion, inline: true },
				...(serverCode ? [{ name: '\ud83d\udd11 Code', value: serverCode, inline: true }] : [{ name: '\u200b', value: '\u200b', inline: true }]),
				{
					name: '\ud83d\udd17 Join',
					value: '[Click here to join Pure Soccer!](https://www.roblox.com/games/88920112778598/Pure-Soccer)',
					inline: false,
				},
				{
					name: '\ud83d\udd15 Opt Out',
					value: 'To stop receiving pings, remove your role [here](https://discord.com/channels/1384782138725105715/1391925457074524222).',
					inline: false,
				}
			)
			.setFooter({
				text: 'PSL \u00b7 Pure Soccer League',
				iconURL:
					'https://cdn.discordapp.com/attachments/1455665134902051051/1455665224966209617/PS_LOGO_WHITE.webp?ex=69558d62&is=69543be2&hm=a4211aece09f511a0ee5a976a108664ad0ccb471073d2de517c47c6bd841659b&',
			})
			.setTimestamp();

		if (sinfoImage) {
			embed.setImage(sinfoImage.url);
		}

		try {
			const channel = await interaction.client.channels.fetch(SCRIM_CHANNEL_ID);
			await channel.send({ content: pingString, embeds: [embed] });
			await interaction.reply({ content: '✅ Your scrim announcement has been sent!', ephemeral: true });
		} catch (error) {
			console.error('Error sending scrim message:', error);
			cooldowns.delete(userId);
			await interaction.reply({ content: '⚠️ Failed to send scrim announcement.', ephemeral: true });
		}
	},
};
