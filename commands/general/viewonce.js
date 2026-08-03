/**
 * ViewOnce Command - Reveal view-once messages, sends to owner's DM
 */

const { downloadContentFromMessage } = require('@whiskeysockets/baileys');
const config = require('../../config');

module.exports = {
  name: 'viewonce',
  aliases: ['readvo', 'read', 'vv', 'readviewonce'],
  category: 'general',
  description: 'Reveal view-once messages (sends to your DM)',
  usage: ',vv (reply to view-once message)',
  
  async execute(sock, msg, args, extra) {
    const ownerJid = config.ownerNumber[0] + '@s.whatsapp.net';
    const chatId = msg.key.remoteJid;

    const ctx = msg.message?.extendedTextMessage?.contextInfo
      || msg.message?.imageMessage?.contextInfo
      || msg.message?.videoMessage?.contextInfo
      || msg.message?.buttonsResponseMessage?.contextInfo
      || msg.message?.listResponseMessage?.contextInfo;

    if (!ctx?.quotedMessage || !ctx?.stanzaId) {
      return await sock.sendMessage(chatId,
        { text: '⚠️ Reply to a *view-once* message to reveal it.' },
        { quoted: msg }
      );
    }

    const quotedMsg = ctx.quotedMessage;
    const hasViewOnce =
      !!quotedMsg.viewOnceMessageV2 ||
      !!quotedMsg.viewOnceMessageV2Extension ||
      !!quotedMsg.viewOnceMessage ||
      !!quotedMsg.viewOnce ||
      !!quotedMsg?.imageMessage?.viewOnce ||
      !!quotedMsg?.videoMessage?.viewOnce ||
      !!quotedMsg?.audioMessage?.viewOnce;

    if (!hasViewOnce) {
      return await sock.sendMessage(chatId,
        { text: '❌ This is not a view-once message!' },
        { quoted: msg }
      );
    }

    let actualMsg = null;
    let mtype = null;

    if (quotedMsg.viewOnceMessageV2Extension?.message) {
      actualMsg = quotedMsg.viewOnceMessageV2Extension.message;
      mtype = Object.keys(actualMsg)[0];
    } else if (quotedMsg.viewOnceMessageV2?.message) {
      actualMsg = quotedMsg.viewOnceMessageV2.message;
      mtype = Object.keys(actualMsg)[0];
    } else if (quotedMsg.viewOnceMessage?.message) {
      actualMsg = quotedMsg.viewOnceMessage.message;
      mtype = Object.keys(actualMsg)[0];
    } else if (quotedMsg.imageMessage?.viewOnce) {
      actualMsg = { imageMessage: quotedMsg.imageMessage };
      mtype = 'imageMessage';
    } else if (quotedMsg.videoMessage?.viewOnce) {
      actualMsg = { videoMessage: quotedMsg.videoMessage };
      mtype = 'videoMessage';
    } else if (quotedMsg.audioMessage?.viewOnce) {
      actualMsg = { audioMessage: quotedMsg.audioMessage };
      mtype = 'audioMessage';
    }

    if (!actualMsg || !mtype) {
      return await sock.sendMessage(chatId,
        { text: '❌ Unsupported view-once type.' },
        { quoted: msg }
      );
    }

    await extra.react('⏳');

    const downloadType = mtype === 'imageMessage' ? 'image' : mtype === 'videoMessage' ? 'video' : 'audio';
    const mediaStream = await downloadContentFromMessage(actualMsg[mtype], downloadType);
    let buffer = Buffer.from([]);
    for await (const chunk of mediaStream) buffer = Buffer.concat([buffer, chunk]);

    const caption = actualMsg[mtype]?.caption || '';
    const sendTo = ownerJid; // always send to owner's DM

    if (/video/.test(mtype)) {
      await sock.sendMessage(sendTo, { video: buffer, caption, mimetype: 'video/mp4' });
    } else if (/image/.test(mtype)) {
      await sock.sendMessage(sendTo, { image: buffer, caption, mimetype: 'image/jpeg' });
    } else if (/audio/.test(mtype)) {
      await sock.sendMessage(sendTo, { audio: buffer, ptt: true, mimetype: 'audio/ogg; codecs=opus' });
    }

    await extra.react('👁️');
  }
};
