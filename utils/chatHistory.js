/**
 * Chat History — Stores recent messages per chat for AI features
 *
 * Listens to messages.upsert on the main socket.
 * Keeps last 30 messages per JID in memory (lightweight, no disk I/O).
 * Used by: ,cc (chat continuer), future AI chatbot, etc.
 */

const history = new Map(); // jid -> [{ sender, text, timestamp }]
const MAX_PER_CHAT = 30;

/**
 * Add a message to the history.
 * @param {string} jid - Chat JID
 * @param {string} text - Message text
 * @param {boolean} fromMe - Whether the message is from the bot/owner
 */
function addMessage(jid, text, fromMe) {
	if (!jid || !text || !text.trim()) return;

	// Skip system JIDs
	if (jid.includes('@broadcast') || jid.includes('@newsletter')) return;

	if (!history.has(jid)) history.set(jid, []);
	const chat = history.get(jid);

	chat.push({
		sender: fromMe ? 'me' : 'them',
		text: text.trim().substring(0, 500),
		timestamp: Date.now()
	});

	// Keep only last N
	if (chat.length > MAX_PER_CHAT) {
		chat.splice(0, chat.length - MAX_PER_CHAT);
	}
}

/**
 * Get recent chat history for a JID.
 * @param {string} jid
 * @param {number} limit - Max messages to return (default 15)
 * @returns {Array}
 */
function getHistory(jid, limit = 15) {
	const chat = history.get(jid);
	if (!chat) return [];
	return chat.slice(-limit);
}

/**
 * Initialize the listener on the main socket.
 * Call once from index.js after socket is created.
 */
function initialize(sock) {
	sock.ev.on('messages.upsert', ({ messages }) => {
		for (const msg of messages) {
			if (!msg.message) continue;

			const jid = msg.key.remoteJid;
			if (!jid) continue;

			// Extract text from any message type
			let text = '';
			const m = msg.message;
			if (m.conversation) text = m.conversation;
			else if (m.extendedTextMessage?.text) text = m.extendedTextMessage.text;
			else if (m.imageMessage?.caption) text = m.imageMessage.caption;
			else if (m.videoMessage?.caption) text = m.videoMessage.caption;

			if (!text.trim()) continue;

			addMessage(jid, text, !!msg.key.fromMe);
		}
	});

	console.log('[chatHistory] Listening for messages');
}

module.exports = { initialize, getHistory, addMessage };
