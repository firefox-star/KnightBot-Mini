/**
 * Status Reactor v3 — Standalone status viewer & reactor
 *
 * COMPLETELY SEPARATE from autostatus config.
 * This is a self-contained module that just works on its own.
 *
 * How it works (same as a working standalone bot):
 * 1. Sends presence:available on connect so WA pushes status messages
 * 2. Listens to ALL messages.upsert events (no type filter)
 * 3. When a status@broadcast message arrives, views it and reacts
 *
 * Toggled via its own simple on/off state — no dependency on autostatus.
 * The .autostatus command can still set emoji + delay, which this reads.
 */

const fs = require('fs');
const path = require('path');

// ---- Own config file (separate from autostatus) ----
const STATUS_CONFIG_FILE = path.join(__dirname, '..', 'database', 'statusview.json');

const defaults = {
  enabled: true,    // ON by default — just works
  view: true,       // view statuses by default
  react: true,      // react to statuses by default
  reaction: '\ud83d\udc9a',  // 💚
  delay: 5          // seconds before reacting
};

function loadConfig() {
  try {
    if (fs.existsSync(STATUS_CONFIG_FILE)) {
      const data = JSON.parse(fs.readFileSync(STATUS_CONFIG_FILE, 'utf8'));
      return { ...defaults, ...data };
    }
  } catch (_) {}
  return { ...defaults };
}

function saveConfig(cfg) {
  try {
    const dir = path.dirname(STATUS_CONFIG_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(STATUS_CONFIG_FILE, JSON.stringify(cfg, null, 2), 'utf8');
  } catch (_) {}
}

// Export config functions so the command can use them
module.exports.loadConfig = loadConfig;
module.exports.saveConfig = saveConfig;

// ---- Deduplication ----
const processed = new Set();
setInterval(() => processed.clear(), 30 * 60 * 1000);

// ---- Reactor ----
function initializeStatusReactor(sock) {
  // React to a single status message
  const handleStatus = (msg) => {
    const from = msg.key?.remoteJid;
    if (from !== 'status@broadcast') return;
    if (msg.key.fromMe) return;

    const sender = msg.key.participant;
    if (!sender) return;

    const msgId = msg.key.id;
    if (!msgId || processed.has(msgId)) return;
    processed.add(msgId);

    const cfg = loadConfig();
    if (!cfg.enabled) return;

    const delayMs = Math.max(0, Number(cfg.delay) || 5) * 1000;
    const emoji = String(cfg.reaction || '\ud83d\udc9a');

    setTimeout(async () => {
      try {
        // View the status (send read receipt)
        if (cfg.view) {
          await sock.readMessages([msg.key]);
          console.log(`[statusView] Viewed ${sender.split('@')[0]}'s status`);
        }

        // React to the status
        if (cfg.react) {
          await sock.sendMessage(
            'status@broadcast',
            { react: { text: emoji, key: msg.key } },
            { statusJidList: [sender] }
          );
          console.log(`[statusView] Reacted ${emoji} to ${sender.split('@')[0]}'s status`);
        }
      } catch (e) {
        console.error(`[statusView] error: ${e.message}`);
      }
    }, delayMs);
  };

  // ---- Listen for ALL message upserts (no type filter!) ----
  // This is critical. The main handler filters by type === 'notify'
  // and skips status@broadcast. We catch everything here.
  sock.ev.on('messages.upsert', ({ messages }) => {
    for (const msg of messages) {
      handleStatus(msg);
    }
  });

  // ---- On connection open, send presence:available ----
  // This tells WhatsApp server we are active, so it pushes status
  // stories to this client (same thing WhatsApp Web does).
  sock.ev.on('connection.update', ({ connection }) => {
    if (connection === 'open') {
      console.log('[statusView] Connected, status viewer active');
      // Send presence after a short delay for connection to stabilize
      setTimeout(async () => {
        try {
          await sock.sendPresenceUpdate('available');
          console.log('[statusView] Presence set to available');
        } catch (e) {
          console.error(`[statusView] presence error: ${e.message}`);
        }
      }, 3000);
    }
  });
}

module.exports.initializeStatusReactor = initializeStatusReactor;