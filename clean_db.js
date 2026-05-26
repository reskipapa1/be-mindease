require('dotenv').config();
const { pool } = require('./config/db');
const mlService = require('./services/mlService');

const cleanDatabase = async () => {
  console.log('==================================================');
  console.log('🛡️  Memulai Pembersihan Retroaktif Database MindEase...');
  console.log('==================================================');
  
  try {
    // 1. Ambil semua postingan dari database
    const result = await pool.query('SELECT * FROM posts');
    const totalPosts = result.rows.length;
    console.log(`🔍 Ditemukan ${totalPosts} total postingan di database.`);

    let deletedCount = 0;

    for (const post of result.rows) {
      // 2. Evaluasi kesopanan postingan menggunakan 3-Lapis Proteksi
      const validation = await mlService.checkSentiment(post.content);
      
      if (!validation.is_appropriate) {
        console.log(`❌ Menghapus postingan tidak sopan (ID: ${post.id}): "${post.content}"`);
        
        // 3. Hapus postingan dari database
        await pool.query('DELETE FROM posts WHERE id = $1', [post.id]);
        deletedCount++;
      }
    }

    console.log('==================================================');
    console.log(`✅ Pembersihan Selesai!`);
    console.log(`📊 Hasil: Berhasil menghapus ${deletedCount} dari ${totalPosts} postingan.`);
    console.log('==================================================');
    
    pool.end();
    process.exit(0);
  } catch (err) {
    console.error('🔴 Terjadi kesalahan saat membersihkan database:', err.message);
    pool.end();
    process.exit(1);
  }
};

cleanDatabase();
