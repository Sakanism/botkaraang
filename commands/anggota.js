const { saveMembersData } = require('../helpers.js');

module.exports = {
    name: 'anggota',
    description: 'Memperbarui dan menampilkan daftar anggota grup.',
    adminOnly: true,
    groupOnly: true,
    async execute({ client, msg, BOT_ADMINS }) {
        const chat = await msg.getChat();
        const groupParticipants = chat.participants;
        if (!groupParticipants || groupParticipants.length === 0) {
            return msg.reply('Gagal mendapatkan daftar anggota grup.');
        }

        const membersInfo = [];
        const membersNumbers = [];
        for (const p of groupParticipants) {
            membersInfo.push(`${p.id.user} (Admin: ${p.isAdmin || p.isSuperAdmin})`);
            membersNumbers.push(p.id.user);
        }

        saveMembersData(chat.id._serialized, membersNumbers);

        let replyMessage = `*Anggota Grup "${chat.name}" (${membersInfo.length}):*\n\n${membersInfo.join('\n')}`;
        await msg.reply(replyMessage);

        for (const adminNum of BOT_ADMINS) {
            if (adminNum !== msg.author.split('@')[0]) {
                await client.sendMessage(`${adminNum}@c.us`, `Daftar anggota grup "${chat.name}" diperbarui.`);
            }
        }
    }
};