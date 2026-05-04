// ═══════════════════════════════════════════════════
//  ALMEER MD · pair.js
//  Pairing code route — ported for ALMEER MD
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
import pn from "awesome-phonenumber";
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);

const router = express.Router();

/* ── Session ID generator ─────────────────────────────────────────────────── */
async function generateAlmeerSession(credsPath) {
    try {
        const credsData   = fs.readFileSync(credsPath, 'utf-8');
        const base64Creds = Buffer.from(credsData).toString('base64');
        // ALMEER MD session prefix (matches main bot's format)
        return {
            sessionId:   'ALMEER_MD_',
            encodedData: base64Creds,
        };
    } catch (err) {
        console.error('Error generating ALMEER session:', err);
        return null;
    }
}

/* ── Helpers ──────────────────────────────────────────────────────────────── */
function rm(p) {
    try {
        if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true });
    } catch (e) {
        console.log('Cleanup error:', e);
    }
}

/* ── Route ────────────────────────────────────────────────────────────────── */
router.get('/', async (req, res) => {
    let num = (req.query.number || '').replace(/[^0-9]/g, '');
    if (!num) return res.status(400).send({ code: 'Number required' });

    const phone = pn('+' + num);
    if (!phone.isValid()) return res.status(400).send({ code: 'Invalid number' });
    num = phone.getNumber('e164').replace('+', '');

    const dir = './session' + num;
    rm(dir);

    async function start() {
        const { state, saveCreds } = await useMultiFileAuthState(dir);
        const { version }          = await fetchLatestBaileysVersion();

        const sock = makeWASocket({
            version,
            auth: {
                creds: state.creds,
                keys:  makeCacheableSignalKeyStore(state.keys, pino({ level: 'fatal' })),
            },
            logger:              pino({ level: 'fatal' }),
            browser:             Browsers.windows('Chrome'),
            printQRInTerminal:   false,
            markOnlineOnConnect: false,
        });

        sock.ev.on('creds.update', saveCreds);

        sock.ev.on('connection.update', async ({ connection, lastDisconnect }) => {

            /* ── Connected — send session ID to user ─────────────────────── */
            if (connection === 'open') {
                try {
                    // Wait for creds.json to be written fully
                    await delay(3000);

                    const credsPath   = join(dir, 'creds.json');
                    const sessionInfo = await generateAlmeerSession(credsPath);

                    if (!sessionInfo) throw new Error('Failed to generate ALMEER session');

                    const jid            = jidNormalizedUser(num + '@s.whatsapp.net');
                    const completeSession = `${sessionInfo.sessionId}${sessionInfo.encodedData}`;

                    // 1. Send the session ID string
                    await sock.sendMessage(jid, { text: completeSession });

                    // 2. Short pause
                    await delay(2000);

                    // 3. Send ALMEER MD styled bot info card
                    const fakeVCardQuoted = {
                        key: {
                            fromMe:      false,
                            participant: '0@s.whatsapp.net',
                            remoteJid:   'status@broadcast',
                        },
                        message: {
                            contactMessage: {
                                displayName: '✞ ALMEER MD ✞',
                                vcard: `BEGIN:VCARD\nVERSION:3.0\nFN:✞ ALMEER MD ✞\nORG:ALMEER BRAND;\nTEL;type=CELL;type=VOICE;waid=13135550002:+13135550002\nEND:VCARD`,
                            },
                        },
                    };

                    const caption = `
╭━〔 *✞ 𝑨𝑳𝑴𝑬𝑬𝑹 ✠ 𝑴𝑫 ✞* 〕━··๏
┃★╭──────────────────
┃★│ 👑 Owner   : *SIDER44*
┃★│ 🤖 Baileys : *Multi Device*
┃★│ 💻 Type    : *NodeJs*
┃★│ ⚙️  Mode   : *Public*
┃★│ 🔣 Prefix  : *[ . ]*
┃★│ 🏷️  Version : *v5.0.0*
┃★│ 🌐 Brand   : *ALMEER BRAND*
┃★╰──────────────────
╰━━━━━━━━━━━━━━━━━┈⊷

> ✅ Your *ALMEER_MD_* session ID has been sent above.
> Set it as *SESSION_ID* in your .env or Pterodactyl variables.`;

                    await sock.sendMessage(
                        jid,
                        {
                            image:   { url: 'https://files.catbox.moe/16i1l7.jpg' },
                            caption,
                            contextInfo: {
                                mentionedJid: [jid],
                                forwardingScore: 999,
                                isForwarded:     true,
                                forwardedNewsletterMessageInfo: {
                                    newsletterJid:   '120363348739987203@newsletter',
                                    newsletterName:  '✞『✦𝑨𝑳𝑴𝑬𝑬𝑹 ✠ 𝑴𝑫✦』✞',
                                    serverMessageId: 143,
                                },
                            },
                        },
                        { quoted: fakeVCardQuoted }
                    );

                    // 4. Cleanup and exit
                    await delay(2000);
                    rm(dir);
                    setTimeout(() => process.exit(0), 1000);

                } catch (err) {
                    console.error('❌ ALMEER session error:', err);
                    rm(dir);
                    try {
                        const jid = jidNormalizedUser(num + '@s.whatsapp.net');
                        await sock.sendMessage(jid, {
                            text: '❌ Error generating ALMEER MD session. Please try again.',
                        });
                    } catch {}
                    process.exit(1);
                }
            }

            if (connection === 'close') {
                const c = lastDisconnect?.error?.output?.statusCode;
                if (c !== 401) setTimeout(() => start(), 2000);
            }
        });

        /* ── Request pairing code (RIOT2 pattern) ─────────────────────────── */
        if (!sock.authState.creds.registered) {
            // 3-second warm-up (matches RIOT2 session.js)
            await delay(3000);

            // Poll until WebSocket is OPEN (readyState 1)
            const WS_OPEN = 1;
            let wsWaited  = 0;
            while (sock.ws?.readyState !== WS_OPEN && wsWaited < 15000) {
                await delay(500);
                wsWaited += 500;
            }
            if (sock.ws?.readyState !== WS_OPEN) {
                if (!res.headersSent) {
                    res.status(503).send({ code: 'SOCKET_NOT_OPEN', error: 'Socket did not open in time.' });
                }
                rm(dir);
                return;
            }

            try {
                let code = await sock.requestPairingCode(num);
                code = code?.match(/.{1,4}/g)?.join('-') || code;
                if (!res.headersSent) {
                    res.send({
                        success: true,
                        code,
                        message: 'Enter code: WhatsApp → Linked Devices → Link with phone number',
                    });
                }
            } catch (err) {
                console.error('Pairing error:', err);
                if (!res.headersSent) {
                    res.status(503).send({ code: 'PAIR_FAIL', error: err.message });
                }
                rm(dir);
                process.exit(1);
            }
        }
    }

    start();
});

/* ── Safety nets ──────────────────────────────────────────────────────────── */
process.on('uncaughtException', (err) => {
    const e = String(err);
    if (e.includes('conflict') || e.includes('not-authorized') || e.includes('Timed Out')) return;
    console.error('Crash:', err);
});

process.on('unhandledRejection', (err) => {
    console.error('Unhandled Rejection:', err);
});

export default router;
