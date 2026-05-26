const { pool } = require('../config/db');

/** Window length for trend charts (calendar days including today). */
const ANALYTICS_WINDOW_DAYS = 3;

exports.getStats = async (req, res) => {
  try {
    const userCount = await pool.query('SELECT COUNT(*) FROM users');
    const postCount = await pool.query('SELECT COUNT(*) FROM posts');
    res.json({
      users: parseInt(userCount.rows[0].count, 10),
      posts: parseInt(postCount.rows[0].count, 10),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error' });
  }
};

exports.getAnalytics = async (req, res) => {
  try {
    const windowDays = ANALYTICS_WINDOW_DAYS;

    const [moodDistributionRes, moodTrendRes, postsPerDayRes, userGrowthRes] = await Promise.all([
      pool.query(`
        SELECT mood_type, COUNT(*)::int AS count
        FROM moods
        GROUP BY mood_type
        ORDER BY mood_type
      `),
      pool.query(
        `
        SELECT TO_CHAR(d.day, 'YYYY-MM-DD') AS date,
          COALESCE(SUM(CASE WHEN m.mood_type = 'happy' THEN 1 ELSE 0 END), 0)::int AS happy,
          COALESCE(SUM(CASE WHEN m.mood_type = 'neutral' THEN 1 ELSE 0 END), 0)::int AS neutral,
          COALESCE(SUM(CASE WHEN m.mood_type = 'sad' THEN 1 ELSE 0 END), 0)::int AS sad
        FROM generate_series(
          (CURRENT_DATE - (($1::int - 1) * INTERVAL '1 day'))::date,
          CURRENT_DATE::date,
          INTERVAL '1 day'
        ) AS d(day)
        LEFT JOIN moods m ON (
          m.date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
          AND (m.date)::date = d.day
        )
        GROUP BY d.day
        ORDER BY d.day ASC
      `,
        [windowDays]
      ),
      pool.query(
        `
        SELECT TO_CHAR(d.day, 'YYYY-MM-DD') AS date,
          COUNT(p.id)::int AS count
        FROM generate_series(
          (CURRENT_DATE - (($1::int - 1) * INTERVAL '1 day'))::date,
          CURRENT_DATE::date,
          INTERVAL '1 day'
        ) AS d(day)
        LEFT JOIN posts p ON ((p.created_at)::date = d.day)
        GROUP BY d.day
        ORDER BY d.day ASC
      `,
        [windowDays]
      ),
      pool.query(
        `
        SELECT TO_CHAR(d.day, 'YYYY-MM-DD') AS date,
          COUNT(u.id)::int AS count
        FROM generate_series(
          (CURRENT_DATE - (($1::int - 1) * INTERVAL '1 day'))::date,
          CURRENT_DATE::date,
          INTERVAL '1 day'
        ) AS d(day)
        LEFT JOIN users u ON ((u.created_at)::date = d.day)
        GROUP BY d.day
        ORDER BY d.day ASC
      `,
        [windowDays]
      ),
    ]);

    res.json({
      moodDistribution: moodDistributionRes.rows,
      moodTrend: moodTrendRes.rows,
      postsPerDay: postsPerDayRes.rows,
      userGrowth: userGrowthRes.rows,
    });
  } catch (err) {
    console.error(err);
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
    if (err.code === '23505') {
      return res.status(400).json({ error: 'Channel with this slug already exists' });
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
      if (admins.rows[0].n <= 1) {
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
    if (admins.rows[0].n <= 1) {
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
