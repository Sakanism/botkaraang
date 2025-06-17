const { stopReminderIntervalForGroup, buildResultsMessage, saveAllGroupVotes } = require('../helpers.js');

module.exports = {
    name: 'stop',
    description: 'Menghentikan voting yang berjalan.',
    adminOnly: true,
    groupOnly: true,
    async execute({ client, msg, currentGroupVoteState, EXCLUDED_NUMBERS }) {
        if (!currentGroupVoteState.isActive) {
            return msg.reply('Tidak ada voting yang aktif untuk dihentikan.');
        }
        
        const chat = await msg.getChat();
        const currentGroupId = chat.id._serialized;

        stopReminderIntervalForGroup(currentGroupId);
        
        const { content, mentions } = buildResultsMessage(currentGroupVoteState, true, EXCLUDED_NUMBERS);
        await chat.sendMessage(content, { mentions });

        const voteEndedMessage = `📢 Voting "*${currentGroupVoteState.title}*" telah berakhir!`;
        for (const pId of currentGroupVoteState.votedMessageRecipients) {
            try { await client.sendMessage(pId, voteEndedMessage); } catch (e) { /* ignore */ }
        }

        // Reset state
        Object.assign(currentGroupVoteState, {
            isActive: false, title: '', options: [], optionMap: {}, results: {},
            votedParticipants: [], resultsMessageId: null, votedMessageRecipients: [],
            reminderInterval: null, lastReminderSent: {}, startTime: 0
        });
        saveAllGroupVotes();
        await msg.reply("Voting telah dihentikan.");
    }
};