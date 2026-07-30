/**
 * Status Reactor v2 — Robust multi-strategy status reactor
 *
 * How it works:
 * 1. On connection open, sends `presence: available` to appear as an active
 *    WhatsApp Web client viewing the Status tab (this is what WA Web does).
 * 2. Periodically re-subscribes via IQ query to `status@broadcast`.
 * 3. Status messages pushed by WhatsApp arrive through `messages.upsert`
 *    and are caught by our listener — no type filter (accepts notify, append, etc).
 * 4. Each new (unseen) status is viewed and/or reacted to per config.
 *
 * Key fix over v1: WA server only pushes status stories when the client
 * signals it is "active" via presence:available. Without this, the initial
 * buffered batch arrives but no new statuses are pushed afterwards.
 */

const { load } = require('./autostatus');

const processed = new Set();
let pollTimer = null;
let isRunning = false;
let presenceRestored = false;

// Clear processed set every 30 minutes to prevent unbounded memory growth
setInterval(() => {
	const size = processed.size;
	processed.clear();
	if (size > 0) console.log(`[statusReactor] Cleared ${size} processed IDs`);
}, 30 * 60 * 1000);

// Poll every 15 seconds — aggressive enough to keep subscription alive
const POLL_INTERVAL = 15_000;

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

	// ---- Strategy 1: Passive listener — catch ALL status pushes from WA ----
	// NO type filter! Accept 'notify', 'append', or anything else.
	// This is critical — the old version filtered by type and missed messages.
	sock.ev.on('messages.upsert', ({ messages }) => {
		for (const msg of messages) {
			reactToStatus(msg);
		}
	});

	// ---- Strategy 2: Active polling with presence + IQ subscription ----
	const poll = async () => {
		if (isRunning) return;
		isRunning = true;

		let cfg;
		try { cfg = load(); } catch (_) { isRunning = false; return; }
		if (!cfg.react && !cfg.view) {
			isRunning = false;
			return;
		}

		try {
			// CRITICAL: Send presence 'available' before the IQ query.
			// This mimics WhatsApp Web opening the Status tab and signals
			// the server to push status story messages to this client.
			// Without this, WA only sends the initial buffered batch then stops.
			await sock.sendPresenceUpdate('available').catch(() => {});

			// Small delay to let the presence update propagate
			await new Promise(r => setTimeout(r, 500));

			// Send IQ subscription to status@broadcast
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
			console.log('[statusReactor] Poll sent (presence: available + IQ subscription)');
		} catch (e) {
			console.error(`[statusReactor] poll error: ${e.message}`);
		}

		isRunning = false;
	};

	// ---- Start / stop on connection changes ----
	sock.ev.on('connection.update', ({ connection }) => {
		if (connection === 'open') {
			// Clean up any leftover timer (reconnect safety)
			if (pollTimer) clearInterval(pollTimer);
			presenceRestored = false;

			// Wait 8s for the connection to fully stabilise, then start polling
			console.log('[statusReactor] Connection open, starting in 8 seconds...');
			setTimeout(poll, 8_000);
			pollTimer = setInterval(poll, POLL_INTERVAL);
		} else if (connection === 'close') {
			if (pollTimer) {
				clearInterval(pollTimer);
				pollTimer = null;
			}
			isRunning = false;
			presenceRestored = false;
		}
	});
}

module.exports = { initializeStatusReactor };
