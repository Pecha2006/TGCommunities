const { getCommunityDurationSeconds } = require('../config/communities');

const toDate = (value) => {
    if (!value) {
        return null;
    }

    if (value instanceof Date) {
        return value;
    }

    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const calculateNewExpiry = (currentExpiry, durationSeconds) => {
    const now = new Date();
    const current = toDate(currentExpiry);
    const base = current && current > now ? current : now;

    return new Date(base.getTime() + durationSeconds * 1000);
};

const isSubscriptionActive = (expires) => {
    const expiryDate = toDate(expires);
    return Boolean(expiryDate && expiryDate.getTime() > Date.now());
};

module.exports = {
    getCommunityDurationSeconds,
    calculateNewExpiry,
    isSubscriptionActive,
    toDate
};

