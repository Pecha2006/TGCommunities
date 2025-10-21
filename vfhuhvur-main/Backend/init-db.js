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
                expires TIMESTAMP NOT NULL,
                active BOOLEAN DEFAULT FALSE,
                invite_link TEXT,
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

        // Створення індексів для швидкості
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_users_telegram ON users(telegram_username, telegram_id);
            CREATE INDEX IF NOT EXISTS idx_users_active ON users(active);
            CREATE INDEX IF NOT EXISTS idx_users_expires ON users(expires);
            CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status);
            CREATE INDEX IF NOT EXISTS idx_payments_user_id ON payments(user_id);
            CREATE INDEX IF NOT EXISTS idx_users_invite_link ON users(invite_link);
            CREATE INDEX IF NOT EXISTS idx_users_community ON users(community);
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