const axios = require('axios');
const { MessageMedia } = require('whatsapp-web.js');

module.exports = {
    name: 'ss',
    description: 'Mencari stiker. Contoh: `.ss spongebob`',
    adminOnly: false,
    groupOnly: false,
    async execute({ client, msg, args }) {
        const query = args.join(' ');
        if (!query) return msg.reply('Masukkan teks untuk dicari. Contoh: `.ss kucing`');
        
        await msg.reply(`Mencari stiker untuk "*${query}*"...`);
        try {
            const searchUrl = `https://api.botcahx.eu.org/api/search/sticker?text1=${encodeURIComponent(query)}&apikey=sakaa`;
            const searchResponse = await axios.get(searchUrl);

            if (searchResponse.data.result && searchResponse.data.result.sticker_url.length > 0) {
                const stickersToSend = searchResponse.data.result.sticker_url.slice(0, 10);
                await msg.reply(`Ditemukan ${stickersToSend.length} stiker teratas...`);
                for (const stickerUrl of stickersToSend) {
                    try {
                        const stickerResponse = await axios.get(stickerUrl, { responseType: 'arraybuffer' });
                        const media = new MessageMedia('image/webp', Buffer.from(stickerResponse.data).toString('base64'));
                        await client.sendMessage(msg.from, media, { sendMediaAsSticker: true });
                        await new Promise(resolve => setTimeout(resolve, 500));
                    } catch (loopError) {
                        console.error(`Gagal mengirim stiker dari ${stickerUrl}:`, loopError.message);
                    }
                }
            } else {
                await msg.reply(`Maaf, stiker untuk "*${query}*" tidak ditemukan.`);
            }
        } catch (error) {
            console.error('Gagal saat mencari stiker:', error.message);
            await msg.reply('Maaf, terjadi kesalahan pada API pencarian stiker.');
        }
    }
};