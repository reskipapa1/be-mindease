const { Pool } = require('pg');
require('dotenv').config();

console.log('🔌 [Database] Connecting to PostgreSQL database...');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL.includes('localhost') || process.env.DATABASE_URL.includes('127.0.0.1')
    ? false
    : { rejectUnauthorized: false }
});

const initDB = async () => {
  try {
    // Create users table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(255) UNIQUE NOT NULL,
        email VARCHAR(255) UNIQUE,
        password VARCHAR(255) NOT NULL,
        role VARCHAR(50) DEFAULT 'user',
        birth_date VARCHAR(50),
        gender VARCHAR(50),
        reset_token VARCHAR(255),
        reset_token_expires VARCHAR(100),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create channels table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS channels (
        id SERIAL PRIMARY KEY,
        slug VARCHAR(255) UNIQUE NOT NULL,
        name VARCHAR(255) NOT NULL,
        description TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Seed initial channels if table is empty
    const seedCount = await pool.query('SELECT COUNT(*) AS count FROM channels');
    const count = parseInt(seedCount.rows[0].count) || 0;
    if (count === 0) {
      await pool.query(`
        INSERT INTO channels (slug, name, description) VALUES
        ('curhat-umum', '💬-curhat-umum', 'Saluran bebas untuk membagikan keluh kesah dan cerita apa saja.'),
        ('stres-kecemasan', '🧠-stres-kecemasan', 'Tempat berbagi cerita seputar stres, kepanikan, dan kecemasan Anda.'),
        ('insomnia-tidur', '🌙-insomnia-tidur', 'Mengalami masalah tidur? Yuk, saling bercerita dan berbagi tips di sini.')
      `);
    }

    await pool.query(`
      CREATE TABLE IF NOT EXISTS posts (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        content TEXT NOT NULL,
        channel_slug VARCHAR(255) DEFAULT 'curhat-umum',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS moods (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        date VARCHAR(50) NOT NULL,
        mood_type VARCHAR(50) NOT NULL,
        note TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, date)
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS settings (
        id SERIAL PRIMARY KEY,
        setting_key VARCHAR(255) UNIQUE NOT NULL,
        setting_value TEXT NOT NULL
      )
    `);

    try {
      await pool.query(`INSERT INTO settings (setting_key, setting_value) VALUES ('dashboard_greeting', 'Bagaimana perasaanmu hari ini? Yuk ceritakan.') ON CONFLICT (setting_key) DO NOTHING`);
      await pool.query(`INSERT INTO settings (setting_key, setting_value) VALUES ('ai_prompt', 'Kamu adalah asisten AI yang ramah dan empatik untuk kesehatan mental. Berikan jawaban yang menenangkan dan suportif.') ON CONFLICT (setting_key) DO NOTHING`);
    } catch (e) { console.error('Error inserting default settings:', e); }

    await pool.query(`
      CREATE TABLE IF NOT EXISTS doctors (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        spec VARCHAR(255) NOT NULL,
        exp VARCHAR(50) NOT NULL,
        rating NUMERIC(2, 1) DEFAULT 5.0,
        reviews INTEGER DEFAULT 0,
        available BOOLEAN DEFAULT true,
        tags TEXT
      )
    `);

    // Insert default doctors if table is empty
    const doctorsCount = await pool.query('SELECT COUNT(*) AS count FROM doctors');
    const docCount = parseInt(doctorsCount.rows[0].count) || 0;
    if (docCount === 0) {
      await pool.query(`
        INSERT INTO doctors (name, spec, exp, rating, reviews, available, tags) VALUES 
        ('Dr. Budi Santoso, M.Psi', 'Konselor Akademik Kampus', '8 Tahun', 4.9, 214, true, 'Kecemasan Skripsi,Burnout,Manajemen Waktu'),
        ('Rina Oktavia, M.Psi', 'Psikolog Dewasa Muda', '5 Tahun', 4.8, 156, true, 'Quarter Life Crisis,Homesick,Depresi'),
        ('Dr. Sarah Wijaya, Sp.KJ', 'Psikiater Mahasiswa', '10 Tahun', 5.0, 312, false, 'ADHD,Gangguan Tidur,Stres Ujian')
      `);
    }

    await pool.query(`
      CREATE TABLE IF NOT EXISTS chat_sessions (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        title VARCHAR(255) DEFAULT 'Obrolan Baru',
        risk_level VARCHAR(50) DEFAULT '-',
        burnout_score REAL DEFAULT 0.0,
        is_pinned BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS chat_history (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        session_id INTEGER REFERENCES chat_sessions(id) ON DELETE CASCADE,
        sender VARCHAR(50) NOT NULL,
        text TEXT,
        type VARCHAR(50) DEFAULT 'text',
        risk_level VARCHAR(50),
        burnout_score REAL,
        recommendation TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    console.log('Connected to PostgreSQL and verified tables');
  } catch (err) {
    console.error('Error initializing PostgreSQL tables', err);
  }
};

module.exports = { pool, initDB };
