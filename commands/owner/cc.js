/**
 * Chat Continuer — AI-powered reply suggestions
 *
 * Usage:
 *   ,cc          → 5 reply suggestions sent to your bot DM
 *   ,v f/c/d/s/a  → set vibe (flirty/casual/deep/sarcastic/auto)
 *
 * Reads recent chat history, sends to GLM AI,
 * delivers 5 options to your private chat with the bot.
 */

const { chat: glmChat } = require('../../utils/glmApi');
const { getHistory } = require('../../utils/chatHistory');
const fs = require('fs');
const path = require('path');

const VIBE_FILE = path.join(__dirname, '../../database/vibe.json');

// Cooldown: prevent spamming ,cc in the same chat within 15 seconds
const _cooldowns = new Map(); // chatJid -> timestamp
const COOLDOWN_MS = 15000;

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

		// Check cooldown
		const now = Date.now();
		const lastUsed = _cooldowns.get(chatJid) || 0;
		if (now - lastUsed < COOLDOWN_MS) {
			const remaining = Math.ceil((COOLDOWN_MS - (now - lastUsed)) / 1000);
			return extra.reply(`⏳ Cool down — wait ${remaining}s before using ,cc again`);
		}
		_cooldowns.set(chatJid, now);

		// Check history
		const history = getHistory(chatJid);
		if (history.length < 2) {
			return extra.reply('❌ Not enough chat history yet. Chat more first.');
		}

		// Check API key
		if (!process.env.GLM_API_KEY) {
			return extra.reply('❌ GLM_API_KEY not set. Add it in Railway env vars.');
		}

		// Get vibe setting
		const vibes = loadVibes();
		const vibeKey = vibes[ownerNum] || 'a';
		const vibeLabel = VIBE_MAP[vibeKey] || 'auto';

		// Build chat context for AI
		const recent = history.slice(-15);
		const chatText = recent.map(m =>
			`${m.sender === 'me' ? 'Me' : 'Them'}: ${m.text}`
		).join('\n');

		// Vibe instruction
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
			await extra.react('⏳');

			const response = await glmChat([
				{
					role: 'assistant',
					content: 'You are a conversation expert who generates natural, human-sounding text message replies. Never sound robotic or formal.'
				},
				{ role: 'user', content: prompt }
			]);

			// Build a clean display of the chat + options
			const chatPreview = recent.slice(-4).map(m =>
				`${m.sender === 'me' ? 'Me' : 'Them'}: ${m.text}`
			).join('\n');

			await sock.sendMessage(ownerJid, {
				text:
				`💬 *Chat Continuer* [${vibeLabel}]
` +
				`📍 Chat: ${chatJid.includes('@g.us') ? 'Group' : 'DM'}

` +
				`*Recent:*
${chatPreview}

` +
				`*Suggested replies:*
${response}

` +
				`_Copy your pick and send it_`
			});

			// Done react in original chat
			await sock.sendMessage(chatJid, {
				react: { text: '✅', key: msg.key }
			}).catch(() => {});

		} catch (err) {
			await sock.sendMessage(chatJid, {
				react: { text: '❌', key: msg.key }
			}).catch(() => {});

			// Send friendly error to DM
			try {
				await sock.sendMessage(ownerJid, {
					text: `❌ CC Error: ${err.message}`
				});
			} catch (_) {}
		}
	}
};
