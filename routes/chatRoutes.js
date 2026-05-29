const express = require('express');
const router = express.Router();
const chatController = require('../controllers/chatController');
const { authenticateToken, optionalAuthenticateToken } = require('../middleware/authMiddleware');

router.post('/agent', optionalAuthenticateToken, chatController.chatAgent);
router.post('/predict', optionalAuthenticateToken, chatController.predictHealth);
router.get('/history', authenticateToken, chatController.getChatHistory);
router.post('/save-result', authenticateToken, chatController.saveChatResult);

// Rute untuk Sesi Obrolan (Chat Sessions)
router.get('/sessions', authenticateToken, chatController.getSessions);
router.post('/sessions', authenticateToken, chatController.createSession);
router.post('/sessions/:id/generate-title', authenticateToken, chatController.generateSessionTitle);
router.put('/sessions/:id', authenticateToken, chatController.updateSession);
router.delete('/sessions/:id', authenticateToken, chatController.deleteSession);

module.exports = router;
