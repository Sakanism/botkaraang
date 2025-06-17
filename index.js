// index.js
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const fs = require('fs');
const path = require('path');
const { Collection } = require('@discordjs/collection'); // Opsional tapi bagus

// Impor helper dan state
const {
    ALL_GROUP_VOTES, loadAllGroupVotes, saveAllGroupVotes, getGroupVoteState,
    updateResultsMessageForGroup, processPendingVotes, ensureDirectory,
    MEMBER_DATA_DIR, VOTE_DATA_DIR
} = require('./helpers.js');

// --- KONFIGURASI PENTING ---
const EXCLUDED_NUMBERS = [
    '6282254997880', '6282254849136', '6285250885666',
    '6285250224104', '628984609074',
];
const BOT_ADMINS = ['6285651443577'];
const CMD_PREFIX = '.';

// Inisialisasi client WhatsApp
const client = new Client({
    authStrategy: new LocalAuth(),
    ffmpegPath: 'C:/ffmpeg/bin/ffmpeg.exe',
    puppeteer: {
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
    }
});

// Membuat koleksi untuk menyimpan semua perintah
client.commands = new Collection();
const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));

for (const file of commandFiles) {
    const filePath = path.join(commandsPath, file);
    const command = require(filePath);
    if (command.name) {
        client.commands.set(command.name, command);
        console.log(`[CMD LOAD] Perintah '${command.name}' berhasil dimuat.`);
    } else {
        console.log(`[CMD WARN] File '${file}' tidak memiliki 'name'.`);
    }
}

// --- EVENTS BOT ---
client.on('qr', qr => {
    qrcode.generate(qr, { small: true });
});

client.on('ready', async () => {
    console.log('Client is ready!');
    ensureDirectory(MEMBER_DATA_DIR);
    ensureDirectory(VOTE_DATA_DIR);

    Object.assign(ALL_GROUP_VOTES, loadAllGroupVotes());
    await processPendingVotes(client, EXCLUDED_NUMBERS);

    for (const adminNumber of BOT_ADMINS) {
        try {
            await client.sendMessage(`${adminNumber}@c.us`, 'Bot telah aktif dan siap digunakan!');
        } catch (e) {
            console.error(`Gagal mengirim notifikasi ke admin ${adminNumber}:`, e);
        }
    }
});

client.on('message', async msg => {
    const chat = await msg.getChat();
    const messageBody = msg.body.trim();
    if (!messageBody || msg.from === 'status@broadcast') return;

    const senderId = msg.author || msg.from;
    const senderNumber = senderId.split('@')[0];
    const isSenderBotAdmin = BOT_ADMINS.includes(senderNumber);

    // Penanganan Perintah
    if (messageBody.startsWith(CMD_PREFIX)) {
        const args = messageBody.slice(CMD_PREFIX.length).trim().split(/ +/);
        const commandName = args.shift().toLowerCase();
        const command = client.commands.get(commandName);

        if (!command) return;

        if (command.adminOnly && !isSenderBotAdmin) return msg.reply('Perintah ini hanya untuk admin bot.');
        if (command.groupOnly && !chat.isGroup) return msg.reply('Perintah ini hanya bisa digunakan di dalam grup.');

        try {
            const currentGroupVoteState = chat.isGroup ? getGroupVoteState(chat.id._serialized) : null;
            await command.execute({ client, msg, args, currentGroupVoteState, isSenderBotAdmin, EXCLUDED_NUMBERS, BOT_ADMINS });
        } catch (error) {
            console.error(`Error saat menjalankan '${commandName}':`, error);
            await msg.reply('Terjadi kesalahan saat menjalankan perintah.');
        }
        return;
    }

    // Penanganan Balasan Voting
    if (!chat.isGroup && !msg.fromMe) {
        if (EXCLUDED_NUMBERS.includes(senderNumber)) return;
        
        let targetVoteState = null;
        let targetGroupId = null;

        for (const groupId in ALL_GROUP_VOTES) {
            const voteState = ALL_GROUP_VOTES[groupId];
            if (voteState.isActive && voteState.votedMessageRecipients.includes(senderId) && !voteState.votedParticipants.includes(senderId)) {
                targetVoteState = voteState;
                targetGroupId = groupId;
                break;
            }
        }

        if (targetVoteState) {
            const lowerCaseMessageBody = msg.body.trim().toLowerCase();
            let chosenOptionText = null;
            if (targetVoteState.optionMap[lowerCaseMessageBody]) {
                chosenOptionText = targetVoteState.optionMap[lowerCaseMessageBody];
            } else {
                chosenOptionText = targetVoteState.options.find(opt => opt.toLowerCase() === lowerCaseMessageBody);
            }

            if (chosenOptionText) {
                targetVoteState.results[senderId] = chosenOptionText;
                targetVoteState.votedParticipants.push(senderId);

                const senderContact = await msg.getContact();
                const senderDisplayName = senderContact.pushname || senderContact.name || senderNumber;
                
                await msg.reply(`Terima kasih, ${senderDisplayName}! Pilihanmu: *${chosenOptionText}*`);
                console.log(`Voting dari ${senderDisplayName} tercatat: ${chosenOptionText}`);

                await updateResultsMessageForGroup(targetGroupId, client, EXCLUDED_NUMBERS);
                saveAllGroupVotes();
            } else {
                let errorMessage = `Pilihan "${msg.body.trim()}" tidak valid.\n`;
                targetVoteState.options.forEach((opt, index) => {
                    errorMessage += `${index + 1}. *${opt}*\n`;
                });
                await msg.reply(errorMessage);
            }
        }
    }
});

client.initialize();