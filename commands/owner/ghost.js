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

	// Exported so handler/index can check without loading the command
	isGhostMode,

	async execute(sock, msg, args, extra) {
		const sub = args[0]?.toLowerCase();

		if (sub === 'on') {
			setGhostMode(true);
			return extra.reply('\ud83d\udc7b *Ghost Mode ON*
\nYou now appear offline to everyone. No blue ticks, no typing, no online status. Bot still works normally.');
		}

		if (sub === 'off') {
			setGhostMode(false);
			return extra.reply('\u2705 *Ghost Mode OFF*
\nYou are now visible again. Read receipts and typing will work as normal.');
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
