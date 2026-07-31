/**
 * Ghost Mode — Appear offline while bot still processes everything
 *
 * When ON:
 *   - No read receipts (blue ticks) sent to anyone
 *   - No typing indicator shown
 *   - No online/available status broadcast
 *   - Bot still receives, processes, and replies to all messages normally
 *
 * Usage: ,ghost        → toggles on/off
 *        ,ghost on     → turn on
 *        ,ghost off    → turn off
 */

const fs = require('fs');
const path = require('path');

const GHOST_FILE = path.join(__dirname, '../../database/ghost.json');

function isGhostMode() {
        try {
                if (fs.existsSync(GHOST_FILE)) {
                        const data = JSON.parse(fs.readFileSync(GHOST_FILE, 'utf8'));
                        return !!data.enabled;
                }
        } catch (_) {}
        return false;
}

function setGhostMode(enabled) {
        const dir = path.dirname(GHOST_FILE);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(GHOST_FILE, JSON.stringify({ enabled }, null, 2));
}

module.exports = {
        name: 'ghost',
        category: 'owner',
        description: 'Appear offline while bot still works',
        usage: ',ghost [on|off]',
        ownerOnly: true,

        isGhostMode,
        setGhostMode,

        async execute(sock, msg, args, extra) {
                const sub = args[0]?.toLowerCase();

                if (sub === 'on') {
                        setGhostMode(true);
                        return extra.reply('\ud83d\udc7b *Ghost Mode ON*\n\nYou now appear offline. No blue ticks, no typing, no online status.');
                }

                if (sub === 'off') {
                        setGhostMode(false);
                        return extra.reply('\u2705 *Ghost Mode OFF*\n\nBack to normal. Read receipts and typing work as usual.');
                }

                // Toggle
                const current = isGhostMode();
                setGhostMode(!current);
                const now = !current;
                return extra.reply(now
                        ? '\ud83d\udc7b *Ghost Mode ON*'
                        : '\u2705 *Ghost Mode OFF*');
        }
};
