const { Router } = require('express');
const controller  = require('../browser/zalo-controller');

const router = Router();

// GET /api/chats — danh sách hội thoại
router.get('/', async (req, res) => {
  try {
    const chats = await controller.getChats();
    res.json(chats);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/chats/:id/messages — tin nhắn của 1 hội thoại
router.get('/:id/messages', async (req, res) => {
  try {
    const messages = await controller.getMessages(req.params.id);
    res.json(messages);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
