/**
 * Status Reactor - Listens for WhatsApp status updates and reacts/views them
 * Completely isolated from the main message handler.
 * Only activates when autostatus is enabled by the owner.
 */

const { load } = require('./autostatus');

// Dedup set — prevents reacting to the same status twice
const processedStatuses = new Set();

// Clear every 30 minutes to prevent memory growth
setInterval(() => {
  processedStatuses.clear();
}, 30 * 60 * 1000);

function initializeStatusReactor(sock) {
  // Baileys allows multiple listeners on the same event.
  // This listener ONLY cares about status@broadcast messages.
  // The main handler in index.js already filters those out via isSystemJid(),
  // so there is zero overlap or conflict.
  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    // Only new messages
    if (type !== 'notify') return;

    try {
      const cfg = load();

      // Nothing to do if both view and react are off
      if (!cfg.view && !cfg.react) return;

      for (const msg of messages) {
        const from = msg.key.remoteJid;

        // Only status broadcast messages
        if (!from || !from.includes('status@broadcast')) continue;

        // Skip own statuses
        if (msg.key.fromMe) continue;

        // Need the actual poster's JID
        const sender = msg.key.participant;
        if (!sender) continue;

        // Dedup
        const msgId = msg.key.id;
        if (!msgId || processedStatuses.has(msgId)) continue;
        processedStatuses.add(msgId);

        // Fire-and-forget with delay — doesn't block other messages
        const delayMs = Math.max(0, (cfg.delay || 5)) * 1000;

        setTimeout(async () => {
          try {
            // View status (send read receipt)
            if (cfg.view) {
              try {
                await sock.readMessages([msg.key]);
              } catch (_) {
                // Read receipt can fail silently
              }
            }

            // React to status
            if (cfg.react && cfg.reaction) {
              try {
                await sock.sendMessage(from, {
                  react: {
                    text: cfg.reaction,
                    key: msg.key
                  }
                });
                console.log(`[statusReactor] Reacted to ${sender.split('@')[0]}'s status with ${cfg.reaction}`);
              } catch (e) {
                console.error('[statusReactor] react error:', e.message);
              }
            }
          } catch (_) {
            // Never let a delayed reaction error bubble up
          }
        }, delayMs);
      }
    } catch (e) {
      console.error('[statusReactor] error:', e.message);
    }
  });
}

module.exports = { initializeStatusReactor };