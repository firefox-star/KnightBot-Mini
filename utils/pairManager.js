/**
 * Pair Manager — Generates WhatsApp pairing codes for linking devices
 *
 * Creates INDEPENDENT Baileys sockets in separate session directories.
 * Does NOT touch the main bot's session or event handlers.
 *
 * Architecture:
 *   sessions/           ← main bot session (NEVER touched by pair manager)
 *   sessions/pair_XXX/  ← each paired number gets its own isolated session
 *
 * Flow:
 *   1. Owner sends ".pair 234xxxxxxxxx"
 *   2. Manager creates a fresh Baileys socket + auth state in sessions/pair_XXX/
 *   3. Calls requestPairingCode() → WhatsApp server generates an 8-char code
 *   4. Code is returned to the command handler → sent to owner
 *   5. Owner forwards code to target person → they enter it in WhatsApp
 *   6. Server sends pair-success → socket transitions to connection: 'open'
 *   7. Bot is now linked as a device on target's WhatsApp
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

// Active paired sessions: Map<"234xxx", { sock, state, saveCreds, status, pairedAt }>
const activePairs = new Map();

// Base directory for pair sessions (sibling to main session)
const PAIR_SESSIONS_DIR = path.join(__dirname, '..', 'sessions');

// Ensure sessions directory exists
if (!fs.existsSync(PAIR_SESSIONS_DIR)) {
	fs.mkdirSync(PAIR_SESSIONS_DIR, { recursive: true });
}

/**
 * Create a silent logger for pair sockets (won't pollute main bot logs)
 */
function createPairLogger(number) {
	const { Writable } = require('stream');
	const silentStream = new Writable({
		write(chunk, encoding, callback) {
			// Discard all log output
			callback();
		}
	});
	return pino({ level: 'silent' }, silentStream);
}

/**
 * Generate a pairing code for a phone number.
 * Creates a completely independent Baileys socket.
 *
 * @param {string} phoneNumber - The target phone number (digits only, with country code)
 * @returns {Promise<{ code: string, number: string }>} The 8-char pairing code
 */
async function generatePairingCode(phoneNumber) {
	// Validate number
	const clean = phoneNumber.replace(/\D/g, '');
	if (!clean || clean.length < 7 || clean.length > 15) {
		throw new Error('Invalid phone number. Must be 7-15 digits with country code.');
	}

	// Check if already active
	if (activePairs.has(clean)) {
		const existing = activePairs.get(clean);
		if (existing.status === 'pairing') {
			throw new Error(`Pairing already in progress for +${clean}. Wait for it to complete or use .unpair ${clean} first.`);
		}
		if (existing.status === 'connected') {
			throw new Error(`+${clean} is already paired and connected. Use .unpair ${clean} to remove.`);
		}
	}

	const sessionDir = path.join(PAIR_SESSIONS_DIR, `pair_${clean}`);
	const logger = createPairLogger(clean);

	// Create isolated auth state for this pair
	const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
	const { version } = await fetchLatestBaileysVersion();

	// Create completely independent socket — no interaction with main bot
	const sock = makeWASocket({
		version,
		logger,
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
		state,
		saveCreds,
		status: 'connecting',
		number: clean,
		createdAt: Date.now(),
		pairedAt: null
	};
	activePairs.set(clean, pairEntry);

	// Handle connection lifecycle for this pair socket
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
				console.log(`[pairManager] +${clean} logged out, removing session`);
				activePairs.delete(clean);
				// Clean up session files
				try {
					fs.rmSync(sessionDir, { recursive: true, force: true });
				} catch (e) {
					console.error(`[pairManager] Failed to cleanup session for +${clean}:`, e.message);
				}
			} else {
				pairEntry.status = 'disconnected';
				console.log(`[pairManager] +${clean} disconnected (code: ${statusCode}), will not auto-reconnect`);
			}
		}
	});

	// Wait for the socket to be ready, then request pairing code
	const code = await new Promise((resolve, reject) => {
		const timeout = setTimeout(() => {
			cleanupPair(clean);
			reject(new Error('Timeout: Failed to generate pairing code in 30 seconds. Check your connection.'));
		}, 30_000);

		sock.ev.on('connection.update', async (update) => {
			if (update.connection === 'connecting') {
				try {
					pairEntry.status = 'pairing';
					const pairingCode = await sock.requestPairingCode(clean);
					clearTimeout(timeout);
					console.log(`[pairManager] Pairing code generated for +${clean}: ${pairingCode}`);
					resolve(pairingCode);
				} catch (err) {
					clearTimeout(timeout);
					cleanupPair(clean);
					reject(new Error(`Failed to request pairing code: ${err.message}`));
				}
			}
		});
	});

	return { code, number: clean };
}

/**
 * Remove a paired session cleanly.
 *
 * @param {string} phoneNumber - The phone number to unpair
 * @returns {{ success: boolean, message: string }}
 */
function removePair(phoneNumber) {
	const clean = phoneNumber.replace(/\D/g, '');

	if (!activePairs.has(clean)) {
		return { success: false, message: `+${clean} is not actively paired.` };
	}

	const entry = activePairs.get(clean);
	const sessionDir = path.join(PAIR_SESSIONS_DIR, `pair_${clean}`);

	// Close the socket gracefully
	try {
		entry.sock.end(new Error('Owner initiated unpair'));
	} catch (_) {
		// Socket might already be closed
	}

	// Remove from tracking
	activePairs.delete(clean);

	// Clean up session files
	try {
		if (fs.existsSync(sessionDir)) {
			fs.rmSync(sessionDir, { recursive: true, force: true });
		}
	} catch (e) {
		console.error(`[pairManager] Failed to cleanup session files for +${clean}:`, e.message);
	}

	console.log(`[pairManager] +${clean} unpaired and cleaned up`);
	return { success: true, message: `+${clean} has been unpaired successfully.` };
}

/**
 * Internal: Clean up a pair entry without closing socket (for error cases)
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
 * Get a formatted list of all active pairs.
 *
 * @returns {Array<{ number: string, status: string, pairedAt: string|null }>}
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
 * Check if a number is currently being paired or is already paired.
 */
function isPairActive(phoneNumber) {
	const clean = phoneNumber.replace(/\D/g, '');
	return activePairs.has(clean);
}

/**
 * Clean up all pairs on bot shutdown.
 * Call this from a process event handler if desired.
 */
function shutdownAll() {
	console.log(`[pairManager] Shutting down ${activePairs.size} paired session(s)...`);
	for (const [number, entry] of activePairs) {
		try {
			entry.sock.end(new Error('Bot shutting down'));
		} catch (_) {}
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