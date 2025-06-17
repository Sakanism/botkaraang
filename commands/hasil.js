const { updateResultsMessageForGroup } = require('../helpers.js');

module.exports = {
    name: 'hasil',
    description: 'Memperbarui dan menampilkan hasil voting saat ini.',
    adminOnly: true,
    groupOnly: true,
    async execute({ client, msg, currentGroupVoteState, EXCLUDED_NUMBERS }) {
        if (!currentGroupVoteState.isActive) {
            return msg.reply('Tidak ada voting yang sedang aktif di grup ini.');
        }
        await updateResultsMessageForGroup(msg.id.remote, client, EXCLUDED_NUMBERS);
        await msg.reply("Hasil voting telah diperbarui di pesan utama.");
    }
};