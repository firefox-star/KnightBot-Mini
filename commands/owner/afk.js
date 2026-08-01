/**
 * AFK AI Auto-Reply — Bot replies to your messages sounding like you
 * 
 * Usage: ,afk on/off [reason]
 * When ON: bot auto-replies to ALL DMs using AI, sounds human
 * For media (voice notes, images, etc.) sends a simple offline text
 */

const fs = require('fs');
const path = require('path');
const config = require('../../config');
const { chatAI } = require('../../utils/api');

const STATE_FILE = path.join(__dirname, '../../database/afk.json');

// Small delay between replies to avoid rate limits (per jid)
const lastReplyTime = new Map();
const MIN_INTERVAL_MS = 3000; // 3 seconds minimum between replies per chat

// Cache the state so we don't read file on every message
let cachedState = null;
let stateFileMtime = 0;

function getState() {
	try {
		if (fs.existsSync(STATE_FILE)) {
			const stat = fs.statSync(STATE_FILE);
			// Only re-read if file changed
			if (stat.mtimeMs !== stateFileMtime || !cachedState) {
				cachedState = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
				stateFileMtime = stat.mtimeMs;
			}
			return cachedState;
		}
	} catch (_) {}
	return { enabled: false, reason: '' };
}

function saveState(state) {
	const dir = path.dirname(STATE_FILE);
	if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
	cachedState = state;
	stateFileMtime = Date.now();
}

function isEnabled() {
	return getState().enabled === true;
}

/** Check if a message contains media (not just text) */
function isMediaMessage(msg) {
	if (!msg?.message) return false;
	const m = msg.message;
	return !!(
		m.audioMessage ||
		m.imageMessage ||
		m.videoMessage ||
		m.stickerMessage ||
		m.documentMessage ||
		m.documentWithCaptionMessage
	);
}

/** Extract text from a stored message */
function extractText(m) {
	if (!m?.message) return '';
	const mt = m.message;
	// Unwrap ephemeral/view-once containers
	let unwrapped = mt;
	if (unwrapped.ephemeralMessage) unwrapped = unwrapped.ephemeralMessage.message;
	if (unwrapped.viewOnceMessageV2) unwrapped = unwrapped.viewOnceMessageV2.message;
	
	if (unwrapped.conversation) return unwrapped.conversation;
	if (unwrapped.extendedTextMessage?.text) return unwrapped.extendedTextMessage.text;
	if (unwrapped.imageMessage?.caption) return unwrapped.imageMessage.caption;
	if (unwrapped.videoMessage?.caption) return unwrapped.videoMessage.caption;
	return '';
}

/** Extract the current message's text directly */
function extractCurrentText(msg) {
	if (!msg?.message) return '';
	const mt = msg.message;
	if (mt.conversation) return mt.conversation;
	if (mt.extendedTextMessage?.text) return mt.extendedTextMessage.text;
	if (mt.imageMessage?.caption) return mt.imageMessage.caption;
	if (mt.videoMessage?.caption) return mt.videoMessage.caption;
	return '';
}

/** Called from index.js for incoming DMs */
async function handleAfkReply(sock, msg, store) {
	const state = getState();
	if (!state.enabled) return;

	const jid = msg.key.remoteJid;
	if (!jid || jid.endsWith('@g.us')) return;
	if (msg.key.fromMe) return;

	// Don't reply to owner's messages
	const sender = msg.key.participant || jid;
	const senderNum = sender.split('@')[0];
	if (config.ownerNumber.some(n => senderNum === String(n))) return;

	// Rate limit: minimum 3s between replies per chat
	const last = lastReplyTime.get(jid) || 0;
	if (Date.now() - last < MIN_INTERVAL_MS) return;
	lastReplyTime.set(jid, Date.now());

	const reason = state.reason || 'not around';

	// For media messages — simple offline text, no AI
	if (isMediaMessage(msg)) {
		const replies = [
			`im ${reason} rn, text me instead`,
			`not around right now, send a text`,
			`cant check media atm, im ${reason}`,
			`im offline, just text me`,
			`busy rn, drop a text instead`,
		];
		const reply = replies[Math.floor(Math.random() * replies.length)];
		try { await sock.sendMessage(jid, { text: reply }); } catch (e) { console.error('[afk] media reply error:', e.message); }
		return;
	}

	// Get the current message text
	const currentText = extractCurrentText(msg).trim();
	if (!currentText) return; // nothing to reply to

	// Build context from recent messages in store
	let chatContext = '';
	try {
		const chatMsgs = store?.messages?.get(jid);
		if (chatMsgs && chatMsgs.size > 0) {
			const recentRaw = Array.from(chatMsgs.values())
				.sort((a, b) => (a.messageTimestamp || 0) - (b.messageTimestamp || 0))
				.slice(-15);

			const recent = recentRaw
				.map(m => ({ who: m.key.fromMe ? 'Me' : 'Them', text: extractText(m) }))
				.filter(e => e.text.trim().length > 0);

			if (recent.length > 0) {
				chatContext = recent.map(m => `${m.who}: ${m.text}`).join('\n');
			}
		}
	} catch (_) {}

	// Even if no context, still reply using just the current message
	const chatText = chatContext || `Them: ${currentText}`;

	const prompt =
		`You are replying to WhatsApp messages on behalf of someone. They are currently ${reason}. ` +
		`Sound like a REAL HUMAN texting casually — no emoji spam, no "I'm an AI", no robotic phrases. ` +
		`Keep replies short (1-3 sentences). Use normal texting style, lowercase, maybe a typo or slang. ` +
		`If asked where you are, give a vague excuse. Don't be overly helpful or formal.\n\n` +
		`Recent chat:\n${chatText}\n\n` +
		`Reply as "Me" with just the message text. No quotes, no labels. Just what to send.`;

	try {
		const result = await chatAI(prompt);
		let reply = (result?.msg || result?.result || result?.data || '').trim();
		reply = reply.replace(/^["']|["']$/g, '').replace(/^(Me:\s*)/i, '').trim();
		if (reply.length > 0 && reply.length < 500) {
			await sock.sendMessage(jid, { text: reply });
		}
	} catch (err) {
		// If AI fails, send a simple fallback reply
		try {
			const fallbacks = [
				`im ${reason} rn`,
				`yeah im not around`,
				`busy atm`,
				`cant talk right now`,
			];
			await sock.sendMessage(jid, { text: fallbacks[Math.floor(Math.random() * fallbacks.length)] });
		} catch (_) {}
	}
}

module.exports = {
	name: 'afk',
	category: 'owner',
	description: 'AI auto-reply when you\'re away, sounds human',
	usage: ',afk on/off [reason]',
	ownerOnly: true,
	isEnabled,
	handleAfkReply,

	async execute(sock, msg, args, extra) {
		const sub = args[0]?.toLowerCase();

		if (sub === 'on') {
			const reason = args.slice(1).join(' ');
			saveState({ enabled: true, reason });
			return extra.reply(
				'\U0001f6ab *AFK Mode ON*\n' +
				(reason ? `\nReason: ${reason}` : '') +
				'\n\nBot will auto-reply to ALL your DMs.\n' +
				'Media gets a simple offline text.'
			);
		}

		if (sub === 'off') {
			saveState({ enabled: false, reason: '' });
			lastReplyTime.clear();
			return extra.reply('\u2705 *AFK Mode OFF*');
		}

		const state = getState();
		const status = state.enabled ? 'ON' + (state.reason ? ` (${state.reason})` : '') : 'OFF';
		return extra.reply(`\U0001f6ab AFK: *${status}*`);
	}
};