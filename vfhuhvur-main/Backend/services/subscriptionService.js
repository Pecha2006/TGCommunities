const { calculateNewExpiry, getCommunityDurationSeconds, toDate } = require('../utils/subscription');

const ensureDbClient = (db) => {
    if (!db || typeof db.query !== 'function') {
        throw new Error('Database client with query method is required');
    }
    return db;
};

const activateUserSubscription = async ({
    db,
    user,
    community,
    telegramUsername,
    telegramId,
    inviteLinkProvider
}) => {
    const client = ensureDbClient(db);

    if (!user || !user.id) {
        throw new Error('User record with valid id is required to activate subscription');
    }

    const durationSeconds = getCommunityDurationSeconds(community);
    const nextExpiry = calculateNewExpiry(toDate(user.expires), durationSeconds);

    let inviteLink = user.invite_link || null;

    if (inviteLinkProvider) {
        try {
            const inviteResult = await inviteLinkProvider();
            if (inviteResult && inviteResult.success && inviteResult.inviteLink) {
                inviteLink = inviteResult.inviteLink;
            }
        } catch (error) {
            console.error(`❌ Не вдалося створити запрошення для @${telegramUsername}:`, error.message);
        }
    }

    await client.query(
        `UPDATE users
         SET active = true,
             expires = $1,
             invite_link = $2,
             telegram_id = $3,
             expiry_warning_sent = false,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $4`,
        [nextExpiry, inviteLink, telegramId ? telegramId.toString() : null, user.id]
    );

    return {
        inviteLink,
        expiresAt: nextExpiry,
        durationSeconds
    };
};

const findActiveSubscription = async ({ db, community, telegramId }) => {
    const client = ensureDbClient(db);

    if (!telegramId) {
        return null;
    }

    const result = await client.query(
        `SELECT *
         FROM users
         WHERE community = $1
           AND telegram_id = $2
           AND active = true
           AND expires > NOW()
         ORDER BY expires DESC
         LIMIT 1`,
        [community, telegramId.toString()]
    );

    return result.rows[0] || null;
};

const findUserByInviteLink = async ({ db, inviteLink }) => {
    const client = ensureDbClient(db);

    if (!inviteLink) {
        return null;
    }

    const result = await client.query(
        `SELECT *
         FROM users
         WHERE invite_link = $1
         LIMIT 1`,
        [inviteLink]
    );

    return result.rows[0] || null;
};

module.exports = {
    activateUserSubscription,
    findActiveSubscription,
    findUserByInviteLink
};

