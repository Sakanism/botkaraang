const { loadMembersData, buildResultsMessage, startReminderIntervalForGroup, saveAllGroupVotes } = require('../helpers.js');

module.exports = {
    name: 'mulai',
    description: 'Memulai voting. Format: `.mulai <judul>, <opsi1>, <opsi2>`',
    adminOnly: true,
    groupOnly: true,
    async execute({ client, msg, args, currentGroupVoteState, EXCLUDED_NUMBERS }) {
        if (currentGroupVoteState.isActive) {
            return msg.reply('Ada voting yang sedang berlangsung. Hentikan dengan `.stop`.');
        }

        const voteArgs = args.join(' ').split(',');
        if (voteArgs.length < 3 || voteArgs[0].trim() === '') {
            return msg.reply('Format salah. Contoh: `.mulai Rapat, Hadir, Tidak Hadir`');
        }

        Object.assign(currentGroupVoteState, {
            title: voteArgs[0].trim(),
            options: voteArgs.slice(1).map(opt => opt.trim()),
            isActive: true, results: {}, votedParticipants: [], votedMessageRecipients: [],
            lastReminderSent: {}, startTime: Date.now(), optionMap: {}
        });
        
        let optionsListForMessage = '';
        currentGroupVoteState.options.forEach((opt, index) => {
            const num = (index + 1).toString();
            currentGroupVoteState.optionMap[num] = opt;
            optionsListForMessage += `${num}. *${opt}*\n`;
        });
        
        const chat = await msg.getChat();
        const storedMembers = loadMembersData(chat.id._serialized);
        if (!storedMembers || storedMembers.length === 0) {
            currentGroupVoteState.isActive = false;
            saveAllGroupVotes();
            return msg.reply('Data anggota kosong. Jalankan `.anggota` dulu.');
        }

        const participantsToMessage = storedMembers.filter(num => !EXCLUDED_NUMBERS.includes(num)).map(num => `${num}@c.us`);
        
        const introMessage = `Halo, yuk vote:\n\n*${currentGroupVoteState.title}*\n\nBalas dengan *angka* atau *teks* pilihanmu:\n${optionsListForMessage}`;
        
        let sentCount = 0;
        for (const pId of participantsToMessage) {
            try {
                currentGroupVoteState.votedMessageRecipients.push(pId);
                await client.sendMessage(pId, introMessage);
                sentCount++;
            } catch (e) { /* ignore */ }
        }
        
        const { content, mentions } = buildResultsMessage(currentGroupVoteState, false, EXCLUDED_NUMBERS);
        const sentResultsMsg = await chat.sendMessage(content, { mentions });
        currentGroupVoteState.resultsMessageId = sentResultsMsg.id._serialized;
        
        await msg.reply(`Voting "*${currentGroupVoteState.title}*" dimulai! Pesan terkirim ke ${sentCount} anggota.`);
        startReminderIntervalForGroup(chat.id._serialized, client, EXCLUDED_NUMBERS);
        saveAllGroupVotes();
    }
};