const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { MessageMedia } = require('whatsapp-web.js');
const { ensureDirectory } = require('../helpers.js');

module.exports = {
    name: 'tt',
    description: 'Download video TikTok. Contoh: `.tt <link_video>`',
    adminOnly: false,
    groupOnly: false,
    async execute({ client, msg, args }) {
        const url = args[0];
        if (!url || !url.includes('tiktok.com')) {
            return msg.reply('Masukkan link video TikTok yang valid.');
        }

        await msg.reply('Memproses link TikTok, mohon tunggu...');
        const tempDir = path.join(__dirname, '..', 'temp_media');
        ensureDirectory(tempDir);
        const tempFilePath = path.join(tempDir, `tiktok_${Date.now()}.mp4`);

        try {
            const requestUrl = `https://api.botcahx.eu.org/api/dowloader/tiktok?url=${encodeURIComponent(url)}&apikey=sakaa`;
            const response = await axios.get(requestUrl);
            const data = response.data;

            if (data && data.result && data.result.video && data.result.video[0]) {
                const downloadUrl = data.result.video[0];
                const videoTitle = data.result.title || 'Video TikTok';
                await msg.reply(`Mengunduh: *${videoTitle}*...`);

                const fileResponse = await axios.get(downloadUrl, { responseType: 'arraybuffer' });
                fs.writeFileSync(tempFilePath, fileResponse.data);

                const media = MessageMedia.fromFilePath(tempFilePath);
                await client.sendMessage(msg.from, media, { caption: videoTitle });

            } else {
                await msg.reply('Maaf, tidak ditemukan link download dari API.');
            }
        } catch (error) {
            console.error('Gagal download TikTok:', error.message);
            await msg.reply('Maaf, terjadi kesalahan saat download video.');
        } finally {
            if (fs.existsSync(tempFilePath)) {
                fs.unlinkSync(tempFilePath);
            }
        }
    }
};