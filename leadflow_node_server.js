/**
 * LeadFlow WhatsApp + Email Server
 * whatsapp-web.js + Nodemailer (Gmail)
 * 100% FREE — PDF auto-attaches on WA and Email
 */

const express    = require('express');
const cors       = require('cors');
const qrcode     = require('qrcode-terminal');
const nodemailer = require('nodemailer');
const fs         = require('fs');
const path       = require('path');
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');

const app  = express();
const PORT = 3001;

app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '50mb' }));

// ── Config (Gmail credentials) ────────────────────────────────
const CONFIG_FILE = path.join(__dirname, 'leadflow_config.json');
function loadConfig() {
    try { if (fs.existsSync(CONFIG_FILE)) return JSON.parse(fs.readFileSync(CONFIG_FILE,'utf8')); } catch(e){}
    return { gmailUser:'', gmailPass:'', fromName:'LeadFlow' };
}
function saveConfig(cfg) { fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg,null,2)); }
let config = loadConfig();

// ── WhatsApp Client ───────────────────────────────────────────
let waReady = false, waStatus = 'starting';

const client = new Client({
    authStrategy: new LocalAuth({ dataPath: './wa_auth_data' }),
    puppeteer: {
        headless: true,
        args: ['--no-sandbox','--disable-setuid-sandbox',
               '--disable-dev-shm-usage','--disable-gpu',
               '--no-first-run','--no-zygote']
    },
    restartOnAuthFail: true
});

client.on('qr', (qr) => {
    waStatus = 'waiting_qr'; waReady = false;
    console.log('\n' + '='.repeat(52));
    console.log('  📱 SCAN QR WITH WHATSAPP');
    console.log('  WhatsApp > Linked Devices > Link a Device');
    console.log('='.repeat(52) + '\n');
    qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
    waReady = true; waStatus = 'ready';
    console.log('\n✅ WhatsApp Connected!');
    console.log(`   Account : ${client.info.pushname} (+${client.info.wid.user})`);
    console.log(`   Server  : http://localhost:${PORT}\n`);
});

client.on('authenticated', () => console.log('🔐 Authenticated — session saved\n'));

client.on('disconnected', (reason) => {
    waReady = false; waStatus = 'disconnected';
    console.log('⚠️  Disconnected:', reason, '— reconnecting in 5s...');
    setTimeout(() => { try { client.initialize(); } catch(e){} }, 5000);
});

client.on('auth_failure', () => {
    waReady = false; waStatus = 'auth_failure';
    console.log('❌ Auth failed — clearing session, please re-scan QR');
    try { fs.rmSync('./wa_auth_data', { recursive:true, force:true }); } catch(e){}
    setTimeout(() => client.initialize(), 3000);
});

// Keep-alive ping every 30s
setInterval(() => {
    if (!waReady) return;
    client.getState().catch(() => {
        waReady = false; waStatus = 'reconnecting';
        console.log('⚠️  Keep-alive failed — reconnecting...');
        try { client.initialize(); } catch(e){}
    });
}, 30000);

// ── Helpers ───────────────────────────────────────────────────
function formatPhone(phone) {
    let p = String(phone).replace(/[\s\-\+\(\)]/g,'');
    if (p.length === 10) p = '91' + p;
    return p + '@c.us';
}

// ── WhatsApp Send ─────────────────────────────────────────────
async function sendWA(phone, message, pdfBase64, pdfName) {
    if (!waReady) return { success:false, error:'WhatsApp not connected' };
    const chatId = formatPhone(phone);
    try {
        if (pdfBase64 && pdfBase64.length > 10) {
            const media = new MessageMedia('application/pdf', pdfBase64, pdfName||'document.pdf');
            await client.sendMessage(chatId, media, { caption: message });
            console.log(`  ✅ WA PDF sent → ${phone}`);
            return { success:true, method:'pdf_attached', phone };
        } else {
            await client.sendMessage(chatId, message);
            console.log(`  ✅ WA text sent → ${phone}`);
            return { success:true, method:'text_only', phone };
        }
    } catch(err) {
        console.error(`  ❌ WA error → ${phone}:`, err.message);
        return { success:false, error:err.message, phone };
    }
}

// ── Email Send ────────────────────────────────────────────────
async function sendEmail(toEmail, toName, subject, message, pdfBase64, pdfName, fromName) {
    config = loadConfig();
    if (!config.gmailUser || !config.gmailPass)
        return { success:false, error:'Gmail not configured. Add in LeadFlow Settings.' };

    const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: { user: config.gmailUser, pass: config.gmailPass }
    });

    const mail = {
        from: `"${fromName||config.fromName||'LeadFlow'}" <${config.gmailUser}>`,
        to: toEmail,
        subject,
        html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
            <div style="background:#1e3a8a;padding:20px 28px;border-radius:12px 12px 0 0">
                <h2 style="color:#fff;margin:0">${fromName||config.fromName||'LeadFlow'}</h2>
            </div>
            <div style="background:#f8fafc;padding:24px 28px;border:1px solid #e2e8f0">
                <p style="color:#334155;font-size:15px;line-height:1.7;white-space:pre-line">${message}</p>
            </div>
            <div style="background:#1e3a8a;padding:10px 28px;border-radius:0 0 12px 12px;text-align:center">
                <p style="color:#93c5fd;font-size:12px;margin:0">Sent via LeadFlow CRM</p>
            </div></div>`,
        attachments: pdfBase64 && pdfBase64.length > 10 ? [{
            filename: pdfName||'document.pdf',
            content: Buffer.from(pdfBase64,'base64'),
            contentType: 'application/pdf'
        }] : []
    };

    try {
        await transporter.sendMail(mail);
        console.log(`  ✅ Email sent → ${toEmail}`);
        return { success:true, method:'email_with_pdf' };
    } catch(err) {
        console.error(`  ❌ Email error:`, err.message);
        return { success:false, error:err.message };
    }
}

// ── API Endpoints ─────────────────────────────────────────────
app.get('/api/status', (req,res) => res.json({ ready:waReady, status:waStatus }));

app.post('/api/config', (req,res) => {
    const { gmailUser, gmailPass, fromName } = req.body;
    config = { gmailUser, gmailPass, fromName };
    saveConfig(config);
    console.log(`  ✅ Gmail config saved: ${gmailUser}`);
    res.json({ success:true });
});

app.post('/api/test-email', async (req,res) => {
    const result = await sendEmail(
        req.body.toEmail||config.gmailUser,'Test',
        'LeadFlow Email Test ✅',
        'Your email integration is working!\nInvoices will now be sent with PDF auto-attached.\n\n— LeadFlow CRM',
        '','',config.fromName
    );
    res.json(result);
});

app.post('/api/send', async (req,res) => {
    const { phone, message, pdfBase64, pdfName } = req.body;
    if (!phone) return res.json({ success:false, error:'Phone required' });
    res.json(await sendWA(phone, message, pdfBase64, pdfName));
});

app.post('/api/send-email', async (req,res) => {
    const { toEmail, toName, subject, message, pdfBase64, pdfName, fromName } = req.body;
    if (!toEmail) return res.json({ success:false, error:'Email required' });
    res.json(await sendEmail(toEmail, toName, subject, message, pdfBase64, pdfName, fromName));
});

app.post('/api/send-both', async (req,res) => {
    const { phone, toEmail, toName, subject, message, pdfBase64, pdfName, fromName } = req.body;
    const results = {};
    if (phone) results.whatsapp = await sendWA(phone, message, pdfBase64, pdfName);
    if (toEmail) results.email = await sendEmail(toEmail, toName, subject, message, pdfBase64, pdfName, fromName);
    res.json({ success:true, results });
});

app.post('/api/send-bulk', async (req,res) => {
    const { batch=[], delay=5 } = req.body;
    const results = [];
    console.log(`\n📤 Bulk: ${batch.length} messages\n`);
    for (let i=0; i<batch.length; i++) {
        const { phone, message, pdfBase64, pdfName } = batch[i];
        console.log(`  [${i+1}/${batch.length}] → ${phone}`);
        results.push(await sendWA(phone, message, pdfBase64, pdfName));
        if (i < batch.length-1) await new Promise(r=>setTimeout(r, delay*1000));
    }
    const ok = results.filter(r=>r.success).length;
    console.log(`\n✅ Done: ${ok}/${batch.length}\n`);
    res.json({ results, total:batch.length, success:ok });
});

app.post('/api/reconnect', async (req,res) => {
    waReady=false; waStatus='reconnecting';
    try { await client.destroy(); } catch(_){}
    setTimeout(()=>client.initialize(), 2000);
    res.json({ status:'reconnecting' });
});

// ── Start ─────────────────────────────────────────────────────
app.listen(PORT, () => {
    console.log('='.repeat(52));
    console.log('  LeadFlow Server  |  localhost:' + PORT);
    console.log('  WhatsApp + Email — PDF Auto-Attach');
    console.log('='.repeat(52) + '\n');
});

client.initialize();
