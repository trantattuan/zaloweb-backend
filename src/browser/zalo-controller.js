const { chromium } = require('playwright');
const session = require('./session');

// Selectors — verify against live Zalo Web DOM (F12 → inspect)
const SEL = {
  // Phone + password login form
  phoneLoginTab: '[class*="login-tab"][class*="phone"], [class*="phone-login"], a[class*="phone"]',
  phoneInput:    'input[type="tel"], input[placeholder*="điện thoại"], input[name="phone"], input[autocomplete="tel"]',
  passwordInput: 'input[type="password"]',
  loginBtn:      'button[type="submit"], [class*="login-btn"], [class*="btn-login"], [class*="submit"]',
  loginError:    '[class*="error-msg"], [class*="invalid"], [class*="login-error"]',
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

  return page;
}

/** Đăng nhập bằng số điện thoại và mật khẩu */
async function loginWithPhone(phone, password) {
  if (!page) throw new Error('Browser not initialized');

  // Nếu đã đăng nhập sẵn → bỏ qua
  const alreadyIn = await _checkLoginState();
  if (alreadyIn) {
    const username = await _getUsername();
    _io?.emit('logged_in', { username });
    return;
  }

  // Thử click tab "đăng nhập bằng mật khẩu" nếu có
  try {
    const tab = await page.$(SEL.phoneLoginTab);
    if (tab) { await tab.click(); await page.waitForTimeout(500); }
  } catch { /* tab không tồn tại — form đã sẵn sàng */ }

  // Điền số điện thoại
  await page.waitForSelector(SEL.phoneInput, { timeout: 10000 });
  await page.fill(SEL.phoneInput, phone);

  // Điền mật khẩu
  await page.waitForSelector(SEL.passwordInput, { timeout: 5000 });
  await page.fill(SEL.passwordInput, password);

  // Nhấn đăng nhập
  await page.click(SEL.loginBtn);

  // Chờ vào được giao diện chat
  try {
    await page.waitForSelector(SEL.chatList, { timeout: 20000 });
  } catch {
    // Kiểm tra có thông báo lỗi không
    const errEl = await page.$(SEL.loginError);
    const errMsg = errEl ? await errEl.innerText() : 'Đăng nhập thất bại';
    throw new Error(errMsg.trim() || 'Đăng nhập thất bại — kiểm tra số điện thoại / mật khẩu');
  }

  // Lưu session và báo frontend
  const state = await context.storageState();
  session.save(state);

  const username = await _getUsername();
  _io?.emit('logged_in', { username });
}

async function _checkLoginState() {
  try {
    await page.waitForSelector(SEL.chatList, { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
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
  loginWithPhone,
  getPage,
  isLoggedIn,
  getUsername,
  getChats,
  getMessages,
  sendMessage,
  closeBrowser,
};
