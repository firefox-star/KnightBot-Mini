/**
 * Pair Manager — Generates WhatsApp pairing codes + relays commands
 *
 * Creates INDEPENDENT Baileys sockets in separate session directories.
 * When a pair connects, wires their messages to the main handler so
 * the paired person can use ALL bot commands through their own WhatsApp.
 *
 * Architecture:
 *   session/            ← main bot session (NEVER touched by pair manager)
 *   session/pair_XXX/   ← each paired number gets its own isolated session
 *
 * Flow:
 *   1. Owner sends ",pair 234xxxxxxxxx"
 *   2. Manager creates a fresh Baileys socket + auth state in session/pair_XXX/
 *   3. Waits 3s, calls requestPairingCode() → 8-char code generated
 *   4. Owner forwards code to target → they enter it in WhatsApp
 *   5. Socket connects (connection: 'open')
 *   6. Relay is activated: paired person's commands go through the handler
 *   7. Bot responds through the paired socket back to them
 */

const pino = require('pino');
const fs = require('fs');
const path = require('path');
const config = require('../config');
const {
	default: makeWASocket,
	useMultiFileAuthState,
	DisconnectReason,
	Browsers,
	fetchLatestBaileysVersion
} = require('@whiskeysockets/baileys');

// Active paired sessions: Map<"234xxx", { sock, status, pairedAt }>
const activePairs = new Map();

// Base directory for pair sessions — inside the main session folder
const PAIR_SESSIONS_DIR = path.join(__dirname, '..', 'session');

// Ensure session directory exists
if (!fs.existsSync(PAIR_SESSIONS_DIR)) {
	fs.mkdirSync(PAIR_SESSIONS_DIR, { recursive: true });
}

/**
 * Create a silent logger (won't pollute main bot logs)
 */
function silentLogger() {
	const { Writable } = require('stream');
	const devNull = new Writable({ write(chunk, enc, cb) { cb(); } });
	return pino({ level: 'silent' }, devNull);
}

/**
 * Wire up the command relay for a connected pair socket.
 * Only processes the PAIRED PERSON's own messages (fromMe: true)
 * that start with the bot prefix. Everything else is ignored.
 *
 * The handler sees the paired socket as the "sock", so replies
 * automatically go back through the paired socket to the person.
 */
function setupRelay(sock, pairNumber) {
	// Lazy-import handler to avoid circular dependency at startup
	const handler = require('../handler');

	sock.ev.on('messages.upsert', ({ type, messages }) => {
		// Only process new messages (not history)
		if (type !== 'notify') return;

		for (const msg of messages) {
			if (!msg.message || !msg.key?.id) continue;

			// Only process the paired person's OWN messages
			// (they're the ones using commands)
			if (!msg.key.fromMe) continue;

			// Skip system JIDs
			const from = msg.key.remoteJid;
			if (!from || from.includes('@broadcast') || from.includes('@newsletter')) continue;

			// Check if message starts with prefix
			const content = msg.message.conversation ||
				msg.message.extendedTextMessage?.text ||
				msg.message.imageMessage?.caption ||
				msg.message.videoMessage?.caption || '';

			if (content.trim().startsWith(config.prefix)) {
				handler.handleMessage(sock, msg).catch(err => {
					if (!err.message?.includes('rate-overlimit')) {
						console.error(`[pairRelay] +${pairNumber} handler error:`, err.message);
					}
			});
			}
		}
	});

	console.log(`[pairManager] Relay active for +${pairNumber}`);
}

/**
 * Generate a pairing code for a phone number.
 * Creates a completely independent Baileys socket.
 */
async function generatePairingCode(phoneNumber) {
	const clean = phoneNumber.replace(/\D/g, '');
	if (!clean || clean.length < 7 || clean.length > 15) {
		throw new Error('Invalid phone number. Must be 7-15 digits with country code.');
	}

	// Check if already active
	if (activePairs.has(clean)) {
		const existing = activePairs.get(clean);
		if (existing.status === 'pairing') {
			throw new Error(`Pairing already in progress for +${clean}. Wait or use ,unpair ${clean} first.`);
		}
		if (existing.status === 'connected') {
			throw new Error(`+${clean} is already paired. Use ,unpair ${clean} to remove.`);
		}
	}

	const sessionDir = path.join(PAIR_SESSIONS_DIR, `pair_${clean}`);

	// Create isolated auth state for this pair
	const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
	const { version } = await fetchLatestBaileysVersion();

	// Create completely independent socket
	const sock = makeWASocket({
		version,
		logger: silentLogger(),
		printQRInTerminal: false,
		browser: Browsers.ubuntu('Chrome'),
		auth: state,
		syncFullHistory: false,
		downloadHistory: false,
		markOnlineOnConnect: false,
		getMessage: async () => undefined
	});

	// Save credentials when updated
	sock.ev.on('creds.update', saveCreds);

	// Track this pair
	const pairEntry = {
		sock,
		status: 'connecting',
		number: clean,
		createdAt: Date.now(),
		pairedAt: null
	};
	activePairs.set(clean, pairEntry);

	// Handle connection lifecycle
	sock.ev.on('connection.update', (update) => {
		const { connection, lastDisconnect } = update;

		if (connection === 'open') {
			pairEntry.status = 'connected';
			pairEntry.pairedAt = Date.now();
			console.log(`[pairManager] +${clean} paired successfully`);

			// Activate the command relay so this person can use bot commands
			try {
				setupRelay(sock, clean);
			} catch (err) {
				console.error(`[pairManager] Failed to setup relay for +${clean}:`, err.message);
			}

		} else if (connection === 'close') {
			const statusCode = lastDisconnect?.error?.output?.statusCode;
			const isLoggedOut = statusCode === DisconnectReason.loggedOut;

			if (isLoggedOut) {
				console.log(`[pairManager] +${clean} logged out`);
				activePairs.delete(clean);
				try { fs.rmSync(sessionDir, { recursive: true, force: true }); } catch (_) {}
			} else {
				pairEntry.status = 'disconnected';
				console.log(`[pairManager] +${clean} disconnected (code: ${statusCode})`);
			}
		}
	});

	// Generate pairing code after 3 seconds
	return new Promise((resolve, reject) => {
		const timeout = setTimeout(() => {
			cleanupPair(clean);
			reject(new Error('Timeout: Failed to generate pairing code in 30s. Check connection.'));
		}, 30_000);

		setTimeout(async () => {
			try {
				pairEntry.status = 'pairing';
				const code = await sock.requestPairingCode(clean);
				clearTimeout(timeout);
				console.log(`[pairManager] Code for +${clean}: ${code}`);
				resolve({ code, number: clean });
			} catch (err) {
				clearTimeout(timeout);
				cleanupPair(clean);
				reject(new Error(`Failed to request pairing code: ${err.message}`));
			}
		}, 3000);
	});
}

/**
 * Remove a paired session cleanly.
 */
function removePair(phoneNumber) {
	const clean = phoneNumber.replace(/\D/g, '');

	if (!activePairs.has(clean)) {
		return { success: false, message: `+${clean} is not actively paired.` };
	}

	const entry = activePairs.get(clean);
	const sessionDir = path.join(PAIR_SESSIONS_DIR, `pair_${clean}`);

	try { entry.sock.end(new Error('Owner initiated unpair')); } catch (_) {}

	activePairs.delete(clean);

	try {
		if (fs.existsSync(sessionDir)) {
			fs.rmSync(sessionDir, { recursive: true, force: true });
		}
	} catch (_) {}

	console.log(`[pairManager] +${clean} unpaired`);
	return { success: true, message: `+${clean} unpaired successfully.` };
}

/**
 * Internal cleanup (for error cases)
 */
function cleanupPair(phoneNumber) {
	const clean = phoneNumber.replace(/\D/g, '');
	const sessionDir = path.join(PAIR_SESSIONS_DIR, `pair_${clean}`);
	activePairs.delete(clean);
	try {
		if (fs.existsSync(sessionDir)) {
			fs.rmSync(sessionDir, { recursive: true, force: true });
		}
	} catch (_) {}
}

/**
 * List all active pairs.
 */
function listPairs() {
	const pairs = [];
	for (const [number, entry] of activePairs) {
		pairs.push({
			number,
			status: entry.status,
			pairedAt: entry.pairedAt ? new Date(entry.pairedAt).toLocaleString() : null,
			createdAt: new Date(entry.createdAt).toLocaleString()
		});
	}
	return pairs;
}

/**
 * Check if a number is currently paired and connected.
 * Used by handler.js to give paired users owner access.
 */
function isPairActive(phoneNumber) {
	const clean = phoneNumber.replace(/\D/g, '');
	const entry = activePairs.get(clean);
	return !!entry && entry.status === 'connected';
}

/**
 * Check if a number (JID or raw) belongs to a paired user.
 * Used by handler.js isOwner() to grant owner-level access.
 */
function isPairedUser(jidOrNumber) {
	if (!jidOrNumber) return false;
	// Extract just the digits
	const digits = String(jidOrNumber).replace(/\D/g, '');
	if (!digits || digits.length < 7) return false;
	return activePairs.has(digits);
}

/**
 * Shutdown all pairs.
 */
function shutdownAll() {
	console.log(`[pairManager] Shutting down ${activePairs.size} pair(s)...`);
	for (const [, entry] of activePairs) {
		try { entry.sock.end(new Error('Bot shutting down')); } catch (_) {}
	}
	activePairs.clear();
}

module.exports = {
	generatePairingCode,
	removePair,
	listPairs,
	isPairActive,
	isPairedUser,
	shutdownAll
};
