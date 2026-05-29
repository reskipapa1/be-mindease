require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { initDB } = require('./config/db');

const authRoutes = require('./routes/authRoutes');
const postRoutes = require('./routes/postRoutes');
const moodRoutes = require('./routes/moodRoutes');
const adminRoutes = require('./routes/adminRoutes');
const publicRoutes = require('./routes/publicRoutes');
const chatRoutes = require('./routes/chatRoutes');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

// Initialize Database
initDB();

// Mount Routes
app.use('/api/auth', authRoutes);
app.use('/api/posts', postRoutes);
app.use('/api/moods', moodRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/public', publicRoutes);
app.use('/api/chat', chatRoutes);

// Daily Email Reminder Scheduler using node-cron (Setiap hari pukul 08:00 AM)
const cron = require('node-cron');
const { sendDailyMoodReminders } = require('./services/emailService');

cron.schedule('0 8 * * *', () => {
  console.log('⏰ [Cron Job] Memulai pengiriman otomatis email pengingat harian...');
  sendDailyMoodReminders();
});

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
