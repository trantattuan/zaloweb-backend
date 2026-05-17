const fs = require('fs');
const path = require('path');

const SESSION_FILE = path.resolve(__dirname, '../../playwright-session/session.json');

function save(storageState) {
  fs.mkdirSync(path.dirname(SESSION_FILE), { recursive: true });
  fs.writeFileSync(SESSION_FILE, JSON.stringify(storageState, null, 2));
}

function load() {
  if (!fs.existsSync(SESSION_FILE)) return null;
  try {
    return JSON.parse(fs.readFileSync(SESSION_FILE, 'utf-8'));
  } catch {
    return null;
  }
}

function clear() {
  if (fs.existsSync(SESSION_FILE)) fs.unlinkSync(SESSION_FILE);
}

module.exports = { save, load, clear };
