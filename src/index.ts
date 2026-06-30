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
<html><head><meta charset="utf-8"><title>WhatsApp Bot ✅</title>
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
<p>The Fatawa bot is live and listening for messages.</p>
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

function buildLinkPage(ts: number): string {
  return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Link WhatsApp — Fatawa Bot</title>
<meta http-equiv="refresh" content="58">
<style>
*{box-sizing:border-box;margin:0;padding:0;}
body{font-family:'Segoe UI',Tahoma,sans-serif;background:#0a0a0a;color:#fff;
     display:flex;align-items:center;justify-content:center;min-height:100vh;padding:20px;}
.card{background:#111;border:1px solid #1e3a2a;border-radius:24px;padding:36px 28px;
      max-width:440px;width:100%;box-shadow:0 0 80px rgba(37,211,102,.12);}
.header{text-align:center;margin-bottom:28px;}
.badge{background:#25d366;color:#000;border-radius:20px;padding:4px 16px;
       font-size:.78rem;font-weight:700;display:inline-block;margin-bottom:12px;letter-spacing:.5px;}
h1{color:#25d366;font-size:1.6rem;margin-bottom:4px;}
.sub{color:#666;font-size:.88rem;}

/* ── Tabs ── */
.tabs{display:flex;gap:8px;margin-bottom:24px;background:#0d0d0d;border-radius:12px;padding:4px;}
.tab{flex:1;padding:10px;border:none;border-radius:8px;cursor:pointer;font-size:.88rem;
     font-weight:600;transition:all .2s;background:transparent;color:#555;}
.tab.active{background:#25d366;color:#000;}
.tab:hover:not(.active){background:#1a2e22;color:#ccc;}
.pane{display:none;}
.pane.active{display:block;}

/* ── QR ── */
.qr-wrap{text-align:center;margin-bottom:20px;}
img.qr{border-radius:14px;border:4px solid #25d366;width:260px;height:260px;
        background:#fff;display:inline-block;}
.qr-error{color:#f59e0b;font-size:.8rem;margin-top:8px;display:none;}

/* ── Steps ── */
.steps{background:#0d1f17;border-radius:10px;padding:14px 16px;}
.steps li{color:#bbb;margin:7px 0;font-size:.85rem;list-style:none;display:flex;gap:8px;}
.steps li::before{content:"→";color:#25d366;flex-shrink:0;}

/* ── Phone form ── */
.form-group{margin-bottom:16px;}
label{display:block;color:#aaa;font-size:.82rem;margin-bottom:6px;}
input[type=tel]{width:100%;padding:12px 14px;border-radius:10px;border:1px solid #2a3a30;
  background:#0d1a12;color:#fff;font-size:1rem;outline:none;transition:border .2s;}
input[type=tel]:focus{border-color:#25d366;}
input[type=tel]::placeholder{color:#444;}
.btn{width:100%;padding:12px;border:none;border-radius:10px;background:#25d366;
     color:#000;font-size:1rem;font-weight:700;cursor:pointer;transition:opacity .2s;margin-top:4px;}
.btn:hover{opacity:.85;}
.btn:disabled{opacity:.4;cursor:not-allowed;}
.code-box{background:#0d1f17;border:2px solid #25d366;border-radius:14px;padding:20px;
           text-align:center;margin-top:16px;display:none;}
.code-display{font-size:2.4rem;font-weight:800;letter-spacing:.18em;color:#25d366;
               font-family:'Courier New',monospace;}
.code-label{color:#666;font-size:.8rem;margin-top:6px;}
.msg{margin-top:10px;font-size:.84rem;padding:10px 12px;border-radius:8px;display:none;}
.msg.error{background:#2a0d0d;color:#f87171;border:1px solid #5b1c1c;}
.msg.info{background:#0d1f17;color:#6ee7b7;}

.divider{text-align:center;color:#333;font-size:.78rem;margin:20px 0;
          display:flex;align-items:center;gap:10px;}
.divider::before,.divider::after{content:"";flex:1;height:1px;background:#1e2e22;}

.refresh{text-align:center;color:#333;font-size:.75rem;margin-top:18px;}
</style></head>
<body><div class="card">
  <div class="header">
    <div class="badge">🔗 DEVICE LINKING</div>
    <h1>Link WhatsApp</h1>
    <p class="sub">Choose how to link the bot's WhatsApp account</p>
  </div>

  <div class="tabs">
    <button class="tab active" onclick="switchTab('qr',this)" id="tab-qr">📷 Scan QR</button>
    <button class="tab" onclick="switchTab('phone',this)" id="tab-phone">📱 Phone Number</button>
  </div>

  <!-- QR TAB -->
  <div class="pane active" id="pane-qr">
    <div class="qr-wrap">
      <img class="qr" id="qr-img" src="/qr.png?t=${ts}" alt="WhatsApp QR Code"
           onerror="document.querySelector('.qr-error').style.display='block'">
      <p class="qr-error">⚠️ QR image failed to load — try refreshing the page</p>
    </div>
    <div class="steps"><ul>
      <li>Open <strong>WhatsApp</strong> on your phone</li>
      <li>Tap <strong>⋮ Menu → Linked Devices</strong></li>
      <li>Tap <strong>"Link a Device"</strong></li>
      <li>Point camera at the QR above</li>
    </ul></div>
    <p class="refresh">⏱ QR auto-refreshes every 58s</p>
  </div>

  <!-- PHONE NUMBER TAB -->
  <div class="pane" id="pane-phone">

    <!-- ⚠️ Important explanation box -->
    <div style="background:#1a1a0a;border:1px solid #7c6a00;border-radius:10px;padding:14px 16px;margin-bottom:18px;">
      <p style="color:#fbbf24;font-size:.83rem;font-weight:700;margin-bottom:6px;">⚠️ Read this first</p>
      <p style="color:#d4a400;font-size:.8rem;line-height:1.5;">
        The number below = <strong>the bot's own WhatsApp number</strong> (the SIM/phone the bot runs on).<br>
        The 8-char code must be entered on <strong>that exact same phone</strong> — the one whose number you type here.<br>
        <span style="color:#f59e0b;">If they don't match, WhatsApp will say "check the phone number".</span>
      </p>
    </div>

    <div class="steps" style="margin-bottom:18px;"><ul>
      <li>On the <strong>bot's phone</strong> open WhatsApp</li>
      <li>Tap <strong>⋮ Menu → Linked Devices → Link a Device</strong></li>
      <li>Tap <strong>"Link with phone number instead"</strong></li>
      <li>WhatsApp asks for your number — enter it, then it shows a code</li>
      <li><strong>Ignore that code</strong> — enter the code shown on THIS page instead</li>
    </ul></div>

    <div class="form-group">
      <label for="phone-input">Bot's WhatsApp phone number (digits only, with country code)</label>
      <input type="tel" id="phone-input" placeholder="e.g. 96512345678"
             oninput="document.getElementById('code-box').style.display='none';
                      document.getElementById('msg-box').style.display='none';">
      <div style="color:#555;font-size:.78rem;margin-top:5px">
        No +, no spaces, no dashes &nbsp;·&nbsp;
        Kuwait: <code style="color:#25d366">96512345678</code> &nbsp;·&nbsp;
        Pakistan: <code style="color:#25d366">923001234567</code> &nbsp;·&nbsp;
        Saudi: <code style="color:#25d366">966501234567</code>
      </div>
    </div>
    <button class="btn" id="get-code-btn" onclick="requestCode()">Get Pairing Code</button>

    <div class="msg" id="msg-box"></div>

    <div class="code-box" id="code-box">
      <div class="code-display" id="code-display"></div>
      <p class="code-label">Enter this code on the <strong>bot's phone</strong>: WhatsApp → Linked Devices → Link with phone number</p>
      <p style="color:#f59e0b;font-size:.78rem;margin-top:8px">⏱ Code expires in ~60 seconds — enter it quickly</p>
    </div>

    <div style="margin-top:24px;padding-top:20px;border-top:1px solid #1a2e22;text-align:center">
      <p style="color:#555;font-size:.8rem;margin-bottom:10px">Got an error or entered a wrong code? Reset the session:</p>
      <button class="btn" id="reset-btn" onclick="resetAuth()"
        style="background:#1a1a1a;color:#f87171;border:1px solid #5b1c1c;font-size:.85rem;padding:9px">
        🔄 Reset &amp; Start Fresh
      </button>
      <div class="msg" id="reset-msg" style="margin-top:10px"></div>
    </div>
  </div>

</div>

<script>
function switchTab(name, el) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.pane').forEach(p => p.classList.remove('active'));
  el.classList.add('active');
  document.getElementById('pane-' + name).classList.add('active');
}

async function requestCode() {
  const phone = document.getElementById('phone-input').value.replace(/[^0-9]/g,'');
  if (phone.length < 10) {
    showMsg('\u274c Enter the full number with country code, digits only. Example: 923001234567', 'error');
    return;
  }
  const btn = document.getElementById('get-code-btn');
  btn.disabled = true;
  btn.textContent = '\u23f3 Requesting\u2026 (may take up to 20s)';
  showMsg('\u231b Connecting to WhatsApp\u2026 please wait', 'info');
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 22000);
    const resp = await fetch('/link-phone', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ phone }),
      signal: controller.signal
    });
    clearTimeout(timer);
    const data = await resp.json();
    if (resp.ok && data.code) {
      document.getElementById('code-display').textContent = data.code;
      document.getElementById('code-box').style.display = 'block';
      showMsg('\u2705 Code generated! Enter it in WhatsApp within 60 seconds.', 'info');
    } else {
      showMsg('\u274c ' + (data.error || 'Failed to get code. Try again.'), 'error');
    }
  } catch(e) {
    if (e.name === 'AbortError') {
      showMsg('\u274c Timed out — the bot may still be starting. Wait 10 seconds and try again.', 'error');
    } else {
      showMsg('\u274c ' + (e.message || 'Network error. Try again.'), 'error');
    }
  } finally {
    btn.disabled = false;
    btn.textContent = 'Get Pairing Code';
  }
}

function showMsg(text, type) {
  const el = document.getElementById('msg-box');
  el.textContent = text;
  el.className = 'msg ' + type;
  el.style.display = text ? 'block' : 'none';
}

async function resetAuth() {
  const btn = document.getElementById('reset-btn');
  btn.disabled = true;
  btn.textContent = '⏳ Resetting…';
  const msgEl = document.getElementById('reset-msg');
  msgEl.textContent = '';
  msgEl.style.display = 'none';
  try {
    const resp = await fetch('/reset-auth', { method: 'POST' });
    const data = await resp.json();
    msgEl.textContent = '✅ Reset done! Page will reload in 4s to show new QR/pairing…';
    msgEl.className = 'msg info';
    msgEl.style.display = 'block';
    setTimeout(() => location.reload(), 4000);
  } catch(e) {
    msgEl.textContent = '❌ Reset failed: ' + (e.message || 'network error');
    msgEl.className = 'msg error';
    msgEl.style.display = 'block';
    btn.disabled = false;
    btn.textContent = '🔄 Reset & Start Fresh';
  }
}
</script>
</body></html>`;
}

// ─── HTTP Server — starts immediately ─────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  const url = req.url?.split('?')[0] ?? '/';
  const method = req.method?.toUpperCase() ?? 'GET';

  // ── /qr.png — server-side PNG of the current QR code ──────────────────────
  if (url === '/qr.png' && method === 'GET') {
    if (!latestQr) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('No QR available yet');
      return;
    }
    try {
      const pngBuffer = await QRCode.toBuffer(latestQr, {
        width: 400,
        margin: 2,
        errorCorrectionLevel: 'M',
        color: { dark: '#000000', light: '#ffffff' },
      });
      res.writeHead(200, {
        'Content-Type': 'image/png',
        'Cache-Control': 'no-store, no-cache',
        'Content-Length': pngBuffer.length,
      });
      res.end(pngBuffer);
    } catch {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('QR generation failed');
    }
    return;
  }

  // ── POST /link-phone — request pairing code via phone number ───────────────
  if (url === '/link-phone' && method === 'POST') {
    let body = '';
    req.on('data', (chunk) => { body += chunk.toString(); });
    req.on('end', async () => {
      try {
        const { phone } = JSON.parse(body) as { phone?: string };
        if (!phone) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'phone is required' }));
          return;
        }
        if (!requestPairingCodeForPhone) {
          res.writeHead(503, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Bot not initialised yet — wait a few seconds and retry' }));
          return;
        }
        const code = await requestPairingCodeForPhone(phone);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ code }));
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: msg }));
      }
    });
    return;
  }

  // ── POST /reset-auth — wipe auth_info_baileys and reconnect fresh ──────────────────
  if (url === '/reset-auth' && method === 'POST') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, message: 'Auth reset initiated — reconnecting...' }));
    // Reset after response is sent so client gets the reply
    setImmediate(() => {
      resetAuthAndRestart().catch((err) =>
        logger.error({ err }, 'Error during auth reset'),
      );
    });
    return;
  }

  // ── Default — HTML status page ─────────────────────────────────────────────
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  if (botConnected) {
    res.end(HTML_CONNECTED);
  } else if (latestQr) {
    res.end(buildLinkPage(Date.now()));
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
import { startBot, setQrCallback, setConnectionCallback, requestPairingCodeForPhone, resetAuthAndRestart } from './bot/connection';
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
║   📱  OPEN THIS IN YOUR BROWSER TO LINK:           ║
║       http://localhost:${PORT}                         ║
║   Choose QR scan OR phone number pairing           ║
║                                                    ║
╚════════════════════════════════════════════════════╝`);
  await startBot();
}

main().catch((err: unknown) => {
  logger.error({ err }, 'Fatal bot startup error — HTTP server still running');
  // Do NOT call process.exit() — keep HTTP server alive for Cloud Run health check
});
