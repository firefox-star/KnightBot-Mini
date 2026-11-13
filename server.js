require('./utils/envLoader').loadEnvFile();

const express = require('express');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const botState = require('./sharedState');
const { isGhostMode, setGhostMode } = require('./commands/owner/ghost');
const config = require('./config');
const database = require('./database');
const handler = require('./handler');
const botConfig = require('./utils/botConfig');
const ghostChats = require('./utils/ghostChats');

const app = express();
app.use(express.json({ limit: '25mb' }));

/**
 * Get real phone number from any JID using sharedState LID map
 */
function getPhone(jid) {
        return botState.resolvePhone(jid);
}

/**
 * Get display name for a JID
 */
function getName(jid) {
        return botState.getContactName(jid);
}

/**
 * Resolve JID to PN JID for sending messages
 */
function getPnJid(jid) {
        if (!jid.endsWith('@g.us')) {
                return botState.resolvePnJid(jid);
        }
        return jid;
}

const DASHBOARD_PASSWORD = process.env.DASHBOARD_PASSWORD || '5656';

// ---- Auth ----
const tokens = new Map();

function authMiddleware(req, res, next) {
        // Bearer header OR ?token= (EventSource cannot send headers)
        const auth = req.headers.authorization;
        const headerToken = auth && auth.startsWith('Bearer ') ? auth.slice(7) : null;
        const queryToken = req.query && req.query.token ? String(req.query.token) : null;
        const token = headerToken || queryToken;
        if (!token) return res.status(401).json({ error: 'No token' });
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
                ghost: isGhostMode(),
                dmSettingsReply: botConfig.get('dmSettingsReply', true),
                ghostChatCount: ghostChats.list().length,
                botName: config.botName,
                prefix: config.prefix,
                ai: {
                        glm: !!config.glmApiKey,
                        openrouter: !!config.openRouterApiKey,
                        glmModel: config.glmModel,
                        openRouterModel: config.openRouterModel
                }
        });
});

// Ghost mode toggle
app.post('/api/ghost', authMiddleware, (req, res) => {
        const current = isGhostMode();
        setGhostMode(!current);
        res.json({ ghost: !current });
});

// Chat list — includes real phone numbers and pushNames
app.get('/api/chats', authMiddleware, (req, res) => {
        const store = botState.getStore();
        const sock = botState.getSock();
        if (!store) return res.json([]);

        const chats = [];
        for (const [jid, chatMsgs] of store.messages.entries()) {
                if (chatMsgs.size === 0) continue;
                const sorted = Array.from(chatMsgs.values()).sort((a, b) => (b.messageTimestamp || 0) - (a.messageTimestamp || 0));
                const last = sorted[0];
                const text = extractText(last);
                const mediaType = getMessageType(last);
                const preview = text || mediaTypeLabel(mediaType);
                if (!preview && mediaType === 'unknown') continue;

                const phoneNumber = getPhone(jid);
                const pushName = getName(jid) || last.pushName || null;

                chats.push({
                        jid,
                        phoneNumber,
                        pushName,
                        lastMessage: preview.substring(0, 80),
                        lastTimestamp: last.messageTimestamp,
                        fromMe: !!last.key?.fromMe,
                        isGroup: jid.endsWith('@g.us'),
                        count: chatMsgs.size
                });
        }

        chats.sort((a, b) => (b.lastTimestamp || 0) - (a.lastTimestamp || 0));
        res.json(chats);
});

// Messages in a chat — includes real phone numbers for group senders
app.get('/api/chats/:jid', authMiddleware, (req, res) => {
        const store = botState.getStore();
        const sock = botState.getSock();
        if (!store) return res.json([]);

        const jid = decodeURIComponent(req.params.jid);
        const chatMsgs = store.messages.get(jid);
        if (!chatMsgs) return res.json([]);

        // Pre-scan all messages to build a phone number + pushName lookup
        const senderInfo = new Map();
        for (const m of chatMsgs.values()) {
                const senderJid = m.key?.participant || m.key?.remoteJid;
                if (!senderJid || senderJid.endsWith('@g.us')) continue;
                if (!senderInfo.has(senderJid)) {
                        senderInfo.set(senderJid, {
                                phoneNumber: getPhone(senderJid),
                                pushName: getName(senderJid) || m.pushName || null
                        });
                }
        }

        const messages = Array.from(chatMsgs.values())
                .sort((a, b) => (a.messageTimestamp || 0) - (b.messageTimestamp || 0))
                .map(m => {
                        const type = getMessageType(m);
                        const text = extractText(m);
                        const senderJid = m.key?.participant || m.key?.remoteJid;
                        let mediaUrl = null;
                        let mediaMime = null;
                        const msgObj = m.message;

                        // Unwrap view-once and ephemeral containers for media
                        let unwrapped = msgObj;
                        if (unwrapped?.ephemeralMessage) unwrapped = unwrapped.ephemeralMessage.message;
                        if (unwrapped?.viewOnceMessageV2) unwrapped = unwrapped.viewOnceMessageV2.message;
                        if (unwrapped?.viewOnceMessage) unwrapped = unwrapped.viewOnceMessage.message;

                        // Try to get media URL (check unwrapped first, then original)
                        const src = unwrapped || msgObj;
                        if (src?.imageMessage?.url) { mediaUrl = src.imageMessage.url; mediaMime = src.imageMessage.mimetype; }
                        else if (src?.videoMessage?.url) { mediaUrl = src.videoMessage.url; mediaMime = src.videoMessage.mimetype; }
                        else if (src?.audioMessage?.url) { mediaUrl = src.audioMessage.url; mediaMime = src.audioMessage.mimetype; }
                        else if (src?.stickerMessage?.url) { mediaUrl = src.stickerMessage.url; mediaMime = src.stickerMessage.mimetype; }
                        else if (src?.documentMessage?.url) { mediaUrl = src.documentMessage.url; mediaMime = src.documentMessage.mimetype; }

                        // Get media file size
                        let fileSize = 0;
                        if (src?.imageMessage?.fileLength) fileSize = src.imageMessage.fileLength;
                        else if (src?.videoMessage?.fileLength) fileSize = src.videoMessage.fileLength;
                        else if (src?.audioMessage?.fileLength) fileSize = src.audioMessage.fileLength;
                        else if (src?.documentMessage?.fileLength) fileSize = src.documentMessage.fileLength;

                        // Duration for audio/video (in seconds)
                        let duration = 0;
                        if (src?.audioMessage?.seconds) duration = src.audioMessage.seconds;
                        else if (src?.videoMessage?.seconds) duration = src.videoMessage.seconds;

                        // Document filename
                        let fileName = '';
                        if (src?.documentMessage?.fileName) fileName = src.documentMessage.fileName;

                        // Sender info (real phone number + pushName)
                        const info = senderInfo.get(senderJid);

                        return {
                                id: m.key?.id,
                                fromMe: !!m.key?.fromMe,
                                sender: senderJid,
                                senderPhone: info?.phoneNumber || null,
                                senderName: info?.pushName || null,
                                pushName: m.pushName || null,
                                text,
                                timestamp: m.messageTimestamp,
                                type,
                                mediaUrl,
                                mediaMime,
                                fileSize,
                                duration,
                                fileName
                        };
                });

        res.json(messages);
});

// Send message — works with both phone number JIDs and LID JIDs
app.post('/api/chats/:jid/send', authMiddleware, async (req, res) => {
        const sock = botState.getSock();
        if (!sock || sock.ws?.readyState !== 1) {
                return res.status(503).json({ error: 'Bot not connected' });
        }

        let jid = decodeURIComponent(req.params.jid);
        const { text } = req.body;
        if (!text?.trim()) return res.status(400).json({ error: 'No text' });

        try {
                // Resolve LID to PN JID for sending
                jid = getPnJid(jid);

                const sent = await sock.sendMessage(jid, { text: text.trim() });

                // Keep the outgoing message in the store so the web chat shows it
                const store = botState.getStore();
                if (sent?.key?.id && store) {
                        if (!store.messages.has(jid)) store.messages.set(jid, new Map());
                        sent.messageTimestamp = sent.messageTimestamp || Math.floor(Date.now() / 1000);
                        store.messages.get(jid).set(sent.key.id, sent);
                }

                res.json({ success: true });
        } catch (err) {
                console.error('[dashboard send error]', err.message);
                res.status(500).json({ error: err.message });
        }
});

// Proxy media download — allows dashboard to load images/audio/video
app.get('/api/media/:msgId', authMiddleware, async (req, res) => {
        const store = botState.getStore();
        const sock = botState.getSock();
        if (!store || !sock) return res.status(503).json({ error: 'Not ready' });

        const msgId = decodeURIComponent(req.params.msgId);

        // Find the message in store
        let targetMsg = null;
        for (const chatMsgs of store.messages.values()) {
                const msg = chatMsgs.get(msgId);
                if (msg) { targetMsg = msg; break; }
        }
        if (!targetMsg) return res.status(404).json({ error: 'Message not found' });

        const msgObj = targetMsg.message;
        let unwrapped = msgObj;
        if (unwrapped?.ephemeralMessage) unwrapped = unwrapped.ephemeralMessage.message;
        if (unwrapped?.viewOnceMessageV2) unwrapped = unwrapped.viewOnceMessageV2.message;
        if (unwrapped?.viewOnceMessage) unwrapped = unwrapped.viewOnceMessage.message;
        const src = unwrapped || msgObj;

        let mediaMsg = null;
        let downloadType = null;

        if (src?.imageMessage) { mediaMsg = src.imageMessage; downloadType = 'image'; }
        else if (src?.videoMessage) { mediaMsg = src.videoMessage; downloadType = 'video'; }
        else if (src?.audioMessage) { mediaMsg = src.audioMessage; downloadType = 'audio'; }
        else if (src?.stickerMessage) { mediaMsg = src.stickerMessage; downloadType = 'image'; }
        else if (src?.documentMessage) { mediaMsg = src.documentMessage; downloadType = 'document'; }

        if (!mediaMsg?.url) return res.status(404).json({ error: 'No media in message' });

        try {
                const { downloadContentFromMessage } = require('@whiskeysockets/baileys');
                const stream = await downloadContentFromMessage(mediaMsg, downloadType);
                const chunks = [];
                for await (const chunk of stream) chunks.push(chunk);
                const buffer = Buffer.concat(chunks);

                const mime = mediaMsg.mimetype || 'application/octet-stream';
                res.setHeader('Content-Type', mime);
                res.setHeader('Content-Length', buffer.length);
                res.setHeader('Cache-Control', 'public, max-age=3600');
                res.send(buffer);
        } catch (err) {
                console.error('[media download error]', err.message);
                res.status(500).json({ error: err.message });
        }
});

// ---- Smart Reply ----
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
        const onRead = (data) => {
                try { res.write(`event: readReceipt\ndata: ${JSON.stringify(data)}\n\n`); } catch (_) {}
        };
        botState.on('newMessage', onMsg);
        botState.on('readReceipt', onRead);

        const heartbeat = setInterval(() => {
                try {
                        const sock = botState.getSock();
                        res.write(`event: status\ndata: ${JSON.stringify({ connected: !!sock && sock.ws?.readyState === 1, at: Date.now() })}\n\n`);
                        res.write(':heartbeat\n\n');
                } catch (_) {}
        }, 15000);

        req.on('close', () => {
                clearInterval(heartbeat);
                botState.removeListener('newMessage', onMsg);
                botState.removeListener('readReceipt', onRead);
        });
});

// ---- Global settings (dashboard toggles) ----
app.get('/api/settings', authMiddleware, (req, res) => {
        res.json({
                ...botConfig.getAll(),
                botName: config.botName,
                prefix: config.prefix,
                ownerNumber: (Array.isArray(config.ownerNumber) ? config.ownerNumber[0] : config.ownerNumber) || null,
                ai: {
                        glm: !!config.glmApiKey,
                        openrouter: !!config.openRouterApiKey,
                        glmModel: config.glmModel,
                        openRouterModel: config.openRouterModel
                }
        });
});

app.post('/api/settings', authMiddleware, (req, res) => {
        const { key, value } = req.body || {};
        try {
                const current = botConfig.get(key, undefined);
                let v = value;
                if (typeof current === 'boolean') v = value === true || value === 'true' || value === 'on';
                if (typeof current === 'boolean' || typeof value === 'boolean') {
                        const saved = botConfig.set(key, v);
                        return res.json({ success: true, key, value: saved });
                }
                const saved = botConfig.set(key, value);
                res.json({ success: true, key, value: saved });
        } catch (err) {
                res.status(400).json({ error: err.message });
        }
});

// ---- Groups + per-group settings (toggle switches) ----
app.get('/api/groups', authMiddleware, async (req, res) => {
        const store = botState.getStore();
        const sock = botState.getSock();

        const map = new Map();
        for (const [jid, settings] of Object.entries(database.getAllGroupSettings())) {
                if (!jid.endsWith('@g.us')) continue;
                map.set(jid, { jid, name: null, participants: 0, lastTimestamp: 0, settings });
        }
        if (store) {
                for (const [jid, chatMsgs] of store.messages.entries()) {
                        if (!jid.endsWith('@g.us')) continue;
                        const last = Array.from(chatMsgs.values()).sort((a, b) => (b.messageTimestamp || 0) - (a.messageTimestamp || 0))[0];
                        const entry = map.get(jid) || { jid, name: null, participants: 0, settings: database.getGroupSettings(jid) };
                        entry.lastTimestamp = last?.messageTimestamp || entry.lastTimestamp || 0;
                        map.set(jid, entry);
                }
        }

        // One bulk fetch for names (falls back silently if it fails)
        let allMeta = {};
        if (sock && sock.ws?.readyState === 1) {
                try { allMeta = await sock.groupFetchAllParticipating() || {}; } catch (_) {}
        }

        const groups = [];
        for (const [jid, entry] of map.entries()) {
                const meta = allMeta[jid];
                if (meta) {
                        entry.name = meta.subject || entry.name;
                        entry.participants = meta.participants?.length || entry.participants;
                }
                if (!entry.name) entry.name = botState.getContactName(jid) || jid;
                groups.push(entry);
        }
        groups.sort((a, b) => (b.lastTimestamp || 0) - (a.lastTimestamp || 0));
        res.json(groups);
});

app.post('/api/groups/:jid/settings', authMiddleware, (req, res) => {
        const jid = decodeURIComponent(req.params.jid);
        if (!jid.endsWith('@g.us')) return res.status(400).json({ error: 'Not a group jid' });

        const { key, value } = req.body || {};
        const allowed = new Set([...Object.keys(config.defaultGroupSettings), 'suppress']);
        if (!allowed.has(key)) return res.status(400).json({ error: `Unknown setting: ${key}` });

        const def = config.defaultGroupSettings[key];
        let v = value;
        if (typeof def === 'boolean' || key === 'suppress') {
                v = value === true || value === 'true' || value === 'on';
        }
        if (key === 'antilinkAction' || key === 'antitagAction' || key === 'antibotAction' || key === 'antistickerAction' || key === 'antibadwordAction' || key === 'antigroupmentionAction' || key === 'antigroupstatusAction') {
                if (!['delete', 'kick', 'warn'].includes(String(v))) return res.status(400).json({ error: 'Action must be delete/kick/warn' });
        }

        const ok = database.updateGroupSettings(jid, { [key]: v });
        if (!ok) return res.status(500).json({ error: 'Failed to save' });
        res.json({ success: true, key, value: v });
});

// ---- Command list + run-command-from-web ----
app.get('/api/commands', authMiddleware, (req, res) => {
        try {
                const { getCommandMap } = require('./utils/commandLoader');
                const list = [];
                for (const [name, c] of getCommandMap().entries()) {
                        if (!c?.name || name !== c.name) continue; // skip alias entries
                        list.push({
                                name: c.name,
                                aliases: c.aliases || [],
                                category: c.category || 'general',
                                description: c.description || '',
                                usage: c.usage || `${config.prefix}${c.name}`,
                                ownerOnly: !!c.ownerOnly,
                                adminOnly: !!c.adminOnly,
                                groupOnly: !!c.groupOnly
                        });
                }
                list.sort((a, b) => String(a.category).localeCompare(String(b.category)) || String(a.name).localeCompare(String(b.name)));
                res.json(list);
        } catch (err) {
                res.status(500).json({ error: err.message });
        }
});

// Run a bot command from the web as the owner (target: "self" or a group jid).
// Replies follow the normal rules — settings commands answer in the owner DM.
app.post('/api/command', authMiddleware, async (req, res) => {
        const sock = botState.getSock();
        if (!sock || sock.ws?.readyState !== 1) return res.status(503).json({ error: 'Bot not connected' });

        let cmdText = String(req.body?.cmd || '').trim();
        if (!cmdText) return res.status(400).json({ error: 'No command' });
        if (!cmdText.startsWith(config.prefix)) cmdText = config.prefix + cmdText;

        const ownerNum = sock.user?.id?.split(':')[0];
        if (!ownerNum) return res.status(503).json({ error: 'Bot identity unknown' });
        const ownerJ = `${ownerNum}@s.whatsapp.net`;

        const target = String(req.body?.target || 'self');
        let jid = ownerJ;
        if (target !== 'self') {
                jid = getPnJid(target);
                if (!jid.endsWith('@g.us')) return res.status(400).json({ error: 'Target must be "self" or a group jid' });
        }

        const fake = {
                key: {
                        remoteJid: jid,
                        fromMe: true,
                        participant: jid.endsWith('@g.us') ? ownerJ : undefined,
                        id: 'DASH' + crypto.randomBytes(10).toString('hex').toUpperCase()
                },
                message: { conversation: cmdText },
                pushName: 'Dashboard',
                messageTimestamp: Math.floor(Date.now() / 1000)
        };

        handler.handleMessage(sock, fake).catch(err => {
                console.error('[dashboard command]', err.message);
        });
        res.json({ success: true, cmd: cmdText, target: jid });
});

// ---- Per-chat ghost list (web chat without blue ticks) ----
app.get('/api/ghostchats', authMiddleware, (req, res) => {
        res.json({ chats: ghostChats.list() });
});

app.post('/api/ghostchats', authMiddleware, (req, res) => {
        const { jid, enabled } = req.body || {};
        if (!jid) return res.status(400).json({ error: 'No jid' });
        const now = ghostChats.set(jid, !!enabled);
        res.json({ success: true, jid, ghost: now });
});

// Send blue ticks now (mark chat as read) — only allowed when ghost is OFF for that chat
app.post('/api/markread', authMiddleware, async (req, res) => {
        const sock = botState.getSock();
        const store = botState.getStore();
        if (!sock || sock.ws?.readyState !== 1) return res.status(503).json({ error: 'Bot not connected' });

        const jid = req.body?.jid;
        if (!jid) return res.status(400).json({ error: 'No jid' });
        if (isGhostMode()) return res.status(400).json({ error: 'Global ghost mode is ON — blue ticks stay off everywhere' });
        if (ghostChats.has(jid)) return res.status(400).json({ error: 'Ghost is ON for this chat — turn it off first if you want blue ticks' });

        const chatMsgs = store?.messages.get(jid);
        if (!chatMsgs || chatMsgs.size === 0) return res.status(404).json({ error: 'No messages found' });

        const keys = Array.from(chatMsgs.values()).filter(m => m && m.key && !m.key.fromMe).map(m => m.key);
        if (!keys.length) return res.json({ marked: 0 });

        try {
                await sock.readMessages(keys);
                res.json({ marked: keys.length });
        } catch (err) {
                res.status(500).json({ error: err.message });
        }
});

// ---- Send media from the web chat ----
app.post('/api/chats/:jid/send-media', authMiddleware, async (req, res) => {
        const sock = botState.getSock();
        const store = botState.getStore();
        if (!sock || sock.ws?.readyState !== 1) return res.status(503).json({ error: 'Bot not connected' });

        let jid = getPnJid(decodeURIComponent(req.params.jid));
        const { kind, data, mimetype, caption, fileName, ptt } = req.body || {};
        if (!data) return res.status(400).json({ error: 'No file data' });

        let buffer;
        try { buffer = Buffer.from(String(data), 'base64'); } catch (_) {}
        if (!buffer || !buffer.length) return res.status(400).json({ error: 'Invalid file data' });

        const content =
                kind === 'image' ? { image: buffer, mimetype: mimetype || 'image/jpeg', caption: caption || undefined } :
                kind === 'video' ? { video: buffer, mimetype: mimetype || 'video/mp4', caption: caption || undefined } :
                kind === 'audio' ? { audio: buffer, mimetype: mimetype || 'audio/mpeg', ptt: !!ptt } :
                kind === 'sticker' ? { sticker: buffer, mimetype: mimetype || 'image/webp' } :
                { document: buffer, mimetype: mimetype || 'application/octet-stream', fileName: fileName || 'file', caption: caption || undefined };

        try {
                const sent = await sock.sendMessage(jid, content);
                if (sent?.key?.id && store) {
                        if (!store.messages.has(jid)) store.messages.set(jid, new Map());
                        sent.messageTimestamp = sent.messageTimestamp || Math.floor(Date.now() / 1000);
                        store.messages.get(jid).set(sent.key.id, sent);
                }
                res.json({ success: true, id: sent?.key?.id || null });
        } catch (err) {
                console.error('[dashboard send-media error]', err.message);
                res.status(500).json({ error: err.message });
        }
});

// ---- Serve dashboard ----
app.use(express.static('public'));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'dashboard.html')));

// ---- Helpers ----
const PORT = process.env.PORT || 3000;

function extractText(msg) {
        if (!msg?.message) return '';
        const m = msg.message;
        // Unwrap containers
        let unwrapped = m;
        if (unwrapped.ephemeralMessage) unwrapped = unwrapped.ephemeralMessage.message;
        if (unwrapped.viewOnceMessageV2) unwrapped = unwrapped.viewOnceMessageV2.message;
        if (unwrapped.viewOnceMessage) unwrapped = unwrapped.viewOnceMessage.message;

        if (unwrapped.conversation) return unwrapped.conversation;
        if (unwrapped.extendedTextMessage?.text) return unwrapped.extendedTextMessage.text;
        if (unwrapped.imageMessage?.caption) return unwrapped.imageMessage.caption;
        if (unwrapped.videoMessage?.caption) return unwrapped.videoMessage.caption;
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

function mediaTypeLabel(type) {
        const labels = {
                image: 'Photo',
                video: 'Video',
                audio: 'Voice note',
                sticker: 'Sticker',
                document: 'Document',
                other: 'Message'
        };
        return labels[type] || 'Message';
}

console.log(`\n\U0001f310 Dashboard: http://localhost:${PORT}`);
app.listen(PORT, () => console.log(`\u2705 Web server running on port ${PORT}`));
