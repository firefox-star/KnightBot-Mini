/**
 * AutoStatus Command - Control the status viewer/reactor
 *
 * The status viewer/reactor is a SEPARATE standalone module (statusReactor.js).
 * This command lets the owner configure it: toggle on/off, change emoji, delay, etc.
 */

const { loadConfig, saveConfig } = require('../../utils/statusReactor');

module.exports = {
  name: 'autostatus',
  aliases: ['astatus', 'asv', 'sv'],
  category: 'owner',
  description: 'Control status auto-view and auto-react (owner only)',
  usage: '.autostatus [on/off] [view] [react] [reaction <emoji>] [delay <s>]',
  ownerOnly: true,

  async execute(sock, msg, args, extra) {
    try {
      const cfg = loadConfig();

      if (!args[0]) {
        return extra.reply(
          `📱 *Status Viewer/Reactor*

` +
          `Enabled: *${cfg.enabled ? 'ON' : 'OFF'}*
` +
          `View: *${cfg.view ? 'ON' : 'OFF'}*
` +
          `React: *${cfg.react ? 'ON' : 'OFF'}*
` +
          `Reaction: ${cfg.reaction}
` +
          `Delay: *${cfg.delay}* seconds

` +
          `*Usage:*
` +
          `  ,autostatus on/off
` +
          `  ,autostatus view on/off
` +
          `  ,autostatus react on/off
` +
          `  ,autostatus reaction <emoji>
` +
          `  ,autostatus delay <seconds>`
        );
      }

      const sub = args[0].toLowerCase();
      const val = args[1]?.toLowerCase();

      // Toggle everything on/off
      if (sub === 'on') {
        cfg.enabled = true;
        cfg.view = true;
        cfg.react = true;
        saveConfig(cfg);
        return extra.reply(`✅ Status viewer/reactor ON. View + React enabled with ${cfg.reaction}`);
      }

      if (sub === 'off') {
        cfg.enabled = false;
        saveConfig(cfg);
        return extra.reply('❌ Status viewer/reactor OFF.');
      }

      // View toggle
      if (sub === 'view') {
        if (val === 'on') {
          cfg.view = true;
          cfg.enabled = true;
          saveConfig(cfg);
          return extra.reply('✅ Auto *view* ON.');
        }
        if (val === 'off') {
          cfg.view = false;
          saveConfig(cfg);
          return extra.reply('❌ Auto *view* OFF.');
        }
        return extra.reply('Usage: ,autostatus view <on/off>');
      }

      // React toggle
      if (sub === 'react') {
        if (val === 'on') {
          cfg.react = true;
          cfg.enabled = true;
          saveConfig(cfg);
          return extra.reply(`✅ Auto *react* ON. Using ${cfg.reaction}`);
        }
        if (val === 'off') {
          cfg.react = false;
          saveConfig(cfg);
          return extra.reply('❌ Auto *react* OFF.');
        }
        return extra.reply('Usage: ,autostatus react <on/off>');
      }

      // Change emoji
      if (sub === 'reaction') {
        const emoji = args[1]?.trim();
        if (!emoji) {
          return extra.reply(`Current reaction: ${cfg.reaction}\nUsage: ,autostatus reaction <emoji>`);
        }
        cfg.reaction = emoji;
        saveConfig(cfg);
        return extra.reply(`✅ Reaction set to ${emoji}`);
      }

      // Change delay
      if (sub === 'delay') {
        const seconds = parseInt(args[1]);
        if (isNaN(seconds) || seconds < 0 || seconds > 300) {
          return extra.reply('Usage: ,autostatus delay <0-300 seconds>');
        }
        cfg.delay = seconds;
        saveConfig(cfg);
        return extra.reply(`✅ Delay set to *${seconds}* second${seconds !== 1 ? 's' : ''}.`);
      }

      return extra.reply('❌ Invalid option. Use: on | off | view | react | reaction | delay');
    } catch (err) {
      console.error('[autostatus cmd] error:', err);
      return extra.reply('❌ Error updating status settings.');
    }
  }
};
