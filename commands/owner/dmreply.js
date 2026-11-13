/**
 * DM Reply Mode — when ON (default), any group-settings command typed inside
 * a group answers in the sender's own DM instead of the group chat.
 * Owner "category" commands do the same.
 *
 * Usage: .dmreply            → toggles on/off
 *        .dmreply on|off     → explicit
 */

const botConfig = require('../../utils/botConfig');

module.exports = {
	name: 'dmreply',
	aliases: ['settingsdm', 'dmreplies'],
	category: 'owner',
	description: 'Group settings commands reply in your DM instead of the group',
	usage: '.dmreply [on|off]',
	ownerOnly: true,

	async execute(sock, msg, args, extra) {
		const sub = args[0]?.toLowerCase();
		let current = botConfig.get('dmSettingsReply', true);

		if (sub === 'on' || sub === 'enable') current = botConfig.set('dmSettingsReply', true);
		else if (sub === 'off' || sub === 'disable') current = botConfig.set('dmSettingsReply', false);
		else current = botConfig.set('dmSettingsReply', !current);

		return extra.reply(current
			? '📬 *DM Reply Mode ON*\n\nSettings commands (.antilink, .welcome, ...) typed in a group now answer in your own DM. The group stays quiet.'
			: '💬 *DM Reply Mode OFF*\n\nSettings commands will answer inside the group again.');
	}
};
