/**
 * Persisted global bot config overrides.
 * The web dashboard writes here; values are merged over config.js at startup
 * and applied immediately at runtime.
 */
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'database', 'botconfig.json');

// Keys that may be overridden/persisted (everything else is ignored for safety)
const ALLOWED = [
	'autoRead',
	'autoTyping',
	'autoBio',
	'autoSticker',
	'autoReact',
	'autoReactMode',
	'autoDownload',
	'selfMode',
	// Dashboard-specific behaviour flags (not in config.js)
	'dmSettingsReply' // settings-command replies go to the sender's DM instead of the group
];

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

/** Merge saved overrides into the live config object (call at startup). */
function applyToConfig(config) {
	const saved = load();
	for (const key of ALLOWED) {
		if (key in saved) config[key] = saved[key];
	}
}

/** Update one key: persist + apply live. Returns the new value. */
function set(key, value) {
	if (!ALLOWED.includes(key)) throw new Error(`Key not allowed: ${key}`);
	const data = load();
	data[key] = value;
	save(data);
	const config = require('../config');
	config[key] = value;
	return value;
}

function get(key, fallback) {
	const data = load();
	if (key in data) return data[key];
	const config = require('../config');
	return key in config ? config[key] : fallback;
}

function getAll() {
	const config = require('../config');
	const data = load();
	const out = {};
	for (const key of ALLOWED) {
		if (key in data) out[key] = data[key];
		else if (key === 'dmSettingsReply') out[key] = true; // sensible default: DM replies ON
		else out[key] = config[key];
	}
	return out;
}

module.exports = { load, save, applyToConfig, set, get, getAll, ALLOWED };
