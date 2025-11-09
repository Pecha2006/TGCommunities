const DEFAULT_DURATION_SECONDS = parseInt(process.env.SUBSCRIPTION_DEFAULT_DURATION_SECONDS || '', 10);

const normalizeDuration = (value, fallback) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const fallbackDurationSeconds = normalizeDuration(
    DEFAULT_DURATION_SECONDS,
    2 * 60 // 2 minutes for testing
);

const COMMUNITY_DISPLAY_NAMES = {
    nikotin:'Вільні від нікотину',
    food: 'Вільні від їжі',
    social: 'Вільні від думки інших'
};

const COMMUNITY_PRICES = {
    nikotin: 800,
    food: 600,
    social: 600
};

const COMMUNITY_DURATIONS = {
    nikotin: normalizeDuration(process.env.SUBSCRIPTION_DURATION_NIKOTIN_SECONDS, fallbackDurationSeconds),
    food: normalizeDuration(process.env.SUBSCRIPTION_DURATION_FOOD_SECONDS, fallbackDurationSeconds),
    social: normalizeDuration(process.env.SUBSCRIPTION_DURATION_SOCIAL_SECONDS, fallbackDurationSeconds),
    default: fallbackDurationSeconds
};

const GROUP_IDS = {
    nikotin: process.env.NIKOTIN_GROUP_ID,
    food: process.env.FOOD_GROUP_ID,
    social: process.env.SOCIAL_GROUP_ID
};

const getCommunityDurationSeconds = (community) => {
    return COMMUNITY_DURATIONS[community] || COMMUNITY_DURATIONS.default;
};

module.exports = {
    GROUP_IDS,
    COMMUNITY_DISPLAY_NAMES,
    COMMUNITY_PRICES,
    COMMUNITY_DURATIONS,
    getCommunityDurationSeconds
};

