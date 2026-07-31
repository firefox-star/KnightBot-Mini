/**
 * List installed plugins
 * Usage: ,plugins
 */
const { listPlugins } = require('../../utils/pluginManager');

module.exports = {
	name: 'plugins',
	category: 'owner',
	description: 'List installed plugins',
	usage: ',plugins',
	ownerOnly: true,

	async execute(sock, msg, args, extra) {
		const list = listPlugins();
		if (list.length === 0) {
			return extra.reply('\U0001f4e6 No plugins installed.\n\nUse ,install <gist-url>');
		}

		const text = '\U0001f4e6 *Plugins (' + list.length + ')*\n\n' +
			list.map((p, i) => {
				const ago = Math.floor((Date.now() - p.installedAt) / 3600000);
				const time = ago < 1 ? 'just now' : ago + 'h ago';
				return (i + 1) + '. *' + p.name + '* — ' + time;
			}).join('\n');

		return extra.reply(text);
	}
};
