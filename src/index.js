const express    = require('express');
const http       = require('http');
const { Server } = require('socket.io');
const cors       = require('cors');

const controller = require('./browser/zalo-controller');
const watcher    = require('./browser/zalo-watcher');
const chatRoutes = require('./api/chat.routes');
const sendRoutes = require('./api/send.routes');

const PORT      = process.env.PORT || 3001;
const HEADLESS  = process.env.HEADLESS === 'true';
const FRONTEND  = process.env.FRONTEND_URL || 'http://localhost:3000';

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, { cors: { origin: '*' } });

app.use(cors({ origin: '*' }));
app.use(express.json());

// Routes
app.use('/api/chats', chatRoutes);
app.use('/api/send',  sendRoutes);

// GET /api/status
app.get('/api/status', async (req, res) => {
  const loggedIn = await controller.isLoggedIn();
  const username = loggedIn ? await controller.getUsername() : null;
  res.json({ loggedIn, username, uptime: process.uptime() });
});

// Socket.io
io.on('connection', (socket) => {
  console.log('[socket] client connected:', socket.id);
  socket.on('disconnect', () => {
    console.log('[socket] client disconnected:', socket.id);
  });
});

// POST /api/auth/login — nhận số điện thoại và mật khẩu từ frontend
app.post('/api/auth/login', async (req, res) => {
  const { phone, password } = req.body;
  if (!phone || !password) {
    return res.status(400).json({ error: 'Thiếu số điện thoại hoặc mật khẩu' });
  }
  try {
    await controller.loginWithPhone(phone, password);
    const page = await controller.getPage();
    await watcher.startWatching(page, io);
    res.json({ ok: true });
  } catch (err) {
    console.error('[login] failed:', err.message);
    res.status(401).json({ error: err.message });
  }
});

async function start() {
  // Start HTTP server immediately so /api/status is reachable during browser init
  server.listen(PORT, () => {
    console.log(`[server] listening on http://localhost:${PORT}`);
  });

  console.log('[boot] launching browser...');
  try {
    const page = await controller.initBrowser({ headless: HEADLESS, io });
    // Nếu đã có session → tự vào chat và start watcher
    const loggedIn = await controller.isLoggedIn();
    if (loggedIn) {
      await watcher.startWatching(page, io);
      console.log('[boot] session restored — browser ready');
    } else {
      console.log('[boot] browser ready — chờ đăng nhập qua /api/auth/login');
    }
  } catch (err) {
    console.error('[boot] browser init failed:', err.message);
  }
}

start();
