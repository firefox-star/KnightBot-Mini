/**
 * Pair Command - Generate WhatsApp pairing codes (owner only)
 *
 * Commands:
 *   ,pair <number>   - Generate 8-char pairing code
 *   ,pairs           - List active paired sessions
 *   ,unpair <number> - Remove a paired session
 */

const { generatePairingCode, removePair, listPairs, isPairActive } = require('../../utils/pairManager');

module.exports = {
  name: 'pair',
  aliases: ['link'],
  category: 'owner',
  description: 'Generate WhatsApp pairing code to link a device (owner only)',
  usage: ',pair <number>',
  ownerOnly: true,

  async execute(sock, msg, args, extra) {
    try {
      const sub = args[0]?.toLowerCase();

      // ,pairs — list active pairs
      if (sub === 's' || sub === 'pairs' || sub === 'list') {
        const pairs = listPairs();
        if (pairs.length === 0) {
          return extra.reply('No active paired sessions.');
        }
        const list = pairs.map((p, i) =>
          `  ${i + 1}. +${p.number} — ${p.status}${p.pairedAt ? ` (paired ${p.pairedAt})` : ''}`
        ).join('\n');
        return extra.reply(`*Linked Devices:*\n${list}`);
      }

      // ,unpair <number> — remove a pair
      if (sub === 'unpair' || sub === 'unlink' || sub === 'remove') {
        const number = args[1]?.replace(/\D/g, '');
        if (!number || number.length < 7) {
          return extra.reply('Usage: ,unpair <number>');
        }
        const result = removePair(number);
        return extra.reply(result.success ? `✅ ${result.message}` : `❌ ${result.message}`);
      }

      // ,pair <number> — generate pairing code
      const raw = args[0]?.replace(/\D/g, '');
      if (!raw || raw.length < 7 || raw.length > 15) {
        return extra.reply(
          '❌ Invalid number.\n\n' +
          '*Usage:*\n' +
          '  ,pair <number>   — Generate pairing code\n' +
          '  ,pairs           — List active pairs\n' +
          '  ,unpair <number> — Remove a pair\n\n' +
          'Example: ,pair 2347070818332'
        );
      }

      if (isPairActive(raw)) {
        return extra.reply(`❌ +${raw} is already pairing or connected. Use ,unpair ${raw} first.`);
      }

      try {
        const { code } = await generatePairingCode(raw);
        return extra.reply(code);
      } catch (err) {
        return extra.reply(`❌ ${err.message}`);
      }
    } catch (err) {
      console.error('[pair cmd] error:', err);
      return extra.reply('❌ Error generating pairing code.');
    }
  }
};
