const axios = require('axios');
const { MessageMedia } = require('whatsapp-web.js');

module.exports = {
    name: 'brat',
    description: 'Membuat stiker "brat". Contoh: `.brat teksnya`',
    adminOnly: false,
    groupOnly: false,
    async execute({ client, msg, args }) {
        await msg.reply('Membuat stiker via API, mohon tunggu...');
        try {
            const stickerText = args.join(' ') || 'brat';
            const apiUrl = 'https://api.botcahx.eu.org/api/maker/brat';
            const apiKey = 'sakaa';
            const fullUrl = `${apiUrl}?text=${encodeURIComponent(stickerText)}&apikey=${apiKey}`;

            const response = await axios.get(fullUrl, { responseType: 'arraybuffer' });
            const media = new MessageMedia('image/jpeg', Buffer.from(response.data).toString('base64'));
            await client.sendMessage(msg.from, media, { sendMediaAsSticker: true });
        } catch (error) {
            console.error('Gagal membuat stiker .brat:', error.message);
            await msg.reply('Maaf, terjadi kesalahan saat membuat stiker.');
        }
    }
};