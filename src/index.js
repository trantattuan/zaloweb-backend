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
const io     = new Server(server, { cors: { origin: FRONTEND } });

app.use(cors({ origin: FRONTEND }));
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

async function start() {
  console.log('[boot] launching browser...');
  try {
    const page = await controller.initBrowser({ headless: HEADLESS, io });
    await watcher.startWatching(page, io);
    console.log('[boot] browser ready');
  } catch (err) {
    console.error('[boot] browser init failed:', err.message);
    process.exit(1);
  }

  server.listen(PORT, () => {
    console.log(`[server] listening on http://localhost:${PORT}`);
  });
}

start();
