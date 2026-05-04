// ═══════════════════════════════════════════════════
//  ALMEER MD · qr.js
//  QR code route — ported for ALMEER MD
// ═══════════════════════════════════════════════════

import express from "express";
import fs from "fs";
import pino from "pino";
import {
    makeWASocket,
    useMultiFileAuthState,
    delay,
    makeCacheableSignalKeyStore,
    Browsers,
    jidNormalizedUser,
    fetchLatestBaileysVersion,
} from "@whiskeysockets/baileys";
import QRCode from "qrcode";
import { upload } from "./mega.js";

const router = express.Router();

function removeFile(filePath) {
    try {
        if (!fs.existsSync(filePath)) return false;
        fs.rmSync(filePath, { recursive: true, force: true });
    } catch (e) {
        console.error('Error removing file:', e);
    }
}

function getMegaFileId(url) {
    try {
        const match = url.match(/\/file\/([^#]+#[^\/]+)/);
        return match ? match[1] : null;
    } catch {
        return null;
    }
}

router.get('/', async (req, res) => {
    const sessionId = Date.now().toString() + Math.random().toString(36).substr(2, 9);
    const dirs      = `./qr_sessions/session_${sessionId}`;

    if (!fs.existsSync('./qr_sessions')) {
        fs.mkdirSync('./qr_sessions', { recursive: true });
    }

    await removeFile(dirs);

    async function initiateSession() {
        const { state, saveCreds } = await useMultiFileAuthState(dirs);

        try {
            const { version } = await fetchLatestBaileysVersion();
            let responseSent  = false;

            const sock = makeWASocket({
                version,
                auth: {
                    creds: state.creds,
                    keys:  makeCacheableSignalKeyStore(
                        state.keys,
                        pino({ level: 'fatal' }).child({ level: 'fatal' })
                    ),
                },
                printQRInTerminal:              false,
                logger:                         pino({ level: 'fatal' }).child({ level: 'fatal' }),
                browser:                        Browsers.windows('Chrome'),
                markOnlineOnConnect:            false,
                generateHighQualityLinkPreview: false,
                defaultQueryTimeoutMs:          60000,
                connectTimeoutMs:               60000,
                keepAliveIntervalMs:            30000,
                retryRequestDelayMs:            250,
                maxRetries:                     5,
            });

            sock.ev.on('connection.update', async (update) => {
                const { connection, lastDisconnect, qr } = update;

                /* ── QR generated ────────────────────────────────────────── */
                if (qr && !responseSent) {
                    console.log('🟢 ALMEER MD QR Code generated');
                    try {
                        const qrDataURL = await QRCode.toDataURL(qr, {
                            errorCorrectionLevel: 'M',
                            type:    'image/png',
                            quality: 0.92,
                            margin:  1,
                            color:   { dark: '#000000', light: '#FFFFFF' },
                        });
                        if (!responseSent) {
                            responseSent = true;
                            res.send({
                                qr: qrDataURL,
                                message: 'QR Code generated — scan with WhatsApp',
                                instructions: [
                                    '1. Open WhatsApp on your phone',
                                    '2. Go to Settings → Linked Devices',
                                    '3. Tap "Link a Device"',
                                    '4. Scan the QR code above',
                                ],
                            });
                        }
                    } catch (qrErr) {
                        console.error('Error generating QR:', qrErr);
                        if (!responseSent) {
                            responseSent = true;
                            res.status(500).send({ code: 'Failed to generate QR code' });
                        }
                    }
                }

                /* ── Connected — upload session to MEGA ──────────────────── */
                if (connection === 'open') {
                    console.log('✅ ALMEER MD connected via QR');
                    console.log('📡 Uploading session to MEGA...');
                    try {
                        const credsPath  = dirs + '/creds.json';
                        const megaUrl    = await upload(credsPath, `almeer_md_qr_${sessionId}.json`);
                        const megaFileId = getMegaFileId(megaUrl);

                        if (megaFileId) {
                            console.log('✅ Session uploaded. File ID:', megaFileId);
                            const userJid = jidNormalizedUser(sock.authState.creds.me?.id || '');
                            if (userJid) {
                                await sock.sendMessage(userJid, { text: `ALMEER_MD_${megaFileId}` });
                                console.log('📄 ALMEER_MD_ session ID sent to user');
                            }
                        } else {
                            console.log('❌ Failed to get MEGA file ID');
                        }

                        console.log('🧹 Cleaning up...');
                        await delay(1000);
                        removeFile(dirs);
                        await delay(2000);
                        process.exit(0);

                    } catch (err) {
                        console.error('❌ MEGA upload error:', err);
                        removeFile(dirs);
                        await delay(2000);
                        process.exit(1);
                    }
                }

                if (connection === 'close') {
                    const statusCode = lastDisconnect?.error?.output?.statusCode;
                    if (statusCode === 401) {
                        console.log('❌ Logged out — generate new QR');
                    } else {
                        console.log('🔁 Connection closed — restarting...');
                        initiateSession();
                    }
                }
            });

            sock.ev.on('creds.update', saveCreds);

            // Timeout if QR never generates
            setTimeout(() => {
                if (!responseSent) {
                    responseSent = true;
                    res.status(408).send({ code: 'QR generation timeout' });
                    removeFile(dirs);
                    setTimeout(() => process.exit(1), 2000);
                }
            }, 30000);

        } catch (err) {
            console.error('Error initializing QR session:', err);
            if (!res.headersSent) {
                res.status(503).send({ code: 'Service Unavailable' });
            }
            removeFile(dirs);
            setTimeout(() => process.exit(1), 2000);
        }
    }

    await initiateSession();
});

process.on('uncaughtException', (err) => {
    const e = String(err);
    if (['conflict','not-authorized','Socket connection timeout','rate-overlimit',
         'Connection Closed','Timed Out','Value not found','Stream Errored',
         'statusCode: 515','statusCode: 503'].some(s => e.includes(s))) return;
    console.log('Caught exception:', err);
    process.exit(1);
});

export default router;
