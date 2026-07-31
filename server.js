/**
 * Web Dashboard Server — Express API + SSE + Static files
 * Runs alongside the WhatsApp bot on the same process/port.
 */

const express = require('express');
const path = require('path');
const crypto = require('crypto');
const botState = require('./sharedState');
const { isGhostMode } = require('./commands/owner/ghost');

const app = express();
app.use(express.json());

const DASHBOARD_PASSWORD = process.env.DASHBOARD_PASSWORD || 'knightbot123';

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
        const { setGhostMode } = require('./commands/owner/ghost');
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

        req.on('close', () => {
                botState.removeListener('newMessage', onMsg);
        });
});

// ---- Serve dashboard ----
app.use(express.static('public'));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'dashboard.html')));

// ---- Start ----
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

console.log(`\n🌐 Dashboard: http://localhost:${PORT}`);
app.listen(PORT, () => console.log(`✅ Web server running on port ${PORT}`));
