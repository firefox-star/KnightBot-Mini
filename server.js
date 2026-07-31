const express = require('express');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const botState = require('./sharedState');
const { isGhostMode, setGhostMode } = require('./commands/owner/ghost');

const app = express();
app.use(express.json());

const DASHBOARD_PASSWORD = '5656';

// ---- Auth ----
const tokens = new Map();

function authMiddleware(req, res, next) {
	const auth = req.headers.authorization;
	if (!auth || !auth.startsWith('Bearer ')) return res.status(401).json({ error: 'No token' });
	const token = auth.slice(7);
	if (!tokens.has(token)) return res.status(401).json({ error: 'Invalid token' });
	next();
}

app.post('/api/auth', (req, res) => {
	const { password } = req.body || {};
	if (password !== DASHBOARD_PASSWORD) return res.status(403).json({ error: 'Wrong password' });
	const token = crypto.randomBytes(32).toString('hex');
	tokens.set(token, Date.now());
	res.json({ token });
});

// ---- API Routes ----

// Bot status
app.get('/api/status', authMiddleware, (req, res) => {
	const sock = botState.getSock();
	const connected = !!sock && sock.ws?.readyState === 1;
	res.json({
		connected,
		uptime: Date.now() - botState.startTime,
		number: sock?.user?.id?.split(':')[0] || null,
		ghost: isGhostMode()
	});
});

// Ghost mode toggle
app.post('/api/ghost', authMiddleware, (req, res) => {
	const current = isGhostMode();
	setGhostMode(!current);
	res.json({ ghost: !current });
});

// Chat list
app.get('/api/chats', authMiddleware, (req, res) => {
	const store = botState.getStore();
	if (!store) return res.json([]);

	const chats = [];
	for (const [jid, chatMsgs] of store.messages.entries()) {
		if (chatMsgs.size === 0) continue;
		const sorted = Array.from(chatMsgs.values()).sort((a, b) => (b.messageTimestamp || 0) - (a.messageTimestamp || 0));
		const last = sorted[0];
		const text = extractText(last);
		if (!text) continue;
		chats.push({
			jid,
			lastMessage: text.substring(0, 80),
			lastTimestamp: last.messageTimestamp,
			fromMe: !!last.key?.fromMe,
			isGroup: jid.endsWith('@g.us'),
			count: chatMsgs.size
		});
	}

	chats.sort((a, b) => (b.lastTimestamp || 0) - (a.lastTimestamp || 0));
	res.json(chats);
});

// Messages in a chat
app.get('/api/chats/:jid', authMiddleware, (req, res) => {
	const store = botState.getStore();
	if (!store) return res.json([]);

	const jid = decodeURIComponent(req.params.jid);
	const chatMsgs = store.messages.get(jid);
	if (!chatMsgs) return res.json([]);

	const messages = Array.from(chatMsgs.values())
		.sort((a, b) => (a.messageTimestamp || 0) - (b.messageTimestamp || 0))
		.map(m => ({
			id: m.key?.id,
			fromMe: !!m.key?.fromMe,
			sender: m.key?.participant || m.key?.remoteJid,
			text: extractText(m),
			timestamp: m.messageTimestamp,
			type: getMessageType(m)
		}));

	res.json(messages);
});

// Send message
app.post('/api/chats/:jid/send', authMiddleware, async (req, res) => {
	const sock = botState.getSock();
	if (!sock || sock.ws?.readyState !== 1) {
		return res.status(503).json({ error: 'Bot not connected' });
	}

	const jid = decodeURIComponent(req.params.jid);
	const { text } = req.body;
	if (!text?.trim()) return res.status(400).json({ error: 'No text' });

	try {
		await sock.sendMessage(jid, { text: text.trim() });
		res.json({ success: true });
	} catch (err) {
		res.status(500).json({ error: err.message });
	}
});

// ---- Smart Reply (renamed CC) ----
app.post('/api/smart-reply/:jid', authMiddleware, async (req, res) => {
	const store = botState.getStore();
	const sock = botState.getSock();
	if (!store || !sock) return res.status(503).json({ error: 'Bot not ready' });

	const jid = decodeURIComponent(req.params.jid);
	const chatMsgs = store.messages.get(jid);
	const recentRaw = chatMsgs
		? Array.from(chatMsgs.values())
			.sort((a, b) => (a.messageTimestamp || 0) - (b.messageTimestamp || 0))
			.slice(-20)
		: [];

	if (recentRaw.length < 2) {
		return res.json({ error: 'Not enough messages yet', replies: [] });
	}

	const recent = recentRaw
		.map(m => ({ sender: m.key.fromMe ? 'Me' : 'Them', text: extractText(m) }))
		.filter(e => e.text.trim().length > 0);

	if (recent.length < 2) {
		return res.json({ error: 'Not enough text messages', replies: [] });
	}

	// Load vibe
	const VIBE_FILE = path.join(__dirname, 'database/vibe.json');
	let vibeKey = 'a';
	try {
		if (fs.existsSync(VIBE_FILE)) {
			const vdata = JSON.parse(fs.readFileSync(VIBE_FILE, 'utf8'));
			const ownerNum = sock.user?.id?.split(':')[0];
			if (ownerNum && vdata[ownerNum]) vibeKey = vdata[ownerNum];
		}
	} catch (_) {}

	const VIBE_MAP = {
		f: 'flirty and playful',
		c: 'casual and friendly',
		d: 'deep and thoughtful',
		s: 'sarcastic and funny',
		a: 'auto'
	};

	const vibeLabel = VIBE_MAP[vibeKey] || 'auto';
	const chatText = recent.map(m => `${m.sender}: ${m.text}`).join('\n');

	let vibeInstruction = 'Auto-detect the tone and vibe of the conversation and match it naturally.';
	if (vibeKey !== 'a') {
		vibeInstruction = `The vibe/tone should be: ${vibeLabel}. Match this energy naturally.`;
	}

	const prompt =
		`Here is a recent chat:\n\n${chatText}\n\n` +
		`${vibeInstruction}\n\n` +
		`Generate exactly 5 different natural reply options I could send as \"Me\" to continue this conversation. ` +
		`Make them sound like a real human typed them. Each should feel different. ` +
		`Format as a numbered list 1-5. Reply with ONLY the 5 options, no intro or outro text.`;

	try {
		const { chatAI } = require('./utils/api');
		const result = await chatAI(prompt);
		const response = result.msg || result.result || result.data || JSON.stringify(result);
		res.json({ replies: response, vibe: vibeLabel });
	} catch (err) {
		res.status(500).json({ error: err.message, replies: [] });
	}
});

// ---- Vibe ----
const VIBE_FILE = path.join(__dirname, 'database/vibe.json');

app.get('/api/vibe', authMiddleware, (req, res) => {
	const sock = botState.getSock();
	const ownerNum = sock?.user?.id?.split(':')[0] || '';
	let current = 'a';
	try {
		if (fs.existsSync(VIBE_FILE)) {
			const vdata = JSON.parse(fs.readFileSync(VIBE_FILE, 'utf8'));
			if (ownerNum && vdata[ownerNum]) current = vdata[ownerNum];
		}
	} catch (_) {}
	res.json({ vibe: current });
});

app.post('/api/vibe', authMiddleware, (req, res) => {
	const sock = botState.getSock();
	const ownerNum = sock?.user?.id?.split(':')[0];
	if (!ownerNum) return res.status(503).json({ error: 'Bot not connected' });

	const { vibe } = req.body || {};
	const valid = ['f', 'c', 'd', 's', 'a'];
	if (!valid.includes(vibe)) return res.status(400).json({ error: 'Invalid vibe' });

	const dir = path.dirname(VIBE_FILE);
	if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

	let vdata = {};
	try {
		if (fs.existsSync(VIBE_FILE)) vdata = JSON.parse(fs.readFileSync(VIBE_FILE, 'utf8'));
	} catch (_) {}

	vdata[ownerNum] = vibe;
	fs.writeFileSync(VIBE_FILE, JSON.stringify(vdata, null, 2));

	const labels = { f: 'Flirty', c: 'Casual', d: 'Deep', s: 'Sarcastic', a: 'Auto' };
	res.json({ vibe, label: labels[vibe] || 'Auto' });
});

// ---- Analytics ----
app.get('/api/analytics', authMiddleware, (req, res) => {
	const store = botState.getStore();
	if (!store) return res.json({ totalChats: 0, totalMessages: 0, topChats: [] });

	let totalMessages = 0;
	const chatStats = [];

	for (const [jid, chatMsgs] of store.messages.entries()) {
		const msgs = Array.from(chatMsgs.values());
		totalMessages += msgs.length;

		const fromMe = msgs.filter(m => m.key?.fromMe).length;
		const fromThem = msgs.length - fromMe;

		// Find time of last message
		const lastTs = msgs.reduce((max, m) => Math.max(max, m.messageTimestamp || 0), 0);

		chatStats.push({
			jid,
			isGroup: jid.endsWith('@g.us'),
			total: msgs.length,
			fromMe,
			fromThem,
			lastTimestamp: lastTs
		});
	}

	chatStats.sort((a, b) => b.total - a.total);
	const topChats = chatStats.slice(0, 15);

	// Messages per hour (last 24h)
	const now = Math.floor(Date.now() / 1000);
	const hourBuckets = new Array(24).fill(0);
	for (const chatMsgs of store.messages.values()) {
		for (const m of chatMsgs.values()) {
			const ts = m.messageTimestamp;
			if (ts && now - ts < 86400) {
				const h = new Date(ts * 1000).getHours();
				hourBuckets[h]++;
			}
		}
	}

	res.json({
		totalChats: store.messages.size,
		totalMessages,
		topChats,
		messagesPerHour: hourBuckets
	});
});

// ---- Restart Bot ----
app.post('/api/restart', authMiddleware, (req, res) => {
	res.json({ success: true, message: 'Restarting...' });
	setTimeout(() => process.exit(1), 500);
});

// ---- Broadcast ----
app.post('/api/broadcast', authMiddleware, async (req, res) => {
	const sock = botState.getSock();
	if (!sock || sock.ws?.readyState !== 1) {
		return res.status(503).json({ error: 'Bot not connected' });
	}

	const { text, targets } = req.body || {};
	if (!text?.trim()) return res.status(400).json({ error: 'No text' });

	const store = botState.getStore();
	const jids = targets && targets.length > 0
		? targets
		: Array.from(store.messages.keys());

	if (jids.length === 0) return res.status(400).json({ error: 'No chats to broadcast to' });

	let sent = 0;
	for (const jid of jids) {
		try {
			await sock.sendMessage(jid, { text: text.trim() });
			sent++;
		} catch (_) {}
	}

	res.json({ sent, total: jids.length });
});

// SSE — real-time new message events
app.get('/api/events', authMiddleware, (req, res) => {
	res.setHeader('Content-Type', 'text/event-stream');
	res.setHeader('Cache-Control', 'no-cache');
	res.setHeader('Connection', 'keep-alive');
	res.flushHeaders();

	const onMsg = (data) => {
		try { res.write(`data: ${JSON.stringify(data)}\n\n`); } catch (_) {}
	};
	botState.on('newMessage', onMsg);

	// Send heartbeat every 15s to keep connection alive
	const heartbeat = setInterval(() => {
		try { res.write(':heartbeat\n\n'); } catch (_) {}
	}, 15000);

	req.on('close', () => {
		clearInterval(heartbeat);
		botState.removeListener('newMessage', onMsg);
	});
});

// ---- Serve dashboard ----
app.use(express.static('public'));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'dashboard.html')));

// ---- Helpers ----
const PORT = process.env.PORT || 3000;

function extractText(msg) {
	if (!msg?.message) return '';
	const m = msg.message;
	if (m.conversation) return m.conversation;
	if (m.extendedTextMessage?.text) return m.extendedTextMessage.text;
	if (m.imageMessage?.caption) return m.imageMessage.caption;
	if (m.videoMessage?.caption) return m.videoMessage.caption;
	return '';
}

function getMessageType(msg) {
	if (!msg?.message) return 'unknown';
	const m = msg.message;
	if (m.conversation || m.extendedTextMessage) return 'text';
	if (m.imageMessage) return 'image';
	if (m.videoMessage) return 'video';
	if (m.audioMessage) return 'audio';
	if (m.stickerMessage) return 'sticker';
	if (m.documentMessage) return 'document';
	return 'other';
}

console.log(`\n\U0001f310 Dashboard: http://localhost:${PORT}`);
app.listen(PORT, () => console.log(`\u2705 Web server running on port ${PORT}`));
