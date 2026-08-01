const axios = require('axios');

module.exports = {
  name: 'getpp',
  aliases: ['gp', 'getpic'],
  category: 'general',
  description: 'Get profile picture of a user',
  usage: ',getpp (reply/tag/@number)',
  
  async execute(sock, msg, args, extra) {
    let targetUser = null;
    
    // 1. Reply to message
    const ctx = msg.message?.extendedTextMessage?.contextInfo;
    if (ctx?.participant) {
      targetUser = ctx.participant;
    } else if (ctx?.mentionedJid?.length > 0) {
      targetUser = ctx.mentionedJid[0];
    }
    
    // 2. @number in text (e.g. ,getpp @2347070818332)
    if (!targetUser && args[0]) {
      const num = args[0].replace(/[^0-9]/g, '');
      if (num.length >= 7) {
        targetUser = num + '@s.whatsapp.net';
      }
    }
    
    // 3. Fallback to sender
    if (!targetUser) targetUser = extra.sender;
    
    try {
      const ppUrl = await sock.profilePictureUrl(targetUser, 'image');
      if (!ppUrl) return extra.reply('\u274c No profile picture found.');
      
      const response = await axios.get(ppUrl, { responseType: 'arraybuffer' });
      const buffer = Buffer.from(response.data);
      
      await sock.sendMessage(extra.from, { 
        image: buffer,
        caption: `\u{1f464} @${targetUser.split('@')[0]}`,
        mentions: [targetUser]
      }, { quoted: msg });
      
    } catch (err) {
      extra.reply('\u274c Profile picture not available for this user.');
    }
  }
};
