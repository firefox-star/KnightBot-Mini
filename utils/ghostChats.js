/**
 * Per-chat Ghost chat list (web-dashboard controlled).
 * Chats listed here NEVER get blue ticks from the bot, even when
 * global autoRead or global ghost mode would send them.
 * Used when chatting from the web dashboard: you can read and reply
 * without the other person seeing a read receipt.
 */
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'database', 'ghostchats.json');

function load() {
	try {
		if (fs.existsSync(FILE)) return JSON.parse(fs.readFileSync(FILE, 'utf8'));
	} catch (_) {}
	return {};
}

function save(data) {
	const dir = path.dirname(FILE);
	if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(FILE, JSON.stringify(data, null, 2));
}

function has(jid) {
	if (!jid) return false;
	return !!load()[jid];
}

function set(jid, enabled) {
	if (!jid) return false;
	const data = load();
	if (enabled) data[jid] = true;
	else delete data[jid];
	save(data);
	return !!enabled;
}

function list() {
	return Object.keys(load());
}

module.exports = { has, set, list, load };
