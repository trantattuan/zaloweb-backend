/**
 * zalo-watcher.js
 * Injects a MutationObserver script into the Zalo Web page.
 * Detects new messages and chat list changes, then emits events via Socket.io.
 */

const EVENTS = require('../socket/events');

let _io  = null;
let _page = null;

async function startWatching(page, io) {
  _page = page;
  _io   = io;

  // Expose a bridge function: page JS → Node
  await page.exposeFunction('__zaloBridge', (event) => {
    _io?.emit(event.type, event.payload);
  });

  // Inject MutationObserver into the page
  await page.evaluate(() => {
    const CONV_SEL  = '[class*="conv-item"], [class*="ConvItem"]';
    const MSG_SEL   = '[class*="message-item"], [class*="MessageItem"]';
    const THREAD_SEL = '[class*="message-list"], [class*="MessageList"]';

    function extractMessage(el, index) {
      const contentEl = el.querySelector('[class*="msg-content"], [class*="MsgContent"]');
      const senderEl  = el.querySelector('[class*="msg-sender"], [class*="MsgSender"]');
      return {
        id:        el.dataset.msgId || String(index),
        content:   contentEl?.textContent?.trim() || '',
        sender:    senderEl?.textContent?.trim()  || '',
        timestamp: el.dataset.ts || Date.now().toString(),
        fromMe:    el.classList.contains('from-me') || el.dataset.fromMe === 'true',
      };
    }

    // Watch message thread for new messages
    const threadObserver = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        mutation.addedNodes.forEach((node, i) => {
          if (node.nodeType !== 1) return;
          const msgEl = node.matches?.(MSG_SEL) ? node : node.querySelector?.(MSG_SEL);
          if (!msgEl) return;
          window.__zaloBridge({
            type:    'new_message',
            payload: extractMessage(msgEl, i),
          });
        });
      }
    });

    // Watch chat sidebar for updates (new conversations, unread counts)
    const sidebarObserver = new MutationObserver(() => {
      const items = Array.from(document.querySelectorAll(CONV_SEL));
      const chats = items.slice(0, 50).map((el, i) => {
        const nameEl    = el.querySelector('[class*="conv-title"], [class*="ConvTitle"]');
        const lastMsgEl = el.querySelector('[class*="last-msg"], [class*="LastMsg"]');
        return {
          id:          el.dataset.convId || el.id || String(i),
          name:        nameEl?.textContent?.trim()    || '',
          lastMessage: lastMsgEl?.textContent?.trim() || '',
        };
      });
      window.__zaloBridge({ type: 'chat_updated', payload: chats });
    });

    // Attach observers when target elements appear
    function attachObservers() {
      const thread  = document.querySelector(THREAD_SEL);
      const sidebar = document.querySelector(CONV_SEL)?.parentElement;

      if (thread) {
        threadObserver.observe(thread, { childList: true, subtree: true });
      }
      if (sidebar) {
        sidebarObserver.observe(sidebar, { childList: true, subtree: true });
      }
      if (!thread || !sidebar) {
        setTimeout(attachObservers, 1000);
      }
    }
    attachObservers();
  });
}

module.exports = { startWatching };
