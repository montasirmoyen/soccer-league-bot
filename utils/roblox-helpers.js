const axios = require('axios');

const robloxHttp = axios.create({
    timeout: 10000,
    headers: {
        'x-api-key': process.env.ROBLOX_API_KEY,
        'Content-Type': 'application/json'
    }
});

const MAX_RATE_LIMIT_RETRIES = 5;
let rateLimitExpiresAt = 0;

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

robloxHttp.interceptors.request.use(async config => {
    const waitMs = rateLimitExpiresAt - Date.now();
    if (waitMs > 0) await sleep(waitMs);
    return config;
});

robloxHttp.interceptors.response.use(undefined, async error => {
    const config = error.config;
    if (error.response?.status !== 429 || !config) throw error;

    config.rateLimitRetryCount = config.rateLimitRetryCount || 0;
    if (config.rateLimitRetryCount >= MAX_RATE_LIMIT_RETRIES) throw error;
    config.rateLimitRetryCount++;

    const retryAfter = error.response.headers?.['retry-after'];
    const resetAt = error.response.headers?.['x-ratelimit-reset'];
    let waitMs = 1000 * (2 ** (config.rateLimitRetryCount - 1));

    if (retryAfter) {
        const retryAfterSeconds = Number(retryAfter);
        const retryAfterDate = Date.parse(retryAfter);
        waitMs = Number.isFinite(retryAfterSeconds)
            ? retryAfterSeconds * 1000
            : Number.isFinite(retryAfterDate)
                ? retryAfterDate - Date.now()
                : waitMs;
    } else if (resetAt && Number.isFinite(Number(resetAt))) {
        const resetValue = Number(resetAt);
        waitMs = resetValue > 1e12 ? resetValue - Date.now() : resetValue * 1000 - Date.now();
    }

    rateLimitExpiresAt = Math.max(rateLimitExpiresAt, Date.now() + Math.max(waitMs, 1000));
    await sleep(Math.max(rateLimitExpiresAt - Date.now(), 0));
    return robloxHttp(config);
});

async function getRobloxUserProfile(usernameOrUserId) {
    if (/^\d+$/.test(String(usernameOrUserId))) {
        const robloxUserId = String(usernameOrUserId);
        try {
            const response = await robloxHttp.get(
                `https://apis.roblox.com/cloud/v2/users/${encodeURIComponent(robloxUserId)}`
            );
            return { id: robloxUserId, ...response.data };
        } catch (error) {
            if (error.response?.status === 404) return null;
            throw error;
        }
    }

    const response = await robloxHttp.post('https://users.roblox.com/v1/usernames/users', {
        usernames: [usernameOrUserId]
    });

    return response.data.data[0] || null;
}

async function getGroupMembership(groupId, robloxUserId) {
    if (!groupId) {
        throw new Error('groupId is required to get group membership.');
    }

    const url = `https://apis.roblox.com/cloud/v2/groups/${groupId}/memberships`;
    const response = await robloxHttp.get(url, {
        params: { filter: `user=='users/${robloxUserId}'` }
    });

    const memberships = response.data.groupMemberships;
    return memberships?.[0] || null;
}

async function listGroupMemberships(groupId) {
    if (!groupId) {
        throw new Error('groupId is required to list group memberships.');
    }

    const url = `https://apis.roblox.com/cloud/v2/groups/${groupId}/memberships`;
    const memberships = [];
    const requestedPageTokens = new Set();
    let pageToken;

    do {
        const response = await robloxHttp.get(url, {
            params: {
                maxPageSize: 1000,
                ...(pageToken ? { pageToken } : {})
            }
        });
        memberships.push(...(response.data.groupMemberships || []));

        pageToken = response.data.nextPageToken || null;
        if (pageToken && requestedPageTokens.has(pageToken)) {
            throw new Error('Roblox group membership pagination returned a repeated page token.');
        }
        if (pageToken) requestedPageTokens.add(pageToken);
    } while (pageToken);

    return memberships;
}

async function getRobloxUserJoinRequest(groupId, robloxUserId) {
    if (!groupId || !robloxUserId) {
        throw new Error('groupId and robloxUserId are required to fetch a group join request.');
    }

    const url = `https://apis.roblox.com/cloud/v2/groups/${groupId}/join-requests`;

    try {
        const response = await robloxHttp.get(url, {
            params: {
                maxPageSize: 1,
                filter: `user == 'users/${robloxUserId}'`
            }
        });
        
        const requests = response.data.groupJoinRequests || [];
        if (requests.length > 0) {
            return {
                hasRequested: true,
                data: requests[0]
            };
        }

        return {
            hasRequested: false,
            data: null
        };

    } catch (error) {
        if (error.response && error.response.status === 404) {
            return {
                hasRequested: false,
                data: null
            };
        }

        throw new Error(`❌ Roblox API Error: ${error.response?.data?.message || error.message}`);
    }
}

async function updateGroupRoleset(groupId, membershipPath, targetRoleId, action) {
    if (!groupId) {
        throw new Error('groupId is required to update a group role.');
    }

    const allowedActions = ['assignRole', 'unassignRole'];
    if (!allowedActions.includes(action)) {
        throw new Error(`Invalid action. Must be one of: ${allowedActions.join(', ')}`);
    }

    const url = `https://apis.roblox.com/cloud/v2/${membershipPath}:${action}`;

    try {
        const response = await robloxHttp.post(url, {
            role: `groups/${groupId}/roles/${targetRoleId}`
        });

        return { success: true, data: response.data };
    } catch (error) {
        const status = error.response?.status;
        const message = error.response?.data?.message?.toLowerCase() || '';

        if (action === 'assignRole' && (status === 409 || message.includes('already'))) {
            return { success: true, alreadyOwned: true };
        }
        if (action === 'unassignRole' && (status === 404 || message.includes('not found'))) {
            return { success: true, notAssigned: true };
        }

        throw error;
    }
}

async function acceptJoinRequest(groupId, joinRequestId) {
    if (!groupId || !joinRequestId) {
        throw new Error('groupId and joinRequestId are required to update a group role.');
    }

    const url = `https://apis.roblox.com/cloud/v2/groups/${groupId}/join-requests/${joinRequestId}:accept`

    try {
        const response = await robloxHttp.post(url, {});

        return { success: true };
    } catch (error) {
        throw new Error(`❌ Roblox API Error: ${error.response?.data?.message || error.message}`);
    }
}

module.exports = {
    getRobloxUserProfile,
    getGroupMembership,
    listGroupMemberships,
    getRobloxUserJoinRequest,
    updateGroupRoleset,
    acceptJoinRequest
};