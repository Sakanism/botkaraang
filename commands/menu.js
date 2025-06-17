module.exports = {
    name: 'menu',
    description: 'Menampilkan semua perintah yang tersedia.',
    adminOnly: false,
    groupOnly: false,
    async execute({ client, msg, isSenderBotAdmin }) {
        let menuMessage = `*🤖 Menu Perintah Bot 🤖*\n\nBerikut adalah perintah yang bisa Anda gunakan:\n`;

        const adminCommands = [];
        const publicCommands = [];

        client.commands.forEach(cmd => {
            if (cmd.adminOnly) adminCommands.push(cmd);
            else publicCommands.push(cmd);
        });

        if (isSenderBotAdmin && adminCommands.length > 0) {
            menuMessage += `\n*--- Perintah Admin ---*\n`;
            adminCommands.forEach(cmd => menuMessage += `\`\`\`.${cmd.name}\`\`\`\n  - ${cmd.description}\n`);
        }
        
        menuMessage += `\n*--- Perintah Umum ---*\n`;
        publicCommands.forEach(cmd => menuMessage += `\`\`\`.${cmd.name}\`\`\`\n  - ${cmd.description}\n`);
        
        menuMessage += `\n_Saat voting aktif, balas pesan dari bot di chat pribadi untuk vote._`;
        await msg.reply(menuMessage);
    }
};