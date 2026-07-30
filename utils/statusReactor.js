/**
 * Status Reactor — Polling-based status story reactor for Baileys v7
 *
 * How it works:
 * 1. A periodic IQ query is sent to 'status@broadcast' (w:m xmlns).
 *    This mimics what WhatsApp Web does when you open the Status tab,
 *    telling the server to push new status story messages.
 * 2. Those pushed messages arrive through the normal messages.upsert
 *    event with remoteJid = 'status@broadcast' and participant = the poster.
 * 3. We react to each new (unseen) status with the configured emoji.
 */

const { load } = require('./autostatus');

const processed = new Set();
let pollTimer = null;

// Clear processed set every 30 minutes to prevent memory growth
setInterval(() => processed.clear(), 30 * 60 * 1000);

// How often (ms) we ping WhatsApp to keep status updates flowing
const STATUS_POLL_INTERVAL = 30_000;

function initializeStatusReactor(sock) {
	// ---- React to a single status message ----
	const reactToStatus = (msg) => {
		const from = msg.key?.remoteJid;
		if (from !== 'status@broadcast') return;
		if (msg.key.fromMe) return;

		const sender = msg.key.participant;
		if (!sender) return;

		const msgId = msg.key.id;
		if (!msgId || processed.has(msgId)) return;
		processed.add(msgId);

		// Load config fresh each time (owner may change settings at runtime)
		let cfg;
		try { cfg = load(); } catch (_) { return; }
		if (!cfg.react && !cfg.view) return;

		const delayMs = Math.max(0, Number(cfg.delay) || 5) * 1000;
		const emoji = String(cfg.reaction || '\ud83d\udc9a');

		setTimeout(async () => {
			try {
				// View (send read receipt)
				if (cfg.view) {
					try {
						await sock.readMessages([{ key: msg.key }]);
						console.log(`[statusReactor] Viewed ${sender.split('@')[0]}'s status`);
					} catch (e) {
						console.error(`[statusReactor] view error: ${e.message}`);
					}
				}

				// React with emoji
				if (cfg.react) {
					try {
						await sock.sendMessage(from, {
							react: { text: emoji, key: msg.key }
						});
						console.log(`[statusReactor] Reacted to ${sender.split('@')[0]}'s status with ${emoji}`);
					} catch (e) {
						console.error(`[statusReactor] react error: ${e.message}`);
					}
				}
			} catch (_) { /* no-op */ }
		}, delayMs);
	};

	// ---- Passive listener: catches whatever WhatsApp pushes ----
	sock.ev.on('messages.upsert', ({ messages, type }) => {
		// Accept both 'notify' (live) and 'append' (buffered/catch-up)
		if (type !== 'notify' && type !== 'append') return;
		for (const msg of messages) {
			reactToStatus(msg);
		}
	});

	// ---- Active polling: keep status subscription alive ----
	const sendStatusQuery = async () => {
		// Only poll when feature is enabled
		let cfg;
		try { cfg = load(); } catch (_) { return; }
		if (!cfg.react && !cfg.view) return;

		try {
			await sock.sendNode({
				tag: 'iq',
				attrs: {
					id: sock.generateMessageTag(),
					to: 'status@broadcast',
					xmlns: 'w:m',
					type: 'get'
				},
				content: [
					{
						tag: 'list',
						attrs: {},
						content: []
					}
				]
			});
		} catch (e) {
			console.error(`[statusReactor] poll error: ${e.message}`);
		}
	};

	// Start / stop polling on connection changes
	sock.ev.on('connection.update', ({ connection }) => {
		if (connection === 'open') {
			// Clean up any leftover timer (reconnect safety)
			if (pollTimer) clearInterval(pollTimer);
			// Wait 10 s for the connection to fully stabilise, then poll
			setTimeout(sendStatusQuery, 10_000);
			pollTimer = setInterval(sendStatusQuery, STATUS_POLL_INTERVAL);
		} else if (connection === 'close') {
			if (pollTimer) {
				clearInterval(pollTimer);
				pollTimer = null;
			}
		}
	});
}

module.exports = { initializeStatusReactor };
