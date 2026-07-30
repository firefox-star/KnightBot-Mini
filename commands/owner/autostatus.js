/**
 * AutoStatus Command - View & react to status updates automatically
 * Owner only. When someone posts a status, bot views it and optionally reacts.
 */

const { load, save } = require('../../utils/autostatus');

module.exports = {
  name: 'autostatus',
  aliases: ['astatus', 'asv'],
  category: 'owner',
  description: 'Auto view and react to status updates (owner only)',
  usage: '.autostatus [view on/off] [react on/off] [reaction <emoji>]',
  ownerOnly: true,

  async execute(sock, msg, args, extra) {
    try {
      const cfg = load();

      if (!args[0]) {
        let privacyNote = '';
        try {
          const privacy = await sock.fetchPrivacySettings?.();
          const rr = privacy?.readreceipts || 'unknown';
          privacyNote = rr !== 'all'
            ? `\n⚠️ Bot read receipts: *${rr}* – status poster may NOT see views. Use \`.autostatus readreceipts on\` to fix.`
            : `\n✅ Bot read receipts: ${rr}`;
        } catch (_) {}
        return extra.reply(
          `📱 *AutoStatus*\n\n` +
          `View: *${cfg.view ? 'ON' : 'OFF'}*\n` +
          `React: *${cfg.react ? 'ON' : 'OFF'}*\n` +
          `Reaction: ${cfg.reaction}\n` +
          `Delay: *${cfg.delay || 5}* seconds` +
          privacyNote + `\n\n*Usage:*\n` +
          `  .autostatus view on/off\n` +
          `  .autostatus react on/off\n` +
          `  .autostatus reaction <emoji>\n` +
          `  .autostatus delay <seconds>\n` +
          `  .autostatus readreceipts on/off`
        );
      }

      const sub = args[0].toLowerCase();
      const val = args[1]?.toLowerCase();

      if (sub === 'view') {
        if (val === 'on') {
          cfg.view = true;
          save(cfg);
          return extra.reply('✅ AutoStatus *view* is ON. Bot will view status updates immediately.');
        }
        if (val === 'off') {
          cfg.view = false;
          save(cfg);
          return extra.reply('❌ AutoStatus *view* is OFF.');
        }
        return extra.reply('Usage: .autostatus view <on/off>');
      }

      if (sub === 'react') {
        if (val === 'on') {
          cfg.react = true;
          save(cfg);
          return extra.reply(`✅ AutoStatus *react* is ON. Bot will react with ${cfg.reaction}.`);
        }
        if (val === 'off') {
          cfg.react = false;
          save(cfg);
          return extra.reply('❌ AutoStatus *react* is OFF.');
        }
        return extra.reply('Usage: .autostatus react <on/off>');
      }

      if (sub === 'reaction') {
        const emoji = args[1]?.trim();
        if (!emoji) {
          return extra.reply(`Current reaction: ${cfg.reaction}\nUsage: .autostatus reaction <emoji>`);
        }
        cfg.reaction = emoji;
        save(cfg);
        return extra.reply(`✅ AutoStatus reaction set to ${emoji}`);
      }

      if (sub === 'readreceipts') {
        if (val === 'on') {
          try {
            await sock.updateReadReceiptsPrivacy?.('all');
            return extra.reply('✅ Bot read receipts enabled. Status poster will now see when bot views their status.');
          } catch (e) {
            return extra.reply('❌ Failed: ' + (e?.message || e));
          }
        }
        if (val === 'off') {
          try {
            await sock.updateReadReceiptsPrivacy?.('none');
            return extra.reply('❌ Bot read receipts disabled.');
          } catch (e) {
            return extra.reply('❌ Failed: ' + (e?.message || e));
          }
        }
        return extra.reply('Usage: .autostatus readreceipts <on/off>');
      }

      if (sub === 'delay') {
        const seconds = parseInt(args[1]);
        if (isNaN(seconds) || seconds < 0 || seconds > 300) {
          return extra.reply('Usage: .autostatus delay <0-300 seconds>');
        }
        cfg.delay = seconds;
        save(cfg);
        return extra.reply(`✅ AutoStatus delay set to *${seconds}* second${seconds !== 1 ? 's' : ''}.`);
      }

      return extra.reply('❌ Invalid option. Use: view | react | reaction | delay | readreceipts');
    } catch (err) {
      console.error('[autostatus cmd] error:', err);
      return extra.reply('❌ Error updating autostatus.');
    }
  }
};
