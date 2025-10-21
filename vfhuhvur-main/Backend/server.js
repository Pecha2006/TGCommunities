const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Підключення до PostgreSQL
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(express.urlencoded({ extended: true }));

// Логування всіх запитів
app.use((req, res, next) => {
    console.log(`📨 ${new Date().toISOString()} - ${req.method} ${req.url}`);
    next();
});

// Обслуговування статичних файлів з Frontend директорії
app.use(express.static(path.join(__dirname, '..', 'Frontend')));
app.get('/favicon.ico', (req, res) => {
    res.status(204).end();
});

// Явно вказуємо шлях до index.html
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'Frontend', 'index.html'));
});

// Конфігурація Portmone
const PORTMONE_CONFIG = {
    payeeId: process.env.PORTMONE_PAYEE_ID || '1185',
    login: process.env.PORTMONE_LOGIN || 'WDISHOP',
    password: process.env.PORTMONE_PASSWORD || 'wdi451'
};

// Імпортуємо функції з бота
const { 
    COMMUNITY_DISPLAY_NAMES, 
    COMMUNITY_PRICES
} = require('./bot');

// Функція для генерації URL оплати Portmone
function generatePortmonePaymentUrl(amount, description, orderNumber) {
    const baseUrl = 'https://www.portmone.com.ua/gateway/';

    // URL для callback
    const successUrl = `${process.env.BASE_URL || 'http://localhost:3000'}/payment-callback?status=success&order=${orderNumber}`;
    const failureUrl = `${process.env.BASE_URL || 'http://localhost:3000'}/payment-callback?status=failure&order=${orderNumber}`;

    const params = new URLSearchParams({
        payee_id: PORTMONE_CONFIG.payeeId,
        shop_order_number: orderNumber,
        bill_amount: amount,
        description: description.substring(0, 255),
        success_url: successUrl,
        failure_url: failureUrl,
        lang: 'uk',
        encoding: 'UTF-8'
    });

    const paymentUrl = `${baseUrl}?${params.toString()}`;
    console.log('🔗 Згенеровано URL Portmone:', paymentUrl);
    return paymentUrl;
}

// Функція для активації користувача після оплати
async function activateUserAfterPayment(userId, telegramUsername, community, telegramId) {
    try {
        console.log(`🎯 Активація користувача @${telegramUsername}, telegram_id: ${telegramId}`);
        
        // Для тесту - 10 секунд (замініть на 30 днів для продакшена)
        const expires = new Date();
        expires.setSeconds(expires.getSeconds() + 10);

        // Імпортуємо функцію створення запрошення
        const { createInviteLink } = require('./bot');
        
        // Створюємо запрошення
        const inviteResult = await createInviteLink(telegramUsername, community);
        
        let inviteLink = null;
        if (inviteResult.success) {
            inviteLink = inviteResult.inviteLink;
        } else {
            console.error(`❌ Не вдалося створити запрошення для @${telegramUsername}:`, inviteResult.error);
        }

        // Оновлюємо користувача - ДОДАЄМО telegram_id
        const result = await pool.query(
            `UPDATE users 
             SET active = true, expires = $1, invite_link = $2, 
                 telegram_id = $3, updated_at = CURRENT_TIMESTAMP 
             WHERE id = $4
             RETURNING *`,
            [expires, inviteLink, telegramId, userId]
        );
        
        console.log(`✅ Користувач ${telegramUsername} активовано до ${expires}, telegram_id: ${telegramId}`);
        return inviteLink;

    } catch (error) {
        console.error('❌ Помилка активації користувача:', error);
        throw error;
    }
}

// Перевірка з'єднання з БД
app.get('/api/health', async (req, res) => {
    try {
        const result = await pool.query('SELECT NOW() as time, version() as version');
        res.json({
            status: 'OK',
            database: 'Connected',
            time: result.rows[0].time,
            version: result.rows[0].version
        });
    } catch (error) {
        console.error('❌ Помилка БД:', error);
        res.status(500).json({
            status: 'Error',
            error: 'Database connection failed',
            details: error.message
        });
    }
});

// Отримати всіх користувачів
app.get('/api/users', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT u.*, p.amount, p.status as payment_status, p.portmone_id 
            FROM users u 
            LEFT JOIN payments p ON u.id = p.user_id 
            ORDER BY u.joined DESC
        `);
        res.json(result.rows);
    } catch (error) {
        console.error('❌ Помилка отримання користувачів:', error);
        res.status(500).json({ error: error.message });
    }
});

// Додаємо новий endpoint для отримання інформації про користувача
app.get('/api/user/:username', async (req, res) => {
    try {
        const { username } = req.params;
        const { getUserInfo } = require('./bot');
        const userInfo = await getUserInfo(username);

        if (userInfo) {
            res.json({
                success: true,
                user: userInfo
            });
        } else {
            res.json({
                success: false,
                error: 'Користувача не знайдено або підписка не активна'
            });
        }
    } catch (error) {
        console.error('❌ Помилка отримання інформації про користувача:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Створити нового користувача та платіж
app.post('/api/users', async (req, res) => {
    console.log('📨 Отримано запит на реєстрацію:', {
        username: req.body.telegramUsername,
        phone: req.body.userPhone,
        community: req.body.community,
        amount: req.body.amount,
        telegramId: req.body.telegramId,
        telegramIdType: typeof req.body.telegramId
    });

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const { telegramUsername, userPhone, community, amount, telegramId } = req.body;

        if (!telegramUsername || !userPhone || !community || !amount) {
            throw new Error('Всі поля обов\'язкові для заповнення');
        }

        // Детальна перевірка telegram_id
        console.log('🔍 Перевірка telegram_id:', {
            received: telegramId,
            type: typeof telegramId,
            isValid: telegramId && /^\d+$/.test(telegramId)
        });

        if (!telegramId || !/^\d+$/.test(telegramId)) {
            throw new Error('Некоректний Telegram ID. Будь ласка, отримайте коректний Telegram ID.');
        }

        // Перевіряємо, чи не має користувач вже активної підписки
        const existingUser = await client.query(
            `SELECT u.id FROM users u 
             LEFT JOIN payments p ON u.id = p.user_id 
             WHERE (u.telegram_username = $1 OR u.telegram_id = $2) AND u.community = $3 
             AND u.active = true AND p.status = 'completed'
             AND u.expires > NOW()`,
            [telegramUsername.toLowerCase(), telegramId, community]
        );

        if (existingUser.rows.length > 0) {
            throw new Error('У вас вже є активна підписка на цю спільноту');
        }

        // Розраховуємо дату закінчення (30 днів)
        const expires = new Date();
        expires.setDate(expires.getDate() + 30);

        // Створюємо користувача
        const userResult = await client.query(
            `INSERT INTO users (telegram_username, telegram_id, phone, community, expires, active, invite_link)
             VALUES ($1, $2, $3, $4, $5, $6, $7) 
             RETURNING *`,
            [telegramUsername.toLowerCase(), telegramId, userPhone, community, expires, false, null]
        );

        const user = userResult.rows[0];
        console.log('✅ Користувач створений:', {
            id: user.id,
            username: user.telegram_username,
            telegramId: user.telegram_id
        });

        // ... решта коду без змін

        // Генеруємо номер замовлення
        const orderNumber = `order_${Date.now()}_${user.id}`;

        // Створюємо платіж
        const paymentResult = await client.query(
            `INSERT INTO payments (user_id, amount, status, portmone_id)
             VALUES ($1, $2, $3, $4) 
             RETURNING *`,
            [user.id, amount, 'pending', orderNumber]
        );

        const payment = paymentResult.rows[0];
        console.log('✅ Платіж створений:', payment.id);

        // Генеруємо URL для Portmone
        const description = `Місячна підписка: ${COMMUNITY_DISPLAY_NAMES[community]} - @${telegramUsername}`;
        const paymentUrl = generatePortmonePaymentUrl(amount, description, orderNumber);

        await client.query('COMMIT');

        console.log('💰 Перенаправляємо на Portmone для користувача:', telegramUsername);

        res.json({
            success: true,
            user: user,
            payment: payment,
            paymentUrl: paymentUrl,
            message: 'Перенаправлення на оплату'
        });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('❌ Помилка реєстрації:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    } finally {
        client.release();
    }
});

// Загальна функція для обробки callback від Portmone
async function handlePaymentCallback(orderNumber, status) {
    const client = await pool.connect();
    
    try {
        await client.query('BEGIN');

        // Знаходимо платіж за номером замовлення
        const paymentResult = await client.query(
            `SELECT p.*, u.telegram_username, u.community, u.id as user_id, u.telegram_id
             FROM payments p 
             JOIN users u ON p.user_id = u.id 
             WHERE p.portmone_id = $1`,
            [orderNumber]
        );

        if (paymentResult.rows.length === 0) {
            throw new Error('Платіж не знайдено: ' + orderNumber);
        }

        const payment = paymentResult.rows[0];
        const username = payment.telegram_username;
        const community = payment.community;
        const userId = payment.user_id;
        const telegramId = payment.telegram_id;

        console.log(`🔍 Обробка платежу для @${username}, telegram_id: ${telegramId}`);

        if (status === 'success') {
            // Оновлюємо платіж як успішний
            await client.query(
                `UPDATE payments SET status = 'completed', updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
                [payment.id]
            );

            // Активуємо користувача та створюємо запрошення
            const inviteLink = await activateUserAfterPayment(userId, username, community, telegramId);

            await client.query('COMMIT');

            console.log(`✅ Оплата успішна для користувача: @${username}, telegram_id: ${telegramId}`);

            return {
                success: true,
                username,
                community,
                amount: payment.amount,
                inviteLink
            };

        } else {
            // Якщо оплата невдала
            await client.query(
                `UPDATE payments SET status = 'failed', updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
                [payment.id]
            );

            await client.query('COMMIT');

            console.log(`❌ Оплата невдала для користувача: @${username}`);

            return {
                success: false,
                username,
                community,
                amount: payment.amount
            };
        }

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('❌ Помилка обробки платежу:', error);
        throw error;
    } finally {
        client.release();
    }
}

// Callback для обробки результатів оплати від Portmone (GET)
app.get('/payment-callback', async (req, res) => {
    console.log('🔔 Отримано GET callback від Portmone. Query:', req.query);

    const { status, order } = req.query;

    if (!order) {
        return res.send(`
            <!DOCTYPE html>
            <html lang="uk">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Помилка - Вільні Залежні</title>
                <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0-alpha1/dist/css/bootstrap.min.css" rel="stylesheet">
                <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
                <style>
                    :root {
                        --primary-color: #EAE7DC;
                        --secondary-color: #D8C3A5;
                        --accent-color: #BE8D8A;
                        --accent-dark: #E98074;
                        --header-color: #c94c4c;
                        --text-color: #5D5D5D;
                    }
                    body {
                        background-color: var(--primary-color);
                        color: var(--text-color);
                        font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                        padding-top: 70px;
                    }
                    .error-container {
                        min-height: 100vh;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        padding: 20px;
                    }
                    .error-card {
                        background: white;
                        border-radius: 15px;
                        box-shadow: 0 10px 30px rgba(0,0,0,0.1);
                        padding: 50px;
                        text-align: center;
                        max-width: 500px;
                        width: 100%;
                        border-top: 5px solid var(--accent-dark);
                    }
                    .error-icon {
                        font-size: 80px;
                        color: var(--accent-dark);
                        margin-bottom: 30px;
                    }
                    .btn-primary {
                        background: linear-gradient(135deg, var(--accent-color), var(--accent-dark));
                        border: none;
                        padding: 12px 30px;
                        border-radius: 25px;
                        font-weight: 600;
                    }
                </style>
            </head>
            <body>
                <div class="error-container">
                    <div class="error-card">
                        <div class="error-icon">❌</div>
                        <h1>Помилка обробки</h1>
                        <p class="mb-4">Відсутній номер замовлення. Будь ласка, зверніться до підтримки.</p>
                        <a href="/" class="btn btn-primary">На головну</a>
                    </div>
                </div>
            </body>
            </html>
        `);
    }

    try {
        const result = await handlePaymentCallback(order, status);

        if (result.success) {
            // Сторінка успішної оплати
            const responseHtml = `
                <!DOCTYPE html>
                <html lang="uk">
                <head>
                    <meta charset="UTF-8">
                    <meta name="viewport" content="width=device-width, initial-scale=1.0">
                    <title>Оплата успішна - Вільні Залежні</title>
                    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0-alpha1/dist/css/bootstrap.min.css" rel="stylesheet">
                    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
                    <link href="https://fonts.googleapis.com/css2?family=Dancing+Script:wght@600;700&display=swap" rel="stylesheet">
                    <style>
                        :root {
                            --primary-color: #EAE7DC;
                            --secondary-color: #D8C3A5;
                            --accent-color: #BE8D8A;
                            --accent-dark: #E98074;
                            --header-color: #c94c4c;
                            --text-color: #5D5D5D;
                        }
                        
                        body {
                            background-color: var(--primary-color);
                            color: var(--text-color);
                            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                            padding-top: 0;
                            margin: 0;
                        }
                        
                        .navbar {
                            background-color: var(--header-color);
                            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
                            padding: 12px 0;
                        }
                        
                        .logo-text {
                            font-weight: bold;
                            font-size: 20px;
                            color: #fff;
                        }
                        
                        .success-section {
                            min-height: 100vh;
                            display: flex;
                            align-items: center;
                            justify-content: center;
                            padding: 40px 20px;
                        }
                        
                        .success-card {
                            background: white;
                            border-radius: 20px;
                            box-shadow: 0 15px 40px rgba(0,0,0,0.1);
                            padding: 50px;
                            text-align: center;
                            max-width: 700px;
                            width: 100%;
                            border-top: 5px solid #28a745;
                        }
                        
                        .success-icon {
                            font-size: 80px;
                            color: #28a745;
                            margin-bottom: 30px;
                        }
                        
                        .details-card {
                            background: var(--primary-color);
                            border-radius: 15px;
                            padding: 30px;
                            margin: 30px 0;
                            border-left: 4px solid #28a745;
                        }
                        
                        .detail-item {
                            display: flex;
                            justify-content: space-between;
                            align-items: center;
                            margin-bottom: 15px;
                            padding-bottom: 15px;
                            border-bottom: 1px solid rgba(40, 167, 69, 0.2);
                        }
                        
                        .detail-label {
                            font-weight: 600;
                            color: var(--text-color);
                        }
                        
                        .detail-value {
                            color: #28a745;
                            font-weight: 500;
                        }
                        
                        .btn-primary {
                            background: linear-gradient(135deg, var(--accent-color), var(--accent-dark));
                            border: none;
                            padding: 15px 30px;
                            border-radius: 30px;
                            font-weight: 600;
                            margin: 5px;
                            color: white;
                            text-decoration: none;
                            display: inline-block;
                        }
                        
                        .btn-telegram {
                            background: linear-gradient(135deg, #0088cc, #00aced);
                            border: none;
                            padding: 15px 30px;
                            border-radius: 30px;
                            font-weight: 600;
                            margin: 5px;
                            color: white;
                            text-decoration: none;
                            display: inline-block;
                        }
                        
                        .invite-section {
                            background: rgba(40, 167, 69, 0.1);
                            border: 2px dashed #28a745;
                            border-radius: 15px;
                            padding: 30px;
                            margin: 30px 0;
                        }
                        
                        .warning {
                            background: #fff3cd;
                            border: 1px solid #ffeaa7;
                            border-radius: 10px;
                            padding: 20px;
                            margin: 20px 0;
                            color: #856404;
                        }
                    </style>
                </head>
                <body>
                    <!-- Навігаційна панель -->
                    <nav class="navbar navbar-expand-lg navbar-dark fixed-top">
                        <div class="container">
                            <a class="navbar-brand d-flex align-items-center" href="/">
                                <span class="logo-text">Вільні - Залежні</span>
                            </a>
                        </div>
                    </nav>

                    <!-- Секція успіху -->
                    <div class="success-section">
                        <div class="success-card">
                            <div class="success-icon">🎉</div>
                            <h1 class="mb-4">Оплата успішна!</h1>
                            <p class="mb-4">Вітаємо з успішною оплатою!</p>
                            
                            <div class="details-card">
                                <div class="detail-item">
                                    <span class="detail-label">Користувач:</span>
                                    <span class="detail-value">@${result.username}</span>
                                </div>
                                <div class="detail-item">
                                    <span class="detail-label">Спільнота:</span>
                                    <span class="detail-value">${COMMUNITY_DISPLAY_NAMES[result.community] || result.community}</span>
                                </div>
                                <div class="detail-item">
                                    <span class="detail-label">Сума:</span>
                                    <span class="detail-value">${result.amount} грн</span>
                                </div>
                                <div class="detail-item">
                                    <span class="detail-label">Статус:</span>
                                    <span class="detail-value" style="color: #28a745;">✅ Активний</span>
                                </div>
                            </div>

                            ${result.inviteLink ? `
                            <div class="invite-section">
                                <h4 class="mb-4">🔗 Ваше запрошення готове!</h4>
                                
                                <div style="background: white; padding: 20px; border-radius: 10px; margin: 20px 0; word-break: break-all;">
                                    <strong>Одноразове посилання для приєднання:</strong><br>
                                    <a href="${result.inviteLink}" target="_blank" style="color: var(--accent-dark); font-weight: 600;">${result.inviteLink}</a>
                                </div>

                                <div class="warning">
                                    <strong>⚠️ Важливо:</strong> Це посилання дійсне протягом 24 годин та може бути використане тільки один раз.
                                </div>

                                <div class="mt-4">
                                    <a href="${result.inviteLink}" target="_blank" class="btn btn-primary">
                                        🚀 Приєднатися до спільноти
                                    </a>
                                </div>
                            </div>
                            ` : `
                            <div class="warning">
                                <strong>⚠️ Посилання тимчасово недоступне</strong><br>
                                Будь ласка, отримайте запрошення через Telegram бота командою /start
                            </div>
                            `}

                            <div class="mt-4">
                                <a href="/" class="btn btn-primary">Повернутися на сайт</a>
                                ${result.inviteLink ? `
                                <a href="${result.inviteLink}" target="_blank" class="btn btn-telegram">Приєднатися</a>
                                ` : ''}
                                <a href="https://t.me/${process.env.BOT_USERNAME || 'VilniZalezhni_bot'}" target="_blank" class="btn btn-telegram">Перейти до бота</a>
                            </div>
                        </div>
                    </div>
                </body>
                </html>
            `;

            res.send(responseHtml);

        } else {
            // Сторінка невдалої оплати
            res.send(`
                <!DOCTYPE html>
                <html>
                <head>
                    <meta charset="UTF-8">
                    <title>Помилка оплати - Вільні Залежні</title>
                    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0-alpha1/dist/css/bootstrap.min.css" rel="stylesheet">
                    <style>
                        body { 
                            font-family: Arial, sans-serif; 
                            text-align: center; 
                            padding: 50px; 
                            background: linear-gradient(135deg, #ff6b6b 0%, #ee5a24 100%);
                            color: white;
                        }
                        .btn { 
                            background: white; 
                            color: #ee5a24; 
                            padding: 10px 20px; 
                            text-decoration: none; 
                            border-radius: 5px; 
                            margin-top: 20px;
                            display: inline-block;
                        }
                        .error-container {
                            min-height: 100vh;
                            display: flex;
                            align-items: center;
                            justify-content: center;
                        }
                    </style>
                </head>
                <body>
                    <div class="error-container">
                        <div>
                            <h1>❌ Помилка оплати</h1>
                            <p>Спробуйте ще раз або зверніться до підтримки.</p>
                            <a href="/" class="btn">На головну</a>
                        </div>
                    </div>
                </body>
                </html>
            `);
        }

    } catch (error) {
        console.error('❌ Помилка обробки callback:', error);
        res.status(500).send(`
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="UTF-8">
                <title>Помилка - Вільні Залежні</title>
                <style>
                    body { 
                        font-family: Arial, sans-serif; 
                        text-align: center; 
                        padding: 50px; 
                        background: linear-gradient(135deg, #ff6b6b 0%, #ee5a24 100%);
                        color: white;
                    }
                    .btn { 
                        background: white; 
                        color: #ee5a24; 
                        padding: 10px 20px; 
                        text-decoration: none; 
                        border-radius: 5px; 
                        margin-top: 20px;
                        display: inline-block;
                    }
                </style>
            </head>
            <body>
                <h1>❌ Помилка обробки</h1>
                <p>${error.message}</p>
                <a href="/" class="btn">На головну</a>
            </body>
            </html>
        `);
    }
});

// Вебхук для POST запитів від Portmone
app.post('/payment-callback', async (req, res) => {
    console.log('🔔 Отримано POST callback від Portmone:', req.body);

    const { SHOPORDERNUMBER, RESULT, APPROVALCODE } = req.body;
    const status = (RESULT === '0') ? 'success' : 'failure';

    console.log('📋 Обробка POST callback:', { SHOPORDERNUMBER, status, APPROVALCODE });

    try {
        await handlePaymentCallback(SHOPORDERNUMBER, status);

        // Перенаправляємо на GET callback для відображення сторінки
        res.send(`
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="UTF-8">
                <title>Обробка платежу - Вільні Залежні</title>
                <meta http-equiv="refresh" content="0; url=/payment-callback?status=${status}&order=${SHOPORDERNUMBER}">
                <style>
                    body {
                        font-family: Arial, sans-serif;
                        text-align: center;
                        padding: 50px;
                        background: var(--primary-color, #f8f9fa);
                        color: var(--text-color, #333);
                    }
                    .spinner {
                        border: 4px solid #f3f3f3;
                        border-top: 4px solid #3498db;
                        border-radius: 50%;
                        width: 40px;
                        height: 40px;
                        animation: spin 2s linear infinite;
                        margin: 20px auto;
                    }
                    @keyframes spin {
                        0% { transform: rotate(0deg); }
                        100% { transform: rotate(360deg); }
                    }
                </style>
            </head>
            <body>
                <h2>Обробка платежу...</h2>
                <div class="spinner"></div>
                <p>Зачекайте, відбувається перенаправлення...</p>
                <p>Якщо перенаправлення не відбувається, <a href="/payment-callback?status=${status}&order=${SHOPORDERNUMBER}">натисніть тут</a>.</p>
            </body>
            </html>
        `);

    } catch (error) {
        console.error('❌ Помилка обробки POST callback:', error);
        
        res.status(500).send(`
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="UTF-8">
                <title>Помилка - Вільні Залежні</title>
                <style>
                    body { 
                        font-family: Arial, sans-serif; 
                        text-align: center; 
                        padding: 50px; 
                        background: linear-gradient(135deg, #ff6b6b 0%, #ee5a24 100%);
                        color: white;
                    }
                    .btn { 
                        background: white; 
                        color: #ee5a24; 
                        padding: 10px 20px; 
                        text-decoration: none; 
                        border-radius: 5px; 
                        margin-top: 20px;
                        display: inline-block;
                    }
                </style>
            </head>
            <body>
                <h1>❌ Помилка обробки</h1>
                <p>${error.message}</p>
                <a href="/" class="btn">На головну</a>
            </body>
            </html>
        `);
    }
});

// Обробка 404
app.use('*', (req, res) => {
    console.log('❌ Маршрут не знайдено:', req.originalUrl);
    res.status(404).json({
        error: 'Маршрут не знайдено',
        path: req.originalUrl
    });
});

// Обробка помилок
app.use((error, req, res, next) => {
    console.error('❌ Необроблена помилка:', error);
    res.status(500).json({
        success: false,
        error: 'Внутрішня помилка сервера',
        message: error.message
    });
});

// Запуск сервера
app.listen(PORT, () => {
    console.log('🚀 Сервер успішно запущено!');
    console.log(`📍 Порт: ${PORT}`);
    console.log(`🌐 Головна сторінка: http://localhost:${PORT}`);
    console.log(`❤️ Health check: http://localhost:${PORT}/api/health`);
    console.log(`💰 Payment callback: http://localhost:${PORT}/payment-callback`);
});

// Graceful shutdown
process.on('SIGINT', async () => {
    console.log('🛑 Отримано SIGINT. Зупинка сервера...');
    await pool.end();
    process.exit(0);
});