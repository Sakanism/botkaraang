const { loadMembersData } = require('../helpers.js');

module.exports = {
    name: 'info',
    description: 'Mengirim pesan penting ke semua anggota. Contoh: `.info rapat besok`',
    adminOnly: true,
    groupOnly: true,
    async execute({ client, msg, args, EXCLUDED_NUMBERS }) {
        const infoMessageContent = args.join(' ');
        if (!infoMessageContent) {
            return msg.reply('Format salah. Gunakan: `.info <pesan_anda>`');
        }

        const chat = await msg.getChat();
        const storedMembers = loadMembersData(chat.id._serialized);
        if (!storedMembers || storedMembers.length === 0) {
            return msg.reply('Tidak ada data anggota. Jalankan `.anggota` dulu.');
        }

        await msg.reply(`*Pesan Penting:*\n\n${infoMessageContent}`);
        let sentCount = 0;
        for (const memberNumber of storedMembers) {
            if (!EXCLUDED_NUMBERS.includes(memberNumber)) {
                try {
                    const contact = await client.getContactById(`${memberNumber}@c.us`);
                    const displayName = contact.pushname || contact.name || memberNumber;
                    await client.sendMessage(`${memberNumber}@c.us`, `Halo *${displayName}*, ada pesan penting di grup *${chat.name}*:\n\n*${infoMessageContent}*`);
                    sentCount++;
                } catch (e) {
                    // ignore
                }
            }
        }
        await msg.reply(`Pesan info telah dikirim ke *${sentCount}* anggota.`);
    }
};