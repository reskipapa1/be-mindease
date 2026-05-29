const { pool } = require('../config/db');
const { sendDailyMoodReminders } = require('../services/emailService');
const bcrypt = require('bcryptjs');

/** Window length for trend charts (calendar days including today). */
const ANALYTICS_WINDOW_DAYS = 3;

exports.getStats = async (req, res) => {
  try {
    const userCount = await pool.query('SELECT COUNT(*) AS count FROM users');
    const postCount = await pool.query('SELECT COUNT(*) AS count FROM posts');
    const uCount = parseInt(userCount.rows[0].count || userCount.rows[0]['count(*)'] || userCount.rows[0]['COUNT(*)']) || 0;
    const pCount = parseInt(postCount.rows[0].count || postCount.rows[0]['count(*)'] || postCount.rows[0]['COUNT(*)']) || 0;
    res.json({
      users: uCount,
      posts: pCount,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error' });
  }
};

exports.getAnalytics = async (req, res) => {
  try {
    const windowDays = ANALYTICS_WINDOW_DAYS;

    // Generate last 3 dates in YYYY-MM-DD
    const dates = [];
    for (let i = windowDays - 1; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      dates.push(d.toLocaleDateString('en-CA'));
    }

    // 1. Mood Distribution
    const moodDistQuery = `
      SELECT mood_type, COUNT(*) AS count
      FROM moods
      GROUP BY mood_type
      ORDER BY mood_type
    `;
    const moodDistributionRes = await pool.query(moodDistQuery);

    // 2. Mood Trend (Last 3 days)
    const trendQuery = `
      SELECT date, mood_type, COUNT(*) AS count 
      FROM moods 
      WHERE date IN ($1, $2, $3) 
      GROUP BY date, mood_type
    `;
    const trendRes = await pool.query(trendQuery, dates);
    const moodTrend = dates.map(date => {
      const rows = trendRes.rows.filter(r => r.date === date);
      const happy = parseInt(rows.find(r => r.mood_type === 'happy')?.count || 0, 10);
      const neutral = parseInt(rows.find(r => r.mood_type === 'neutral')?.count || 0, 10);
      const sad = parseInt(rows.find(r => r.mood_type === 'sad')?.count || 0, 10);
      return { date, happy, neutral, sad };
    });

    // 3. Posts Per Day (Last 3 days)
    const postsRes = await pool.query("SELECT created_at FROM posts");
    const postsPerDay = dates.map(date => {
      const count = postsRes.rows.filter(r => {
        const postDate = r.created_at ? r.created_at.substring(0, 10) : '';
        return postDate === date;
      }).length;
      return { date, count };
    });

    // 4. User Growth (Last 3 days)
    const usersRes = await pool.query("SELECT created_at FROM users");
    const userGrowth = dates.map(date => {
      const count = usersRes.rows.filter(r => {
        const userDate = r.created_at ? r.created_at.substring(0, 10) : '';
        return userDate === date;
      }).length;
      return { date, count };
    });

    res.json({
      moodDistribution: moodDistributionRes.rows,
      moodTrend: moodTrend,
      postsPerDay: postsPerDay,
      userGrowth: userGrowth,
    });
  } catch (err) {
    console.error("Error getAnalytics:", err);
    res.status(500).json({ error: 'Database error' });
  }
};

exports.getPosts = async (req, res) => {
  try {
    const query = `
      SELECT posts.id, posts.content, posts.created_at, users.username 
      FROM posts 
      JOIN users ON posts.user_id = users.id 
      ORDER BY posts.created_at DESC
    `;
    const result = await pool.query(query);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error' });
  }
};

exports.deletePost = async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid post ID' });

  try {
    const result = await pool.query('DELETE FROM posts WHERE id = $1 RETURNING id', [id]);
    if (result.rowCount === 0) return res.status(404).json({ error: 'Post not found' });
    res.json({ message: 'Post deleted successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error' });
  }
};

exports.bulkDeletePosts = async (req, res) => {
  const { ids } = req.body;
  if (!ids || !Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: 'Post IDs are required' });
  }
  try {
    await pool.query('DELETE FROM posts WHERE id = ANY($1::int[])', [ids]);
    res.json({ message: 'Selected posts deleted successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error' });
  }
};

exports.createChannel = async (req, res) => {
  const { slug, name, description } = req.body;
  if (!slug || !name) return res.status(400).json({ error: 'Slug and Name are required' });

  // Clean slug
  const cleanSlug = slug.toLowerCase().trim().replace(/[^a-z0-9-_]/g, '-');

  try {
    const result = await pool.query(
      'INSERT INTO channels (slug, name, description) VALUES ($1, $2, $3) RETURNING *',
      [cleanSlug, name, description || '']
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505' || err.code === 'SQLITE_CONSTRAINT' || err.message.includes('UNIQUE')) {
      return res.status(400).json({ error: 'Saluran dengan slug ini sudah terdaftar' });
    }
    console.error(err);
    res.status(500).json({ error: 'Database error' });
  }
};

exports.deleteChannel = async (req, res) => {
  const { slug } = req.params;
  if (slug === 'curhat-umum') {
    return res.status(400).json({ error: 'Cannot delete the default general channel' });
  }
  try {
    // Delete all posts in this channel first
    await pool.query('DELETE FROM posts WHERE channel_slug = $1', [slug]);
    
    // Delete the channel
    const result = await pool.query('DELETE FROM channels WHERE slug = $1 RETURNING *', [slug]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Channel not found' });
    
    res.json({ message: 'Channel and its posts deleted successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error' });
  }
};

exports.getUsers = async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, username, role, created_at FROM users ORDER BY created_at DESC'
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error' });
  }
};

exports.deleteUser = async (req, res) => {
  const userId = parseInt(req.params.id, 10);
  if (!Number.isFinite(userId)) return res.status(400).json({ error: 'Invalid user ID' });
  if (userId === req.user.id) return res.status(400).json({ error: 'Cannot delete your own account' });

  try {
    const existing = await pool.query('SELECT role FROM users WHERE id = $1', [userId]);
    if (existing.rows.length === 0) return res.status(404).json({ error: 'User not found' });

    if (existing.rows[0].role === 'admin') {
      const admins = await pool.query("SELECT COUNT(*)::int AS n FROM users WHERE role = 'admin'");
      const adminCount = parseInt(admins.rows[0].n || admins.rows[0]['n'] || 0, 10);
      if (adminCount <= 1) {
        return res.status(400).json({ error: 'Cannot delete the last admin account' });
      }
    }

    await pool.query('DELETE FROM moods WHERE user_id = $1', [userId]);
    await pool.query('DELETE FROM posts WHERE user_id = $1', [userId]);
    await pool.query('DELETE FROM users WHERE id = $1', [userId]);
    res.json({ message: 'User deleted successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error' });
  }
};

exports.makeAdmin = async (req, res) => {
  try {
    const username = req.params.username?.trim();
    if (!username) return res.status(400).json({ error: 'Username required' });

    const result = await pool.query(
      "UPDATE users SET role = 'admin' WHERE username = $1 RETURNING id",
      [username]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'User not found' });
    res.json({ message: `User ${username} is now an admin` });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error' });
  }
};

exports.removeAdmin = async (req, res) => {
  try {
    const username = req.params.username?.trim();
    if (!username) return res.status(400).json({ error: 'Username required' });

    const existing = await pool.query('SELECT id, role FROM users WHERE username = $1', [username]);
    if (existing.rows.length === 0) return res.status(404).json({ error: 'User not found' });
    if (existing.rows[0].role !== 'admin') {
      return res.status(400).json({ error: 'User is not an admin' });
    }

    const admins = await pool.query("SELECT COUNT(*)::int AS n FROM users WHERE role = 'admin'");
    const adminCount = parseInt(admins.rows[0].n || admins.rows[0]['n'] || 0, 10);
    if (adminCount <= 1) {
      return res.status(400).json({ error: 'Cannot remove the last admin' });
    }

    await pool.query("UPDATE users SET role = 'user' WHERE username = $1", [username]);
    res.json({ message: `Admin rights removed from ${username}` });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error' });
  }
};

exports.getSettings = async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM settings');
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error' });
  }
};

exports.updateSetting = async (req, res) => {
  const { setting_key, setting_value } = req.body;
  if (!setting_key || !setting_value) return res.status(400).json({ error: 'Key and value required' });
  try {
    await pool.query(
      'INSERT INTO settings (setting_key, setting_value) VALUES ($1, $2) ON CONFLICT (setting_key) DO UPDATE SET setting_value = $2',
      [setting_key, setting_value]
    );
    res.json({ message: 'Setting updated successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error' });
  }
};

exports.getDoctorsAdmin = async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM doctors ORDER BY id ASC');
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error' });
  }
};

exports.addDoctor = async (req, res) => {
  const { name, spec, exp, rating, reviews, available, tags } = req.body;
  try {
    const result = await pool.query(
      'INSERT INTO doctors (name, spec, exp, rating, reviews, available, tags) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *',
      [name, spec, exp, rating, reviews, available, tags]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error' });
  }
};

exports.updateDoctor = async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { name, spec, exp, rating, reviews, available, tags } = req.body;
  try {
    const result = await pool.query(
      'UPDATE doctors SET name = $1, spec = $2, exp = $3, rating = $4, reviews = $5, available = $6, tags = $7 WHERE id = $8 RETURNING *',
      [name, spec, exp, rating, reviews, available, tags, id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Doctor not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error' });
  }
};

exports.deleteDoctor = async (req, res) => {
  const id = parseInt(req.params.id, 10);
  try {
    const result = await pool.query('DELETE FROM doctors WHERE id = $1 RETURNING id', [id]);
    if (result.rowCount === 0) return res.status(404).json({ error: 'Doctor not found' });
    res.json({ message: 'Doctor deleted successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error' });
  }
};

exports.createUser = async (req, res) => {
  const { username, email, password, role } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username dan Password wajib diisi' });
  }

  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    const result = await pool.query(
      'INSERT INTO users (username, email, password, role) VALUES ($1, $2, $3, $4) RETURNING id, username, email, role',
      [username, email || '', hashedPassword, role || 'user']
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505' || err.message.includes('UNIQUE')) {
      return res.status(400).json({ error: 'Username atau Email sudah terdaftar' });
    }
    console.error(err);
    res.status(500).json({ error: 'Database error' });
  }
};

exports.sendReminders = async (req, res) => {
  try {
    const result = await sendDailyMoodReminders();
    if (result.success) {
      res.json({ message: result.message, count: result.count, type: result.type });
    } else {
      res.status(500).json({ error: result.error });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to trigger reminders' });
  }
};

exports.changeUserRole = async (req, res) => {
  const userId = parseInt(req.params.id, 10);
  const { role } = req.body;
  if (!Number.isFinite(userId)) return res.status(400).json({ error: 'Invalid user ID' });
  if (!role || (role !== 'admin' && role !== 'user')) {
    return res.status(400).json({ error: 'Role must be either user or admin' });
  }

  try {
    // If demoting to user, ensure we are not demoting the last admin
    if (role === 'user') {
      const existing = await pool.query('SELECT role FROM users WHERE id = $1', [userId]);
      if (existing.rows.length > 0 && existing.rows[0].role === 'admin') {
        const admins = await pool.query("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'");
        const adminCount = parseInt(admins.rows[0].n || admins.rows[0]['n'] || 0, 10);
        if (adminCount <= 1) {
          return res.status(400).json({ error: 'Cannot demote the last admin account' });
        }
      }
    }

    const result = await pool.query(
      'UPDATE users SET role = $1 WHERE id = $2 RETURNING id, username, role',
      [role, userId]
    );

    if (result.rows.length === 0) return res.status(404).json({ error: 'User not found' });
    res.json({ message: `User role updated successfully to ${role}`, user: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error' });
  }
};
