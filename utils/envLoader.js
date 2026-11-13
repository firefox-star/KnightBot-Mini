/**
 * Tiny .env loader (no external dependency).
 * Loads key=value pairs from the repo-root .env file into process.env
 * WITHOUT overwriting variables that are already set (host panel wins).
 */
const fs = require('fs');
const path = require('path');

function loadEnvFile() {
	const p = path.join(__dirname, '..', '.env');
	if (!fs.existsSync(p)) return;
	try {
		const lines = fs.readFileSync(p, 'utf8').split(/\r?\n/);
		for (const line of lines) {
			if (!line || line.trim().startsWith('#') || !line.includes('=')) continue;
			const eq = line.indexOf('=');
			const key = line.slice(0, eq).trim();
			let val = line.slice(eq + 1).trim();
			if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
				val = val.slice(1, -1);
			}
			if (!key || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
			if (!(key in process.env)) process.env[key] = val;
		}
	} catch (_) {}
}

module.exports = { loadEnvFile };
