/**
 * WhatsApp QR + Session management routes.
 */
const express    = require('express');
const { protect }= require('../middleware/auth');
const { initSession, getStatus, disconnectSession } = require('../services/whatsapp.service');
const router     = express.Router();

router.use(protect);

// GET current WA status
router.get('/status', (req, res) => {
  const status = getStatus(req.user.id);
  res.json(status);
});

// POST initialize WA (get QR)
router.post('/init', async (req, res, next) => {
  try {
    const result = await initSession(req.user.id);
    res.json(result);
  } catch (err) { next(err); }
});

// POST disconnect WA
router.post('/disconnect', async (req, res, next) => {
  try {
    await disconnectSession(req.user.id);
    res.json({ success: true });
  } catch (err) { next(err); }
});

module.exports = router;
