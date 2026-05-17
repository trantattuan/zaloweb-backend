const { Router }  = require('express');
const controller   = require('../browser/zalo-controller');

const router = Router();

// POST /api/send — gửi tin nhắn
// Body: { chatId: string, content: string }
router.post('/', async (req, res) => {
  const { chatId, content } = req.body;
  if (!chatId || !content) {
    return res.status(400).json({ error: 'chatId and content are required' });
  }
  try {
    await controller.sendMessage(chatId, content);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
