/**
 * Plugin Installer — Install bot commands from GitHub Gists
 * Usage: ,install <gist-url>
 */
const { installPlugin } = require('../../utils/pluginManager');

module.exports = {
	name: 'install',
	category: 'owner',
	description: 'Install a plugin from GitHub Gist URL',
	usage: ',install <gist-url>',
	ownerOnly: true,

	async execute(sock, msg, args, extra) {
		const url = args.join(' ');
		if (!url) {
			return extra.reply(
				'\U0001f527 *Plugin Installer*\n\n' +
				'Usage: ,install <gist-url>\n\n' +
				'Create a Gist with a .js file:\n\n' +
				'```js\n' +
				'module.exports = {\n' +
				'  name: "hello",\n' +
				'  description: "Says hello",\n' +
				'  async execute(sock, msg, args, extra) {\n' +
				'    extra.reply("Hello from plugin!");\n' +
				'  }\n' +
				'};\n' +
				'```\n\n' +
				'Other: ,plugins | ,uninstall <name>'
			);
		}

		await extra.react('\u23f3');

		const { getCommandMap } = require('../../utils/commandLoader');
		const result = await installPlugin(url, getCommandMap());

		if (result.error && !result.installed?.length) {
			await extra.react('\u274c');
			return extra.reply('\u274c ' + result.error);
		}

		let text = '\u2705 *Plugin Installed!*\n\n';
		if (result.installed?.length) {
			text += '*Loaded: ' + result.installed.length + ' command(s)*\n' +
				result.installed.map(n => '  \u2022 ,' + n).join('\n') + '\n';
		}
		if (result.failed?.length) {
			text += '\n*Errors:*\n' + result.failed.map(e => '  \u274c ' + e).join('\n');
		}

		await extra.react('\u2705');
		return extra.reply(text);
	}
};
