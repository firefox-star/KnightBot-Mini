/**
 * Plugin Manager — Install bot commands from GitHub Gist URLs
 * 
 * Usage: ,install <gist-url>   → downloads & loads plugin
 *        ,plugins              → lists installed plugins
 *        ,uninstall <name>     → removes a plugin
 * 
 * Plugin format (gist .js file):
 *   module.exports = {
 *     name: 'hello',
 *     category: 'utility',
 *     description: 'Says hello',
 *     usage: ',hello',
 *     async execute(sock, msg, args, extra) {
 *       extra.reply('Hello!');
 *     }
 *   };
 */

const fs = require('fs');
const path = require('path');
const axios = require('axios');

const PLUGINS_DIR = path.join(__dirname, '..', 'plugins');
const REGISTRY_FILE = path.join(__dirname, '..', 'database', 'installed-plugins.json');

// Ensure plugins dir exists
if (!fs.existsSync(PLUGINS_DIR)) fs.mkdirSync(PLUGINS_DIR, { recursive: true });

function getRegistry() {
	try {
		if (fs.existsSync(REGISTRY_FILE)) return JSON.parse(fs.readFileSync(REGISTRY_FILE, 'utf8'));
	} catch (_) {}
	return {};
}

function saveRegistry(registry) {
	const dir = path.dirname(REGISTRY_FILE);
	if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(REGISTRY_FILE, JSON.stringify(registry, null, 2));
}

/**
 * Parse a Gist URL to extract gist ID
 * Supports: https://gist.github.com/user/abc123 or just abc123
 */
function parseGistUrl(input) {
	const trimmed = input.trim();
	// Direct gist ID (32+ char hex)
	if (/^[a-f0-9]{20,}$/.test(trimmed)) return trimmed;
	// Full URL
	const match = trimmed.match(/gist\.github\.com\/[\w-]+\/([a-f0-9]+)/);
	return match ? match[1] : null;
}

/**
 * Fetch gist metadata from GitHub API
 */
async function fetchGist(gistId) {
	const res = await axios.get(`https://api.github.com/gists/${gistId}`);
	return res.data;
}

/**
 * Install a plugin from a Gist URL
 * Returns { success, name, error? }
 */
async function installPlugin(gistUrl, commandsMap) {
	const gistId = parseGistUrl(gistUrl);
	if (!gistId) return { success: false, error: 'Invalid gist URL. Use: https://gist.github.com/user/gistid' };

	let gist;
	try {
		gist = await fetchGist(gistId);
	} catch (err) {
		return { success: false, error: 'Gist not found or private: ' + err.message };
	}

	// Find .js files in the gist
	const jsFiles = Object.entries(gist.files || {}).filter(([, f]) => f.filename.endsWith('.js'));
	if (jsFiles.length === 0) {
		return { success: false, error: 'No .js file found in gist. Make sure your plugin file ends with .js' };
	}

	const results = [];
	const registry = getRegistry();

	for (const [filename, fileData] of jsFiles) {
		const rawUrl = fileData.raw_url;
		const safeName = filename.replace(/[^a-zA-Z0-9_-]/g, '_');
		const localPath = path.join(PLUGINS_DIR, safeName);

		try {
			// Download file
			const res = await axios.get(rawUrl);
			fs.writeFileSync(localPath, res.data);

			// Clear require cache so we get fresh module
			delete require.cache[require.resolve(localPath)];

			// Load and validate
			const plugin = require(localPath);
			if (!plugin.name) {
				fs.unlinkSync(localPath);
				results.push({ file: filename, error: 'Missing "name" export' });
				continue;
			}

			// Unload old version if exists
			unregisterCommand(plugin.name, commandsMap);
			if (plugin.aliases) {
				for (const alias of plugin.aliases) unregisterCommand(alias, commandsMap);
			}

			// Register in commands map
			commandsMap.set(plugin.name, plugin);
			if (plugin.aliases) {
				for (const alias of plugin.aliases) commandsMap.set(alias, plugin);
			}

			// Track in registry
			registry[plugin.name] = {
				gistId,
				filename: safeName,
				originalFile: filename,
				installedAt: Date.now()
			};

			results.push({ file: filename, name: plugin.name, success: true });
		} catch (err) {
			results.push({ file: filename, error: err.message });
		}
	}

	saveRegistry(registry);
	const succeeded = results.filter(r => r.success);
	const failed = results.filter(r => r.error);

	return {
		success: succeeded.length > 0,
		installed: succeeded.map(r => r.name),
		failed: failed.map(r => `${r.file}: ${r.error}`),
		gistId
	};
}

/**
 * Uninstall a plugin by name
 */
function uninstallPlugin(name, commandsMap) {
	const registry = getRegistry();
	const entry = registry[name];
	if (!entry) return { success: false, error: `Plugin "${name}" not found` };

	// Remove file
	const localPath = path.join(PLUGINS_DIR, entry.filename);
	if (fs.existsSync(localPath)) {
		fs.unlinkSync(localPath);
		delete require.cache[require.resolve(localPath)];
	}

	// Unregister from commands
	unregisterCommand(name, commandsMap);

	// Remove from registry
	delete registry[name];
	saveRegistry(registry);

	return { success: true, name };
}

function unregisterCommand(name, commandsMap) {
	const cmd = commandsMap.get(name);
	if (cmd && cmd.aliases) {
		for (const alias of cmd.aliases) commandsMap.delete(alias);
	}
	commandsMap.delete(name);
}

/**
 * Load all previously installed plugins (called on startup)
 * Re-downloads gists if local files are missing (e.g. after Railway redeploy)
 */
async function restorePlugins(commandsMap) {
	const registry = getRegistry();
	const entries = Object.entries(registry);
	if (entries.length === 0) return 0;

	console.log(`\n🔌 Restoring ${entries.length} plugin(s)...`);
	let restored = 0;

	for (const [name, entry] of entries) {
		const localPath = path.join(PLUGINS_DIR, entry.filename);

		// If file exists locally, just load it
		if (fs.existsSync(localPath)) {
			try {
				delete require.cache[require.resolve(localPath)];
				const plugin = require(localPath);
				if (plugin.name) {
					commandsMap.set(plugin.name, plugin);
					if (plugin.aliases) {
						for (const alias of plugin.aliases) commandsMap.set(alias, plugin);
					}
				restored++;
				}
			} catch (err) {
				console.error(`  ❌ Failed to load plugin ${name}: ${err.message}`);
			}
			continue;
		}

		// File missing — re-download from gist
		try {
			const gist = await fetchGist(entry.gistId);
			const originalFile = (gist.files || {})[entry.originalFile];
			if (!originalFile) {
				console.error(`  ❌ File ${entry.originalFile} not found in gist ${entry.gistId}`);
				continue;
			}

			const res = await axios.get(originalFile.raw_url);
			fs.writeFileSync(localPath, res.data);

			delete require.cache[require.resolve(localPath)];
			const plugin = require(localPath);
			if (plugin.name) {
				commandsMap.set(plugin.name, plugin);
				if (plugin.aliases) {
					for (const alias of plugin.aliases) commandsMap.set(alias, plugin);
				}
				restored++;
				console.log(`  ✅ Restored: ${name}`);
			}
		} catch (err) {
			console.error(`  ❌ Failed to restore ${name}: ${err.message}`);
		}
	}

	if (restored > 0) console.log(`\n✅ ${restored}/${entries.length} plugin(s) restored\n`);
	return restored;
}

/**
 * List all installed plugins
 */
function listPlugins() {
	const registry = getRegistry();
	return Object.entries(registry).map(([name, entry]) => ({
		name,
		gistId: entry.gistId,
		installedAt: entry.installedAt
	}));
}

module.exports = { installPlugin, uninstallPlugin, restorePlugins, listPlugins };
