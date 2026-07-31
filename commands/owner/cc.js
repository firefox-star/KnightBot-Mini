const { chatAI } = require('../../utils/api');
const fs = require('fs');
const path = require('path');

const VIBE_FILE = path.join(__dirname, '../../database/vibe.json');

const _cooldowns = new Map();
const COOLDOWN_MS = 10000;

function loadVibes() {
	try {
		if (fs.existsSync(VIBE_FILE)) return JSON.parse(fs.readFileSync(VIBE_FILE, 'utf8'));
	} catch (_) {}
	return {};
}

const VIBE_MAP = {
	f: 'flirty and playful',
	c: 'casual and friendly',
	d: 'deep and thoughtful',
	s: 'sarcastic and funny',
	a: 'auto'
};

function extractText(msg) {
	if (!msg?.message) return '';
	const m = msg.message;
	if (m.conversation) return m.conversation;
	if (m.extendedTextMessage?.text) return m.extendedTextMessage.text;
	if (m.imageMessage?.caption) return m.imageMessage.caption;
	if (m.videoMessage?.caption) return m.videoMessage.caption;
	return '';
}

module.exports = {
	name: 'cc',
	category: 'owner',
	description: 'AI suggests 5 replies based on recent chat',
	usage: ',cc',
	ownerOnly: true,

	async execute(sock, msg, args, extra) {
		const chatJid = msg.key.remoteJid;
		const ownerNum = sock.user.id.split(':')[0];
		const ownerJid = ownerNum + '@s.whatsapp.net';

		// Cooldown check
		const now = Date.now();
		const lastUsed = _cooldowns.get(chatJid) || 0;
		if (now - lastUsed < COOLDOWN_MS) {
			const remaining = Math.ceil((COOLDOWN_MS - (now - lastUsed)) / 1000);
			return extra.reply(`\u23f3 Wait ${remaining}s`);
		}
		_cooldowns.set(chatJid, now);

		// Build history from main store
		const { store } = require('../../index');
		const chatMsgs = store.messages.get(chatJid);
		const recentRaw = chatMsgs
			? Array.from(chatMsgs.values())
				.sort((a, b) => (a.messageTimestamp || 0) - (b.messageTimestamp || 0))
				.slice(-20)
			: [];

		if (recentRaw.length < 2) {
			return extra.reply('\u274c Not enough messages yet. Send a few more in this chat then try ,cc again.');
		}

		const recent = recentRaw
			.map(m => ({
				sender: m.key.fromMe ? 'Me' : 'Them',
				text: extractText(m)
			}))
			.filter(e => e.text.trim().length > 0);

		if (recent.length < 2) {
			return extra.reply('\u274c Not enough text messages. Try in a chat with more text conversation.');
		}

		// Vibe
		const vibes = loadVibes();
		const vibeKey = vibes[ownerNum] || 'a';
		const vibeLabel = VIBE_MAP[vibeKey] || 'auto';

		const chatText = recent.map(m => `${m.sender}: ${m.text}`).join('\n');

		let vibeInstruction = 'Auto-detect the tone and vibe of the conversation and match it naturally.';
		if (vibeKey !== 'a') {
			vibeInstruction = `The vibe/tone should be: ${vibeLabel}. Match this energy naturally.`;
		}

		const prompt =
			`Here is a recent chat:\n\n${chatText}\n\n` +
			`${vibeInstruction}\n\n` +
			`Generate exactly 5 different natural reply options I could send as "Me" to continue this conversation. ` +
			`Make them sound like a real human typed them. Each should feel different. ` +
			`Format as a numbered list 1-5. Reply with ONLY the 5 options, no intro or outro text.`;

		try {
			await extra.react('\u23f3');

			const result = await chatAI(prompt);
			const response = result.msg || result.result || result.data || JSON.stringify(result);

			const chatPreview = recent.slice(-4).map(m => `${m.sender}: ${m.text}`).join('\n');

			await sock.sendMessage(ownerJid, {
				text:
				`\ud83d\udcac *Chat Continuer* [${vibeLabel}]
` +
				`\ud83d\udccd Chat: ${chatJid.includes('@g.us') ? 'Group' : 'DM'}

` +
				`*Recent:*
${chatPreview}

` +
				`*Suggested replies:*
${response}

` +
				`_Copy your pick and send it_`
			});

			await sock.sendMessage(chatJid, {
				react: { text: '\u2705', key: msg.key }
			}).catch(() => {});

		} catch (err) {
			await sock.sendMessage(chatJid, {
				react: { text: '\u274c', key: msg.key }
			}).catch(() => {});
			try {
				await sock.sendMessage(ownerJid, {
				text: `\u274c CC Error: ${err.message}`
				});
			} catch (_) {}
		}
	}
};
