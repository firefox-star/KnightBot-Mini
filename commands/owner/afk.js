/**
 * AFK AI Auto-Reply — Bot replies to your messages sounding like you
 * 
 * Usage: ,afk on/off
 * When ON: bot auto-replies to DMs using AI, sounds human
 */

const fs = require('fs');
const path = require('path');
const config = require('../../config');
const { chatAI } = require('../../utils/api');

const STATE_FILE = path.join(__dirname, '../../database/afk.json');
const COOLDOWNS = new Map(); // per-jid cooldowns
const COOLDOWN_MS = 60000; // 1 min between auto-replies per chat

function getState() {
	try {
		if (fs.existsSync(STATE_FILE)) return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
	} catch (_) {}
	return { enabled: false, reason: '' };
}

function saveState(state) {
	const dir = path.dirname(STATE_FILE);
	if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

/** Called from index.js for incoming DMs */
async function handleAfkReply(sock, msg, store) {
	const state = getState();
	if (!state.enabled) return;

	const jid = msg.key.remoteJid;
	if (jid.endsWith('@g.us')) return; // groups only if wanted later
	if (msg.key.fromMe) return; // don't reply to self

	// Owner's messages should not be auto-replied
	const sender = msg.key.participant || jid;
	if (config.ownerNumber.includes(sender.split('@')[0])) return;

	// Cooldown per chat
	const lastReply = COOLDOWNS.get(jid) || 0;
	if (Date.now() - lastReply < COOLDOWN_MS) return;
	COOLDOWNS.set(jid, Date.now());

	// Get recent messages for context
	const chatMsgs = store.messages.get(jid);
	const recentRaw = chatMsgs
		? Array.from(chatMsgs.values())
			.sort((a, b) => (a.messageTimestamp || 0) - (b.messageTimestamp || 0))
			.slice(-15)
		: [];

	if (recentRaw.length < 1) return;

	function extractText(m) {
		if (!m?.message) return '';
		const mt = m.message;
		if (mt.conversation) return mt.conversation;
		if (mt.extendedTextMessage?.text) return mt.extendedTextMessage.text;
		if (mt.imageMessage?.caption) return mt.imageMessage.caption;
		if (mt.videoMessage?.caption) return mt.videoMessage.caption;
		return '';
	}

	const recent = recentRaw
		.map(m => ({ who: m.key.fromMe ? 'Me' : 'Them', text: extractText(m) }))
		.filter(e => e.text.trim().length > 0);

	if (recent.length < 1) return;

	const chatText = recent.map(m => `${m.who}: ${m.text}`).join('\n');
	const reason = state.reason ? `I'm currently ${state.reason}.` : "I'm not available right now.";

	const prompt =
		`You are replying to WhatsApp messages on behalf of someone. ${reason} ` +
		`You must sound like a REAL HUMAN texting casually — no emojis spam, no "I'm an AI", no robotic phrases. ` +
		`Keep replies short and natural (1-3 sentences max). Use normal texting style with lowercase, maybe a typo or slang. ` +
		`If they ask where you are, give a vague casual excuse. Don't be overly helpful or formal.\n\n` +
		`Recent chat:\n${chatText}\n\n` +
		`Reply as "Me" with just the message text. No quotes, no labels, no explanation. Just what to send.`;

	try {
		const result = await chatAI(prompt);
		let reply = (result.msg || result.result || result.data || '').trim();
		// Clean up AI artifacts
		reply = reply.replace(/^["']|["']$/g, '').replace(/^(Me:\s*)/i, '').trim();
		if (reply.length > 0 && reply.length < 500) {
			await sock.sendMessage(jid, { text: reply });
		}
	} catch (_) {}
}

module.exports = {
	name: 'afk',
	category: 'owner',
	description: 'AI auto-reply when you\'re away, sounds human',
	usage: ',afk on/off [reason]',
	ownerOnly: true,
	handleAfkReply,

	async execute(sock, msg, args, extra) {
		const sub = args[0]?.toLowerCase();

		if (sub === 'on') {
			const reason = args.slice(1).join(' ');
			saveState({ enabled: true, reason });
			return extra.reply(
				'\U0001f6ab *AFK Mode ON*\n' +
				(reason ? `\nReason: ${reason}` : '') +
				'\n\nBot will auto-reply to your DMs using AI.\n' +
				'Replies sound human, not robotic.'
			);
		}

		if (sub === 'off') {
			saveState({ enabled: false, reason: '' });
			return extra.reply('\u2705 *AFK Mode OFF*\n\nBack to normal.');
		}

		const state = getState();
		const status = state.enabled ? 'ON' + (state.reason ? ` (${state.reason})` : '') : 'OFF';
		return extra.reply(`\U0001f6ab AFK: *${status}*`);
	}
};
