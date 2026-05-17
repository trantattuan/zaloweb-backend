module.exports = {
  QR_READY:     'qr_ready',      // { qr: 'data:image/png;base64,...' }
  LOGGED_IN:    'logged_in',     // { username: string }
  NEW_MESSAGE:  'new_message',   // { id, content, sender, timestamp, fromMe }
  CHAT_UPDATED: 'chat_updated',  // [{ id, name, lastMessage }]
};
