const { pool } = require('./config/db');
const bcrypt = require('bcryptjs');

async function createAdmin() {
  const username = 'admin';
  const email = 'admin@mindease.com';
  const password = 'password123';
  
  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    
    // Check if admin already exists
    const check = await pool.query("SELECT * FROM users WHERE username = 'admin'");
    if (check.rows.length > 0) {
      // Ensure it has admin role
      await pool.query("UPDATE users SET role = 'admin' WHERE username = 'admin'");
      console.log('Admin user already exists. Role set to admin.');
    } else {
      await pool.query(
        "INSERT INTO users (username, email, password, role) VALUES ($1, $2, $3, 'admin')",
        [username, email, hashedPassword]
      );
      console.log('Admin user created successfully.');
    }
    
    console.log('Username: admin');
    console.log('Password: password123');
  } catch (err) {
    console.error(err);
  } finally {
    pool.end();
  }
}

createAdmin();
