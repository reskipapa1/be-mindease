// Native fetch tersedia di Node.js 18+ — tidak perlu install node-fetch
const { pool } = require('../config/db');

let GoogleGenAI, Groq;
try {
  GoogleGenAI = require('@google/genai').GoogleGenAI;
} catch (e) {
  console.warn("Package @google/genai tidak terinstall.");
}
try {
  Groq = require('groq-sdk');
} catch (e) {
  console.warn("Package groq-sdk tidak terinstall.");
}

const FASTAPI_URL = process.env.ML_API_URL || 'http://localhost:8000';

async function callAI(systemPrompt, userMessage) {
  // 1. Coba Gemini jika ada kunci
  if (process.env.GEMINI_API_KEY && GoogleGenAI) {
    console.log("[AI Agent] Menggunakan Google Gemini Model...");
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [
        { role: 'user', parts: [{ text: `${systemPrompt}\n\nPesan User:\n"${userMessage}"` }] }
      ],
      config: {
        responseMimeType: 'application/json',
        temperature: 0.7
      }
    });
    return response.text;
  }

  // 2. Coba Groq jika ada kunci
  if (process.env.GROQ_API_KEY && Groq) {
    console.log("[AI Agent] Menggunakan Groq Llama Model...");
    const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
    const completion = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage }
      ],
      response_format: { type: "json_object" },
      temperature: 0.7,
      max_tokens: 1024,
    });
    return completion.choices[0].message.content;
  }

  throw new Error("No API keys configured");
}

async function callAITitle(userMessage) {
  const prompt = `Buatkan judul percakapan sangat singkat (maksimal 3 kata) yang merangkum maksud dari kalimat ini: "${userMessage}". Balas HANYA dengan judulnya saja, tanpa tanda kutip, tanpa titik.`;

  if (process.env.GEMINI_API_KEY && GoogleGenAI) {
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      config: { temperature: 0.3 }
    });
    return response.text.trim();
  }

  if (process.env.GROQ_API_KEY && Groq) {
    const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
    const completion = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.3,
      max_tokens: 15
    });
    return completion.choices[0].message.content.trim();
  }

  throw new Error("No API keys configured");
}

function calculateAge(birthDateStr) {
  if (!birthDateStr) return null;
  const birthDate = new Date(birthDateStr);
  if (isNaN(birthDate.getTime())) return null;
  const today = new Date();
  let age = today.getFullYear() - birthDate.getFullYear();
  const m = today.getMonth() - birthDate.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) {
    age--;
  }
  return age;
}

function mapGender(genderStr) {
  if (!genderStr) return null;
  const g = genderStr.trim().toLowerCase();
  if (g.startsWith('l') || g === 'pria' || g === 'male' || g === 'laki-laki') return 'Male';
  if (g.startsWith('p') || g === 'wanita' || g === 'female' || g === 'perempuan') return 'Female';
  return 'Other';
}

exports.chatAgent = async (req, res) => {
  try {
    const { message, currentState, session_id, mode } = req.body;
    const activeMode = mode || 'chat';

    // Ambil data profil (gender & umur) otomatis untuk disuntikkan demi kenyamanan UX
    let userGender = null;
    let userAge = null;

    if (req.user) {
      try {
        const userRes = await pool.query(
          "SELECT gender, birth_date FROM users WHERE id = $1",
          [req.user.id]
        );
        if (userRes.rows.length > 0) {
          const userObj = userRes.rows[0];
          userGender = mapGender(userObj.gender);
          userAge = calculateAge(userObj.birth_date);
        }
      } catch (dbErr) {
        console.error("Gagal mengambil profil user untuk chatbot:", dbErr.message);
      }
    }

    // Suntikkan gender & age jika belum terisi di currentState
    if (currentState && typeof currentState === 'object') {
      if (userGender && currentState.gender === null) {
        currentState.gender = userGender;
      }
      if (userAge && currentState.age === null) {
        currentState.age = userAge;
      }
    }

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

    // Cek krisis darurat secara lokal demi keamanan!
    const CRISIS_KEYWORDS = [
      "bunuh diri", "ingin mati", "mau mati", "tidak mau hidup", "mau bunuh",
      "mengakhiri hidup", "tidak ada gunanya hidup", "lebih baik mati",
      "pengen mati", "pengin mati", "pengen bunuh diri", "pengin bunuh diri",
      "self harm", "menyakiti diri"
    ];
    const isCrisis = CRISIS_KEYWORDS.some(kw => message.toLowerCase().includes(kw));
    
    if (isCrisis) {
      const crisisResponse = {
        is_crisis: true,
        reply: "Hei, saya mendengarmu. Apa yang kamu rasakan sekarang sangat berat, dan saya khawatir dengan keadaanmu. Kamu tidak harus melewati ini sendirian. Tolong hubungi salah satu bantuan di bawah ini sekarang ya.",
        extractedFeatures: {},
        action: "SHOW_EMERGENCY_CONTACTS",
        hotlines: [
          { name: "Into The Light Indonesia", number: "119", ext: "ext 8", hours: "24 jam" },
          { name: "Yayasan Pulih", number: "02178842580", display: "(021) 788-42580", hours: "Senin-Jumat" },
          { name: "Hotline Kemenkes", number: "1500454", display: "1500-454", hours: "24 jam" }
        ]
      };

      if (req.user && session_id) {
        try {
          await pool.query(
            "INSERT INTO chat_history (user_id, session_id, sender, text, type) VALUES ($1, $2, $3, $4, $5)",
            [req.user.id, session_id, 'ai', crisisResponse.reply, 'text']
          );
        } catch (dbErr) {}
      }

      return res.json(crisisResponse);
    }

    // 2. Coba panggil AI Model jika API Key tersedia
    if ((process.env.GEMINI_API_KEY && GoogleGenAI) || (process.env.GROQ_API_KEY && Groq)) {
      try {
        const missingFeatures = [];
        if (currentState && typeof currentState === 'object') {
          for (const [key, value] of Object.entries(currentState)) {
            if (value === null) {
              missingFeatures.push(key);
            }
          }
        }
        const nextQuestionHint = missingFeatures[0] || 'semua sudah lengkap';

        let prompt = "";
        
        if (activeMode === 'chat') {
          prompt = `Kamu adalah "MindEase AI", sahabat curhat yang sangat empatik, hangat, dan suportif untuk mahasiswa Indonesia.

TUGASMU:
1. Berikan tanggapan yang tulus, penuh empati, dan menenangkan (2-3 kalimat bahasa Indonesia santai).
2. Fokus sepenuhnya pada validasi emosi dan mendengarkan keluh kesah user secara alami.
3. JANGAN pernah menanyakan data teknis, skor, angka, atau variabel apa pun secara paksa. Biarkan percakapan mengalir santai.
4. Di akhir tanggapan, Anda boleh mengajukan satu pertanyaan terbuka yang lembut untuk mendorong mereka bercerita lebih lanjut tentang perasaan mereka (bukan tentang data numerik).
5. Dari pesan user, tetap lakukan ekstraksi secara diam-diam JIKA mereka menyebutkan informasi berikut (jika tidak ada, kosongkan saja):
   - age (umur, angka)
   - gender (Male/Female/Other)
   - academic_year (tahun kuliah 1-4, angka)
   - study_hours_per_day (jam belajar per hari, angka)
   - exam_pressure (tekanan ujian 0-10, angka)
   - academic_performance (nilai akademik 0-100, angka)
   - stress_level (level stres 0-10, angka)
   - anxiety_score (skor kecemasan 0-10, angka)
   - depression_score (skor depresi 0-10, angka)
   - sleep_hours (jam tidur per hari, angka)
   - physical_activity (jam olahraga per minggu, angka)
   - social_support (dukungan sosial 0-10, angka)
   - screen_time (jam layar per hari, angka)
   - internet_usage (jam internet per hari, angka)
   - financial_stress (tekanan finansial 0-10, angka)
   - family_expectation (ekspektasi keluarga 0-10, angka)

PENTING: Hanya balas dengan JSON murni dengan struktur:
{"reply": "balasan empati kamu", "extractedFeatures": {"nama_fitur": nilai}}`;
        } else {
          prompt = `Kamu adalah "MindEase AI", asisten kesehatan mental yang lembut dan penuh empati. Saat ini kamu sedang membimbing user dalam sesi **Asesmen Kesehatan Mental Terpandu** secara bertahap.

TUGASMU:
1. Target pertanyaan saat ini adalah untuk menggali info tentang fitur: "${nextQuestionHint}".
2. Balas pesan user dengan empati hangat (1-2 kalimat), kemudian ajukan satu pertanyaan kualitatif yang sangat natural tentang "${nextQuestionHint}".
3. ATURAN MUTLAK: JANGAN PERNAH menanyakan nilai angka atau rate 1-10 secara langsung!
   - Contoh salah: "Dari 1-10 seberapa cemas kamu?"
   - Contoh benar: "Bagaimana rasanya ketika kecemasan itu datang menyerangmu? Apakah kamu merasa sangat tidak tenang dan panik, atau masih bisa dikendalikan dengan baik?"
4. Dari jawaban kualitatif user, kamu harus menyimpulkan sendiri nilai estimasi angkanya:
   - Skala 1-10 (misal: stress_level, anxiety_score, depression_score, exam_pressure, social_support, financial_stress, family_expectation):
     * Sangat ringan/hampir tidak ada -> 1-2
     * Ringan/kadang-kadang -> 3-4
     * Sedang/cukup terasa -> 5-6
     * Berat/sering/cukup mengganggu -> 7-8
     * Sangat berat/ekstrem/tidak tertahankan -> 9-10
   - Skala 0-100 (academic_performance):
     * Kurang/buruk -> 40-59
     * Cukup/sedang -> 60-79
     * Sangat baik/IPK tinggi -> 80-100
5. Masukkan nilai kesimpulan angka tersebut ke dalam objek extractedFeatures untuk fitur: "${nextQuestionHint}".

PENTING: Hanya balas dengan JSON murni dengan struktur:
{"reply": "balasan empati dan pertanyaan kualitatif kamu", "extractedFeatures": {"nama_fitur": nilai}}`;
        }

        const rawText = await callAI(prompt, message);
        let parsed = { reply: "Aku mendengarmu. Ceritakan lebih banyak ya. 💙", extractedFeatures: {} };
        try {
          parsed = JSON.parse(rawText);
        } catch (jsonErr) {
          const jsonMatch = rawText.match(/\{[\s\S]*\}/);
          if (jsonMatch) parsed = JSON.parse(jsonMatch[0]);
        }

        const cleanFeatures = {};
        if (parsed.extractedFeatures) {
          for (const [k, v] of Object.entries(parsed.extractedFeatures)) {
            if (v !== null && v !== "") {
              cleanFeatures[k] = v;
            }
          }
        }

        // Suntikkan gender & age jika belum ada di percakapan aktif
        if (userGender && (!currentState || currentState.gender === null)) {
          cleanFeatures.gender = userGender;
        }
        if (userAge && (!currentState || currentState.age === null)) {
          cleanFeatures.age = userAge;
        }

        // Perekaman pesan balasan AI ke database
        if (req.user && session_id && parsed.reply) {
          try {
            await pool.query(
              "INSERT INTO chat_history (user_id, session_id, sender, text, type) VALUES ($1, $2, $3, $4, $5)",
              [req.user.id, session_id, 'ai', parsed.reply, 'text']
            );
          } catch (dbErr) {
            console.error("Gagal merekam chat AI ke DB:", dbErr.message);
          }
        }

        return res.json({
          reply: parsed.reply,
          extractedFeatures: cleanFeatures,
          is_crisis: false,
          action: "CONTINUE_CHAT"
        });

      } catch (aiError) {
        console.warn("⚠️ AI Model Error, beralih ke Smart Local Fallback:", aiError.message);
      }
    }

    // 3. Coba kirim request ke FastAPI (Engine Utama - jika berjalan lokal)
    try {
      const response = await fetch(`${FASTAPI_URL}/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
              message: message,
              history: currentState
          })
      });

      if (response.ok) {
        const data = await response.json();
        
        // Suntikkan gender & age jika belum ada di percakapan aktif
        if (!data.extractedFeatures) {
          data.extractedFeatures = {};
        }
        if (userGender && (!currentState || currentState.gender === null)) {
          data.extractedFeatures.gender = userGender;
        }
        if (userAge && (!currentState || currentState.age === null)) {
          data.extractedFeatures.age = userAge;
        }

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
        return res.json(data);
      }
    } catch (fastApiErr) {
      // Abaikan dan lanjut ke Smart Local Fallback
    }

    // ==========================================
    // SMART LOCAL FALLBACK (Mode Teman Curhat)
    // ==========================================
    console.warn("⚠️ FastAPI/Groq Offline. Mengaktifkan Mode Teman Curhat MindEase (Smart Local Fallback)...");

    const missingFeatures = [];
    if (currentState && typeof currentState === 'object') {
      for (const [key, value] of Object.entries(currentState)) {
        if (value === null) {
          missingFeatures.push(key);
        }
      }
    }

    let reply = "Aku di sini untuk mendengarkanmu. Ceritakan lebih banyak tentang apa yang sedang kamu rasakan ya. 💙";
    const extracted = {};



    // Ekstrak fitur secara cerdas dari input pesan user saat ini
    const numMatch = message.match(/\b\d+(\.\d+)?\b/);
    const parsedNum = numMatch ? parseFloat(numMatch[0]) : null;

    if (missingFeatures.length > 0) {
      const nextFeature = missingFeatures[0];

      // Simulasikan ekstraksi berdasarkan apa yang dijawab user
      if (nextFeature === 'age' && parsedNum && parsedNum > 10 && parsedNum < 100) {
        extracted['age'] = parsedNum;
        missingFeatures.shift();
      } else if (nextFeature === 'gender') {
        const textLower = message.toLowerCase();
        if (textLower.includes('perempuan') || textLower.includes('cewek') || textLower.includes('wanita') || textLower.includes('female')) {
          extracted['gender'] = 'Female';
          missingFeatures.shift();
        } else if (textLower.includes('laki') || textLower.includes('cowok') || textLower.includes('pria') || textLower.includes('male')) {
          extracted['gender'] = 'Male';
          missingFeatures.shift();
        }
      } else if (parsedNum !== null) {
        // Imputasi angka ke fitur numerik berikutnya
        extracted[nextFeature] = parsedNum;
        missingFeatures.shift();
      }

      // Siapkan pertanyaan berikutnya untuk menggali fitur yang masih null
      if (missingFeatures.length > 0) {
        const currentTarget = missingFeatures[0];
        const questions = {
          age: "Boleh tahu berapa umurmu saat ini? (contoh: 20)",
          gender: "Apa jenis kelaminmu? (Laki-laki / Perempuan)",
          academic_year: "Saat ini kamu sedang menempuh perkuliahan di tahun/angkatan ke berapa? (1 - 4)",
          study_hours_per_day: "Berapa jam yang biasanya kamu habiskan untuk belajar dalam sehari?",
          exam_pressure: "Dari skala 1 sampai 10, seberapa berat tekanan ujian yang kamu rasakan?",
          academic_performance: "Berapa nilai rata-rata prestasi akademik (IPK/nilai) kamu dalam skala 100?",
          stress_level: "Dari skala 1 sampai 10, berapa tingkat stres yang kamu rasakan belakangan ini?",
          anxiety_score: "Dari skala 1 sampai 10, seberapa sering kamu merasakan kecemasan berlebih?",
          depression_score: "Dari skala 1 sampai 10, seberapa sering kamu merasa sedih atau lelah emosional?",
          sleep_hours: "Berapa jam rata-rata kamu tidur dalam sehari?",
          physical_activity: "Berapa jam biasanya kamu berolahraga atau melakukan aktivitas fisik dalam seminggu?",
          social_support: "Dari skala 1 sampai 10, seberapa besar dukungan sosial yang kamu rasakan dari teman atau keluarga?",
          screen_time: "Berapa jam rata-rata screen time (waktu di depan layar HP/laptop) kamu per hari?",
          internet_usage: "Berapa jam waktu yang kamu habiskan untuk internetan dalam sehari?",
          financial_stress: "Dari skala 1 sampai 10, seberapa besar tekanan finansial yang kamu rasakan saat ini?",
          family_expectation: "Dari skala 1 sampai 10, seberapa tinggi ekspektasi keluarga yang membebanimu?"
        };

        const featureLabels = {
          age: "umur",
          gender: "jenis kelamin",
          academic_year: "tahun kuliah",
          study_hours_per_day: "jam belajar per hari",
          exam_pressure: "tekanan ujian",
          academic_performance: "prestasi akademik",
          stress_level: "level stres",
          anxiety_score: "skor kecemasan",
          depression_score: "skor depresi",
          sleep_hours: "jam tidur",
          physical_activity: "aktivitas fisik",
          social_support: "dukungan sosial",
          screen_time: "screen time",
          internet_usage: "penggunaan internet",
          financial_stress: "tekanan finansial",
          family_expectation: "ekspektasi keluarga"
        };

        const targetLabel = featureLabels[currentTarget] || currentTarget;
        const defaultQuestion = `Boleh ceritakan seputar ${targetLabel} kamu?`;

        reply = `Terima kasih sudah berbagi. ${questions[currentTarget] || defaultQuestion} 💙`;
      } else {
        reply = "Semua informasimu telah lengkap terkumpul! Yuk, klik tombol **'Selesaikan & Analisis'** di bagian bawah untuk melihat hasil analisis kesehatan mentalmu. 🪄";
      }
    } else {
      reply = "Informasimu sudah lengkap terkumpul! Yuk, klik tombol **'Selesaikan & Analisis'** di kanan bawah untuk melihat hasil analisis kesehatan mentalmu. 🪄";
    }

    // Suntikkan gender & age jika belum ada di percakapan aktif
    if (userGender && (!currentState || currentState.gender === null)) {
      extracted.gender = userGender;
    }
    if (userAge && (!currentState || currentState.age === null)) {
      extracted.age = userAge;
    }

    res.json({
      reply,
      extractedFeatures: extracted,
      is_crisis: false,
      action: "CONTINUE_CHAT"
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error' });
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
      "SELECT COUNT(*) AS count FROM chat_sessions WHERE user_id = $1",
      [req.user.id]
    );
    const row = countResult.rows[0];
    const sessionNum = (parseInt(row.count || row['count(*)'] || row['COUNT(*)']) || 0) + 1;
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

exports.updateSession = async (req, res) => {
  try {
    const { id } = req.params;
    const { title, is_pinned } = req.body;

    let query = "UPDATE chat_sessions SET ";
    const values = [];
    let count = 1;

    if (title !== undefined) {
      query += `title = $${count} `;
      values.push(title);
      count++;
    }

    if (is_pinned !== undefined) {
      if (count > 1) query += ", ";
      query += `is_pinned = $${count} `;
      values.push(is_pinned);
      count++;
    }

    if (values.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    query += `WHERE id = $${count} AND user_id = $${count + 1} RETURNING *`;
    values.push(id, req.user.id);

    const result = await pool.query(query, values);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Session not found' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error("Error updateSession:", err);
    res.status(500).json({ error: 'Database error' });
  }
};

exports.generateSessionTitle = async (req, res) => {
  try {
    const { id } = req.params;
    const { message } = req.body;

    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }

    // Panggil FastAPI untuk generate judul
    const response = await fetch(`${FASTAPI_URL}/generate-title`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message })
    });

    if (!response.ok) {
      throw new Error(`FastAPI error: ${response.status}`);
    }

    const data = await response.json();
    const newTitle = data.title || "Obrolan Baru";

    // Update title di database
    const result = await pool.query(
      "UPDATE chat_sessions SET title = $1 WHERE id = $2 AND user_id = $3 RETURNING *",
      [newTitle, id, req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Session not found' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error("Error generateSessionTitle:", err.message);
    res.status(500).json({ error: 'Failed to generate title' });
  }
};

exports.predictHealth = async (req, res) => {
  const { features } = req.body;
  try {
    // 1. Coba hubungi FastAPI di port 8000 jika menyala
    const response = await fetch(`${FASTAPI_URL}/predict`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ features })
    });
    if (response.ok) {
      const data = await response.json();
      return res.json(data);
    }
  } catch (e) {
    console.warn("⚠️ FastAPI Offline untuk prediksi, menggunakan AI/Heuristik lokal...");
  }

  // 2. Jika offline, hitung secara lokal
  const stress = parseFloat(features.stress_level || 5);
  const anxiety = parseFloat(features.anxiety_score || 5);
  const depression = parseFloat(features.depression_score || 5);
  const averageScore = (stress + anxiety + depression) / 3;
  
  let riskLevel = 'Low';
  if (averageScore >= 7) {
    riskLevel = 'High';
  } else if (averageScore >= 4) {
    riskLevel = 'Medium';
  }
  const burnoutScore = Math.min(10, Math.max(0, parseFloat((averageScore * 1.1).toFixed(1))));

  // 3. Panggil AI untuk memberikan rekomendasi hangat jika ada key
  let recommendation = "Keadaan emosionalmu tampak cukup stabil. Tetap pertahankan pola hidup seimbang dan luangkan waktu untuk relaksasi ya.";
  try {
    if ((process.env.GEMINI_API_KEY && GoogleGenAI) || (process.env.GROQ_API_KEY && Groq)) {
      const levelMap = { 'High': 'tinggi', 'Medium': 'sedang', 'Low': 'rendah' };
      const levelIndo = levelMap[riskLevel] || 'stabil';
      const aiPrompt = `Kamu adalah asisten kesehatan mental yang hangat. Analisis hasil mahasiswa: tingkat risiko mental ${levelIndo}, skor burnout ${burnoutScore} dari 10. Berikan rekomendasi singkat yang memotivasi dan penuh empati dalam 2-3 kalimat santai bahasa Indonesia. JANGAN sebut angka atau skor apa pun.`;
      
      const aiText = await callAI(aiPrompt, "Berikan saya rekomendasi.");
      if (aiText) {
        try {
          const parsed = JSON.parse(aiText);
          recommendation = parsed.reply || aiText;
        } catch (e) {
          recommendation = aiText;
        }
      }
    }
  } catch (err) {
    console.error("Gagal mendapatkan rekomendasi AI:", err);
  }

  res.json({
    risk_level: riskLevel,
    burnout_score: burnoutScore,
    genai_recommendation: recommendation
  });
};


