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

// GET /api/debug/dom — class names thực tế trong DOM Zalo
app.get('/api/debug/dom', async (req, res) => {
  try { res.json(await controller.debugDOM()); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/debug/dom/all — tất cả class names (không lọc keyword)
app.get('/api/debug/dom/all', async (req, res) => {
  try {
    const page = await controller.getPage();
    const info = await page.evaluate(() => {
      const all = new Set();
      document.querySelectorAll('[class]').forEach(el =>
        String(el.className).split(/\s+/).forEach(c => { if (c) all.add(c); })
      );
      return [...all].sort();
    });
    res.json(info);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/debug/click/:index — click conv-item theo index rồi dump DOM
app.get('/api/debug/click/:index', async (req, res) => {
  try {
    const page = await controller.getPage();
    const idx  = Number(req.params.index);
    await page.evaluate((i) => {
      const items = document.querySelectorAll('.conv-item');
      items[i]?.click();
    }, idx);
    await page.waitForTimeout(2000);
    const info = await page.evaluate(() => {
      const all = new Set();
      document.querySelectorAll('[class]').forEach(el =>
        String(el.className).split(/\s+/).forEach(c => { if (c) all.add(c); })
      );
      return [...all].sort();
    });
    res.json(info);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/status
app.get('/api/status', async (req, res) => {
  const loggedIn = await controller.isLoggedIn();
  const username = loggedIn ? await controller.getUsername() : null;
  res.json({ loggedIn, username, uptime: process.uptime() });
});

// Socket.io
io.on('connection', (socket) => {
  console.log('[socket] client connected:', socket.id);
  // Forward click/type từ frontend về Playwright (giải CAPTCHA)
  socket.on('page_click', ({ x, y }) => controller.pageClick(x, y).catch(() => {}));
  socket.on('page_type',  ({ text }) => controller.pageType(text).catch(() => {}));
  socket.on('page_key',   ({ key })  => controller.pageKey(key).catch(() => {}));
  socket.on('disconnect', () => {
    console.log('[socket] client disconnected:', socket.id);
  });
});

// POST /api/auth/login — kick off login, trả về ngay để frontend bắt stream
app.post('/api/auth/login', async (req, res) => {
  const { phone, password } = req.body;
  if (!phone || !password) {
    return res.status(400).json({ error: 'Thiếu số điện thoại hoặc mật khẩu' });
  }
  res.json({ ok: true, streaming: true });

  // Chạy nền — kết quả qua socket logged_in / login_error
  controller.loginWithPhone(phone, password)
    .then(async () => {
      const page = await controller.getPage();
      await watcher.startWatching(page, io);
    })
    .catch(err => {
      console.error('[login] failed:', err.message);
      io.emit('login_error', { error: err.message });
    });
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
