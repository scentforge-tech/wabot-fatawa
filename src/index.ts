// ─── HTTP server MUST start first ─────────────────────────────────────────────
// Cloud Run requires the container to bind PORT within ~4 minutes.
// We start the server here — BEFORE any other import that might call process.exit().
import * as http from 'http';
import * as QRCode from 'qrcode';

const PORT = Number(process.env.PORT) || 8080;
let latestQr: string | null = null;
let botConnected = false;

// HTML pages defined before server so they're in scope
const HTML_CONNECTED = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>WhatsApp Bot</title>
<style>*{margin:0;padding:0;box-sizing:border-box;}
body{font-family:'Segoe UI',sans-serif;background:#0a0a0a;color:#fff;
     display:flex;align-items:center;justify-content:center;min-height:100vh;}
.card{text-align:center;padding:48px;border-radius:20px;background:#111;
      border:1px solid #1a3a2a;box-shadow:0 0 60px rgba(37,211,102,.2);}
h1{color:#25d366;font-size:2.2rem;margin-bottom:12px;}
p{color:#888;font-size:1rem;}</style></head>
<body><div class="card">
<div style="font-size:4rem;margin-bottom:16px;">✅</div>
<h1>WhatsApp Connected!</h1>
<p>The Fatawa bot is live and listening for voice messages.</p>
<p style="margin-top:12px;color:#25d366;">No action needed — the bot is running.</p>
</div></body></html>`;

const HTML_LOADING = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Starting...</title>
<meta http-equiv="refresh" content="3">
<style>*{margin:0;padding:0;}body{font-family:sans-serif;background:#0a0a0a;color:#fff;
display:flex;align-items:center;justify-content:center;min-height:100vh;}
</style></head>
<body><div style="text-align:center">
<div style="font-size:3rem;margin-bottom:16px">⏳</div>
<h2>Starting bot...</h2><p style="color:#555;margin-top:8px">Page will refresh automatically</p>
</div></body></html>`;

function buildQrPage(ts: number): string {
  return `<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Scan QR — WhatsApp Bot</title>
<meta http-equiv="refresh" content="58">
<style>
*{box-sizing:border-box;margin:0;padding:0;}
body{font-family:'Segoe UI',sans-serif;background:#0a0a0a;color:#fff;
     display:flex;align-items:center;justify-content:center;min-height:100vh;padding:20px;}
.card{background:#111;border:1px solid #1a3a2a;border-radius:20px;padding:40px 32px;
      text-align:center;max-width:400px;width:100%;box-shadow:0 0 60px rgba(37,211,102,.15);}
.badge{background:#25d366;color:#000;border-radius:20px;padding:5px 18px;
       font-size:.8rem;font-weight:700;display:inline-block;margin-bottom:18px;}
h1{color:#25d366;font-size:1.5rem;margin-bottom:6px;}
.sub{color:#777;font-size:.9rem;margin-bottom:24px;}
img.qr{border-radius:12px;border:4px solid #25d366;max-width:100%;width:280px;height:280px;
        background:#fff;display:block;margin:0 auto;}
.steps{margin-top:24px;background:#0d1f17;border-radius:10px;padding:16px;text-align:left;}
.steps li{color:#ccc;margin:8px 0;font-size:.88rem;list-style:none;display:flex;gap:8px;}
.steps li::before{content:"→";color:#25d366;flex-shrink:0;}
.refresh{margin-top:16px;color:#444;font-size:.78rem;}
</style></head>
<body><div class="card">
  <div class="badge">📱 SCAN TO CONNECT</div>
  <h1>Link WhatsApp</h1>
  <p class="sub">Scan with the bot's WhatsApp number</p>
  <img class="qr" src="/qr.png?t=${ts}" alt="WhatsApp QR Code">
  <ul class="steps">
    <li>Open <strong>WhatsApp</strong> on your phone</li>
    <li>Tap <strong>⋮ Menu → Linked Devices</strong></li>
    <li>Tap <strong>"Link a Device"</strong></li>
    <li>Point camera at the QR code above</li>
  </ul>
  <p class="refresh">⏱ Auto-refreshes every 58s for a new QR</p>
</div></body></html>`;
}

// ─── HTTP Server — starts immediately ─────────────────────────────────────────
const server = http.createServer(async (_req, res) => {
  const url = _req.url?.split('?')[0] ?? '/';

  // ── /qr.png — server-side PNG of the current QR code ──────────────────────
  if (url === '/qr.png') {
    if (!latestQr) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('No QR available yet');
      return;
    }
    try {
      const pngBuffer = await QRCode.toBuffer(latestQr, {
        width: 300,
        margin: 2,
        color: { dark: '#000000', light: '#ffffff' },
      });
      res.writeHead(200, {
        'Content-Type': 'image/png',
        'Cache-Control': 'no-store',
        'Content-Length': pngBuffer.length,
      });
      res.end(pngBuffer);
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('QR generation failed');
    }
    return;
  }

  // ── Default — HTML status page ─────────────────────────────────────────────
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  if (botConnected) {
    res.end(HTML_CONNECTED);
  } else if (latestQr) {
    res.end(buildQrPage(Date.now()));
  } else {
    res.end(HTML_LOADING);
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[STARTUP] HTTP server ready on port ${PORT}`);
});

// ─── Bot init (after server is bound) ─────────────────────────────────────────
import 'dotenv/config';
import * as qrcode from 'qrcode-terminal';
import { startBot, setQrCallback, setConnectionCallback } from './bot/connection';
import logger from './config/logger';

setQrCallback((qr: string) => {
  latestQr = qr;
  botConnected = false;
  logger.info(`📱 New QR ready → open http://localhost:${PORT} in browser to scan`);
  qrcode.generate(qr, { small: true });
});

setConnectionCallback((connected: boolean) => {
  botConnected = connected;
  if (connected) latestQr = null;
  logger.info({ connected }, connected ? '✅ WhatsApp connected' : '⚠️ WhatsApp disconnected');
});

async function main(): Promise<void> {
  logger.info(`
╔════════════════════════════════════════════════════╗
║   🤖  WhatsApp Fatawa Bot — Starting               ║
╠════════════════════════════════════════════════════╣
║                                                    ║
║   📱  OPEN THIS IN YOUR BROWSER TO SCAN QR:        ║
║       http://localhost:${PORT}                         ║
║                                                    ║
╚════════════════════════════════════════════════════╝`);
  await startBot();
}

main().catch((err: unknown) => {
  logger.error({ err }, 'Fatal bot startup error — HTTP server still running');
  // Do NOT call process.exit() — keep HTTP server alive for Cloud Run health check
});
