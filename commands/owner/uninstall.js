/**
 * Uninstall a plugin
 * Usage: ,uninstall <name>
 */
const { uninstallPlugin } = require('../../utils/pluginManager');

module.exports = {
	name: 'uninstall',
	category: 'owner',
	description: 'Remove an installed plugin',
	usage: ',uninstall <name>',
	ownerOnly: true,

	async execute(sock, msg, args, extra) {
		const name = args[0];
		if (!name) return extra.reply('Usage: ,uninstall <plugin-name>');

		const { getCommandMap } = require('../../utils/commandLoader');
		const result = uninstallPlugin(name, getCommandMap());

		if (!result.success) {
			await extra.react('\u274c');
			return extra.reply('\u274c ' + result.error);
		}

		await extra.react('\u2705');
		return extra.reply('\u2705 Plugin *' + result.name + '* removed.');
	}
};
