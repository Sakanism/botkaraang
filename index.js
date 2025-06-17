// index.js

const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const fs = require('fs'); // <--- PASTIKAN BARIS INI ADA ATAU TAMBAHKAN
const path = require('path');
// ... require lainnya
const Jimp = require('jimp');
const axios = require('axios'); 

// --- KONFIGURASI PENTING ---
const EXCLUDED_NUMBERS = [
    // Contoh: '6281234567890', 
    '6282254997880',
    '6282254849136',
    '6285250885666',
    '6285250224104',
    '628984609074',
];

// Nomor WhatsApp admin bot
const BOT_ADMINS = ['6285651443577']; 

// Path untuk folder penyimpanan data anggota grup
const MEMBER_DATA_DIR = path.join(__dirname, 'member_data');
// Path untuk folder penyimpanan data voting
const VOTE_DATA_DIR = path.join(__dirname, 'vote_data');
const VOTE_DATA_FILE = path.join(VOTE_DATA_DIR, 'all_group_votes.json');


// Inisialisasi client WhatsApp
const client = new Client({
    authStrategy: new LocalAuth(),
    ffmpegPath: 'C:/ffmpeg/bin/ffmpeg.exe', // Memberitahu wwebjs untuk menggunakan ffmpeg dari system path
    puppeteer: {
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
    }
});

// --- VARIABEL GLOBAL UNTUK STATUS VOTING BERBAGAI GRUP ---
let ALL_GROUP_VOTES = {}; 

// --- FUNGSI PEMBANTU ---

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

// FUNGSI UNTUK MENGHINDARI CIRCULAR REFERENCE DAN MENYIMPAN DATA (DIPERBAIKI)
function saveAllGroupVotes() {
    ensureDirectory(VOTE_DATA_DIR);
    
    const cleanData = {};
    for (const groupId in ALL_GROUP_VOTES) {
        const voteState = { ...ALL_GROUP_VOTES[groupId] }; // Membuat salinan dangkal
        // Hapus properti yang tidak bisa di-serialize (circular reference)
        if (voteState.reminderInterval) {
            delete voteState.reminderInterval;
        }
        cleanData[groupId] = voteState;
    }

    fs.writeFileSync(VOTE_DATA_FILE, JSON.stringify(cleanData, null, 2), 'utf-8');
    console.log(`Data voting disimpan ke ${VOTE_DATA_FILE}`);
}

// FUNGSI BARU: Muat semua data voting dari file
function loadAllGroupVotes() {
    ensureDirectory(VOTE_DATA_DIR);
    if (fs.existsSync(VOTE_DATA_FILE)) {
        try {
            const data = fs.readFileSync(VOTE_DATA_FILE, 'utf-8');
            ALL_GROUP_VOTES = JSON.parse(data);
            // Re-initialize reminder intervals for active votes
            for (const groupId in ALL_GROUP_VOTES) {
                const voteState = ALL_GROUP_VOTES[groupId];
                if (voteState.isActive && voteState.reminderTime > 0) {
                    startReminderIntervalForGroup(groupId);
                }
            }
            console.log(`Data voting berhasil dimuat dari ${VOTE_DATA_FILE}.`);
        } catch (e) {
            console.error(`Gagal memuat data voting dari ${VOTE_DATA_FILE}:`, e);
            ALL_GROUP_VOTES = {}; // Reset jika ada error
        }
    } else {
        console.log(`File data voting (${VOTE_DATA_FILE}) tidak ditemukan. Memulai dengan data kosong.`);
        ALL_GROUP_VOTES = {};
    }
}

// Fungsi untuk mendapatkan status voting grup
function getGroupVoteState(groupId) {
    if (!ALL_GROUP_VOTES[groupId]) {
        // Inisialisasi jika belum ada
        ALL_GROUP_VOTES[groupId] = {
            isActive: false,
            title: '',
            options: [], 
            optionMap: {}, 
            results: {}, 
            votedParticipants: [], 
            resultsMessageId: null, 
            groupId: groupId, 
            votedMessageRecipients: [], 
            reminderInterval: null, 
            reminderTime: 0, 
            lastReminderSent: {},
            // Tambahkan timestamp saat voting dimulai
            startTime: 0 
        };
        saveAllGroupVotes(); // Simpan perubahan saat inisialisasi baru
    }
    return ALL_GROUP_VOTES[groupId];
}

// Fungsi untuk menghentikan interval pengingat untuk grup tertentu
function stopReminderIntervalForGroup(groupId) {
    const voteState = getGroupVoteState(groupId);
    if (voteState.reminderInterval) {
        clearInterval(voteState.reminderInterval);
        voteState.reminderInterval = null;
        console.log(`Interval pengingat voting untuk grup ${groupId} dihentikan.`);
    }
}

// Fungsi untuk memulai interval pengingat untuk grup tertentu
function startReminderIntervalForGroup(groupId) {
    const voteState = getGroupVoteState(groupId); 
    stopReminderIntervalForGroup(groupId); 
    if (voteState.isActive && voteState.reminderTime > 0) {
        // Clear previous interval if any
        if (voteState.reminderInterval) clearInterval(voteState.reminderState); 
        voteState.reminderInterval = setInterval(() => sendReminderToUnvotedParticipants(groupId), voteState.reminderTime * 1000);
        console.log(`Pengingat voting untuk grup ${groupId} diaktifkan, akan dikirim setiap ${voteState.reminderTime} detik.`);
    }
}

// Fungsi untuk mengirim pengingat ke peserta yang belum vote di grup tertentu
async function sendReminderToUnvotedParticipants(groupId) {
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

function buildResultsMessage(voteState, isFinal = false) {
    let resultMessage = `--- Hasil Voting ${isFinal ? 'Akhir' : 'Saat Ini'}: *${voteState.title || 'Belum Ada Voting'}* ---\n`;
    
    // Bagian Hasil Vote
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
            } else {
                resultsSummary[vote] = (resultsSummary[vote] || 0) + 1; 
            }
        }

        let totalVotes = 0;
        for (const option in resultsSummary) {
            resultMessage += `*${option}*: ${resultsSummary[option]} suara\n`; 
            totalVotes += resultsSummary[option];
        }
        resultMessage += `--------------------\n`;
        resultMessage += `Total suara masuk: ${totalVotes}\n`;
        resultMessage += `Jumlah partisipan yang sudah vote: ${voteState.votedParticipants.length}\n`;
    }

    // Bagian Status Partisipasi (Sudah & Belum Mengisi)
    resultMessage += `\n--- Status Partisipasi ---\n`;
    const allExpectedVotersJids = voteState.votedMessageRecipients; 
    const votedJids = voteState.votedParticipants; 

    const hasVoted = [];
    const hasNotVoted = [];
    const mentions = []; 

    for (const jid of allExpectedVotersJids) {
        const number = jid.split('@')[0];
        if (EXCLUDED_NUMBERS.includes(number)) {
            continue; 
        }

        mentions.push(jid); 

        if (votedJids.includes(jid)) {
            hasVoted.push(`@${number}`); 
        } else {
            hasNotVoted.push(`@${number}`); 
        }
    }

    if (hasVoted.length > 0) {
        resultMessage += `\n✅ *Sudah Mengisi (${hasVoted.length}):*\n${hasVoted.join(' ')}\n`;
    } else {
        resultMessage += `\n✅ *Sudah Mengisi (0):* Belum ada yang mengisi.\n`;
    }

    if (hasNotVoted.length > 0) {
        resultMessage += `\n❌ *Belum Mengisi (${hasNotVoted.length}):*\n${hasNotVoted.join(' ')}\n`;
    } else {
        resultMessage += `\n❌ *Belum Mengisi (0):* Semua sudah mengisi!\n`;
    }
    
    if (!isFinal) { // Hanya tambahkan baris ini jika bukan pesan final
        resultMessage += `\n_Pesan ini akan terus diperbarui secara otomatis._`; 
    }

    return {
        content: resultMessage,
        mentions: mentions 
    };
}


// Fungsi untuk memperbarui pesan hasil voting di grup tertentu
async function updateResultsMessageForGroup(groupId) {
    const voteState = getGroupVoteState(groupId);
    if (voteState.resultsMessageId && voteState.groupId) {
        try {
            const groupChat = await client.getChatById(voteState.groupId);
            if (groupChat) {
                const message = await client.getMessageById(voteState.resultsMessageId);
                if (message) {
                    const { content: newContent, mentions: newMentions } = buildResultsMessage(voteState); 
                    await message.edit(newContent, { mentions: newMentions }); 
                    console.log(`Pesan hasil voting untuk grup ${groupId} berhasil diperbarui beserta mention.`);
                } else {
                    console.warn(`Pesan hasil voting untuk grup ${groupId} tidak ditemukan untuk diedit.`);
                }
            } else {
                    console.warn(`Chat grup ${groupId} tidak ditemukan untuk memperbarui pesan hasil voting.`);
            }
        } catch (e) {
            console.error(`Gagal memperbarui pesan hasil voting untuk grup ${groupId}:`, e);
            if (e.message.includes('Evaluation failed')) {
                console.error('Kemungkinan masalah format mentions. Cek kembali JID di `buildResultsMessage`');
            }
        }
    }
}

// FUNGSI BARU: Proses pesan-pesan tertunda saat bot kembali online
async function processPendingVotes() {
    console.log('Memulai pemrosesan pesan voting tertunda...');
    let totalVotesProcessed = 0;

    for (const groupId in ALL_GROUP_VOTES) {
        const voteState = ALL_GROUP_VOTES[groupId];
        if (voteState.isActive) {
            console.log(`Mengecek voting aktif untuk grup ${groupId}: "${voteState.title}"`);
            let groupVotesProcessed = 0;
            const unvotedParticipantsForThisGroup = voteState.votedMessageRecipients.filter(
                participantId => !voteState.votedParticipants.includes(participantId) &&
                                !EXCLUDED_NUMBERS.includes(participantId.split('@')[0]) 
            );

            for (const participantId of unvotedParticipantsForThisGroup) {
                try {
                    const chat = await client.getChatById(participantId); // Mengambil chat pribadi partisipan
                    // Batasi untuk mengambil 15 pesan terakhir saja per chat pribadi untuk efisiensi
                    const messages = await chat.fetchMessages({ limit: 15 }); 
                    messages.reverse(); // Proses pesan terlama terlebih dahulu

                    for (const msg of messages) {
                        // Pastikan pesan datang dari partisipan dan setelah voting dimulai
                        // Dan bukan pesan dari bot itu sendiri, serta bukan perintah bot
                        if (msg.from === participantId && (msg.timestamp * 1000) >= voteState.startTime && !msg.fromMe && !msg.body.startsWith('.')) {
                            const normalizedMessageBody = msg.body.trim().toLowerCase();
                            let chosenOptionText = null;

                            if (voteState.optionMap.hasOwnProperty(normalizedMessageBody)) {
                                chosenOptionText = voteState.optionMap[normalizedMessageBody];
                            } else {
                                chosenOptionText = voteState.options.find(opt => opt.toLowerCase() === normalizedMessageBody);
                            }

                            if (chosenOptionText) {
                                // Pastikan partisipan belum vote sebelumnya (handle potensi duplikasi kecil)
                                if (!voteState.votedParticipants.includes(participantId)) {
                                    voteState.results[participantId] = chosenOptionText; 
                                    voteState.votedParticipants.push(participantId);
                                    groupVotesProcessed++;
                                    totalVotesProcessed++;
                                    console.log(`[REPLAY VOTE] Suara tertunda dari ${participantId.split('@')[0]} untuk "${voteState.title}" dicatat: ${chosenOptionText}`);
                                    saveAllGroupVotes(); // Simpan setelah setiap suara diproses
                                    
                                    // KIRIM RESPON TERIMA KASIH SAAT BOT MENEMUKAN JAWABAN VOTE TERTUNDA
                                    try {
                                        const contact = await client.getContactById(participantId);
                                        const displayName = contact.pushname || contact.name || participantId.split('@')[0];
                                        await client.sendMessage(participantId, `Terima kasih, ${displayName}! Suaramu untuk voting "*${voteState.title}*" (${chosenOptionText}) telah tercatat saat bot offline.`);
                                        console.log(`Respon terima kasih untuk vote tertunda terkirim ke ${participantId.split('@')[0]}`);
                                    } catch (sendError) {
                                        console.error(`Gagal mengirim respon terima kasih ke ${participantId.split('@')[0]} untuk vote tertunda:`, sendError);
                                    }
                                }
                                break; // Berhenti memproses pesan untuk partisipan ini setelah suara ditemukan
                            }
                        }
                    }
                } catch (e) {
                    console.error(`Gagal memproses pesan tertunda dari ${participantId.split('@')[0]} untuk grup ${groupId}:`, e.message);
                }
            }
            if (groupVotesProcessed > 0) {
                console.log(`Ditemukan dan diproses ${groupVotesProcessed} suara tertunda untuk voting "${voteState.title}" di grup ${groupId}.`);
                await updateResultsMessageForGroup(groupId); // Perbarui pesan hasil di grup
            } else {
                console.log(`Tidak ada suara tertunda baru ditemukan untuk voting "${voteState.title}" di grup ${groupId}.`);
            }
        }
    }
    console.log(`Pemrosesan pesan voting tertunda selesai. Total suara diproses: ${totalVotesProcessed}.`);
}


// --- EVENTS BOT ---

client.on('qr', qr => {
    qrcode.generate(qr, { small: true });
    console.log('Scan QR Code ini menggunakan aplikasi WhatsApp di ponselmu (Fitur Perangkat Tertaut).');
});

client.on('ready', async () => {
    console.log('Client is ready! Bot WhatsApp Anda telah aktif.');
    ensureDirectory(MEMBER_DATA_DIR); // Pastikan folder member_data ada
    ensureDirectory(VOTE_DATA_DIR); // Pastikan folder vote_data ada

    loadAllGroupVotes(); // Muat data voting saat bot aktif

    // Proses pesan tertunda setelah bot siap dan data voting dimuat
    await processPendingVotes();

    for (const adminNumber of BOT_ADMINS) {
        try {
            await client.sendMessage(adminNumber + '@c.us', 'Bot WhatsApp Anda telah berhasil aktif dan siap digunakan!');
            console.log(`Notifikasi bot aktif terkirim ke admin: ${adminNumber}`);
        } catch (e) {
            console.error(`Gagal mengirim notifikasi ke admin ${adminNumber}:`, e);
        }
    }
});

client.on('message', async msg => {
    const chat = await msg.getChat();
    const messageBody = msg.body.trim();
    const senderId = msg.author || msg.from; 
    const senderNumber = senderId.split('@')[0];
    
    let senderNameForLog = senderNumber;
    try {
        const senderContact = await msg.getContact();
        senderNameForLog = senderContact.pushname || senderContact.name || senderNumber; 
    } catch (e) {
        // Abaikan error
    }
    console.log(`[LOG PESAN] Dari: ${senderNameForLog} (${senderId}) | Chat: ${chat.name || chat.id._serialized} | Pesan: "${messageBody}"`);

    const isSenderBotAdmin = BOT_ADMINS.includes(senderNumber);

    // --- Ubah messageBody menjadi lowercase untuk perbandingan perintah ---
    const lowerCaseMessageBody = messageBody.toLowerCase();

    // Dapatkan status voting spesifik untuk grup ini
    const currentGroupId = chat.isGroup ? chat.id._serialized : null;
    const currentGroupVoteState = currentGroupId ? getGroupVoteState(currentGroupId) : null;

// --- Perintah .ss untuk Sticker Search via API ---
    if (lowerCaseMessageBody.startsWith('.ss ')) {
        const query = messageBody.substring('.ss '.length).trim();
        if (!query) {
            return msg.reply('Silakan masukkan teks untuk dicari. Contoh: `.ss spongebob`');
        }

        msg.reply(`Mencari stiker untuk "*${query}*"...`);

        try {
            const apiUrl = 'https://api.botcahx.eu.org/api/search/sticker';
            const apiKey = 'sakaa';

            const encodedQuery = encodeURIComponent(query);
            const searchUrl = `${apiUrl}?text1=${encodedQuery}&apikey=${apiKey}`;

            console.log(`[DEBUG] Mencari stiker dengan URL: ${searchUrl}`);
            
            const searchResponse = await axios.get(searchUrl);

            if (searchResponse.data.result && searchResponse.data.result.sticker_url && searchResponse.data.result.sticker_url.length > 0) {
                
                // --- PERUBAHAN: Mengambil maksimal 10 stiker, bukan satu acak ---
                const allStickerUrls = searchResponse.data.result.sticker_url;
                const stickersToSend = allStickerUrls.slice(0, 10); // Ambil 10 item pertama
                
                const totalFound = allStickerUrls.length;
                const countToSend = stickersToSend.length;

                await msg.reply(`Ditemukan total ${totalFound} stiker. Mengirim ${countToSend} stiker teratas...`);

                // --- PERUBAHAN: Melakukan perulangan untuk mengirim stiker satu per satu ---
                for (const stickerUrl of stickersToSend) {
                    try {
                        console.log(`[DEBUG] Mengunduh stiker dari: ${stickerUrl}`);
                        const stickerResponse = await axios.get(stickerUrl, {
                            responseType: 'arraybuffer'
                        });

                        const imageBuffer = Buffer.from(stickerResponse.data, 'binary');
                        const media = new MessageMedia('image/jpeg', imageBuffer.toString('base64'));

                        // Mengirim stiker ke chat asal
                        await client.sendMessage(msg.from, media, {
                            sendMediaAsSticker: true
                        });
                        
                        // Beri jeda sedikit antar kiriman untuk menghindari spam yang terlalu cepat
                        await new Promise(resolve => setTimeout(resolve, 500)); // Jeda 0.5 detik

                    } catch (loopError) {
                        console.error(`Gagal mengunduh atau mengirim stiker dari URL: ${stickerUrl}`, loopError.message);
                        // Jika satu stiker gagal, kirim pesan error tapi lanjutkan ke stiker berikutnya (opsional)
                        // await msg.reply(`Gagal memproses salah satu stiker.`); 
                    }
                }

                console.log(`[DEBUG] Selesai mengirim ${countToSend} stiker.`);

            } else {
                msg.reply(`Maaf, stiker untuk "*${query}*" tidak ditemukan.`);
            }

        } catch (error) {
            console.error('Gagal saat mencari stiker via API:', error.message);
            msg.reply('Maaf, terjadi kesalahan saat menghubungi API pencarian stiker.');
        }
        return;
    }

// --- Perintah .tt untuk TikTok Downloader ---
    if (lowerCaseMessageBody.startsWith('.tt ')) {
        const url = messageBody.substring('.tt '.length).trim();

        if (!url.includes('tiktok.com')) {
            return msg.reply('Format salah. Silakan masukkan link video TikTok yang valid.\nContoh: `.tt https://vt.tiktok.com/ZSYA4BcdE/`');
        }

        msg.reply('Memproses link TikTok, mohon tunggu...');

        const tempDir = path.join(__dirname, 'temp_media');
        ensureDirectory(tempDir); // Memastikan folder 'temp_media' ada
        const tempFilePath = path.join(tempDir, `tiktok_${Date.now()}.mp4`);

        try {
            const apiUrl = 'https://api.botcahx.eu.org/api/dowloader/tiktok';
            const apiKey = 'sakaa';
            const requestUrl = `${apiUrl}?url=${encodeURIComponent(url)}&apikey=${apiKey}`;

            console.log(`[DEBUG] Memanggil API TikTok untuk link asli: ${url}`);
            
            const response = await axios.get(requestUrl, {
                headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36' }
            });
            
            const data = response.data;

            if (data && data.status && data.result) {
                const result = data.result;
                let downloadUrl = null;

                if (result.video && Array.isArray(result.video) && result.video.length > 0) {
                    downloadUrl = result.video[0];
                }

                if (downloadUrl) {
                    const videoTitle = result.title || 'Video TikTok';
                    await msg.reply(`Berhasil menemukan video: *${videoTitle}*.\n\nMengunduh video...`);

                    const fileResponse = await axios.get(downloadUrl, { responseType: 'arraybuffer' });
                    const fileBuffer = Buffer.from(fileResponse.data);
                    
                    console.log(`[DEBUG] Download selesai. Ukuran file: ${fileBuffer.length} bytes.`);
                    
                    // --- PERBAIKAN UTAMA: Simpan file ke disk dulu ---
                    fs.writeFileSync(tempFilePath, fileBuffer);
                    console.log(`[DEBUG] File disimpan sementara di: ${tempFilePath}`);
                    
                    // Buat MessageMedia dari path file, bukan dari buffer
                    const media = MessageMedia.fromFilePath(tempFilePath);
                    
                    await client.sendMessage(msg.from, media, { caption: videoTitle });
                    console.log('[DEBUG] Pengiriman media berhasil.');

                } else {
                    await msg.reply('Maaf, tidak ditemukan link download video dari respons API.');
                }

            } else {
                await msg.reply('Gagal mendapatkan informasi dari link TikTok tersebut.');
            }

        } catch (error) {
            console.error('Gagal saat proses download TikTok:', error);
            msg.reply('Maaf, terjadi kesalahan. Periksa terminal untuk detail error.');
        } finally {
            // --- PENTING: Selalu hapus file sementara setelah selesai ---
            if (fs.existsSync(tempFilePath)) {
                fs.unlinkSync(tempFilePath);
                console.log(`[DEBUG] File sementara dihapus: ${tempFilePath}`);
            }
        }
        return;
    }
    
  // --- Perintah .brat via API ---
    if (lowerCaseMessageBody.startsWith('.brat')) {
        msg.reply('Membuat stiker via API, mohon tunggu...');

        try {
            let stickerText = messageBody.substring('.brat'.length).trim();
            if (!stickerText) {
                stickerText = 'brat';
            }

            // --- Konfigurasi API ---
            const apiUrl = 'https://api.botcahx.eu.org/api/maker/brat';
            const apiKey = 'sakaa'; // API Key dari contoh Anda

            // Encode teks agar aman digunakan di URL (menangani spasi & simbol)
            const encodedText = encodeURIComponent(stickerText);
            const fullUrl = `${apiUrl}?text=${encodedText}&apikey=${apiKey}`;

            console.log(`[DEBUG] Memanggil API: ${fullUrl}`);

            // Panggil API menggunakan axios, minta respons sebagai data biner (arraybuffer)
            const response = await axios.get(fullUrl, {
                responseType: 'arraybuffer'
            });

            // Ubah data biner yang diterima menjadi stiker
            const imageBuffer = Buffer.from(response.data, 'binary');
            const media = new MessageMedia('image/jpeg', imageBuffer.toString('base64'));

            await client.sendMessage(msg.from, media, {
                sendMediaAsSticker: true,
                stickerName: 'Brat API',
                stickerAuthor: 'botcahx'
            });

        } catch (error) {
            console.error('Gagal membuat stiker via API:', error.message);
            msg.reply('Maaf, terjadi kesalahan saat menghubungi API. Mungkin API sedang down atau teks tidak valid.');
        }
        return;
    }
    // --- Perintah .menu ---
    if (lowerCaseMessageBody === '.menu') {
        let menuMessage = `*🤖 Menu Perintah Bot 🤖*\n\n`;
        menuMessage += `Berikut adalah perintah yang bisa Anda gunakan:\n\n`;

        // Perintah untuk Admin
        if (isSenderBotAdmin) {
            menuMessage += `*--- Perintah Admin ---*\n`;
            menuMessage += `\`\`\`.anggota\`\`\`\n  - Memperbarui daftar anggota grup (digunakan sebelum voting/info).\n`;
            menuMessage += `\`\`\`.mulai <judul>, <opsi1>, <opsi2>, ...\`\`\`\n  - Memulai voting baru di grup ini.\n`;
            menuMessage += `\`\`\`.hasil\`\`\`\n  - Menampilkan hasil voting saat ini di grup ini.\n`;
            menuMessage += `\`\`\`.stop\`\`\`\n  - Menghentikan voting yang sedang berjalan di grup ini dan menampilkan hasil akhir.\n`;
            menuMessage += `\`\`\`.notif <detik>\`\`\`\n  - Mengatur interval pengingat voting otomatis (dalam detik) untuk grup ini. Setel \`0\` untuk nonaktifkan.\n`;
            menuMessage += `\`\`\`.info <pesan_anda>\`\`\`\n  - Mengirim pesan penting ke semua anggota grup secara pribadi (hidetag).\n`;
        } else {
            menuMessage += `_Anda bukan admin bot. Beberapa perintah hanya tersedia untuk admin._\n`;
        }

        // Perintah untuk Semua Pengguna
        menuMessage += `\n*--- Perintah Umum ---*\n`;
        menuMessage += `\`\`\`.brat <teks_opsional>\`\`\`\n  - Membuat stiker "brat" dengan teks Anda.\n`;
        menuMessage += `_Saat voting aktif, Anda bisa langsung membalas pesan voting dari bot di chat pribadi Anda untuk memberikan suara._\n`;

        msg.reply(menuMessage);
        return; 
    }


    // --- Perintah .anggota ---
    if (lowerCaseMessageBody === '.anggota' && isSenderBotAdmin) {
        if (!chat.isGroup) {
            msg.reply('Perintah `.anggota` hanya bisa digunakan di dalam grup.');
            return;
        }

        try {
            const groupParticipants = chat.participants; 
            if (!groupParticipants || groupParticipants.length === 0) {
                msg.reply('Gagal mendapatkan daftar anggota grup atau grup tidak memiliki anggota. Pastikan bot adalah anggota dan admin grup.');
                return;
            }

            const membersInfo = [];
            const membersNumbers = [];
            for (const participant of groupParticipants) {
                const participantNumber = participant.id.user;
                const participantId = participant.id._serialized;

                let memberName = participantNumber;
                try {
                    const contact = await client.getContactById(participantId);
                    memberName = contact.pushname || contact.name || participantNumber;
                } catch (e) {
                    // console.warn(`Gagal mendapatkan nama kontak untuk ${participantNumber}:`, e.message);
                }
                
                membersInfo.push(`${memberName} (${participantNumber})`);
                membersNumbers.push(participantNumber);
            }

            saveMembersData(chat.id._serialized, membersNumbers);

            let replyMessage = `*Daftar Anggota Grup "${chat.name}" (${membersInfo.length} orang):*\n\n`;
            replyMessage += membersInfo.join('\n');
            replyMessage += `\n\nData anggota telah disimpan di folder 'member_data' dengan nama file ${chat.id._serialized}.json`;
            
            msg.reply(replyMessage);

            for (const adminNum of BOT_ADMINS) {
                if (adminNum !== senderNumber) { 
                    await client.sendMessage(adminNum + '@c.us', `Berikut daftar anggota grup "${chat.name}":\n\n${membersInfo.join('\n')}\n\nData disimpan di server.`);
                }
            }

        } catch (e) {
            console.error('Error saat mengambil atau menyimpan data anggota grup:', e);
            msg.reply('Terjadi kesalahan saat mencoba mengambil atau menyimpan data anggota grup. Pastikan bot adalah anggota atau admin grup.');
        }
    }

    // --- Perintah .mulai ---
    if (lowerCaseMessageBody.startsWith('.mulai ') && isSenderBotAdmin) {
        if (!chat.isGroup) {
            msg.reply('Perintah `.mulai` hanya bisa digunakan di dalam grup.');
            return;
        }

        if (currentGroupVoteState.isActive) {
            msg.reply('Ada voting yang sedang berlangsung di grup ini. Silakan akhiri dengan `.stop` atau tunggu hingga selesai dengan perintah `.hasil`.');
            return;
        }

        const parts = messageBody.substring('.mulai '.length).split(','); 
        if (parts.length < 3) {
            msg.reply('Format perintah salah. Gunakan: `.mulai <judul_vote>, <opsi_1>, <opsi_2>, ...`\nContoh: `.mulai Rapat, Hadir, Tidak Hadir`');
            return;
        }

        currentGroupVoteState.title = parts[0].trim();
        currentGroupVoteState.options = parts.slice(1).map(opt => opt.trim());
        
        if (currentGroupVoteState.options.some(opt => opt === '')) {
            msg.reply('Opsi voting tidak boleh kosong. Pastikan ada teks di antara setiap koma.');
            return;
        }

        currentGroupVoteState.optionMap = {};
        let optionsListForMessage = '';
        currentGroupVoteState.options.forEach((opt, index) => {
            const num = (index + 1).toString();
            currentGroupVoteState.optionMap[num] = opt;
            optionsListForMessage += `${num}. *${opt}*\n`;
        });

        currentGroupVoteState.isActive = true;
        currentGroupVoteState.results = {};
        currentGroupVoteState.votedParticipants = [];
        currentGroupVoteState.votedMessageRecipients = []; 
        currentGroupVoteState.lastReminderSent = {}; 
        currentGroupVoteState.startTime = Date.now(); // Rekam waktu mulai

        console.log(`Memulai voting di grup ${currentGroupId}: "${currentGroupVoteState.title}" dengan opsi: ${currentGroupVoteState.options.join(', ')}`);
        
        let participantsToMessage = [];
        try {
            const storedMembers = loadMembersData(currentGroupId);

            if (!storedMembers || storedMembers.length === 0) {
                msg.reply('Tidak ada data anggota tersimpan untuk grup ini. Silakan jalankan perintah `.anggota` terlebih dahulu.');
                currentGroupVoteState.isActive = false;
                saveAllGroupVotes(); // Simpan perubahan
                return;
            }

            for (const memberNumber of storedMembers) {
                if (!EXCLUDED_NUMBERS.includes(memberNumber)) {
                    participantsToMessage.push(memberNumber + '@c.us');
                } else {
                    console.log(`Nomor ${memberNumber} dikecualikan dari voting di grup ${currentGroupId}.`);
                }
            }
            console.log(`[DEBUG] Jumlah partisipan yang akan di-chat untuk grup ${currentGroupId}: ${participantsToMessage.length}`);

        } catch (e) {
            console.error(`Gagal memuat atau memproses data anggota untuk voting di grup ${currentGroupId}:`, e);
            msg.reply('Terjadi kesalahan saat memuat data anggota untuk voting. Coba lagi atau jalankan `.anggota` terlebih dahulu.');
            currentGroupVoteState.isActive = false; 
            saveAllGroupVotes(); // Simpan perubahan
            return;
        }

        if (participantsToMessage.length === 0) {
            msg.reply('Tidak ada anggota yang bisa di-chat setelah filter pengecualian atau data anggota kosong.');
            currentGroupVoteState.isActive = false; 
            saveAllGroupVotes(); // Simpan perubahan
            return;
        }

        const firstOptionNumber = currentGroupVoteState.options.length > 0 ? '1' : '';
        const firstOptionText = currentGroupVoteState.options.length > 0 ? currentGroupVoteState.options[0] : 'Opsi Pertama';

        const introMessage = `Halo, yuk berikan suaramu untuk voting ini:\n\n*${currentGroupVoteState.title}*\n\nPilih salah satu opsi di bawah ini dengan membalas pesan ini (ketik *angka* atau *teks* opsi secara persis):\n${optionsListForMessage}\n(Contoh: ketik *${firstOptionNumber}* atau *${firstOptionText}*)`;
        
        let sentCount = 0;
        for (const participantId of participantsToMessage) {
            try {
                currentGroupVoteState.votedMessageRecipients.push(participantId); 
                await client.sendMessage(participantId, introMessage);
                console.log(`Pesan voting pengantar terkirim ke ${participantId} untuk grup ${currentGroupId}`);
                sentCount++;
            }
            catch (e) {
                console.error(`Gagal mengirim pesan pengantar ke ${participantId} untuk grup ${currentGroupId}:`, e);
                console.error(`[DEBUG] Error sending intro message to ${participantId} for group ${currentGroupId}:`, e.message, e.stack);
            }
        }
        
        const { content: initialResultsMessage, mentions: initialMentions } = buildResultsMessage(currentGroupVoteState);
        try {
            const sentResultsMsg = await chat.sendMessage(initialResultsMessage, { mentions: initialMentions });
            currentGroupVoteState.resultsMessageId = sentResultsMsg.id._serialized;
            msg.reply(`Voting "*${currentGroupVoteState.title}*" telah dimulai dan pesan terkirim ke ${sentCount} anggota grup!\nHasil voting akan di-update di pesan terpisah di grup ini.`);
            console.log(`Pesan hasil voting awal untuk grup ${currentGroupId} terkirim dan ID-nya disimpan.`);

            startReminderIntervalForGroup(currentGroupId);
            saveAllGroupVotes(); // Simpan data voting setelah mulai

        } catch (e) {
            console.error(`Gagal mengirim atau menyimpan ID pesan hasil voting untuk grup ${currentGroupId}:`, e);
            msg.reply('Terjadi kesalahan saat memulai voting. Pastikan bot adalah admin grup dan `.anggota` sudah dijalankan.\nDetail error: ' + e.message); 
            currentGroupVoteState.isActive = false;
            stopReminderIntervalForGroup(currentGroupId); 
            saveAllGroupVotes(); // Simpan perubahan
            return;
        }
    }

    // --- Perintah .notif ---
    if (lowerCaseMessageBody.startsWith('.notif ') && isSenderBotAdmin) {
        if (!chat.isGroup) {
            msg.reply('Perintah `.notif` hanya bisa digunakan di dalam grup.');
            return;
        }
        const parts = messageBody.split(' '); 
        if (parts.length === 2) {
            const timeInSeconds = parseInt(parts[1]);
            if (!isNaN(timeInSeconds) && timeInSeconds >= 0) {
                currentGroupVoteState.reminderTime = timeInSeconds;
                if (timeInSeconds === 0) {
                    stopReminderIntervalForGroup(currentGroupId);
                    msg.reply('Pengingat voting telah dinonaktifkan untuk grup ini.');
                    console.log(`Pengingat voting dinonaktifkan untuk grup ${currentGroupId}.`);
                } else {
                    if (currentGroupVoteState.isActive) {
                        startReminderIntervalForGroup(currentGroupId);
                        msg.reply(`Pengingat voting akan dikirim setiap *${timeInSeconds} detik* untuk yang belum vote di grup ini.`);
                    } else {
                        msg.reply(`Interval pengingat diatur ke *${timeInSeconds} detik* untuk grup ini. Ini akan aktif saat voting baru dimulai.`);
                    }
                    console.log(`Interval pengingat untuk grup ${currentGroupId} disetel ke ${timeInSeconds} detik.`);
                }
                saveAllGroupVotes(); // Simpan perubahan
            } else {
                msg.reply('Format salah. Gunakan: `.notif <detik>` (misal: `.notif 60` untuk 60 detik). Gunakan `0` untuk menonaktifkan.');
            }
        } else {
            msg.reply('Format salah. Gunakan: `.notif <detik>` (misal: `.notif 60` untuk 60 detik). Gunakan `0` untuk menonaktifkan.');
        }
    }

    // --- Perintah .info (sebelumnya .hidetag) ---
    if (lowerCaseMessageBody.startsWith('.info') && isSenderBotAdmin) {
        if (!chat.isGroup) {
            msg.reply('Perintah `.info` hanya bisa digunakan di dalam grup.');
            return;
        }

        const infoMessageContent = messageBody.substring('.info '.length).trim(); 
        if (!infoMessageContent) {
            msg.reply('Format salah. Gunakan: `.info <pesan_anda>` (contoh: `.info Ada pengumuman penting!`)');
            return;
        }

        try {
            const storedMembers = loadMembersData(currentGroupId);
            if (!storedMembers || storedMembers.length === 0) {
                msg.reply('Tidak ada data anggota tersimpan untuk grup ini. Silakan jalankan perintah `.anggota` terlebih dahulu.');
                return;
            }

            // Mengirim pesan pengantar ke grup
            await msg.reply(`*Pesan Penting:*\n\n${infoMessageContent}`); 
            console.log(`Pesan pengantar info dikirim ke grup ${currentGroupId}: "${infoMessageContent}"`);

            let sentCount = 0;
            // Mengirim mention secara pribadi ke setiap anggota
            for (const memberNumber of storedMembers) {
                if (!EXCLUDED_NUMBERS.includes(memberNumber)) {
                    try {
                        const contact = await client.getContactById(memberNumber + '@c.us');
                        const displayName = contact.pushname || contact.name || memberNumber;
                        await client.sendMessage(memberNumber + '@c.us', `Halo *${displayName}*, ada pesan penting di grup *${chat.name}*:\n\n*${infoMessageContent}*`);
                        sentCount++;
                    } catch (e) {
                        console.error(`Gagal mengirim info mention ke ${memberNumber} untuk grup ${currentGroupId}:`, e);
                    }
                }
            }
            msg.reply(`Pesan info telah dikirim ke *${sentCount}* anggota secara pribadi dari grup ini.`);
            console.log(`Info mention pribadi terkirim ke ${sentCount} anggota dari grup ${currentGroupId}.`);

        } catch (e) {
            console.error(`Error saat menjalankan perintah .info di grup ${currentGroupId}:`, e);
            msg.reply('Terjadi kesalahan saat mencoba mengirim pesan info. Pastikan bot adalah anggota atau admin grup.');
        }
    }


    // --- Memproses balasan voting (hanya jika pesan datang dari chat pribadi) ---
    if (!msg.fromMe && !chat.isGroup && !lowerCaseMessageBody.startsWith('.')) { 
        const actualSenderId = senderId; 
        const actualSenderNumber = actualSenderId.split('@')[0];
        const normalizedMessageBody = messageBody.toLowerCase(); 

        if (EXCLUDED_NUMBERS.includes(actualSenderNumber)) {
            console.log(`[DEBUG VOTE] Voting dari nomor yang dikecualikan (${actualSenderNumber}) diabaikan.`);
            return; 
        }

        let targetGroupId = null;
        let targetVoteState = null;

        for (const groupId in ALL_GROUP_VOTES) {
            const voteState = ALL_GROUP_VOTES[groupId];
            // Memeriksa apakah voting aktif, pengirim ada di daftar yang diharapkan, dan belum vote
            if (voteState.isActive && voteState.votedMessageRecipients.includes(actualSenderId) && !voteState.votedParticipants.includes(actualSenderId)) {
                targetGroupId = groupId;
                targetVoteState = voteState;
                break; 
            }
        }

        if (targetVoteState) { 
            let chosenOptionText = null;

            if (targetVoteState.optionMap.hasOwnProperty(normalizedMessageBody)) {
                chosenOptionText = targetVoteState.optionMap[normalizedMessageBody];
                console.log(`[DEBUG VOTE] Ditemukan opsi berdasarkan angka: ${chosenOptionText}`);
            } 
            else {
                chosenOptionText = targetVoteState.options.find(opt => opt.toLowerCase() === normalizedMessageBody);
                if (chosenOptionText) {
                    console.log(`[DEBUG VOTE] Ditemukan opsi berdasarkan teks (normalized): ${chosenOptionText}`);
                }
            }

            if (chosenOptionText) {
                targetVoteState.results[actualSenderId] = chosenOptionText; 
                targetVoteState.votedParticipants.push(actualSenderId);

                let senderDisplayName = actualSenderNumber; 
                try {
                    const senderContact = await msg.getContact();
                    senderDisplayName = senderContact.pushname || senderContact.name || actualSenderNumber;
                } catch (e) {
                    console.warn('Gagal mendapatkan kontak pengirim atau nama tidak tersedia, menggunakan nomor:', actualSenderNumber);
                }
                
                await msg.reply(`Terima kasih atas suaramu, ${senderDisplayName}! Pilihan Anda: *${chosenOptionText}*`);
                console.log(`Voting dari ${senderDisplayName} tercatat: ${chosenOptionText} untuk grup ${targetGroupId}`);

                await updateResultsMessageForGroup(targetGroupId); 
                saveAllGroupVotes(); // Simpan perubahan setelah suara masuk
            } else {
                let errorMessage = `Pilihan "${messageBody}" tidak valid untuk voting "*${targetVoteState.title}*". Silakan pilih salah satu opsi berikut (ketik *angka* atau *teks* opsi secara persis):\n`;
                targetVoteState.options.forEach((opt, index) => {
                    errorMessage += `${index + 1}. *${opt}*\n`;
                });
                await msg.reply(errorMessage);
                console.log(`[DEBUG VOTE] Pilihan tidak valid dari ${actualSenderId} untuk grup ${targetGroupId}: "${messageBody}"`);
            }
        } else {
            console.log(`[DEBUG VOTE] Pesan non-perintah dari ${actualSenderId} di chat pribadi diabaikan karena tidak ada voting aktif yang relevan.`);
        }
    }
    // Menangani pesan di grup dari partisipan yang sudah vote, agar tidak ada balasan "Anda sudah vote"
    else if (chat.isGroup && currentGroupVoteState && currentGroupVoteState.isActive && !msg.fromMe && currentGroupVoteState.votedParticipants.includes(senderId) && !lowerCaseMessageBody.startsWith('.')) {
        console.log(`[DEBUG VOTE] Pesan dari partisipan ${senderId} di grup ${chat.name} diabaikan (sudah vote dan bukan perintah).`);
        return; 
    }
    // Menangani pesan lain dari admin yang bukan perintah bot yang valid 
    else if (isSenderBotAdmin && !lowerCaseMessageBody.startsWith('.') && chat.isGroup) { 
        console.log(`[DEBUG ADMIN] Pesan non-perintah dari admin ${senderId} di grup ${chat.name} diabaikan.`);
        return; 
    }

    // --- Perintah .hasil ---
    if (lowerCaseMessageBody === '.hasil' && isSenderBotAdmin && chat.isGroup) {
        if (!currentGroupVoteState.isActive) {
            msg.reply('Tidak ada voting yang sedang aktif di grup ini.');
            return;
        }
        await updateResultsMessageForGroup(currentGroupId);
        msg.reply("Hasil voting telah diperbarui di pesan utama. Voting masih berlangsung.");
        console.log(`Perintah .hasil dijalankan untuk grup ${currentGroupId}, pesan hasil di-update.`);
    }

    // --- Perintah .stop ---
    if (lowerCaseMessageBody === '.stop' && isSenderBotAdmin && chat.isGroup) {
        if (!currentGroupVoteState.isActive) {
            msg.reply('Tidak ada voting yang sedang aktif di grup ini untuk dihentikan.');
            return;
        }

        // Hentikan interval pengingat
        stopReminderIntervalForGroup(currentGroupId); 

        // Kirim hasil akhir sebagai pesan baru
        const { content: finalResultsMessage, mentions: finalMentions } = buildResultsMessage(currentGroupVoteState, true); // Set isFinal ke true
        try {
            await chat.sendMessage(finalResultsMessage, { mentions: finalMentions });
            console.log(`Pesan hasil voting akhir untuk grup ${currentGroupId} terkirim.`);
        } catch (e) {
            console.error(`Gagal mengirim pesan hasil voting akhir untuk grup ${currentGroupId}:`, e);
        }

        // Kirim notifikasi bahwa voting telah berakhir
        const voteEndedMessage = `📢 Voting "*${currentGroupVoteState.title}*" telah berakhir!\n\nTerima kasih atas partisipasi Anda.`;
        let sentEndNotifCount = 0;
        for (const participantId of currentGroupVoteState.votedMessageRecipients) {
            try {
                await client.sendMessage(participantId, voteEndedMessage);
                sentEndNotifCount++;
            } catch (e) {
                console.error(`Gagal mengirim notifikasi selesai voting ke ${participantId} untuk grup ${currentGroupId}:`, e);
            }
        }
        console.log(`Notifikasi voting berakhir terkirim ke ${sentEndNotifCount} member untuk grup ${currentGroupId}.`);

        // Reset state voting untuk grup ini
        ALL_GROUP_VOTES[currentGroupId] = {
            isActive: false,
            title: '',
            options: [],
            optionMap: {},
            results: {},
            votedParticipants: [],
            resultsMessageId: null, // Reset ID pesan hasil lama
            groupId: currentGroupId, 
            votedMessageRecipients: [],
            reminderInterval: null,
            reminderTime: 0,
            lastReminderSent: {},
            startTime: 0 // Reset juga waktu mulai
        };
        saveAllGroupVotes(); // Simpan perubahan setelah voting dihentikan dan direset
        msg.reply("Voting telah dihentikan di grup ini. Anda bisa memulai voting baru sekarang."); 
        console.log(`Voting dihentikan dan state direset untuk grup ${currentGroupId}.`);
    }
});

// Mulai koneksi client
client.initialize();