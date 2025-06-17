// helpers.js
const fs = require('fs');
const path = require('path');

// --- Path Global ---
const MEMBER_DATA_DIR = path.join(__dirname, 'member_data');
const VOTE_DATA_DIR = path.join(__dirname, 'vote_data');
const VOTE_DATA_FILE = path.join(VOTE_DATA_DIR, 'all_group_votes.json');

// Variabel ini akan diimpor dan dimodifikasi oleh index.js
let ALL_GROUP_VOTES = {};

function ensureDirectory(directoryPath) {
    if (!fs.existsSync(directoryPath)) {
        fs.mkdirSync(directoryPath, { recursive: true });
        console.log(`Folder '${directoryPath}' dibuat.`);
    }
}

function saveMembersData(groupId, members) {
    ensureDirectory(MEMBER_DATA_DIR);
    const filePath = path.join(MEMBER_DATA_DIR, `${groupId}.json`);
    fs.writeFileSync(filePath, JSON.stringify(members, null, 2), 'utf-8');
    console.log(`Data anggota grup ${groupId} disimpan ke ${filePath}`);
}

function loadMembersData(groupId) {
    const filePath = path.join(MEMBER_DATA_DIR, `${groupId}.json`);
    if (fs.existsSync(filePath)) {
        const data = fs.readFileSync(filePath, 'utf-8');
        return JSON.parse(data);
    }
    return null;
}

function saveAllGroupVotes() {
    ensureDirectory(VOTE_DATA_DIR);
    const cleanData = {};
    for (const groupId in ALL_GROUP_VOTES) {
        const voteState = { ...ALL_GROUP_VOTES[groupId] };
        if (voteState.reminderInterval) {
            delete voteState.reminderInterval;
        }
        cleanData[groupId] = voteState;
    }
    fs.writeFileSync(VOTE_DATA_FILE, JSON.stringify(cleanData, null, 2), 'utf-8');
    console.log(`Data voting disimpan ke ${VOTE_DATA_FILE}`);
}

function loadAllGroupVotes() {
    ensureDirectory(VOTE_DATA_DIR);
    if (fs.existsSync(VOTE_DATA_FILE)) {
        try {
            const data = fs.readFileSync(VOTE_DATA_FILE, 'utf-8');
            ALL_GROUP_VOTES = JSON.parse(data);
            for (const groupId in ALL_GROUP_VOTES) {
                 if (ALL_GROUP_VOTES[groupId].isActive && ALL_GROUP_VOTES[groupId].reminderTime > 0) {
                    startReminderIntervalForGroup(groupId);
                }
            }
            console.log(`Data voting berhasil dimuat dari ${VOTE_DATA_FILE}.`);
            return ALL_GROUP_VOTES;
        } catch (e) {
            console.error(`Gagal memuat data voting:`, e);
        }
    }
    return {};
}

function getGroupVoteState(groupId) {
    if (!ALL_GROUP_VOTES[groupId]) {
        ALL_GROUP_VOTES[groupId] = {
            isActive: false, title: '', options: [], optionMap: {}, results: {},
            votedParticipants: [], resultsMessageId: null, groupId: groupId,
            votedMessageRecipients: [], reminderInterval: null, reminderTime: 0,
            lastReminderSent: {}, startTime: 0
        };
        saveAllGroupVotes();
    }
    return ALL_GROUP_VOTES[groupId];
}

function stopReminderIntervalForGroup(groupId) {
    const voteState = getGroupVoteState(groupId);
    if (voteState.reminderInterval) {
        clearInterval(voteState.reminderInterval);
        voteState.reminderInterval = null;
        console.log(`Interval pengingat untuk grup ${groupId} dihentikan.`);
    }
}

async function sendReminderToUnvotedParticipants(groupId, client, EXCLUDED_NUMBERS) {
    const voteState = getGroupVoteState(groupId);
    if (!voteState.isActive) return;

    const unvotedParticipants = voteState.votedMessageRecipients.filter(
        participantId => !voteState.votedParticipants.includes(participantId) &&
                        !EXCLUDED_NUMBERS.includes(participantId.split('@')[0])
    );

    const currentTime = Date.now();
    const firstOptionNumber = voteState.options.length > 0 ? '1' : '';
    const firstOptionText = voteState.options.length > 0 ? voteState.options[0] : 'Opsi Pertama';

    const reminderMessage = `🔔 Pengingat! Tolong berikan suara Anda untuk voting: *${voteState.title}*.\n\nPilih salah satu opsi (ketik *angka* atau *teks* opsi secara persis):\n${Object.keys(voteState.optionMap).map(key => `${key}. *${voteState.optionMap[key]}*`).join('\n')}\n(Contoh: ketik *${firstOptionNumber}* atau *${firstOptionText}*)`;

    for (const participantId of unvotedParticipants) {
        const lastSent = voteState.lastReminderSent[participantId] || 0;
        if ((currentTime - lastSent) >= (voteState.reminderTime * 1000)) {
            try {
                await client.sendMessage(participantId, reminderMessage);
                voteState.lastReminderSent[participantId] = currentTime;
                console.log(`Pengingat voting terkirim ke ${participantId} untuk grup ${groupId}`);
            } catch (e) {
                console.error(`Gagal mengirim pengingat ke ${participantId} untuk grup ${groupId}:`, e);
            }
        }
    }
}

function startReminderIntervalForGroup(groupId, client, EXCLUDED_NUMBERS) {
    const voteState = getGroupVoteState(groupId);
    stopReminderIntervalForGroup(groupId);
    if (voteState.isActive && voteState.reminderTime > 0) {
        voteState.reminderInterval = setInterval(() => sendReminderToUnvotedParticipants(groupId, client, EXCLUDED_NUMBERS), voteState.reminderTime * 1000);
        console.log(`Pengingat voting untuk grup ${groupId} aktif setiap ${voteState.reminderTime} detik.`);
    }
}

function buildResultsMessage(voteState, isFinal = false, EXCLUDED_NUMBERS) {
    let resultMessage = `--- Hasil Voting ${isFinal ? 'Akhir' : 'Saat Ini'}: *${voteState.title || 'Belum Ada Voting'}* ---\n`;

    if (!voteState.isActive || Object.keys(voteState.results).length === 0) {
        resultMessage += `\n_Belum ada suara yang masuk._\n`;
    } else {
        const resultsSummary = {};
        voteState.options.forEach(option => {
            resultsSummary[option] = 0;
        });

        for (const voterId in voteState.results) {
            const vote = voteState.results[voterId];
            if (resultsSummary.hasOwnProperty(vote)) {
                resultsSummary[vote]++;
            }
        }

        let totalVotes = 0;
        for (const option in resultsSummary) {
            resultMessage += `*${option}*: ${resultsSummary[option]} suara\n`;
            totalVotes += resultsSummary[option];
        }
        resultMessage += `--------------------\nTotal suara masuk: ${totalVotes}\n`;
        resultMessage += `Partisipan yang sudah vote: ${voteState.votedParticipants.length}\n`;
    }

    resultMessage += `\n--- Status Partisipasi ---\n`;
    const allExpectedVotersJids = voteState.votedMessageRecipients;
    const votedJids = voteState.votedParticipants;

    const hasVoted = [];
    const hasNotVoted = [];
    const mentions = [];

    for (const jid of allExpectedVotersJids) {
        const number = jid.split('@')[0];
        if (EXCLUDED_NUMBERS.includes(number)) continue;

        mentions.push(jid);
        if (votedJids.includes(jid)) {
            hasVoted.push(`@${number}`);
        } else {
            hasNotVoted.push(`@${number}`);
        }
    }

    resultMessage += `\n✅ *Sudah Mengisi (${hasVoted.length}):*\n${hasVoted.length > 0 ? hasVoted.join(' ') : 'Belum ada.'}\n`;
    resultMessage += `\n❌ *Belum Mengisi (${hasNotVoted.length}):*\n${hasNotVoted.length > 0 ? hasNotVoted.join(' ') : 'Semua sudah mengisi!'}\n`;

    if (!isFinal) {
        resultMessage += `\n_Pesan ini akan terus diperbarui secara otomatis._`;
    }

    return { content: resultMessage, mentions: mentions };
}


async function updateResultsMessageForGroup(groupId, client, EXCLUDED_NUMBERS) {
    const voteState = getGroupVoteState(groupId);
    if (!voteState.resultsMessageId || !voteState.groupId) return;
    try {
        const message = await client.getMessageById(voteState.resultsMessageId);
        if (message) {
            const { content, mentions } = buildResultsMessage(voteState, false, EXCLUDED_NUMBERS);
            await message.edit(content, { mentions });
        }
    } catch (e) {
        console.error(`Gagal update pesan hasil untuk grup ${groupId}:`, e);
    }
}

async function processPendingVotes(client, EXCLUDED_NUMBERS) {
    console.log('Memproses pesan voting tertunda...');
    let totalVotesProcessed = 0;
    for (const groupId in ALL_GROUP_VOTES) {
        const voteState = ALL_GROUP_VOTES[groupId];
        if (voteState.isActive) {
            const unvoted = voteState.votedMessageRecipients.filter(
                pId => !voteState.votedParticipants.includes(pId) && !EXCLUDED_NUMBERS.includes(pId.split('@')[0])
            );

            for (const participantId of unvoted) {
                try {
                    const chat = await client.getChatById(participantId);
                    const messages = await chat.fetchMessages({ limit: 15 });
                    messages.reverse();
                    for (const msg of messages) {
                         if (msg.from === participantId && (msg.timestamp * 1000) >= voteState.startTime && !msg.fromMe && !msg.body.startsWith('.')) {
                            const normalizedMessageBody = msg.body.trim().toLowerCase();
                            let chosenOptionText = null;

                            if (voteState.optionMap[normalizedMessageBody]) {
                                chosenOptionText = voteState.optionMap[normalizedMessageBody];
                            } else {
                                chosenOptionText = voteState.options.find(opt => opt.toLowerCase() === normalizedMessageBody);
                            }

                            if (chosenOptionText && !voteState.votedParticipants.includes(participantId)) {
                                voteState.results[participantId] = chosenOptionText;
                                voteState.votedParticipants.push(participantId);
                                totalVotesProcessed++;
                                console.log(`[REPLAY VOTE] Suara dari ${participantId.split('@')[0]} dicatat: ${chosenOptionText}`);
                                saveAllGroupVotes();
                                await client.sendMessage(participantId, `Terima kasih! Suaramu untuk "*${voteState.title}*" (${chosenOptionText}) telah tercatat saat bot offline.`);
                                break;
                            }
                        }
                    }
                } catch (e) {
                    console.error(`Gagal proses pesan tertunda dari ${participantId.split('@')[0]}:`, e.message);
                }
            }
            if(totalVotesProcessed > 0){
                 await updateResultsMessageForGroup(groupId, client, EXCLUDED_NUMBERS);
            }
        }
    }
    console.log(`Pemrosesan pesan voting tertunda selesai. Total suara diproses: ${totalVotesProcessed}.`);
}

module.exports = {
    MEMBER_DATA_DIR, VOTE_DATA_DIR, VOTE_DATA_FILE, ALL_GROUP_VOTES,
    ensureDirectory, saveMembersData, loadMembersData, saveAllGroupVotes,
    loadAllGroupVotes, getGroupVoteState, stopReminderIntervalForGroup,
    startReminderIntervalForGroup, buildResultsMessage, updateResultsMessageForGroup,
    processPendingVotes
};