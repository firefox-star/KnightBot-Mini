const { load } = require('./autostatus');

const processed = new Set();

// Clear every 30 min
setInterval(() => processed.clear(), 30 * 60 * 1000);

function initializeStatusReactor(sock) {
  sock.ev.on('messages.upsert', ({ messages, type }) => {
    // Accept both 'notify' (live) and 'append' (offline/catch-up)
    if (type !== 'notify' && type !== 'append') return;

    for (const msg of messages) {
      const from = msg.key?.remoteJid;
      // status@broadcast is the JID WhatsApp uses for all status messages
      if (!from || from !== 'status@broadcast') continue;

      // Skip bot's own statuses
      if (msg.key.fromMe) continue;

      // participant = the person who posted the status
      const sender = msg.key.participant;
      if (!sender) continue;

      const msgId = msg.key.id;
      if (!msgId || processed.has(msgId)) continue;
      processed.add(msgId);

      // Load config fresh each time
      let cfg;
      try { cfg = load(); } catch (_) { continue; }
      if (!cfg.react && !cfg.view) continue;

      const delayMs = Math.max(0, Number(cfg.delay) || 5) * 1000;
      const emoji = String(cfg.reaction || '💚');
      const shouldView = !!cfg.view;
      const shouldReact = !!cfg.react;

      // Fire-and-forget with delay
      setTimeout(async () => {
        try {
          // View (send read receipt)
          if (shouldView) {
            try {
              await sock.readMessages([{ key: msg.key }]);
              console.log(`[statusReactor] Viewed ${sender.split('@')[0]}'s status`);
            } catch (e) {
              console.error(`[statusReactor] view error: ${e.message}`);
            }
          }

          // React
          if (shouldReact) {
            try {
              await sock.sendMessage(from, {
                react: { text: emoji, key: msg.key }
              });
              console.log(`[statusReactor] Reacted to ${sender.split('@')[0]}'s status with ${emoji}`);
            } catch (e) {
              console.error(`[statusReactor] react error: ${e.message}`);
            }
          }
        } catch (_) {}
      }, delayMs);
    }
  });
}

module.exports = { initializeStatusReactor };