const { chromium } = require('playwright');
const session = require('./session');

// Selectors — verify against live Zalo Web DOM (F12 → inspect)
const SEL = {
  // QR login screen
  qrImage:      'img[src*="qr"], canvas[id*="qr"], img[alt*="QR"], [class*="qr"] img, [class*="QR"] img',
  // Button that appears when QR expires — click to get fresh QR
  qrRefreshBtn: '.btn.btn--s.docs-creator',
  // Logged-in chat interface
  chatList:     '.conv-item, [class*="ConvItem"], [class*="conv-item"]',
  chatName:     '[class*="conv-title"], [class*="ConvTitle"]',
  chatAvatar:   '[class*="avatar"] img, [class*="Avatar"] img',
  chatLastMsg:  '[class*="last-msg"], [class*="LastMsg"]',
  // Message thread
  messageItem:  '[class*="message-item"], [class*="MessageItem"]',
  msgContent:   '[class*="msg-content"], [class*="MsgContent"]',
  msgSender:    '[class*="msg-sender"], [class*="MsgSender"]',
  // Send input
  chatInput:    'div[contenteditable="true"][class*="input"], div[contenteditable="true"]',
  // Username after login
  currentUser:  '[class*="profile-name"], [class*="ProfileName"]',
};

let browser = null;
let context = null;
let page    = null;
let _io     = null;

async function initBrowser({ headless = false, io } = {}) {
  _io = io;
  const savedState = session.load();

  browser = await chromium.launch({
    headless,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',  // critical in Docker: default /dev/shm is too small
      '--disable-gpu',
      '--disable-software-rasterizer',
    ],
  });

  context = savedState
    ? await browser.newContext({ storageState: savedState })
    : await browser.newContext();

  page = await context.newPage();

  await page.goto('https://chat.zalo.me/', {
    waitUntil: 'domcontentloaded',
    timeout: 30000,
  });

  const loggedIn = await _checkLoginState();
  if (!loggedIn) {
    await _waitForQRAndEmit();
    await _waitForLoginSuccess();
  }

  // Persist session after login
  const state = await context.storageState();
  session.save(state);

  return page;
}

async function _checkLoginState() {
  try {
    await page.waitForSelector(SEL.chatList, { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

// Capture QR từ DOM và emit — gọi được nhiều lần
async function _captureAndEmitQR() {
  if (!_io || !page) return;
  try {
    // Click nút làm mới nếu QR đã hết hạn (Zalo hiện overlay che QR)
    const refreshBtn = await page.$(SEL.qrRefreshBtn);
    if (refreshBtn && await refreshBtn.isVisible()) {
      await refreshBtn.click();
      console.log('[qr] clicked refresh button — waiting for new QR');
      await page.waitForTimeout(1500);
    }

    const qrEl = await page.$(SEL.qrImage);
    if (!qrEl) return;

    // Tăng contrast để màu đen đậm hơn, dễ quét
    await qrEl.evaluate(el => { el.style.filter = 'contrast(200%) brightness(0.85)'; });
    const buf = await qrEl.screenshot({ type: 'png' });
    await qrEl.evaluate(el => { el.style.filter = ''; });
    _io.emit('qr_ready', { qr: `data:image/png;base64,${buf.toString('base64')}` });
    console.log('[qr] captured and emitted');
  } catch (err) {
    console.error('[qr] capture failed:', err.message);
  }
}

async function _waitForQRAndEmit() {
  if (!_io) return;
  try {
    await page.waitForSelector(SEL.qrImage, { timeout: 15000 });
    await _captureAndEmitQR();
  } catch (err) {
    console.error('[zalo-controller] QR not found:', err.message);
  }
}

async function _waitForLoginSuccess() {
  const maxWait   = 300_000;  // 5 phút
  const checkMs   =   2_000;  // poll login mỗi 2s
  const qrRefreshMs = 60_000; // refresh QR mỗi 60s (Zalo expire 90s, click refresh button kịp thời)
  let elapsed      = 0;
  let lastRefresh  = 0;

  while (elapsed < maxWait) {
    const ok = await _checkLoginState();
    if (ok) {
      const username = await _getUsername();
      _io?.emit('logged_in', { username });
      return;
    }

    // Re-capture QR trước khi nó expire
    if (elapsed - lastRefresh >= qrRefreshMs) {
      await _captureAndEmitQR();
      lastRefresh = elapsed;
    }

    await page.waitForTimeout(checkMs);
    elapsed += checkMs;
  }
  throw new Error('Login timeout — QR not scanned within 5 minutes');
}

async function _getUsername() {
  try {
    const el = await page.$(SEL.currentUser);
    return el ? await el.innerText() : 'unknown';
  } catch {
    return 'unknown';
  }
}

async function getPage() {
  return page;
}

async function isLoggedIn() {
  if (!page) return false;
  return _checkLoginState();
}

async function getUsername() {
  return _getUsername();
}

/** Read chat list from sidebar DOM */
async function getChats() {
  if (!page) return [];
  try {
    await page.waitForSelector(SEL.chatList, { timeout: 5000 });
    return page.evaluate((sel) => {
      const items = Array.from(document.querySelectorAll(sel.chatList));
      return items.slice(0, 50).map((el, i) => {
        const nameEl    = el.querySelector(sel.chatName);
        const avatarEl  = el.querySelector(sel.chatAvatar);
        const lastMsgEl = el.querySelector(sel.chatLastMsg);
        return {
          id:          el.dataset.convId || el.id || String(i),
          name:        nameEl?.textContent?.trim()   || '',
          avatar:      avatarEl?.src                 || '',
          lastMessage: lastMsgEl?.textContent?.trim() || '',
        };
      });
    }, SEL);
  } catch {
    return [];
  }
}

/** Read messages of a conversation — click chat first, then read thread */
async function getMessages(chatId) {
  if (!page) return [];
  try {
    // Click the chat item matching chatId
    const clicked = await page.evaluate((sel, id) => {
      const items = Array.from(document.querySelectorAll(sel.chatList));
      const target = items.find(el => el.dataset.convId === id || el.id === id);
      if (target) { target.click(); return true; }
      return false;
    }, SEL, chatId);

    if (!clicked) return [];

    await page.waitForSelector(SEL.messageItem, { timeout: 5000 });

    return page.evaluate((sel) => {
      const msgs = Array.from(document.querySelectorAll(sel.messageItem));
      return msgs.slice(-100).map((el, i) => {
        const contentEl = el.querySelector(sel.msgContent);
        const senderEl  = el.querySelector(sel.msgSender);
        return {
          id:        el.dataset.msgId || String(i),
          content:   contentEl?.textContent?.trim() || '',
          sender:    senderEl?.textContent?.trim()  || '',
          timestamp: el.dataset.ts || '',
          fromMe:    el.classList.contains('from-me') || el.dataset.fromMe === 'true',
        };
      });
    }, SEL);
  } catch {
    return [];
  }
}

/** Send a message via Playwright automation */
async function sendMessage(chatId, content) {
  if (!page) throw new Error('Browser not initialized');

  // Open the chat
  await page.evaluate((sel, id) => {
    const items = Array.from(document.querySelectorAll(sel.chatList));
    const target = items.find(el => el.dataset.convId === id || el.id === id);
    target?.click();
  }, SEL, chatId);

  await page.waitForSelector(SEL.chatInput, { timeout: 5000 });
  const input = await page.$(SEL.chatInput);
  if (!input) throw new Error('Chat input not found');

  await input.click();
  await input.fill(content);
  await page.keyboard.press('Enter');

  // Save session after action
  const state = await context.storageState();
  session.save(state);
}

async function closeBrowser() {
  if (browser) await browser.close();
  browser = context = page = null;
}

module.exports = {
  initBrowser,
  getPage,
  isLoggedIn,
  getUsername,
  getChats,
  getMessages,
  sendMessage,
  closeBrowser,
};
