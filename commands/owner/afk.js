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

/** Extract text from a message */
function extractText(m) {
        if (!m?.message) return '';
        const mt = m.message;
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
        if (jid.endsWith('@g.us')) return; // DMs only
        if (msg.key.fromMe) return;

        // Don't reply to owner
        const sender = msg.key.participant || jid;
        if (config.ownerNumber.includes(sender.split('@')[0])) return;

        // Rate limit: minimum 3s between replies per chat to avoid WhatsApp bans
        const last = lastReplyTime.get(jid) || 0;
        if (Date.now() - last < MIN_INTERVAL_MS) return;
        lastReplyTime.set(jid, Date.now());

        const reason = state.reason || 'not around';

        // For media messages (voice notes, images, videos, stickers, docs)
        // just send a simple offline message, no AI needed
        if (isMediaMessage(msg)) {
                const replies = [
                        `im ${reason} rn, text me instead`,
                        `not around right now, send a text`,
                        `cant check media atm, im ${reason}`,
                        `im offline, just text me`,
                        `busy rn, drop a text instead`,
                ];
                const reply = replies[Math.floor(Math.random() * replies.length)];
                try {
                        await sock.sendMessage(jid, { text: reply });
                } catch (_) {}
                return;
        }

        // For text messages, use AI to generate a human-sounding reply
        const chatMsgs = store.messages.get(jid);
        const recentRaw = chatMsgs
                ? Array.from(chatMsgs.values())
                        .sort((a, b) => (a.messageTimestamp || 0) - (b.messageTimestamp || 0))
                        .slice(-15)
                : [];

        if (recentRaw.length < 1) return;

        const recent = recentRaw
                .map(m => ({ who: m.key.fromMe ? 'Me' : 'Them', text: extractText(m) }))
                .filter(e => e.text.trim().length > 0);

        if (recent.length < 1) return;

        const chatText = recent.map(m => `${m.who}: ${m.text}`).join('\n');

        const prompt =
                `You are replying to WhatsApp messages on behalf of someone. They are currently ${reason}. ` +
                `You must sound like a REAL HUMAN texting casually — no emojis spam, no "I'm an AI", no robotic phrases. ` +
                `Keep replies short and natural (1-3 sentences max). Use normal texting style with lowercase, maybe a typo or slang. ` +
                `If they ask where you are, give a vague casual excuse. Don't be overly helpful or formal. ` +
                `Vary your responses — don't say the same thing twice.\n\n` +
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
                                '\n\nBot will auto-reply to ALL your DMs using AI.\n' +
                                'Media messages get a simple offline text.'
                        );
                }

                if (sub === 'off') {
                        saveState({ enabled: false, reason: '' });
                        lastReplyTime.clear();
                        return extra.reply('\u2705 *AFK Mode OFF*\n\nBack to normal.');
                }

                const state = getState();
                const status = state.enabled ? 'ON' + (state.reason ? ` (${state.reason})` : '') : 'OFF';
                return extra.reply(`\U0001f6ab AFK: *${status}*`);
        }
};
