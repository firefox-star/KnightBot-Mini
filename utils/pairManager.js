/**
 * Pair Manager — Generates WhatsApp pairing codes for linking devices
 *
 * Creates INDEPENDENT Baileys sockets in separate session directories.
 * Does NOT touch the main bot's session or event handlers.
 *
 * Architecture:
 *   session/            ← main bot session (NEVER touched by pair manager)
 *   session/pair_XXX/   ← each paired number gets its own isolated session
 *
 * Flow:
 *   1. Owner sends ",pair 234xxxxxxxxx"
 *   2. Manager creates a fresh Baileys socket + auth state in session/pair_XXX/
 *   3. Waits 3s for socket to stabilize (same as working standalone bots)
 *   4. Calls requestPairingCode() → WhatsApp server generates an 8-char code
 *   5. Code is returned to the command handler → sent to owner
 *   6. Owner forwards code to target person → they enter it in WhatsApp
 *   7. Server sends pair-success → socket transitions to connection: 'open'
 *   8. Bot is now linked as a device on target's WhatsApp
 */

const pino = require('pino');
const fs = require('fs');
const path = require('path');
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
 * Generate a pairing code for a phone number.
 * Creates a completely independent Baileys socket.
 *
 * @param {string} phoneNumber - The target phone number (digits only, with country code)
 * @returns {Promise<{ code: string, number: string }>} The 8-char pairing code
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

	// Generate pairing code after 3 seconds (same approach as working standalone bots)
	// The socket needs time to establish WebSocket before it can request a code
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
 * Check if a number is currently being paired.
 */
function isPairActive(phoneNumber) {
	return activePairs.has(phoneNumber.replace(/\D/g, ''));
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
	shutdownAll
};