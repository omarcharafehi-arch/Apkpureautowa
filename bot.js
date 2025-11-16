const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const pino = require('pino');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const colors = {
    reset: '\x1b[0m',
    bright: '\x1b[1m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    cyan: '\x1b[36m',
    red: '\x1b[31m',
    black: '\x1b[30m',
    bgGreen: '\x1b[42m',
};

const log = {
    info: (msg) => console.log(`${colors.cyan}ℹ${colors.reset} ${msg}`),
    success: (msg) => console.log(`${colors.green}✓${colors.reset} ${msg}`),
    error: (msg) => console.log(`${colors.red}✗${colors.reset} ${msg}`),
    warn: (msg) => console.log(`${colors.yellow}⚠${colors.reset} ${msg}`),
    code: (msg) => console.log(`${colors.bgGreen}${colors.black}${colors.bright} ${msg} ${colors.reset}`),
};

const MAX_FILE_SIZE_MB = 2048; // 2GB للتخزين

const DEVELOPER_INFO = {
    name: 'Omar Xaraf',
    instagram: 'https://instagram.com/Omarxarafp',
    contact: '@Omarxarafp'
};

let sock;
let isConnected = false;
let pairingCodeRequested = false;
let reconnectAttempts = 0;
let isReconnecting = false;

async function connectToWhatsApp() {
    if (isReconnecting) {
        log.warn('إعادة اتصال جارية بالفعل، تم تجاهل المحاولة المكررة');
        return;
    }
    
    isReconnecting = true;
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
    const { version, isLatest } = await fetchLatestBaileysVersion();

    // Cleanup old socket listeners if they exist
    if (sock && sock.ev) {
        sock.ev.removeAllListeners();
    }

    sock = makeWASocket({
        version,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false,
        auth: state,
        browser: ['Windows', 'Chrome', '1.0.0'],
        connectTimeoutMs: 60000,
        keepAliveIntervalMs: 10000,
        defaultQueryTimeoutMs: 60000,
        retryRequestDelayMs: 250,
        maxMsgRetryCount: 5,
        markOnlineOnConnect: true,
        syncFullHistory: false,
        getMessage: async () => undefined,
    });

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (!sock.authState.creds.registered && !pairingCodeRequested) {
            pairingCodeRequested = true;
            console.log('\n');
            log.info('Waiting for pairing code...');
            const phoneNumber = process.env.PHONE_NUMBER || await getUserPhoneNumber();

            if (!phoneNumber) {
                log.error('Phone number is required for pairing');
                return;
            }

            log.info(`Requesting pairing code for: ${phoneNumber}`);
            const code = await sock.requestPairingCode(phoneNumber.replace(/[^0-9]/g, ''));
            console.log('\n' + '='.repeat(50));
            log.code(`🔑 PAIRING CODE: ${code}`);
            console.log('='.repeat(50) + '\n');
            log.info('Open WhatsApp → Linked Devices → Link with Phone Number');
            log.info('Enter the code above to connect your bot\n');
        }

        if (connection === 'close') {
            const statusCode = (lastDisconnect?.error)?.output?.statusCode;
            isConnected = false;
            
            if (statusCode === DisconnectReason.loggedOut) {
                log.error('تم تسجيل الخروج');
                process.exit(0);
            } else {
                // Cap reconnect attempts at 10 to prevent infinite loops
                if (reconnectAttempts >= 10) {
                    log.error('فشلت محاولات الإعادة المتعددة - توقف الاتصال');
                    isReconnecting = false;
                    setTimeout(() => connectToWhatsApp(), 30000); // Try again after 30s
                    return;
                }
                
                reconnectAttempts++;
                const delay = Math.min(reconnectAttempts * 3000, 15000);
                log.warn(`انقطاع الاتصال (${reconnectAttempts}) - إعادة بعد ${delay/1000}ث...`);
                
                setTimeout(() => {
                    isReconnecting = false;
                    connectToWhatsApp();
                }, delay);
            }
        } else if (connection === 'open') {
            isConnected = true;
            isReconnecting = false;
            reconnectAttempts = 0;
            console.log('\n');
            log.success('✅ البوت متصل بنجاح');
            log.info(`👨‍💻 المطور: ${DEVELOPER_INFO.name}\n`);
        } else if (connection === 'connecting') {
            log.info('🔄 جاري الاتصال...');
        }
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('messages.upsert', async ({ messages }) => {
        // تجاهل جميع الرسائل إذا الاتصال منقطع أو في طور إعادة الاتصال
        if (!isConnected || isReconnecting) {
            log.warn('⚠️ رسالة واردة تم تجاهلها - الاتصال غير مستقر');
            return;
        }

        try {
            const m = messages[0];

            if (!m.message || m.key.fromMe) return;

            const messageType = Object.keys(m.message)[0];
            const messageContent = m.message[messageType];
            const sender = m.key.remoteJid;

            let textMessage = '';
            if (messageType === 'conversation') {
                textMessage = m.message.conversation;
            } else if (messageType === 'extendedTextMessage') {
                textMessage = m.message.extendedTextMessage.text;
            }

            if (!textMessage) return;

            if (textMessage.includes('Session error') || textMessage.includes('decrypt')) return;

            log.info(`📨 Message from ${sender.split('@')[0]}: ${textMessage}`);

            if (textMessage.toLowerCase() === 'hi' || textMessage.toLowerCase() === 'hello' || textMessage.toLowerCase() === 'السلام عليكم' || textMessage.toLowerCase() === 'مرحبا') {
                const welcomeMessage = `🤖 *بوت تحميل التطبيقات* 🤖\n\n` +
                    `📱 *الاستخدام:* أرسل اسم التطبيق\n\n` +
                    `*مثال:* واتساب، انستقرام، تيك توك\n\n` +
                    `✅ يدعم APK و XAPK و APKS\n` +
                    `✅ حجم حتى ${MAX_FILE_SIZE_MB}MB\n\n` +
                    `👨‍💻 *المطور:* ${DEVELOPER_INFO.name}\n` +
                    `📲 *انستقرام:* ${DEVELOPER_INFO.instagram}\n\n` +
                    `_by ${DEVELOPER_INFO.contact}_`;

                await sock.sendMessage(sender, { text: welcomeMessage });
                return;
            }

            if (!textMessage.startsWith('/') && textMessage.trim().length > 0) {
                const appName = textMessage.trim();

                log.info(`🔍 بحث عن: ${appName}`);

                // التحقق من الاتصال قبل البدء
                if (!isConnected || isReconnecting) {
                    log.warn('⏸️ تم تأجيل الطلب - البوت يعيد الاتصال');
                    return;
                }
                
                try {
                    await sock.sendMessage(sender, {
                        react: {
                            text: '🔍',
                            key: m.key
                        }
                    });
                } catch (err) {
                    log.warn(`فشل إرسال رد الفعل - الاتصال غير مستقر`);
                    return;
                }

                try {
                    const result = await searchAndDownloadApp(appName);

                    if (!result) {
                        log.error(`No result returned from scraper`);
                        await sock.sendMessage(sender, { text: `❌ فشل في معالجة الطلب. حاول مرة أخرى.\n\n_by @Omarxarafp_` });
                        return;
                    }

                    if (result.error) {
                        log.error(`خطأ: ${result.error}`);
                        if (isConnected && !isReconnecting) {
                            await sock.sendMessage(sender, { text: `❌ ${result.error}\n\n_by ${DEVELOPER_INFO.contact}_` });
                        }
                        return;
                    }

                    if (result.sizeMB && result.sizeMB > MAX_FILE_SIZE_MB) {
                        log.warn(`ملف كبير: ${result.sizeMB} MB`);
                        
                        const filePath = path.join('downloads', result.filename);
                        // Cleanup with error handling
                        if (fs.existsSync(filePath)) {
                            setTimeout(() => {
                                try {
                                    if (fs.existsSync(filePath)) {
                                        fs.unlinkSync(filePath);
                                        log.info(`🗑️ تم حذف ${result.filename}`);
                                    }
                                } catch (err) {
                                    log.warn(`فشل حذف الملف: ${result.filename}`);
                                }
                            }, 5 * 1000);
                        }
                        
                        await sock.sendMessage(sender, { 
                            text: `⚠️ *الملف كبير جداً!*\n\n` +
                                `📱 ${result.name}\n` +
                                `💾 ${result.size}\n` +
                                `⚠️ الحد الأقصى: ${MAX_FILE_SIZE_MB}MB\n\n` +
                                `_by ${DEVELOPER_INFO.contact}_`
                        });
                        return;
                    }

                    let installNote = '';
                    if (result.fileType === 'XAPK' || result.fileType === 'APKS') {
                        installNote = `\n⚠️ يحتاج ${result.fileType === 'XAPK' ? 'ZArchiver' : 'SAI'} للتثبيت`;
                    }

                    let infoMessage = `📱 *${result.name}*\n\n` +
                        `🔢 الإصدار: ${result.version}\n` +
                        `💾 الحجم: ${result.size}\n` +
                        `👨‍💻 المطور: ${result.developer}\n` +
                        `📥 النوع: ${result.fileType}${installNote}\n\n` +
                        `⏳ جاري الرفع...`;

                    if (result.iconUrl) {
                        try {
                            const axios = require('axios');
                            const iconResponse = await axios.get(result.iconUrl, { 
                                responseType: 'arraybuffer',
                                headers: {
                                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                                    'Accept': 'image/*'
                                },
                                timeout: 10000
                            });
                            
                            if (iconResponse.data && iconResponse.data.length > 0) {
                                const iconBuffer = Buffer.from(iconResponse.data);
                                await sock.sendMessage(sender, {
                                    image: iconBuffer,
                                    caption: infoMessage
                                });
                                log.info(`📸 تم إرسال صورة التطبيق`);
                            } else {
                                await sock.sendMessage(sender, { text: infoMessage });
                            }
                        } catch (err) {
                            log.warn(`فشل تحميل الصورة`);
                            await sock.sendMessage(sender, { text: infoMessage });
                        }
                    } else {
                        await sock.sendMessage(sender, { text: infoMessage });
                    }

                    log.info(`📤 Uploading file: ${result.filename}`);

                    const filePath = path.join('downloads', result.filename);
                    
                    try {
                        if (!fs.existsSync(filePath)) {
                            log.error(`File not found: ${filePath}`);
                            await sock.sendMessage(sender, { text: `❌ فشل في العثور على الملف.\n\n_by @Omarxarafp_` });
                            return;
                        }

                        log.info(`📥 Reading file to memory...`);
                        const fileBuffer = fs.readFileSync(filePath);
                        const fileSizeMB = fileBuffer.length / (1024 * 1024);
                        log.info(`File size: ${fileSizeMB.toFixed(2)} MB`);

                        
                        
                        const mimeTypes = {
                            'APK': 'application/vnd.android.package-archive',
                            'XAPK': 'application/vnd.android.package-archive',
                            'APKS': 'application/vnd.android.package-archive'
                        };
                        
                        const mimetype = mimeTypes[result.fileType] || 'application/vnd.android.package-archive';

                        log.info(`📤 Uploading to WhatsApp...`);
                        await sock.sendMessage(sender, {
                            document: fileBuffer,
                            fileName: result.filename,
                            mimetype: mimetype
                        });

                        log.success(`✅ تم إرسال ${result.filename}`);

                        // حذف الملف بعد 5 ثوانٍ مع معالجة الأخطاء
                        setTimeout(() => {
                            try {
                                if (fs.existsSync(filePath)) {
                                    fs.unlinkSync(filePath);
                                    log.info(`🗑️ تم حذف ${result.filename} بعد 5 ثوانٍ`);
                                }
                            } catch (err) {
                                log.warn(`فشل حذف الملف: ${err.message}`);
                            }
                        }, 5 * 1000);

                        const afterFileMessage = `✅ *تم الإرسال بنجاح!*\n\n` +
                            `💾 الحجم: ${fileSizeMB.toFixed(2)} MB\n\n` +
                            `👨‍💻 *المطور:* ${DEVELOPER_INFO.name}\n` +
                            `📲 ${DEVELOPER_INFO.instagram}\n\n` +
                            `_by ${DEVELOPER_INFO.contact}_`;

                        await sock.sendMessage(sender, { text: afterFileMessage });
                    } catch (uploadErr) {
                        log.error(`خطأ في الرفع: ${uploadErr.message}`);
                        
                        if (fs.existsSync(filePath)) {
                            setTimeout(() => {
                                try {
                                    if (fs.existsSync(filePath)) {
                                        fs.unlinkSync(filePath);
                                        log.info(`🗑️ تم حذف ${result.filename}`);
                                    }
                                } catch (err) {
                                    log.warn(`فشل حذف الملف`);
                                }
                            }, 5 * 1000);
                        }
                        
                        await sock.sendMessage(sender, { 
                            text: `❌ فشل رفع الملف، حاول مرة أخرى\n\n_by ${DEVELOPER_INFO.contact}_`
                        });
                    }

                } catch (error) {
                    log.error(`خطأ: ${error.message}`);
                    try {
                        await sock.sendMessage(sender, { text: `❌ حدث خطأ، حاول مرة أخرى\n\n_by ${DEVELOPER_INFO.contact}_` });
                    } catch (sendErr) {
                        log.error(`فشل إرسال رسالة الخطأ`);
                    }
                }
            }

        } catch (error) {
            log.error(`Message handler error: ${error.message}`);
        }
    });
}

async function getUserPhoneNumber() {
    return new Promise((resolve) => {
        const readline = require('readline').createInterface({
            input: process.stdin,
            output: process.stdout
        });

        readline.question('Enter your phone number (with country code, e.g., 1234567890): ', (answer) => {
            readline.close();
            resolve(answer.trim());
        });
    });
}

function searchAndDownloadApp(appName) {
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            python.kill();
            reject(new Error('Scraper timeout - took longer than 120 seconds'));
        }, 120000); // 120 second timeout

        const python = spawn('python3', ['scraper.py', appName]);
        let dataString = '';
        let errorString = '';

        python.stdout.on('data', (data) => {
            dataString += data.toString();
        });

        python.stderr.on('data', (data) => {
            errorString += data.toString();
        });

        python.on('close', (code) => {
            clearTimeout(timeout);
            
            if (code !== 0) {
                reject(new Error(errorString || 'Python script failed'));
                return;
            }

            try {
                const result = JSON.parse(dataString);
                resolve(result);
            } catch (error) {
                reject(new Error('Failed to parse scraper output'));
            }
        });

        python.on('error', (error) => {
            clearTimeout(timeout);
            reject(error);
        });
    });
}

if (!fs.existsSync('downloads')) {
    fs.mkdirSync('downloads');
}

console.clear();
console.log('\n' + '='.repeat(50));
console.log('  🤖  WhatsApp APK Bot');
console.log('='.repeat(50) + '\n');
connectToWhatsApp();

process.on('uncaughtException', (err) => {
    log.error(`Uncaught Exception: ${err.message}`);
});

process.on('unhandledRejection', (err) => {
    log.error(`Unhandled Rejection: ${err.message}`);
});
