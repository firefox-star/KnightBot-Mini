/**
 * Anti-Delete — Catches deleted messages and forwards to owner
 * 
 * Usage: ,antidelete on/off
 */

const fs = require('fs');
const path = require('path');
const config = require('../../config');

const STATE_FILE = path.join(__dirname, '../../database/antidelete.json');

function isEnabled() {
	try {
		if (fs.existsSync(STATE_FILE)) {
			const d = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
			return !!d.enabled;
		}
	} catch (_) {}
	return false;
}

function setEnabled(v) {
	const dir = path.dirname(STATE_FILE);
	if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(STATE_FILE, JSON.stringify({ enabled: v }, null, 2));
}

/** Called from index.js when a message delete is detected */
async function onMessageDelete(sock, msg, store) {
	if (!isEnabled()) return;

	const jid = msg.key.remoteJid;
	const id = msg.key.id;
	const sender = msg.key.participant || msg.key.remoteJid;
	const fromMe = msg.key.fromMe;

	// Don't report own deleted messages
	if (fromMe) return;

	// Find the original message in store
	const chatMsgs = store.messages.get(jid);
	let original = null;
	if (chatMsgs) {
		original = chatMsgs.get(id);
	}

	if (!original || !original.message) return;

	const m = original.message;
	let content = '';
	let mediaType = null;

	if (m.conversation) {
		content = m.conversation;
	} else if (m.extendedTextMessage?.text) {
		content = m.extendedTextMessage.text;
	} else if (m.imageMessage) {
		content = m.imageMessage.caption || '[Image]';
		mediaType = 'image';
	} else if (m.videoMessage) {
		content = m.videoMessage.caption || '[Video]';
		mediaType = 'video';
	} else if (m.audioMessage) {
		content = '[Voice Note]';
		mediaType = 'audio';
	} else if (m.stickerMessage) {
		content = '[Sticker]';
		mediaType = 'sticker';
	} else {
		content = '[' + Object.keys(m)[0] + ']';
	}

	if (!content) return;

	const ownerNum = config.ownerNumber[0];
	const ownerJid = ownerNum + '@s.whatsapp.net';
	const shortSender = sender.split('@')[0];

	// Try to download media before it's gone
	let mediaBuffer = null;
	if (mediaType && content !== '[' + mediaType + ']') {
		try {
			const { downloadContentFromMessage } = require('@whiskeysockets/baileys');
			const stream = await downloadContentFromMessage(m[mediaType + 'Message'], mediaType);
			mediaBuffer = Buffer.from([]);
			for await (const chunk of stream) mediaBuffer = Buffer.concat([mediaBuffer, chunk]);
		} catch (_) {}
	}

	const header = `\U0001f510 *Deleted Message Caught*\n\n\U0001f4e3 From: +${shortSender}\n\U0001f4ac Chat: ${jid.endsWith('@g.us') ? 'Group' : 'DM'}\n`;

	try {
		if (mediaBuffer && mediaType === 'image') {
			await sock.sendMessage(ownerJid, { image: mediaBuffer, caption: header + content, mimetype: 'image/jpeg' });
		} else if (mediaBuffer && mediaType === 'video') {
			await sock.sendMessage(ownerJid, { video: mediaBuffer, caption: header + content, mimetype: 'video/mp4' });
		} else if (mediaBuffer && mediaType === 'audio') {
			await sock.sendMessage(ownerJid, { audio: mediaBuffer, ptt: true, mimetype: 'audio/ogg; codecs=opus' });
		} else {
			await sock.sendMessage(ownerJid, { text: header + `\n\U0001f4dd Message:\n${content}` });
		}
	} catch (_) {}
}

module.exports = {
	name: 'antidelete',
	category: 'owner',
	description: 'Catch deleted messages and forward to your DM',
	usage: ',antidelete [on|off]',
	ownerOnly: true,
	isEnabled,
	onMessageDelete,

	async execute(sock, msg, args, extra) {
		const sub = args[0]?.toLowerCase();

		if (sub === 'on') {
			setEnabled(true);
			return extra.reply('\U0001f512 *Anti-Delete ON*\n\nDeleted messages will be forwarded to your DM.');
		}

		if (sub === 'off') {
			setEnabled(false);
			return extra.reply('\U0001f513 *Anti-Delete OFF*');
		}

		// Toggle
		const now = !isEnabled();
		setEnabled(now);
		return extra.reply(now
			? '\U0001f512 *Anti-Delete ON*'
			: '\U0001f513 *Anti-Delete OFF*');
	}
};