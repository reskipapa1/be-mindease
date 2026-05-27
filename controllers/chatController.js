// Native fetch tersedia di Node.js 18+ — tidak perlu install node-fetch
const { pool } = require('../config/db');

const FASTAPI_URL = 'http://localhost:8000';

/**
 * chatAgent — Proxy tipis ke FastAPI /chat
 * Semua logika AI (safety protocol, feature extraction, Groq) ada di FastAPI.
 * Controller ini hanya meneruskan request, dan menambahkan logging riwayat ke PostgreSQL.
 */
exports.chatAgent = async (req, res) => {
  try {
    const { message, currentState, session_id } = req.body;

    // 1. Perekaman pesan user ke database (hanya jika pengguna sedang login)
    if (req.user && session_id) {
      try {
        await pool.query(
          "INSERT INTO chat_history (user_id, session_id, sender, text, type) VALUES ($1, $2, $3, $4, $5)",
          [req.user.id, session_id, 'user', message, 'text']
        );
      } catch (dbErr) {
        console.error("Gagal merekam chat user ke DB:", dbErr.message);
      }
    }

    // 2. Kirim request ke FastAPI (Engine Utama)
    const response = await fetch(`${FASTAPI_URL}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            message: message,
            history: currentState  // currentState dikirim sebagai history ke FastAPI
        })
    });

    if (!response.ok) {
        throw new Error(`FastAPI error: ${response.status}`);
    }

    const data = await response.json();

    // 3. Perekaman pesan balasan AI ke database (hanya jika pengguna sedang login)
    if (req.user && session_id && data.reply) {
      try {
        await pool.query(
          "INSERT INTO chat_history (user_id, session_id, sender, text, type) VALUES ($1, $2, $3, $4, $5)",
          [req.user.id, session_id, 'ai', data.reply, 'text']
        );
      } catch (dbErr) {
        console.error("Gagal merekam chat AI ke DB:", dbErr.message);
      }
    }

    // 4. Format response sesuai yang diharapkan frontend (Chatbot.jsx)
    // { reply, extractedFeatures, is_crisis, action, hotlines }
    res.json(data);

  } catch (error) {
    console.error("chatAgent Proxy Error:", error.message);
    res.json({
        reply: "Aku dengar kamu kok. Ceritakan lebih lanjut, aku ada di sini untukmu. 💙",
        extractedFeatures: {},
        is_crisis: false,
        action: "CONTINUE_CHAT"
    });
  }
};

exports.getChatHistory = async (req, res) => {
  try {
    const { session_id } = req.query;

    if (!session_id) {
      return res.status(400).json({ error: 'session_id is required' });
    }

    const result = await pool.query(
      "SELECT * FROM chat_history WHERE user_id = $1 AND session_id = $2 ORDER BY created_at ASC",
      [req.user.id, session_id]
    );

    const formattedHistory = result.rows.map(row => {
      if (row.type === 'result') {
        return {
          id: row.id,
          sender: row.sender,
          type: 'result',
          riskLevel: row.risk_level,
          burnoutScore: row.burnout_score,
          recommendation: row.recommendation
        };
      }
      return {
        id: row.id,
        sender: row.sender,
        text: row.text
      };
    });

    res.json(formattedHistory);
  } catch (err) {
    console.error("Error getChatHistory:", err);
    res.status(500).json({ error: 'Database error' });
  }
};

exports.saveChatResult = async (req, res) => {
  try {
    const { riskLevel, burnoutScore, recommendation, session_id } = req.body;

    if (!riskLevel || burnoutScore === undefined || !recommendation || !session_id) {
      return res.status(400).json({ error: 'Missing required parameters' });
    }

    const result = await pool.query(
      "INSERT INTO chat_history (user_id, session_id, sender, type, risk_level, burnout_score, recommendation) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id",
      [req.user.id, session_id, 'ai', 'result', riskLevel, parseFloat(burnoutScore), recommendation]
    );

    // Update status diagnosis sesi di tabel chat_sessions agar ter-update di dropdown list
    await pool.query(
      "UPDATE chat_sessions SET risk_level = $1, burnout_score = $2 WHERE id = $3 AND user_id = $4",
      [riskLevel, parseFloat(burnoutScore), session_id, req.user.id]
    );

    res.status(201).json({ message: 'Result card saved successfully', id: result.rows[0].id });
  } catch (err) {
    console.error("Error saveChatResult:", err);
    res.status(500).json({ error: 'Database error' });
  }
};

exports.getSessions = async (req, res) => {
  try {
    let result = await pool.query(
      "SELECT * FROM chat_sessions WHERE user_id = $1 ORDER BY created_at DESC",
      [req.user.id]
    );

    // Jika user belum memiliki sesi obrolan sama sekali, buatkan secara otomatis
    if (result.rows.length === 0) {
      const newSession = await pool.query(
        "INSERT INTO chat_sessions (user_id, title) VALUES ($1, $2) RETURNING *",
        [req.user.id, 'Obrolan Baru #1']
      );
      
      // Kirim salam pembuka default dari AI ke riwayat chat baru ini
      await pool.query(
        "INSERT INTO chat_history (user_id, session_id, sender, text, type) VALUES ($1, $2, $3, $4, $5)",
        [req.user.id, newSession.rows[0].id, 'ai', 'Halo! Saya AI MindEase. Ada yang ingin kamu ceritakan hari ini? Jangan ragu untuk berbagi.', 'text']
      );
      
      return res.json([newSession.rows[0]]);
    }

    res.json(result.rows);
  } catch (err) {
    console.error("Error getSessions:", err);
    res.status(500).json({ error: 'Database error' });
  }
};

exports.createSession = async (req, res) => {
  try {
    // Ambil jumlah sesi untuk penomoran
    const countResult = await pool.query(
      "SELECT COUNT(*) FROM chat_sessions WHERE user_id = $1",
      [req.user.id]
    );
    const sessionNum = parseInt(countResult.rows[0].count) + 1;
    const title = `Obrolan Baru #${sessionNum}`;

    const newSession = await pool.query(
      "INSERT INTO chat_sessions (user_id, title) VALUES ($1, $2) RETURNING *",
      [req.user.id, title]
    );

    // Tambahkan salam AI pembuka default
    await pool.query(
      "INSERT INTO chat_history (user_id, session_id, sender, text, type) VALUES ($1, $2, $3, $4, $5)",
      [req.user.id, newSession.rows[0].id, 'ai', 'Halo! Saya AI MindEase. Ada yang ingin kamu ceritakan hari ini? Jangan ragu untuk berbagi.', 'text']
    );

    res.status(201).json(newSession.rows[0]);
  } catch (err) {
    console.error("Error createSession:", err);
    res.status(500).json({ error: 'Database error' });
  }
};

exports.deleteSession = async (req, res) => {
  try {
    const { id } = req.params;

    // Hapus sesi (akan memicu cascade ON DELETE pada chat_history secara otomatis)
    await pool.query(
      "DELETE FROM chat_sessions WHERE id = $1 AND user_id = $2",
      [id, req.user.id]
    );

    res.json({ message: 'Sesi obrolan berhasil dihapus.' });
  } catch (err) {
    console.error("Error deleteSession:", err);
    res.status(500).json({ error: 'Database error' });
  }
};
