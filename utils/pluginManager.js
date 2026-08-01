const fs = require('fs');
const path = require('path');
const axios = require('axios');

const PLUGINS_DIR = path.join(__dirname, '..', 'plugins');
const REGISTRY_FILE = path.join(__dirname, '..', 'database', 'installed-plugins.json');

// GitHub token for private gists + persisting registry across deploys
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || '';
const GIST_REGISTRY_ID = process.env.PLUGIN_REGISTRY_GIST || '';

if (!fs.existsSync(PLUGINS_DIR)) fs.mkdirSync(PLUGINS_DIR, { recursive: true });

// ---- GitHub API helpers ----
function ghHeaders() {
        const h = { Accept: 'application/vnd.github.v3+json' };
        if (GITHUB_TOKEN) h.Authorization = 'Bearer ' + GITHUB_TOKEN;
        return h;
}

// ---- Registry persistence ----
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

/** Sync registry to a GitHub Gist so it survives Railway deploys */
async function pushRegistryToGist(registry) {
        if (!GITHUB_TOKEN) return; // need token
        const content = JSON.stringify(registry);
        try {
                if (GIST_REGISTRY_ID) {
                        // Update existing gist
                        await axios.patch(`https://api.github.com/gists/${GIST_REGISTRY_ID}`, {
                                files: { 'installed-plugins.json': { content } }
                        }, { headers: ghHeaders() });
                } else {
                        // Create new gist (secret by default)
                        const res = await axios.post('https://api.github.com/gists', {
                                description: 'KnightBot Plugin Registry (auto-managed)',
                                public: false,
                                files: { 'installed-plugins.json': { content } }
                        }, { headers: ghHeaders() });
                        if (res.data?.id) {
                                // Log it so user can set PLUGIN_REGISTRY_GIST env
                                console.log(`\n\U0001f4e1 Plugin registry gist: ${res.data.id}` +
                                        ` (set env PLUGIN_REGISTRY_GIST=${res.data.id} to reuse)`);
                        }
                }
        } catch (err) {
                console.error('Failed to sync registry to gist:', err.message);
        }
}

/** Pull registry from Gist (for restoring after deploy) */
async function pullRegistryFromGist() {
        if (!GITHUB_TOKEN || !GIST_REGISTRY_ID) return null;
        try {
                const res = await axios.get(`https://api.github.com/gists/${GIST_REGISTRY_ID}`, { headers: ghHeaders() });
                const file = res.data?.files?.['installed-plugins.json'];
                if (file?.content) return JSON.parse(file.content);
        } catch (_) {}
        return null;
}

// ---- Gist URL parsing ----
function parseGistUrl(input) {
        const trimmed = input.trim();
        if (/^[a-f0-9]{20,}$/.test(trimmed)) return trimmed;
        const match = trimmed.match(/gist\.github\.com\/[\w-]+\/([a-f0-9]+)/);
        return match ? match[1] : null;
}

/** Fetch gist metadata from GitHub API */
async function fetchGist(gistId) {
        const res = await axios.get(`https://api.github.com/gists/${gistId}`, { headers: ghHeaders() });
        return res.data;
}

// ---- Install ----
async function installPlugin(gistUrl, commandsMap) {
        const gistId = parseGistUrl(gistUrl);
        if (!gistId) return { success: false, error: 'Invalid gist URL. Use: https://gist.github.com/user/gistid' };

        let gist;
        try {
                gist = await fetchGist(gistId);
        } catch (err) {
                const msg = err.response?.status === 404
                        ? 'Gist not found. Check the URL.'
                        : err.response?.status === 403
                                ? 'Gist is private or access denied. Set GITHUB_TOKEN env var for private gists.'
                                : err.message;
                return { success: false, error: msg };
        }

        const jsFiles = Object.entries(gist.files || {}).filter(([, f]) => f.filename.endsWith('.js'));
        if (jsFiles.length === 0) {
                return { success: false, error: 'No .js file in gist. Plugin file must end with .js' };
        }

        const results = [];
        const registry = getRegistry();

        for (const [filename, fileData] of jsFiles) {
                const rawUrl = fileData.raw_url;
                const safeName = filename.replace(/[^a-zA-Z0-9_-]/g, '_');
                const localPath = path.join(PLUGINS_DIR, safeName);

                try {
                        const res = await axios.get(rawUrl);
                        fs.writeFileSync(localPath, res.data);

                        delete require.cache[require.resolve(localPath)];
                const plugin = require(localPath);
                        if (!plugin.name) {
                                fs.unlinkSync(localPath);
                                results.push({ file: filename, error: 'Missing "name" export' });
                                continue;
                        }

                        unregisterCommand(plugin.name, commandsMap);
                        if (plugin.aliases) {
                                for (const alias of plugin.aliases) unregisterCommand(alias, commandsMap);
                        }

                        commandsMap.set(plugin.name, plugin);
                        if (plugin.aliases) {
                                for (const alias of plugin.aliases) commandsMap.set(alias, plugin);
                        }

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
        pushRegistryToGist(registry); // persist to GitHub gist

        const succeeded = results.filter(r => r.success);
        const failed = results.filter(r => r.error);
        return {
                success: succeeded.length > 0,
                installed: succeeded.map(r => r.name),
                failed: failed.map(r => `${r.file}: ${r.error}`),
                gistId
        };
}

// ---- Uninstall ----
function uninstallPlugin(name, commandsMap) {
        const registry = getRegistry();
        const entry = registry[name];
        if (!entry) return { success: false, error: `Plugin "${name}" not found` };

        const localPath = path.join(PLUGINS_DIR, entry.filename);
        if (fs.existsSync(localPath)) {
                fs.unlinkSync(localPath);
                try { delete require.cache[require.resolve(localPath)]; } catch (_) {}
        }

        unregisterCommand(name, commandsMap);
        delete registry[name];
        saveRegistry(registry);
        pushRegistryToGist(registry);

        return { success: true, name };
}

function unregisterCommand(name, commandsMap) {
        const cmd = commandsMap.get(name);
        if (cmd && cmd.aliases) {
                for (const alias of cmd.aliases) commandsMap.delete(alias);
        }
        commandsMap.delete(name);
}

// ---- Restore on startup ----
async function restorePlugins(commandsMap) {
        // Try pulling from gist first (survives deploys)
        const gistRegistry = await pullRegistryFromGist();
        if (gistRegistry && Object.keys(gistRegistry).length > 0) {
                saveRegistry(gistRegistry); // save locally too
        }

        const registry = getRegistry();
        const entries = Object.entries(registry);
        if (entries.length === 0) return 0;

        console.log(`\n\U0001f50c Restoring ${entries.length} plugin(s)...`);
        let restored = 0;

        for (const [name, entry] of entries) {
                const localPath = path.join(PLUGINS_DIR, entry.filename);

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
                                console.error(`  \u274c Failed to load ${name}: ${err.message}`);
                        }
                        continue;
                }

                try {
                        const gist = await fetchGist(entry.gistId);
                        const originalFile = (gist.files || {})[entry.originalFile];
                        if (!originalFile) {
                                console.error(`  \u274c ${entry.originalFile} not in gist ${entry.gistId}`);
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
                                console.log(`  \u2705 Restored: ${name}`);
                        }
                } catch (err) {
                        console.error(`  \u274c Failed to restore ${name}: ${err.message}`);
                }
        }

        if (restored > 0) console.log(`\u2705 ${restored}/${entries.length} plugin(s) restored\n`);
        return restored;
}

// ---- List ----
function listPlugins() {
        const registry = getRegistry();
        return Object.entries(registry).map(([name, entry]) => ({
                name,
                gistId: entry.gistId,
                installedAt: entry.installedAt
        }));
}

module.exports = { installPlugin, uninstallPlugin, restorePlugins, listPlugins };
