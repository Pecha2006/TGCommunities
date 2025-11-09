const TelegramBot = require('node-telegram-bot-api');
const { Pool } = require('pg');
require('dotenv').config();

const { GROUP_IDS, COMMUNITY_DISPLAY_NAMES, COMMUNITY_PRICES } = require('./config/communities');
const { activateUserSubscription, findActiveSubscription } = require('./services/subscriptionService');
const { isSubscriptionActive, toDate } = require('./utils/subscription');

// Токен бота отриманий від @BotFather
const token = process.env.TELEGRAM_BOT_TOKEN;

// Перевірка токена
if (!token) {
    console.log('❌ Токен бота не знайдено! Перевірте .env файл');
    process.exit(1);
}

// Підключення до PostgreSQL
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Створюємо екземпляр бота
const bot = new TelegramBot(token, { 
    polling: {
        interval: 300,
        autoStart: false
    }
});

const COMMUNITY_BY_GROUP_ID = Object.entries(GROUP_IDS).reduce((acc, [community, groupId]) => {
    if (groupId) {
        acc[groupId.toString()] = community;
    }
    return acc;
}, {});

const getCommunityName = (community) => COMMUNITY_DISPLAY_NAMES[community] || community;

const getUserMention = (from) => {
    if (!from) {
        return 'друже';
    }
    if (from.username) {
        return `@${from.username}`;
    }
    if (from.first_name) {
        return from.first_name;
    }
    return 'друже';
};

const getBaseUrl = () => process.env.BASE_URL || 'http://localhost:3000';

const welcomeUserToCommunity = async ({ chatId, from, community }) => {
    const communityName = getCommunityName(community);
    const mention = getUserMention(from);
    const message =
        `Ласкаво просимо, ${mention}!
\n` +
        `Раді бачити вас у спільноті "${communityName}".
` +
        `Не соромтесь ділитись своїм досвідом та підтримувати інших!`;

    try {
        await bot.sendMessage(chatId, message);
    } catch (error) {
        console.error('❌ Не вдалося надіслати вітальне повідомлення:', error.message);
    }
};

const notifyUserRemoval = async ({ telegramId, community }) => {
    if (!telegramId) {
        return;
    }

    const communityName = getCommunityName(community);
    const message =
        `⚠️ Ваш доступ до "${communityName}" завершився.
\n` +
        `Вас тимчасово видалено з групи.
\n` +
        `Продовжіть підписку, щоб повернутися: ${getBaseUrl()}
\n` +
        `Після оплати введіть /start у боті, щоб отримати нове запрошення.`;

    try {
        await bot.sendMessage(telegramId, message);
    } catch (error) {
        console.error(`❌ Не вдалося повідомити користувача ${telegramId} про видалення:`, error.message);
    }
};

// Функція для перевірки прав бота в групах
async function checkBotPermissions() {
    console.log('🔍 Перевірка прав бота в групах...');
    
    const botInfo = await bot.getMe();
    console.log(`🤖 Бот: @${botInfo.username}`);
    
    for (const [community, groupId] of Object.entries(GROUP_IDS)) {
        if (!groupId) {
            console.error(`❌ Не вказано ID групи для спільноти ${community}`);
            continue;
        }
        
        try {
            const chatMember = await bot.getChatMember(groupId, botInfo.id);
            const chat = await bot.getChat(groupId);
            
            console.log(`📍 ${COMMUNITY_DISPLAY_NAMES[community]}:`);
            console.log(`   Назва: ${chat.title}`);
            console.log(`   Статус бота: ${chatMember.status}`);
            console.log(`   ID групи: ${groupId}`);
            
            if (chatMember.status !== 'administrator') {
                console.error(`   ❌ Бот не є адміністратором!`);
            } else {
                console.log(`   ✅ Бот є адміністратором`);
            }
            
        } catch (error) {
            console.error(`❌ Помилка перевірки групи ${community}:`, error.message);
            console.log(`   ID групи: ${groupId}`);
        }
    }
}

// Основна функція для створення запрошення
async function createInviteLink(username, community) {
    try {
        console.log(`🔔 Створення запрошення для @${username} до спільноти ${community}`);

        const groupId = GROUP_IDS[community];
        if (!groupId) {
            console.error(`❌ Не знайдено ID групи для спільноти ${community}`);
            return {
                success: false,
                error: `Не знайдено ID групи для спільноти ${community}`
            };
        }

        console.log(`🔄 Створення одноразового посилання для групи ${groupId}...`);
        
        // Перевірка чи бот має доступ до групи
        try {
            await bot.getChat(groupId);
        } catch (error) {
            console.error(`❌ Бот не має доступу до групи ${community}:`, error.message);
            return {
                success: false,
                error: `Бот не має доступу до групи ${community}. Перевірте права адміністратора.`
            };
        }

        // Створення одноразового посилання
        const inviteLink = await bot.createChatInviteLink(groupId, {
            expire_date: Math.floor(Date.now() / 1000) + 86400, // 24 години
            creates_join_request: true
        });

        console.log(`✅ Одноразове посилання створено: ${inviteLink.invite_link}`);

        return {
            success: true,
            inviteLink: inviteLink.invite_link,
            message: 'Одноразове посилання створено успішно'
        };

    } catch (error) {
        console.error(`❌ Помилка створення запрошення для ${community}:`, error.message);
        
        if (error.response && error.response.statusCode === 403) {
            console.error(`🔒 Бот не має прав адміністратора в групі ${community}`);
            return {
                success: false,
                error: `Бот не має прав адміністратора в групі ${community}. Перевірте налаштування групи.`
            };
        }
        
        return {
            success: false,
            error: error.message
        };
    }
}

// Обробка команди /start
bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    const username = msg.from.username;
    const userId = msg.from.id;

    console.log(`🔔 Користувач @${username} (ID: ${userId}) запустив бота`);

    if (!username) {
        await bot.sendMessage(chatId,
            '❌ У вас не встановлено username в Telegram.\n\n' +
            'Будь ласка, додайте username в налаштуваннях Telegram та спробуйте знову.'
        );
        return;
    }

    try {
        // Шукаємо активні підписки користувача
        const result = await pool.query(
            `SELECT DISTINCT ON (u.community)
                u.*,
                (
                    SELECT p.status
                    FROM payments p
                    WHERE p.user_id = u.id
                    ORDER BY p.date DESC, p.id DESC
                    LIMIT 1
                ) AS payment_status
             FROM users u
             WHERE (u.telegram_username = $1 OR u.telegram_id = $2)
               AND u.active = true
               AND u.expires IS NOT NULL
               AND u.expires > NOW()
               AND EXISTS (
                    SELECT 1 FROM payments p
                    WHERE p.user_id = u.id AND p.status = 'completed'
               )
             ORDER BY u.community, u.expires DESC`,
            [username.toLowerCase(), userId.toString()]
        );

        if (result.rows.length > 0) {
            let message = `🎉 Вітаємо, @${username}!\n\n`;
            message += `📋 Ваші активні підписки:\n\n`;

            for (const user of result.rows) {
                const communityName = COMMUNITY_DISPLAY_NAMES[user.community] || user.community;
                
                if (user.invite_link) {
                    message += `✅ ${communityName}\n`;
                    message += `🔗 Запрошення: ${user.invite_link}\n\n`;
                } else {
                    // Якщо посилання немає, створюємо нове
                    const inviteResult = await createInviteLink(username, user.community);
                    if (inviteResult.success) {
                        // Оновлюємо запис в БД
                        await pool.query(
                            'UPDATE users SET invite_link = $1 WHERE id = $2',
                            [inviteResult.inviteLink, user.id]
                        );
                        message += `✅ ${communityName}\n`;
                        message += `🔗 Запрошення: ${inviteResult.inviteLink}\n\n`;
                    } else {
                        message += `⚠️ ${communityName} - ${inviteResult.error}\n\n`;
                    }
                }
            }

            message += `📋 Характеристики посилань:\n`;
            message += `• ⏰ Дійсні 24 години\n`;
            message += `• 👤 Одноразові (тільки для вас)\n`;
            message += `• 🔒 Автоматично деактивуються після використання\n\n`;
            message += `💚 Натисніть на посилання щоб приєднатися до спільноти!`;

            await bot.sendMessage(chatId, message);
            console.log(`✅ Надіслано запрошення для @${username}`);

        } else {
            await bot.sendMessage(chatId,
                `🤖 Вітаю в боті спільнот "Вільні - Залежні"!\n\n` +
                `📋 Для отримання доступу:\n` +
                `1. Зареєструйтесь на нашому сайті\n` +
                `2. Оплатіть підписку на обрану спільноту\n` +
                `3. Після оплати ви отримаєте персональне запрошення\n\n` +
                `💡 Після успішної оплати поверніться до бота та введіть /start щоб отримати запрошення.\n\n` +
                `🏷️ Доступні спільноти:\n` +
                `• ${COMMUNITY_DISPLAY_NAMES.nikotin} - ${COMMUNITY_PRICES.nikotin} грн/міс\n` +
                `• ${COMMUNITY_DISPLAY_NAMES.food} - ${COMMUNITY_PRICES.food} грн/міс\n` +
                `• ${COMMUNITY_DISPLAY_NAMES.social} - ${COMMUNITY_PRICES.social} грн/міс`
            );
        }
    } catch (error) {
        console.error('❌ Помилка обробки /start:', error);
        await bot.sendMessage(chatId,
            '❌ Сталася помилка. Будь ласка, спробуйте пізніше або зверніться до підтримки.'
        );
    }
});

// Обробка команди /help
bot.onText(/\/help/, async (msg) => {
    const chatId = msg.chat.id;
    await bot.sendMessage(chatId,
        '🆘 Довідка по командам:\n\n' +
        '/start - отримати запрошення до спільноти (після оплати)\n' +
        '/check - перевірити статус підписки\n' +
        '/help - ця довідка\n\n' +
        '💡 Для реєстрації у спільноті відвідайте наш сайт.'
    );
});

// Команда для перевірки статусу підписки
bot.onText(/\/check/, async (msg) => {
    const chatId = msg.chat.id;
    const username = msg.from.username;
    const userId = msg.from.id;

    if (!username) {
        await bot.sendMessage(chatId, '❌ У вас не встановлено username в Telegram. Будь ласка, додайте username в налаштуваннях Telegram.');
        return;
    }

    try {
        const result = await pool.query(
            `SELECT DISTINCT ON (u.community)
                u.*,
                (
                    SELECT p.status
                    FROM payments p
                    WHERE p.user_id = u.id
                    ORDER BY p.date DESC, p.id DESC
                    LIMIT 1
                ) AS payment_status
             FROM users u
             WHERE (u.telegram_username = $1 OR u.telegram_id = $2)
             ORDER BY u.community, u.expires DESC NULLS LAST`,
            [username.toLowerCase(), userId.toString()]
        );

        if (result.rows.length > 0) {
            let message = `📊 Статус ваших підписок:\n\n`;

            for (const user of result.rows) {
                const isActive = user.active && user.expires > new Date();
                const status = isActive ? 'активна' : 'неактивна';
                const expires = new Date(user.expires).toLocaleDateString('uk-UA');
                const communityName = COMMUNITY_DISPLAY_NAMES[user.community] || user.community;

                message += `🏷️ ${communityName}\n`;
                message += `✅ Статус: ${status}\n`;
                message += `📅 Дійсна до: ${expires}\n`;
                message += `💳 Оплата: ${user.payment_status}\n`;

                if (isActive && user.payment_status === 'completed' && user.invite_link) {
                    message += `🔗 Запрошення: готове (введіть /start)\n`;
                }
                message += `\n`;
            }

            await bot.sendMessage(chatId, message);
        } else {
            await bot.sendMessage(chatId,
                '❌ Вас не знайдено в системі.\n\n' +
                '💡 Будь ласка, зареєструйтесь на нашому сайті.'
            );
        }
    } catch (error) {
        console.error('Помилка перевірки статусу:', error);
        await bot.sendMessage(chatId, '❌ Сталася помилка при перевірці статусу. Спробуйте пізніше.');
    }
});

// Функція для автоматичного видалення користувачів з простроченими підписками
async function cleanupExpiredSubscriptions() {
    try {
        const currentUTC = new Date().toISOString();
        console.log('🔄 Перевірка прострочених підписок...');
        console.log('⏰ Поточний UTC час:', currentUTC);
        
        // Використовуємо UTC для порівняння
        const expiredSubscriptions = await pool.query(
            `SELECT DISTINCT ON (COALESCE(u.telegram_id, u.telegram_username), u.community)
                u.id,
                u.telegram_username,
                u.telegram_id,
                u.community,
                u.active,
                u.expires,
                (
                    SELECT p.status
                    FROM payments p
                    WHERE p.user_id = u.id
                    ORDER BY p.date DESC, p.id DESC
                    LIMIT 1
                ) AS payment_status
             FROM users u 
             WHERE u.expires IS NOT NULL
             AND u.expires AT TIME ZONE 'UTC' < NOW() AT TIME ZONE 'UTC'
             AND u.active = true
             AND EXISTS (
                 SELECT 1 FROM payments p WHERE p.user_id = u.id AND p.status = 'completed'
             )
             ORDER BY COALESCE(u.telegram_id, u.telegram_username), u.community, u.expires DESC`
        );

        console.log(`📋 Знайдено ${expiredSubscriptions.rows.length} прострочених АКТИВНИХ підписок`);
        
        let processedCount = 0;
        let deactivatedCount = 0;
        let removedFromGroupCount = 0;
        
        for (const user of expiredSubscriptions.rows) {
            console.log(`\n🚫 Обробка користувача @${user.telegram_username} з групи ${user.community}`);
            console.log(`⏰ Час закінчення в БД: ${user.expires}`);
            console.log(`⏰ Поточний UTC: ${currentUTC}`);
            console.log(`   Telegram ID: ${user.telegram_id}, Активний: ${user.active}`);
            
            // Деактивуємо користувача в БД
            await pool.query(
                'UPDATE users SET active = false, invite_link = NULL, expiry_warning_sent = false WHERE id = $1',
                [user.id]
            );
            console.log(`✅ Користувач @${user.telegram_username} деактивований`);
            deactivatedCount++;
            
            // Видаляємо з групи
            if (user.telegram_id) {
                const groupId = GROUP_IDS[user.community];
                if (groupId) {
                    console.log(`🗑️ Спроба видалити з групи: ${user.telegram_id} з ${user.community}`);
                    const removed = await removeUserFromGroup(user.telegram_id, groupId);
                    if (removed) {
                        console.log(`✅ Користувач @${user.telegram_username} успішно видалений з групи ${user.community}`);
                        removedFromGroupCount++;
                        await notifyUserRemoval({ telegramId: user.telegram_id, community: user.community });
                    }
                }
            }
            
            processedCount++;
        }

        if (processedCount > 0) {
            console.log(`\n🎉 ПІДСУМОК ОЧИЩЕННЯ:`);
            console.log(`   Оброблено користувачів: ${processedCount}`);
            console.log(`   Деактивовано: ${deactivatedCount}`);
            console.log(`   Видалено з груп: ${removedFromGroupCount}`);
        } else {
            console.log('ℹ️ Немає активних користувачів для обробки');
        }

    } catch (error) {
        console.error('❌ Помилка очищення підписок:', error);
    }
}





// Функція для сповіщення користувачів за хвилину до завершення підписки
async function notifyExpiringSubscriptions() {
    try {
        const upcomingExpirations = await pool.query(
            `SELECT DISTINCT ON (COALESCE(u.telegram_id, u.telegram_username), u.community)
                u.id,
                u.telegram_id,
                u.telegram_username,
                u.community,
                u.expires,
                EXTRACT(EPOCH FROM (u.expires AT TIME ZONE 'UTC' - NOW() AT TIME ZONE 'UTC')) AS seconds_until_expiry
             FROM users u
             WHERE u.active = true
               AND u.expires IS NOT NULL
               AND u.expires AT TIME ZONE 'UTC' > NOW() AT TIME ZONE 'UTC'
               AND (u.expires AT TIME ZONE 'UTC' - INTERVAL '60 seconds') <= NOW() AT TIME ZONE 'UTC'
               AND COALESCE(u.expiry_warning_sent, FALSE) = FALSE
               AND EXISTS (
                    SELECT 1 FROM payments p WHERE p.user_id = u.id AND p.status = 'completed'
               )
             ORDER BY COALESCE(u.telegram_id, u.telegram_username), u.community, u.expires DESC`
        );

        if (upcomingExpirations.rows.length === 0) {
            return;
        }

        for (const user of upcomingExpirations.rows) {
            if (!user.telegram_id) {
                console.log(`⚠️ Не вдалось надіслати попередження @${user.telegram_username}: відсутній telegram_id`);
                await pool.query(
                    'UPDATE users SET expiry_warning_sent = TRUE, updated_at = CURRENT_TIMESTAMP WHERE id = $1',
                    [user.id]
                );
                continue;
            }

            const communityName = COMMUNITY_DISPLAY_NAMES[user.community] || user.community;
            const message =
                `⚠️ Ваш доступ до "${communityName}" завершиться через хвилину.
Продовжіть підписку, щоб залишатися в спільноті без перерв.`;

            try {
                await bot.sendMessage(user.telegram_id, message);
                console.log(`📣 Надіслано попередження @${user.telegram_username} (ID: ${user.telegram_id}) про завершення підписки ${user.community}`);
            } catch (error) {
                console.error(`❌ Не вдалося надіслати попередження користувачу ${user.telegram_id}:`, error.message);
            }

            await pool.query(
                'UPDATE users SET expiry_warning_sent = TRUE, updated_at = CURRENT_TIMESTAMP WHERE id = $1',
                [user.id]
            );
        }
    } catch (error) {
        console.error('❌ Помилка сповіщення про завершення підписок:', error);
    }
}
// Обробка запитів на приєднання через запрошення
async function handleChatJoinRequest(request) {
    const chatId = request.chat.id.toString();
    const community = COMMUNITY_BY_GROUP_ID[chatId];

    if (!community) {
        return;
    }

    const requesterId = request.from.id.toString();

    try {
        const activeSubscription = await findActiveSubscription({
            db: pool,
            community,
            telegramId: requesterId
        });

        if (activeSubscription) {
            await bot.approveChatJoinRequest(request.chat.id, request.from.id);
            console.log(`✅ Схвалено запит на приєднання для @${request.from.username || requesterId} у спільноту ${community}`);
            await welcomeUserToCommunity({
                chatId: request.chat.id,
                from: request.from,
                community
            });
        } else {
            await bot.declineChatJoinRequest(request.chat.id, request.from.id);
            console.log(`🚫 Відхилено запит на приєднання ${requesterId} до ${community}: активна підписка відсутня`);
        }
    } catch (error) {
        console.error('❌ Помилка обробки запиту на приєднання:', error.message);
    }
}

// Контроль за станом учасників у групі
async function handleChatMemberUpdate(update) {
    if (!update || !update.chat) {
        return;
    }

    const chatId = update.chat.id.toString();
    const community = COMMUNITY_BY_GROUP_ID[chatId];

    if (!community) {
        return;
    }

    const newMember = update.new_chat_member;
    if (!newMember || newMember.status !== 'member') {
        return;
    }

    const memberId = newMember.user.id.toString();

    try {
        const activeSubscription = await findActiveSubscription({
            db: pool,
            community,
            telegramId: memberId
        });

        if (!activeSubscription) {
            console.log(`🚫 Користувач ${memberId} не має активної підписки для ${community}. Видаляємо...`);
            await removeUserFromGroup(memberId, chatId);
            await notifyUserRemoval({ telegramId: memberId, community });
        }
    } catch (error) {
        console.error('❌ Помилка перевірки учасника групи:', error.message);
    }
}


bot.on('chat_join_request', handleChatJoinRequest);
bot.on('chat_member', handleChatMemberUpdate);


// Функція для моніторингу статусу всіх активних користувачів
async function monitorActiveUsers() {
    try {
        const activeUsers = await pool.query(
            `SELECT DISTINCT ON (COALESCE(u.telegram_id, u.telegram_username), u.community)
                u.telegram_username,
                u.telegram_id,
                u.community,
                u.active,
                u.expires,
                (
                    SELECT p.status
                    FROM payments p
                    WHERE p.user_id = u.id
                    ORDER BY p.date DESC, p.id DESC
                    LIMIT 1
                ) AS payment_status,
                EXTRACT(EPOCH FROM (u.expires AT TIME ZONE 'UTC' - NOW() AT TIME ZONE 'UTC')) AS seconds_until_expiry,
                COALESCE(u.expiry_warning_sent, FALSE) AS expiry_warning_sent
             FROM users u 
             WHERE u.active = true
             AND u.expires IS NOT NULL
             AND EXISTS (
                SELECT 1 FROM payments p WHERE p.user_id = u.id AND p.status = 'completed'
             )
             ORDER BY COALESCE(u.telegram_id, u.telegram_username), u.community, u.expires DESC`
        );
        
        if (activeUsers.rows.length > 0) {
            console.log(`👀 МОНІТОРИНГ АКТИВНИХ КОРИСТУВАЧІВ (${activeUsers.rows.length}):`);
            console.log(`⏰ Поточний UTC: ${new Date().toISOString()}`);
            
            activeUsers.rows.forEach(user => {
                const status = isSubscriptionActive(user.expires) ? '✅ АКТИВНИЙ' : '❌ ПРОСТРОЧЕНО';
                const secondsLeftRaw = parseFloat(user.seconds_until_expiry);
                const secondsLeft = Number.isFinite(secondsLeftRaw)
                    ? Math.max(0, Math.floor(secondsLeftRaw))
                    : 'N/A';
                console.log(`   @${user.telegram_username} - ${user.community}`);
                console.log(`     Статус: ${status}`);
                console.log(`     Час закінчення UTC: ${user.expires}`);
                console.log(`     Секунд до закінчення: ${secondsLeft}`);
                console.log(`     Telegram ID: ${user.telegram_id}`);
                console.log(`     Попередження надіслано: ${user.expiry_warning_sent}`);
            });
        } else {
            console.log('👀 МОНІТОРИНГ: Немає активних користувачів');
        }
    } catch (error) {
        console.error('❌ Помилка моніторингу:', error);
    }
}

// Моніторимо кожні 5 секунд
setInterval(monitorActiveUsers, 5 * 1000);

// Сповіщаємо про завершення підписки кожні 5 секунд
setInterval(notifyExpiringSubscriptions, 5 * 1000);




// Функція для видалення користувача з групи
async function removeUserFromGroup(userId, groupId) {
    try {
        console.log(`🔍 Перевірка статусу користувача ${userId} в групі ${groupId}...`);
        
        const chatMember = await bot.getChatMember(groupId, userId);
        
        if (chatMember.status === 'member' || chatMember.status === 'administrator') {
            console.log(`🗑️ Видалення користувача ${userId} з групи...`);
            
            // Видаляємо користувача
            await bot.banChatMember(groupId, userId);
            
            // Розбанюємо, щоб користувач міг приєднатися знову після оплати
            setTimeout(async () => {
                try {
                    await bot.unbanChatMember(groupId, userId);
                    console.log(`🔓 Користувач ${userId} розблокований для майбутніх вступів`);
                } catch (unbanError) {
                    console.log(`ℹ️ Не вдалося розблокувати користувача ${userId}:`, unbanError.message);
                }
            }, 1000);
            
            console.log(`✅ Користувач ${userId} успішно видалений з групи`);
            return true;
        } else {
            console.log(`ℹ️ Користувач ${userId} вже не в групі (статус: ${chatMember.status})`);
            return true;
        }
    } catch (error) {
        if (error.response && error.response.statusCode === 400) {
            console.log(`ℹ️ Користувач ${userId} не знайдений в групі`);
            return true;
        }
        console.error(`❌ Помилка видалення користувача ${userId}:`, error.message);
        return false;
    }
}

// Функція для автоматичного видалення користувачів з груп
async function removeExpiredUsersFromGroups() {
    try {
        console.log('🔄 Перевірка користувачів для видалення з груп...');
        
        // Знаходимо користувачів з простроченими підписками
        const expiredUsers = await pool.query(
            `SELECT DISTINCT u.telegram_id, u.telegram_username, u.community 
             FROM users u 
             WHERE u.active = false 
             AND u.expires IS NOT NULL
             AND u.expires < NOW()
             AND u.telegram_id IS NOT NULL
             AND EXISTS (
                SELECT 1 FROM payments p WHERE p.user_id = u.id AND p.status = 'completed'
             )`
        );

        console.log(`📋 Знайдено ${expiredUsers.rows.length} користувачів для видалення з груп`);

        for (const user of expiredUsers.rows) {
            const groupId = GROUP_IDS[user.community];
            if (!groupId) {
                console.error(`❌ Не знайдено ID групи для спільноти ${user.community}`);
                continue;
            }

            console.log(`🚫 Спроба видалити @${user.telegram_username} (ID: ${user.telegram_id}) з групи ${user.community}`);

            // Видаляємо користувача з групи
            const removed = await removeUserFromGroup(user.telegram_id, groupId);
            
            if (removed) {
                console.log(`✅ Користувач @${user.telegram_username} успішно видалений з групи ${user.community}`);
                await notifyUserRemoval({ telegramId: user.telegram_id, community: user.community });
            }
        }
    } catch (error) {
        console.error('❌ Помилка видалення користувачів з груп:', error);
    }
}

// Додаємо функцію для отримання інформації про користувача
async function getUserInfo(username) {
    try {
        const result = await pool.query(
            `SELECT u.*,
                    (
                        SELECT p.status
                        FROM payments p
                        WHERE p.user_id = u.id
                        ORDER BY p.date DESC, p.id DESC
                        LIMIT 1
                    ) AS payment_status
             FROM users u 
             WHERE u.telegram_username = $1 AND u.active = true
               AND u.expires IS NOT NULL AND u.expires > NOW()
               AND EXISTS (
                    SELECT 1 FROM payments p WHERE p.user_id = u.id AND p.status = 'completed'
               )
             ORDER BY u.expires DESC
             LIMIT 1`,
            [username.toLowerCase()]
        );
        return result.rows.length > 0 ? result.rows[0] : null;
    } catch (error) {
        console.error('❌ Помилка отримання інформації про користувача:', error);
        return null;
    }
}
async function debugExpiredUsers() {
    try {
        console.log('🔍 ДЕТАЛЬНА ПЕРЕВІРКА СТАНУ:');
        console.log('⏰ Поточний UTC час:', new Date().toISOString());
        
        const allUsers = await pool.query(
            `SELECT 
                u.telegram_username, 
                u.telegram_id, 
                u.community, 
                u.active, 
                u.expires,
                (
                    SELECT p.status
                    FROM payments p
                    WHERE p.user_id = u.id
                    ORDER BY p.date DESC, p.id DESC
                    LIMIT 1
                ) AS payment_status,
                u.expires AT TIME ZONE 'UTC' < NOW() AT TIME ZONE 'UTC' AS is_expired_utc
             FROM users u 
             WHERE EXISTS (
                SELECT 1 FROM payments p WHERE p.user_id = u.id AND p.status = 'completed'
             )
             ORDER BY u.active DESC, u.expires ASC NULLS LAST`
        );
        
        console.log(`👥 ВСІ КОРИСТУВАЧІ З ОПЛАТОЮ: ${allUsers.rows.length}`);
        
        allUsers.rows.forEach(user => {
            const activeStatus = user.active ? 'АКТИВНИЙ' : 'НЕАКТИВНИЙ';
            const expiredStatus = user.is_expired_utc ? 'ПРОСТРОЧЕНО' : 'ДІЙСНИЙ';
            console.log(`   @${user.telegram_username} - ${user.community}`);
            console.log(`     Статус: ${activeStatus}, Час: ${expiredStatus}`);
            console.log(`     Час закінчення: ${user.expires}`);
            console.log(`     Telegram ID: ${user.telegram_id}`);
        });

    } catch (error) {
        console.error('❌ Помилка детальної перевірки:', error);
    }
}




// Додайте виклик для debug
setInterval(debugExpiredUsers, 30 * 1000);

// Функція для активації користувача після оплати
async function activateUserAfterPayment(userId, telegramUsername, community, telegramId) {
    try {
        console.log(`🎯 Активація користувача @${telegramUsername}, telegram_id: ${telegramId}`);

        const existingUser = await pool.query(
            `SELECT id, expires, invite_link
             FROM users
             WHERE id = $1`,
            [userId]
        );

        if (existingUser.rows.length === 0) {
            throw new Error(`Користувача з id=${userId} не знайдено`);
        }

        const activationResult = await activateUserSubscription({
            db: pool,
            user: existingUser.rows[0],
            community,
            telegramUsername,
            telegramId,
            inviteLinkProvider: () => createInviteLink(telegramUsername, community)
        });

        console.log(`✅ Користувач ${telegramUsername} активовано до ${activationResult.expiresAt.toISOString()} (UTC), telegram_id: ${telegramId}`);

        // Оновлюємо моніторинг
        setTimeout(monitorActiveUsers, 1000);

        return activationResult.inviteLink;

    } catch (error) {
        console.error('❌ Помилка активації користувача:', error);
        throw error;
    }
}

// Обробка помилок бота
bot.on('error', (error) => {
    console.error('❌ Помилка бота:', error);
});

bot.on('polling_error', (error) => {
    console.error('❌ Помилка polling:', error);
    // Автоматичний перезапуск polling при помилці 409
    if (error.code === 'ETELEGRAM' && error.response && error.response.body && 
        error.response.body.description.includes('Conflict')) {
        console.log('🔄 Перезапуск polling через 5 секунд...');
        setTimeout(() => {
            bot.stopPolling();
            setTimeout(() => {
                startBotPolling();
            }, 1000);
        }, 5000);
    }
});

// Функція для запуску polling
function startBotPolling() {
    bot.startPolling({ 
        restart: true,
        params: {
            timeout: 10
        }
    }).then(() => {
        console.log('✅ Polling бота запущено');
    }).catch(error => {
        console.error('❌ Помилка запуску polling:', error);
    });
}

// Запускаємо очищення кожні 10 секунд для тесту
setInterval(cleanupExpiredSubscriptions, 10 * 1000);

// Запускаємо очищення при старті
setTimeout(cleanupExpiredSubscriptions, 5000);

// Перевіряємо підписки, що скоро завершаться, після запуску
setTimeout(notifyExpiringSubscriptions, 2000);

// Ініціалізація бота
async function initializeBot() {
    try {
        console.log('🤖 Ініціалізація Telegram бота...');
        
        // Перевірка прав бота
        await checkBotPermissions();
        
        // Запуск polling
        startBotPolling();
        
        console.log('📍 Бот готовий до роботи');
        console.log('💡 Команди: /start, /help, /check');
        console.log('🔗 Режим: одноразові посилання через бота');
        console.log('🔄 Автоматичне очищення: кожну хвилину (тестовий режим)');
        console.log('🏷️ Спільноти: нікотин, їжа, соціальна');
        
    } catch (error) {
        console.error('❌ Помилка ініціалізації бота:', error);
    }
}

// Команда для отримання Telegram ID
bot.onText(/\/id/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const username = msg.from.username || 'користувач';
    const firstName = msg.from.first_name || '';
    
    const message = `
👋 Привіт, ${firstName || username}!

🆔 *Ваш Telegram ID:* \`${userId}\`

💡 *Як використати:*
1. Скопіюйте цей ID: \`${userId}\`
2. Відкрийте сайт у браузері: http://localhost:3000
3. Вставте ID у відповідне поле у формі оплати
4. Заповніть решту полів та завершіть реєстрацію

📝 *Порада:* Якщо відкриєте сайт через Telegram браузер - все заповниться автоматично!
    `;
    
    await bot.sendMessage(chatId, message, { 
        parse_mode: 'Markdown'
    });
    
    console.log(`📋 Користувач @${username} запросив свій ID: ${userId}`);
});

// Обробка deep link для автоматизації
bot.onText(/\/start get_id_(.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const username = msg.from.username || 'користувач';
    const originalUrl = decodeURIComponent(match[1]);
    
    // Додаємо telegram_id до URL
    const returnUrl = `${originalUrl}${originalUrl.includes('?') ? '&' : '?'}tg_id=${userId}`;
    
    const message = `
✅ *Ваш Telegram ID:* \`${userId}\`

🔗 *Для продовження реєстрації:*
1. Відкрийте цей сайт у браузері: http://localhost:3000
2. Ваш Telegram ID буде автоматично додано до форми
3. Заповніть решту полів та завершіть реєстрацію

💡 *Порада:* Скопіюйте ваш ID на випадок: \`${userId}\`
    `;
    
    await bot.sendMessage(chatId, message, { 
        parse_mode: 'Markdown'
    });
    
    console.log(`🔗 Користувач @${username} отримав deep link, ID: ${userId}`);
});

// Команда /start
bot.onText(/\/start$/, async (msg) => {
    const chatId = msg.chat.id;
    const username = msg.from.username;
    const userId = msg.from.id;
    
    console.log(`🔔 Користувач @${username} (ID: ${userId}) запустив бота`);
    
    await bot.sendMessage(chatId,
        `🤖 Вітаю в боті спільнот "Вільні - Залежні"!\n\n` +
        `📋 *Доступні команди:*\n` +
        `/id - отримати ваш Telegram ID\n` +
        `/start - отримати запрошення до спільноти\n` +
        `/check - перевірити статус підписки\n` +
        `/help - довідка\n\n` +
        `💡 *Для реєстрації у спільноті:*\n` +
        `1. Відкрийте сайт: http://localhost:3000\n` +
        `2. Використовуйте /id щоб дізнатись свій Telegram ID\n` +
        `3. Заповніть форму на сайті\n` +
        `4. Оплатіть підписку\n` +
        `5. Після оплати отримаєте запрошення\n\n` +
        `🚀 *Почніть з команди /id*`,
        { parse_mode: 'Markdown' }
    );
});

// Запускаємо ініціалізацію
setTimeout(initializeBot, 2000);

// Експортуємо функції для використання в серверній частині
module.exports = {
    bot,
    createInviteLink,
    removeUserFromGroup,
    getUserInfo,
    activateUserAfterPayment,
    GROUP_IDS,
    COMMUNITY_DISPLAY_NAMES,
    COMMUNITY_PRICES
};
