const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/mindease',
});

const initDB = async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(255) UNIQUE NOT NULL,
        email VARCHAR(255) UNIQUE,
        password VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    try { await pool.query('ALTER TABLE users ADD COLUMN email VARCHAR(255) UNIQUE'); } catch (e) {}
    try { await pool.query("ALTER TABLE users ADD COLUMN role VARCHAR(50) DEFAULT 'user'"); } catch (e) {}
    
    await pool.query(`
      CREATE TABLE IF NOT EXISTS posts (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        content TEXT NOT NULL,
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

    // Insert default settings if they don't exist
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
        tags TEXT -- stored as comma-separated string
      )
    `);

    // Insert default doctors if table is empty
    const doctorsCount = await pool.query('SELECT COUNT(*) FROM doctors');
    if (parseInt(doctorsCount.rows[0].count) === 0) {
      await pool.query(`
        INSERT INTO doctors (name, spec, exp, rating, reviews, available, tags) VALUES 
        ('Dr. Budi Santoso, M.Psi', 'Konselor Akademik Kampus', '8 Tahun', 4.9, 214, true, 'Kecemasan Skripsi,Burnout,Manajemen Waktu'),
        ('Rina Oktavia, M.Psi', 'Psikolog Dewasa Muda', '5 Tahun', 4.8, 156, true, 'Quarter Life Crisis,Homesick,Depresi'),
        ('Dr. Sarah Wijaya, Sp.KJ', 'Psikiater Mahasiswa', '10 Tahun', 5.0, 312, false, 'ADHD,Gangguan Tidur,Stres Ujian')
      `);
    }

    console.log('Connected to PostgreSQL and verified tables');
  } catch (err) {
    console.error('Error initializing PostgreSQL tables', err);
  }
};

module.exports = { pool, initDB };
