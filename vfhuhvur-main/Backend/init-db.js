const { Client } = require('pg');
require('dotenv').config();

async function initDatabase() {
    const client = new Client({
        connectionString: process.env.DATABASE_URL
    });

    try {
        await client.connect();
        console.log('✅ Підключено до PostgreSQL');

        // Створення таблиці users
        await client.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                telegram_username VARCHAR(255) NOT NULL,
                telegram_id VARCHAR(255),
                phone VARCHAR(20) NOT NULL,
                community VARCHAR(50) NOT NULL CHECK (community IN ('nikotin', 'food', 'social')),
                joined TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                expires TIMESTAMPTZ,
                active BOOLEAN DEFAULT FALSE,
                invite_link TEXT,
                expiry_warning_sent BOOLEAN DEFAULT FALSE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Створення таблиці payments
        await client.query(`
            CREATE TABLE IF NOT EXISTS payments (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                amount DECIMAL(10, 2) NOT NULL,
                date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                status VARCHAR(50) DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'failed')),
                portmone_id VARCHAR(255),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Додаємо колонку telegram_id, якщо її ще немає
        await client.query(`
            DO $$ 
            BEGIN 
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                              WHERE table_name='users' AND column_name='telegram_id') THEN
                    ALTER TABLE users ADD COLUMN telegram_id VARCHAR(255);
                END IF;
            END $$;
        `);

        // Дозволяємо NULL для expires, якщо обмеження ще активне
        await client.query(`
            DO $$
            BEGIN
                BEGIN
                    ALTER TABLE users ALTER COLUMN expires DROP NOT NULL;
                EXCEPTION
                    WHEN others THEN NULL;
                END;
            END $$;
        `);

        // Перетворюємо колонку expires у TIMESTAMPTZ, якщо ще не перетворена
        await client.query(`
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'users'
                      AND column_name = 'expires'
                      AND data_type = 'timestamp without time zone'
                ) THEN
                    ALTER TABLE users
                        ALTER COLUMN expires TYPE TIMESTAMPTZ
                        USING (CASE WHEN expires IS NOT NULL THEN expires AT TIME ZONE 'UTC' ELSE NULL END);
                END IF;
            END $$;
        `);

        // Додаємо колонку expiry_warning_sent, якщо її ще немає
        await client.query(`
            DO $$
            BEGIN
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                              WHERE table_name='users' AND column_name='expiry_warning_sent') THEN
                    ALTER TABLE users ADD COLUMN expiry_warning_sent BOOLEAN DEFAULT FALSE;
                    UPDATE users SET expiry_warning_sent = FALSE;
                END IF;
            END $$;
        `);

        // Створення індексів для швидкості
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_users_telegram ON users(telegram_username, telegram_id);
            CREATE INDEX IF NOT EXISTS idx_users_active ON users(active);
            CREATE INDEX IF NOT EXISTS idx_users_expires ON users(expires);
            CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status);
            CREATE INDEX IF NOT EXISTS idx_payments_user_id ON payments(user_id);
            CREATE INDEX IF NOT EXISTS idx_users_invite_link ON users(invite_link);
            CREATE INDEX IF NOT EXISTS idx_users_community ON users(community);
            CREATE UNIQUE INDEX IF NOT EXISTS idx_users_unique_subscription ON users(community, telegram_username) WHERE active = true;
            CREATE UNIQUE INDEX IF NOT EXISTS idx_users_unique_subscription_telegram_id ON users(community, telegram_id) WHERE telegram_id IS NOT NULL AND active = true;
        `);

        console.log('✅ Таблиці та індекси успішно створені');

        // Перевірка підключення
        const result = await client.query('SELECT NOW() as current_time');
        console.log('⏰ Час сервера БД:', result.rows[0].current_time);

    } catch (error) {
        console.error('❌ Помилка при створенні таблиць:', error);
    } finally {
        await client.end();
        console.log('🔌 Зʼєднання з PostgreSQL закрито');
    }
}

// Експорт для використання в інших файлах
module.exports = { initDatabase };

// Запуск ініціалізації, якщо файл викликаний напряму
if (require.main === module) {
    initDatabase();
}