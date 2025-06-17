const { startReminderIntervalForGroup, stopReminderIntervalForGroup, saveAllGroupVotes } = require('../helpers.js');

module.exports = {
    name: 'notif',
    description: 'Mengatur pengingat vote. Contoh: `.notif 3600` (detik). 0 untuk mati.',
    adminOnly: true,
    groupOnly: true,
    async execute({ client, msg, args, currentGroupVoteState, EXCLUDED_NUMBERS }) {
        const timeInSeconds = parseInt(args[0]);
        if (isNaN(timeInSeconds) || timeInSeconds < 0) {
            return msg.reply('Format salah. Gunakan: `.notif <detik>` (angka positif).');
        }

        currentGroupVoteState.reminderTime = timeInSeconds;
        if (timeInSeconds === 0) {
            stopReminderIntervalForGroup(msg.id.remote);
            await msg.reply('Pengingat voting dinonaktifkan.');
        } else {
            if (currentGroupVoteState.isActive) {
                startReminderIntervalForGroup(msg.id.remote, client, EXCLUDED_NUMBERS);
            }
            await msg.reply(`Pengingat vote diatur setiap *${timeInSeconds} detik*.`);
        }
        saveAllGroupVotes();
    }
};