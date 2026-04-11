const { Events } = require('discord.js');
const noblox = require('noblox.js');
const axios = require('axios');

const DEFAULT_GROUP_ID = 151319009;
const DEFAULT_ROLE_ID_VERIFIED = '1480572500315209870';
const DEFAULT_RANK_ID_VERIFIED = 3;
const DEFAULT_ROLE_ID_UNVERIFIED = '1480574659459022890';
const DEFAULT_RANK_ID_UNVERIFIED = 2;

let robloxInitialized = false;

let promotionQueue = [];
let isProcessing = false;

async function processQueue() {
    if (isProcessing || promotionQueue.length === 0) return;
    isProcessing = true;

    while (promotionQueue.length > 0) {
        const task = promotionQueue.shift();
        const { config, newMember, robloxId, targetRank } = task;

        try {
            await noblox.setRank(config.groupId, Number.parseInt(String(robloxId), 10), targetRank);
            console.log(`[SUCCESS] Ranked ${newMember.user.tag} (RBX: ${robloxId}) to Rank ${targetRank}`);

            await new Promise(res => setTimeout(res, 10000));
        } catch (err) {
            if (err.response) {
                const errorData = err.response.data || {};
                console.error(`[ROVER ERROR] Code: ${errorData.errorCode || err.response.status}`);
                console.error(`[MESSAGE]: ${errorData.message || 'No message provided'}`);

                if (errorData.errorCode === 'user_not_found') {
                    console.log(`💡 User ${newMember.user.tag} is not in RoVer's database for this guild.`);
                }
            } else {
                console.error('[SYSTEM ERROR]', err.message);
            }
        }
    }

    isProcessing = false;
}

function parseIntEnv(name) {
    const raw = process.env[name];
    if (!raw) {
        return null;
    }

    const parsed = Number.parseInt(raw, 10);
    return Number.isNaN(parsed) ? null : parsed;
}

function parseRoleIdEnv(name, fallback) {
    const raw = process.env[name];
    if (!raw) {
        return fallback;
    }

    return String(raw).trim();
}

function getVerifierConfig() {
    return {
        robloxCookie: process.env.ROBLOX_COOKIE,
        roverApiKey: process.env.ROVER_API_KEY,
        groupId: parseIntEnv('GROUP_ID') || DEFAULT_GROUP_ID,
        roleIdVerified: parseRoleIdEnv('ROLE_ID_VERIFIED', DEFAULT_ROLE_ID_VERIFIED),
        roleIdUnverified: parseRoleIdEnv('ROLE_ID_UNVERIFIED', DEFAULT_ROLE_ID_UNVERIFIED),
        rankIdVerified: parseIntEnv('RANK_ID_VERIFIED') || DEFAULT_RANK_ID_VERIFIED,
        rankIdUnverified: parseIntEnv('RANK_ID_UNVERIFIED') || DEFAULT_RANK_ID_UNVERIFIED,
    };
}

function hasRequiredConfig(config) {
    return Boolean(
        config.robloxCookie
        && config.roverApiKey
        && config.groupId
        && config.roleIdVerified
        && config.roleIdUnverified
        && config.rankIdVerified
        && config.rankIdUnverified
    );
}

async function initRoblox(config) {
    if (robloxInitialized) {
        return;
    }

    await noblox.setCookie(config.robloxCookie);
    robloxInitialized = true;
    console.log('✅ Authenticated with Roblox');
}

async function fetchRobloxUserId(guildId, memberId, roverApiKey) {
    const apiUrl = `https://registry.rover.link/api/guilds/${guildId}/discord-to-roblox/${memberId}`;

    const response = await axios.get(apiUrl, {
        headers: {
            Authorization: `Bearer ${roverApiKey}`,
            Accept: 'application/json',
        },
    });

    return response.data?.robloxId;
}

function registerVerifierHandler(client) {
    const config = getVerifierConfig();

    if (!hasRequiredConfig(config)) {
        console.warn('⚠️ Verifier handler disabled: missing one or more verifier environment variables');
        return;
    }

    client.once(Events.ClientReady, async () => {
        try {
            await initRoblox(config);
        } catch (err) {
            console.error('❌ Roblox Auth Error:', err.message);
        }
    });

    client.on(Events.GuildMemberUpdate, async (oldMember, newMember) => {
        const gainedVerified = !oldMember.roles.cache.has(config.roleIdVerified) && newMember.roles.cache.has(config.roleIdVerified);
        const gainedUnverified = !oldMember.roles.cache.has(config.roleIdUnverified) && newMember.roles.cache.has(config.roleIdUnverified);

        if (!gainedVerified && !gainedUnverified) {
            return;
        }

        if (!robloxInitialized) {
            console.warn(`⚠️ Skipping rank sync for ${newMember.user.tag}: Roblox session is not initialized`);
            return;
        }

        try {
            const robloxId = await fetchRobloxUserId(newMember.guild.id, newMember.id, config.roverApiKey);

            if (!robloxId) {
                console.log(`[WARN] No robloxId found for ${newMember.user.tag}`);
                return;
            }

            const targetRank = gainedVerified ? config.rankIdVerified : config.rankIdUnverified;

            // Adiciona à fila em vez de processar imediatamente
            promotionQueue.push({ config, newMember, robloxId, targetRank });
            processQueue();

        } catch (err) {
            if (err.response) {
                const errorData = err.response.data || {};
                console.error(`[ROVER ERROR] Code: ${errorData.errorCode || err.response.status}`);
                console.error(`[MESSAGE]: ${errorData.message || 'No message provided'}`);

                if (errorData.errorCode === 'user_not_found') {
                    console.log(`💡 User ${newMember.user.tag} is not in RoVer's database for this guild.`);
                }
            } else {
                console.error('[SYSTEM ERROR]', err.message);
            }
        }
    });
}

module.exports = { registerVerifierHandler };