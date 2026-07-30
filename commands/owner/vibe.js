/**
 * Vibe Setter — Sets the tone for ,cc command
 *
 * Short commands that look like typos if someone glances:
 *   ,v f → flirty
 *   ,v c → casual
 *   ,v d → deep/serious
 *   ,v s → sarcastic/funny
 *   ,v a → auto-detect (default)
 */

const fs = require('fs');
const path = require('path');

const VIBE_FILE = path.join(__dirname, '../../database/vibe.json');

const VIBES = {
	f: 'flirty',
	c: 'casual',
	d: 'deep/serious',
	s: 'sarcastic/funny',
	a: 'auto-detect'
};

const VIBE_DESC = {
	f: 'flirty and playful',
	c: 'casual and friendly',
	d: 'deep and thoughtful',
	s: 'sarcastic and funny',
	a: 'auto-detect'
};

function loadVibes() {
	try {
		if (fs.existsSync(VIBE_FILE)) return JSON.parse(fs.readFileSync(VIBE_FILE, 'utf8'));
	} catch (_) {}
	return {};
}

function saveVibes(data) {
	const dir = path.dirname(VIBE_FILE);
	if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(VIBE_FILE, JSON.stringify(data, null, 2));
}

module.exports = {
	name: 'v',
	category: 'owner',
	description: 'Set vibe for ,cc command',
	usage: ',v <f/c/d/s/a>',
	ownerOnly: true,

	async execute(sock, msg, args, extra) {
		const mode = args[0]?.toLowerCase();

		if (!mode || !VIBES[mode]) {
			const ownerNum = sock.user.id.split(':')[0];
			const vibes = loadVibes();
			const current = vibes[ownerNum] || 'a';
			return extra.reply(
				`🎵 *Vibe Modes*

` +
				`Current: *${VIBES_DESC[current] || 'auto-detect'}*

` +
				`,v f → flirty
` +
				`,v c → casual
` +
				`,v d → deep/serious
` +
				`,v s → sarcastic/funny
` +
				`,v a → auto-detect`
			);
		}

		const ownerNum = sock.user.id.split(':')[0];
		const vibes = loadVibes();
		vibes[ownerNum] = mode;
		saveVibes(vibes);

		return extra.reply(`✅ Vibe → *${VIBES_DESC[mode]}*`);
	}
};
