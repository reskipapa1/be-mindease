const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { pool } = require('../config/db');
const { SECRET_KEY } = require('../middleware/authMiddleware');
const crypto = require('crypto');
const { sendResetPasswordEmail, sendWelcomeEmail } = require('../services/emailService');

exports.register = async (req, res) => {
  const { username, email, password, birth_date, gender } = req.body;
  if (!username || !email || !password || !birth_date || !gender) {
    return res.status(400).json({ error: 'Username, email, password, tanggal lahir, dan jenis kelamin wajib diisi' });
  }

  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    const result = await pool.query(
      'INSERT INTO users (username, email, password, birth_date, gender) VALUES ($1, $2, $3, $4, $5) RETURNING id',
      [username, email, hashedPassword, birth_date, gender]
    );
    res.status(201).json({ message: 'User registered successfully', userId: result.rows[0].id });
    
    // Kirim email perkenalan/sambutan secara background (async)
    sendWelcomeEmail(email, username).catch(e => console.error("Gagal mengirim email sambutan:", e));
  } catch (err) {
    if (err.code === '23505' || err.code === 'SQLITE_CONSTRAINT' || err.message.includes('UNIQUE')) {
      const errMsg = err.message.toLowerCase();
      if (errMsg.includes('email')) {
        return res.status(400).json({ error: 'Email sudah terdaftar' });
      }
      if (errMsg.includes('username')) {
        return res.status(400).json({ error: 'Username sudah terdaftar' });
      }
      return res.status(400).json({ error: 'Username atau Email sudah terdaftar' });
    }
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};

exports.login = async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });

  try {
    const result = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
    if (result.rows.length === 0) return res.status(400).json({ error: 'Invalid username or password' });

    const user = result.rows[0];
    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) return res.status(400).json({ error: 'Invalid username or password' });

    const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, SECRET_KEY, { expiresIn: '24h' });
    res.json({ message: 'Logged in successfully', token, user: { id: user.id, username: user.username, role: user.role } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error' });
  }
};
exports.getProfile = async (req, res) => {
  try {
    const result = await pool.query('SELECT id, username, email, birth_date, gender, role FROM users WHERE id = $1', [req.user.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'User not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database error' });
  }
};

exports.updateProfile = async (req, res) => {
  const { username, email, password, birth_date, gender } = req.body;
  const userId = req.user.id;
  try {
    let query = 'UPDATE users SET username = $1, email = $2, birth_date = $3, gender = $4';
    let values = [username, email, birth_date, gender, userId];
    
    if (password) {
      const hashedPassword = await bcrypt.hash(password, 10);
      query += ', password = $6 WHERE id = $5 RETURNING id, username, email, birth_date, gender, role';
      values.push(hashedPassword);
    } else {
      query += ' WHERE id = $5 RETURNING id, username, email, birth_date, gender, role';
    }
    
    const result = await pool.query(query, values);
    if (result.rows.length === 0) return res.status(404).json({ error: 'User not found' });
    
    const updatedUser = result.rows[0];
    const token = jwt.sign({ id: updatedUser.id, username: updatedUser.username, role: updatedUser.role }, SECRET_KEY, { expiresIn: '24h' });
    res.json({ message: 'Profile updated successfully', token, user: updatedUser });
  } catch (err) {
    if (err.code === '23505' || err.code === 'SQLITE_CONSTRAINT' || err.message.includes('UNIQUE')) {
      return res.status(400).json({ error: 'Username atau Email sudah terdaftar' });
    }
    console.error(err);
    res.status(500).json({ error: 'Database error' });
  }
};

exports.forgotPassword = async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email wajib diisi' });

  try {
    const checkUser = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    if (checkUser.rows.length === 0) {
      return res.status(400).json({ error: 'Email tidak terdaftar' });
    }

    const user = checkUser.rows[0];
    const token = crypto.randomBytes(20).toString('hex');
    const expires = (Date.now() + 3600000).toString(); // 1 hour expiration in ms

    await pool.query(
      'UPDATE users SET reset_token = $1, reset_token_expires = $2 WHERE id = $3',
      [token, expires, user.id]
    );

    await sendResetPasswordEmail(user.email, user.username, token);
    res.json({ message: 'Tautan reset password berhasil dikirim ke email Anda' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database atau server error' });
  }
};

exports.resetPassword = async (req, res) => {
  const { token, password } = req.body;
  if (!token || !password) {
    return res.status(400).json({ error: 'Token dan Password baru wajib diisi' });
  }

  try {
    const checkUser = await pool.query('SELECT * FROM users WHERE reset_token = $1', [token]);
    if (checkUser.rows.length === 0) {
      return res.status(400).json({ error: 'Token tidak valid atau sudah digunakan' });
    }

    const user = checkUser.rows[0];
    const expiry = parseInt(user.reset_token_expires, 10);
    if (Date.now() > expiry) {
      return res.status(400).json({ error: 'Tautan reset password telah kadaluarsa' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    await pool.query(
      'UPDATE users SET password = $1, reset_token = NULL, reset_token_expires = NULL WHERE id = $2',
      [hashedPassword, user.id]
    );

    res.json({ message: 'Password berhasil direset. Silakan masuk kembali dengan password baru Anda' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Database atau server error' });
  }
};
