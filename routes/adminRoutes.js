const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const { authenticateAdmin } = require('../middleware/authMiddleware');

router.get('/stats', authenticateAdmin, adminController.getStats);
router.get('/analytics', authenticateAdmin, adminController.getAnalytics);
router.get('/posts', authenticateAdmin, adminController.getPosts);
router.delete('/posts/:id', authenticateAdmin, adminController.deletePost);
router.post('/posts/bulk-delete', authenticateAdmin, adminController.bulkDeletePosts);
router.post('/channels', authenticateAdmin, adminController.createChannel);
router.delete('/channels/:slug', authenticateAdmin, adminController.deleteChannel);
router.get('/users', authenticateAdmin, adminController.getUsers);
router.delete('/users/:id', authenticateAdmin, adminController.deleteUser);
router.put('/make-admin/:username', authenticateAdmin, adminController.makeAdmin);
router.put('/remove-admin/:username', authenticateAdmin, adminController.removeAdmin);

router.get('/settings', authenticateAdmin, adminController.getSettings);
router.post('/settings', authenticateAdmin, adminController.updateSetting);

router.get('/doctors', authenticateAdmin, adminController.getDoctorsAdmin);
router.post('/doctors', authenticateAdmin, adminController.addDoctor);
router.put('/doctors/:id', authenticateAdmin, adminController.updateDoctor);
router.delete('/doctors/:id', authenticateAdmin, adminController.deleteDoctor);

module.exports = router;
