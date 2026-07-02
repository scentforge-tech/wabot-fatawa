// ─── HTTP server MUST start first ─────────────────────────────────────────────
// Cloud Run requires the container to bind PORT within ~4 minutes.
// We start the server here — BEFORE any other import that might call process.exit().
import * as http from 'http';
import * as QRCode from 'qrcode';

const PORT = Number(process.env.PORT) || 8080;
let latestQr: string | null = null;
let botConnected = false;

// HTML pages defined before server so they're in scope

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
    msgEl.textContent = '✅ Reset done! Waiting for new QR…';
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

// ── Auto-detect when bot connects and redirect ──────────────────────────────
// Poll /api/status every 3 seconds — if connected, reload the page
// (server will then return HTML_CONNECTED instead of HTML_LINK)
(function startPolling() {
  const banner = document.createElement('div');
  banner.style.cssText = 'position:fixed;top:12px;left:50%;transform:translateX(-50%);'
    + 'background:#0d1f17;border:1px solid #25d366;color:#25d366;border-radius:8px;'
    + 'padding:8px 18px;font-size:.8rem;z-index:9999;display:none;';
  banner.textContent = '✅ WhatsApp connected! Redirecting…';
  document.body.appendChild(banner);

  setInterval(async () => {
    try {
      const r = await fetch('/api/status');
      const d = await r.json();
      if (d.connected) {
        banner.style.display = 'block';
        setTimeout(() => location.reload(), 1200);
      }
    } catch (_) { /* ignore network errors */ }
  }, 3000);
})();
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

  // ── GET /api/kb or /api/kb/:id — list / get single KB record ────────────────
  if (url.startsWith('/api/kb') && method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    try {
      const parsed = new URL(url, 'http://localhost');
      const docId  = parsed.pathname.replace('/api/kb', '').replace(/^\//, '');
      const { getFirestore } = await import('firebase-admin/firestore');
      const db = getFirestore();

      if (docId) {
        // Single full record — embed stripped
        const doc = await db.collection('_fatawa_kb').doc(docId).get();
        if (!doc.exists) { res.end(JSON.stringify({ ok: false, error: 'Not found' })); return; }
        const d = doc.data() as any;
        res.end(JSON.stringify({ ok: true, record: { ...d, embedding: undefined, multilingualText: undefined } }));
        return;
      }

      // ── Paginated list — only lightweight fields, NO full transcript ─────────
      const q      = (parsed.searchParams.get('q') || '').toLowerCase();
      const topic  = parsed.searchParams.get('topic') || '';
      const page   = Math.max(1, parseInt(parsed.searchParams.get('page') || '1', 10));
      const limit  = Math.min(25, parseInt(parsed.searchParams.get('limit') || '20', 10));
      const cursor = parsed.searchParams.get('cursor') || ''; // last doc id

      // Base collection reference — lightweight select
      const colRef = db.collection('_fatawa_kb');

      // Topic counts — use a count query to avoid reading all docs
      // We cache topic counts to avoid re-reading on every page change
      let topicCounts: Record<string, number> = {};
      try {
        // Only recompute on first page or when topic filter changes
        if (page === 1 && !q) {
          // Fast count via aggregation (reads 0 documents)
          const allSnap = await colRef.select('topic').limit(700).get();
          allSnap.docs.forEach(d => {
            const t = (d.data() as any).topic || '?';
            topicCounts[t] = (topicCounts[t] || 0) + 1;
          });
        }
      } catch { topicCounts = {}; }

      // Build query — lightweight fields only
      let query: FirebaseFirestore.Query = colRef
        .select('id','question','questionLang','topic','replyMode','audioFileName',
                'confidence','accuracyLabel','authenticRuling','v3ingested')
        .orderBy('id')
        .limit(limit);

      if (topic) {
        query = colRef
          .select('id','question','questionLang','topic','replyMode','audioFileName',
                  'confidence','accuracyLabel','authenticRuling','v3ingested')
          .where('topic', '==', topic)
          .limit(limit);
      }

      // Cursor-based pagination
      if (cursor) {
        const cursorDoc = await colRef.doc(cursor).get();
        if (cursorDoc.exists) query = query.startAfter(cursorDoc);
      }

      const snap = await query.get();
      let items = snap.docs.map(d => {
        const data = d.data() as any;
        // Truncate ruling for list view
        return {
          id: data.id, question: data.question, questionLang: data.questionLang,
          topic: data.topic, replyMode: data.replyMode, audioFileName: data.audioFileName,
          confidence: data.confidence, accuracyLabel: data.accuracyLabel,
          authenticRuling: data.authenticRuling ? data.authenticRuling.slice(0, 100) : '',
          v3ingested: data.v3ingested,
        };
      });

      // In-memory text search (only over the loaded page)
      if (q) {
        // For search, we need to scan more — fetch up to 200 docs then filter
        const searchSnap = await colRef
          .select('id','question','questionLang','topic','replyMode','audioFileName',
                  'confidence','accuracyLabel','authenticRuling','v3ingested')
          .orderBy('id').limit(200).get();
        const allDocs = searchSnap.docs.map(d => {
          const data = d.data() as any;
          return {
            id: data.id, question: data.question, questionLang: data.questionLang,
            topic: data.topic, replyMode: data.replyMode, audioFileName: data.audioFileName,
            confidence: data.confidence, accuracyLabel: data.accuracyLabel,
            authenticRuling: data.authenticRuling ? data.authenticRuling.slice(0, 100) : '',
            v3ingested: data.v3ingested,
          };
        });
        items = allDocs.filter(d =>
          (d.question||'').toLowerCase().includes(q) ||
          (d.authenticRuling||'').toLowerCase().includes(q) ||
          (d.topic||'').toLowerCase().includes(q) ||
          (d.audioFileName||'').toLowerCase().includes(q),
        ).slice((page-1)*limit, page*limit);
      }

      const nextCursor = snap.docs.length === limit ? snap.docs[snap.docs.length-1].id : '';
      res.end(JSON.stringify({
        ok: true, items,
        total: q ? items.length : (topic ? items.length : -1), // -1 = unknown (use cursor)
        page, limit,
        nextCursor,
        topicCounts,
      }));
    } catch (err) { res.end(JSON.stringify({ ok: false, items: [], total: 0, error: String(err) })); }
    return;
  }

  // ── PUT /api/kb/:id — edit a KB record ───────────────────────────────────────
  if (url.startsWith('/api/kb/') && method === 'PUT') {
    const docId = url.split('/api/kb/')[1];
    let body = '';
    req.on('data', (c) => body += c);
    req.on('end', async () => {
      try {
        const u = JSON.parse(body);
        const { getFirestore } = await import('firebase-admin/firestore');
        const updateData: Record<string, any> = { editedAt: new Date().toISOString(), editedVia: 'dashboard' };
        if (u.question !== undefined)        updateData.question = u.question;
        if (u.topic !== undefined)            updateData.topic = u.topic;
        if (u.answerText !== undefined)       updateData.answerText = u.answerText;
        if (u.answerTranscript !== undefined) updateData.answerTranscript = u.answerTranscript;
        if (u.authenticRuling !== undefined)  updateData.authenticRuling = u.authenticRuling;
        if (u.rulingKeyPoints !== undefined)  updateData.rulingKeyPoints = u.rulingKeyPoints;
        if (u.confidence !== undefined)       updateData.confidence = parseFloat(u.confidence);
        if (u.accuracyLabel !== undefined)    updateData.accuracyLabel = u.accuracyLabel;
        await getFirestore().collection('_fatawa_kb').doc(docId).update(updateData);
        // Safely clear in-memory cache if module is loaded
        try {
          const { clearKbCache } = await import('./services/fatawa-kb.service');
          clearKbCache();
        } catch { /* cache not critical */ }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: String(err) }));
      }
    });
    return;
  }

  // ── DELETE /api/kb/:id — delete a KB record ─────────────────────────────────
  if (url.startsWith('/api/kb/') && method === 'DELETE') {
    const docId = url.split('/api/kb/')[1];
    try {
      const { getFirestore } = await import('firebase-admin/firestore');
      await getFirestore().collection('_fatawa_kb').doc(docId).delete();
      try {
        const { clearKbCache } = await import('./services/fatawa-kb.service');
        clearKbCache();
      } catch { /* cache not critical */ }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: String(err) }));
    }
    return;
  }

  // ── POST /api/kb — create new KB record with Gemini embedding ────────────────
  if (url === '/api/kb' && method === 'POST') {
    let body = '';
    req.on('data', (c) => body += c);
    req.on('end', async () => {
      try {
        const input = JSON.parse(body);
        if (!input.question || !input.topic) throw new Error('question and topic are required');
        const GEMINI_KEY = process.env.GEMINI_API_KEY;
        if (!GEMINI_KEY) throw new Error('GEMINI_API_KEY not set');
        const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';
        const docId = 'kb_' + Date.now();

        // Helper: call Gemini generate
        const callGemini = async (prompt: string) => {
          const r = await fetch(`${GEMINI_BASE}/models/gemini-2.5-flash:generateContent?key=${GEMINI_KEY}`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { maxOutputTokens: 600, temperature: 0.15 } }),
          });
          const j = await r.json() as any;
          return j.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? '';
        };

        // Helper: get embedding
        const getEmbedding = async (text: string) => {
          const r = await fetch(`${GEMINI_BASE}/models/gemini-embedding-001:embedContent?key=${GEMINI_KEY}`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: 'models/gemini-embedding-001', content: { parts: [{ text: text.slice(0, 3000) }] }, outputDimensionality: 768 }),
          });
          const j = await r.json() as any;
          return j.embedding?.values ?? [];
        };

        // Step 1: Generate multilingual augmentation
        const augPrompt = `Fatawa specialist. Question: "${input.question.slice(0,150)}" Topic: ${input.topic}
${input.answerTranscript ? 'Answer: "' + input.answerTranscript.slice(0,300) + '"' : ''}
${input.authenticRuling ? 'Ruling: ' + input.authenticRuling.slice(0,150) : ''}
Give THREE parts separated by ---:
PART 1: Roman Urdu transliteration of answer:
---
PART 2: English answer summary (2-3 sentences):
---
PART 3: 5 WhatsApp question variants (1 per line):`;
        const augText = await callGemini(augPrompt);
        const parts = augText.split('---').map((p: string) => p.trim());
        const romanUrdu = parts[0] || '';
        const englishTranslation = parts[1] || '';
        const questionVariants = parts[2] || '';

        // Step 2: Build embed text
        const embedText = [
          input.question, input.authenticRuling || '', input.rulingKeyPoints || '',
          `Topic: ${input.topic}`, romanUrdu, englishTranslation, questionVariants,
          input.answerTranscript || input.answerText || '',
        ].filter(Boolean).join('\n').slice(0, 3000);

        // Step 3: Get embedding
        const embedding = await getEmbedding(embedText);

        // Step 4: Save to Firestore
        const { getFirestore } = await import('firebase-admin/firestore');
        const record = {
          id: docId, question: input.question, questionLang: input.questionLang || 'English',
          topic: input.topic, replyMode: input.audioFileName ? 'audio' : 'text',
          audioFileName: input.audioFileName || '', audioFile: input.audioFileName ? `gs://${process.env.GCS_BUCKET_NAME || 'wabot-fatawa-audio'}/${input.audioFileName}` : '',
          answerText: input.answerText || '', answerTranscript: input.answerTranscript || '',
          authenticRuling: input.authenticRuling || '', rulingKeyPoints: input.rulingKeyPoints || '',
          accuracyLabel: input.accuracyLabel || 'Dashboard Added', confidence: parseFloat(input.confidence) || 0.75,
          romanUrduTranscript: romanUrdu, englishTranslation, questionVariants,
          keywords: (await import('./services/fatawa-kb.service')).deriveMultilingualKeywords([
            input.question, romanUrdu, englishTranslation, input.authenticRuling, input.rulingKeyPoints,
            input.answerTranscript, input.answerText, input.topic,
          ]),
          embedding, multilingualText: embedText.slice(0, 1000),
          v3ingested: false, dashboardAdded: true, createdAt: new Date().toISOString(),
        };
        await getFirestore().collection('_fatawa_kb').doc(docId).set(record);
        try { const { clearKbCache } = await import('./services/fatawa-kb.service'); clearKbCache(); } catch {}
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, id: docId, embedded: embedding.length > 0 }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: String(err) }));
      }
    });
    return;
  }

  // ── POST /api/kb/:id/embed — re-embed an existing KB record ──────────────────
  if (url.match(/^\/api\/kb\/[^/]+\/embed$/) && method === 'POST') {
    const docId = url.split('/api/kb/')[1].replace('/embed', '');
    try {
      const GEMINI_KEY = process.env.GEMINI_API_KEY;
      if (!GEMINI_KEY) throw new Error('GEMINI_API_KEY not set');
      const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';
      const { getFirestore } = await import('firebase-admin/firestore');
      const doc = await getFirestore().collection('_fatawa_kb').doc(docId).get();
      if (!doc.exists) throw new Error('Record not found');
      const d = doc.data() as any;
      const embedText = [d.question, d.authenticRuling, d.rulingKeyPoints, `Topic: ${d.topic}`,
        d.romanUrduTranscript, d.englishTranslation, d.answerTranscript || d.answerText].filter(Boolean).join('\n').slice(0, 3000);
      const r = await fetch(`${GEMINI_BASE}/models/gemini-embedding-001:embedContent?key=${GEMINI_KEY}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'models/gemini-embedding-001', content: { parts: [{ text: embedText }] }, outputDimensionality: 768 }),
      });
      const j = await r.json() as any;
      const embedding = j.embedding?.values ?? [];
      await getFirestore().collection('_fatawa_kb').doc(docId).update({ embedding, reembeddedAt: new Date().toISOString() });
      try { const { clearKbCache } = await import('./services/fatawa-kb.service'); clearKbCache(); } catch {}
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, dims: embedding.length }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: String(err) }));
    }
    return;
  }

  // ── POST /api/kb/:id/upload-audio — attach an audio file to a KB record ──────
  if (url.match(/^\/api\/kb\/[^/]+\/upload-audio$/) && method === 'POST') {
    const docId = url.split('/api/kb/')[1].replace('/upload-audio', '');
    let body = '';
    req.on('data', (c) => body += c);
    req.on('end', async () => {
      try {
        const { filename, dataBase64 } = JSON.parse(body);
        if (!filename || !dataBase64) throw new Error('filename and dataBase64 are required');
        const safeName = `kb-${docId}-${filename}`.replace(/[^a-zA-Z0-9._-]/g, '_');
        const buffer = Buffer.from(dataBase64, 'base64');
        if (buffer.length < 100) throw new Error('Audio file is empty or too small');

        const { uploadAudioBuffer, clearKbCache } = await import('./services/fatawa-kb.service');
        await uploadAudioBuffer(buffer, safeName);

        const { getFirestore } = await import('firebase-admin/firestore');
        await getFirestore().collection('_fatawa_kb').doc(docId).update({
          audioFileName: safeName,
          audioFile: `gs://${process.env.GCS_BUCKET_NAME || 'wabot-fatawa-audio'}/${safeName}`,
          replyMode: 'audio',
        });
        clearKbCache();

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, audioFileName: safeName }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: String(err) }));
      }
    });
    return;
  }

  // ── GET /api/analytics — KB statistics for dashboard charts ──────────────────
  if (url === '/api/analytics' && method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'max-age=60' });
    try {
      const { getFirestore } = await import('firebase-admin/firestore');
      const db = getFirestore();
      const snap = await db.collection('_fatawa_kb')
        .select('topic', 'questionLang', 'replyMode', 'confidence', 'accuracyLabel', 'v3ingested')
        .limit(700).get();
      const topicCounts: Record<string, number> = {};
      const langCounts: Record<string, number> = {};
      const confBuckets = { low: 0, med: 0, high: 0, vhigh: 0 };
      let audioCount = 0, textCount = 0, v3Count = 0;
      snap.docs.forEach(d => {
        const data = d.data() as any;
        const topic = data.topic || 'GENERAL';
        topicCounts[topic] = (topicCounts[topic] || 0) + 1;
        const lang = data.questionLang || 'Unknown';
        langCounts[lang] = (langCounts[lang] || 0) + 1;
        const conf = parseFloat(data.confidence) || 0;
        if (conf >= 0.9) confBuckets.vhigh++;
        else if (conf >= 0.8) confBuckets.high++;
        else if (conf >= 0.65) confBuckets.med++;
        else confBuckets.low++;
        if (data.replyMode === 'audio') audioCount++; else textCount++;
        if (data.v3ingested) v3Count++;
      });
      const [pendingSnap, totalKb] = await Promise.all([
        db.collection('_fatawa_pending').where('status','==','pending').count().get(),
        db.collection('_fatawa_kb').count().get(),
      ]);
      res.end(JSON.stringify({
        ok: true, totalRecords: totalKb.data().count, audioRecords: audioCount, textRecords: textCount,
        v3Records: v3Count, pendingApprovals: pendingSnap.data().count,
        topicCounts, langCounts, confBuckets,
      }));
    } catch (err) { res.end(JSON.stringify({ ok: false, error: String(err) })); }
    return;
  }

  // ── GET /api/pending — list pending questions awaiting admin approval ────────
  if (url === '/api/pending' && method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    try {
      // Get last 10 pending questions
      const { getFirestore } = await import('firebase-admin/firestore');
      const db = getFirestore();
      const snap = await db.collection('_fatawa_pending')
        .where('status', '==', 'pending')
        .orderBy('createdAt', 'desc')
        .limit(10)
        .get();
      const pending = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      res.end(JSON.stringify({ ok: true, pending }));
    } catch (err) {
      res.end(JSON.stringify({ ok: false, pending: [], error: String(err) }));
    }
    return;
  }

  // ── GET /api/debug — current bot routing state ───────────────────────────────
  if (url === '/api/debug' && method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    try {
      const { getGroupSettings } = await import('./services/settings.service');
      const settings = getGroupSettings();
      // Count KB records
      let kbCount = 0;
      try {
        const { getFirestore } = await import('firebase-admin/firestore');
        const db = getFirestore();
        const snap = await db.collection('_fatawa_kb').count().get();
        kbCount = snap.data().count;
      } catch {}
      res.end(JSON.stringify({
        connected: botConnected,
        settings,
        kbCount,
        timestamp: Date.now(),
      }));
    } catch (err) {
      res.end(JSON.stringify({ error: String(err) }));
    }
    return;
  }

  // ── POST /clear-firestore-auth — wipe _wabot_auth collection in Firestore ───
  // Call this BEFORE /reset-auth when changing numbers, so Cloud Run doesn't
  // restore old credentials from Firestore on the next restart.
  if (url === '/clear-firestore-auth' && method === 'POST') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    setImmediate(async () => {
      try {
        const { clearFirestoreAuth } = await import('./bot/auth-firestore');
        await clearFirestoreAuth();
        logger.info('Firestore auth cleared via /clear-firestore-auth');
      } catch (err) {
        logger.error({ err }, 'Failed to clear Firestore auth');
      }
    });
    return;
  }

  // ── GET /api/status — JSON polling endpoint for QR page auto-redirect ──────
  if (url === '/api/status' && method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ connected: botConnected }));
    return;
  }

  // ── GET /api/groups — fetch all WhatsApp groups the bot is in ───────────────
  if (url === '/api/groups' && method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    try {
      const { getSocket } = await import('./bot/connection');
      const sock = getSocket();
      if (!sock) { res.end(JSON.stringify({ groups: [], error: 'Bot not connected' })); return; }
      const raw = await sock.groupFetchAllParticipating();
      const groups = Object.entries(raw).map(([id, meta]: [string, any]) => ({
        id,
        name: meta.subject ?? id,
        participants: meta.participants?.length ?? 0,
      })).sort((a, b) => a.name.localeCompare(b.name));
      res.end(JSON.stringify({ groups }));
    } catch (err) {
      res.end(JSON.stringify({ groups: [], error: String(err) }));
    }
    return;
  }

  // ── GET /api/settings — load current group selections ───────────────────────
  if (url === '/api/settings' && method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    const { getGroupSettings } = await import('./services/settings.service');
    res.end(JSON.stringify(getGroupSettings()));
    return;
  }

  // ── POST /api/settings — save group selections to Firestore ─────────────────
  if (url === '/api/settings' && method === 'POST') {
    let body = '';
    req.on('data', (chunk) => body += chunk);
    req.on('end', async () => {
      try {
        const parsed = JSON.parse(body);
        const { publicGroupJid, adminGroupJid, replyMode, autoReplyThreshold, answerDMs } = parsed;
        const { saveGroupSettings } = await import('./services/settings.service');
        // Only forward fields that were actually provided (partial update).
        const patch: Record<string, unknown> = {};
        if (publicGroupJid !== undefined) patch.publicGroupJid = publicGroupJid;
        if (adminGroupJid !== undefined) patch.adminGroupJid = adminGroupJid;
        if (replyMode !== undefined) patch.replyMode = replyMode;
        if (autoReplyThreshold !== undefined) patch.autoReplyThreshold = Number(autoReplyThreshold);
        if (answerDMs !== undefined) patch.answerDMs = Boolean(answerDMs);
        const saved = await saveGroupSettings(patch);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, settings: saved }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: String(err) }));
      }
    });
    return;
  }

  // ── GET /api/events — SSE stream for dashboard real-time updates ─────────────
  if (url === '/api/events' && method === 'GET') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write(':ok\n\n');
    // Send current status immediately
    res.write(`event: status\ndata: ${JSON.stringify({ connected: botConnected })}\n\n`);
    const { addSseClient, removeSseClient } = await import('./bot/connection');
    addSseClient(res);
    // Heartbeat every 25s — keeps connection alive through Cloud Run's 60s timeout
    const heartbeat = setInterval(() => {
      try { res.write(': heartbeat\n\n'); } catch { clearInterval(heartbeat); }
    }, 25000);
    req.on('close', () => { removeSseClient(res); clearInterval(heartbeat); });
    return;
  }

  // ── POST /api/send — send a message from the dashboard ──────────────────────
  if (url === '/api/send' && method === 'POST') {
    let body = '';
    req.on('data', (chunk) => body += chunk);
    req.on('end', async () => {
      try {
        const { jid, text } = JSON.parse(body);
        if (!jid || !text) throw new Error('jid and text are required');
        const { getSocket, emitDashboardEvent } = await import('./bot/connection');
        const sock = getSocket();
        if (!sock) throw new Error('Bot not connected');
        await sock.sendMessage(jid, { text });
        emitDashboardEvent('bot_message', { id: Date.now()+'', remoteJid: jid,
          pushName: 'Bot (manual)', fromMe: true, msgType: 'conversation',
          text, timestamp: Date.now() });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: String(err) }));
      }
    });
    return;
  }

  // ── Default — HTML page ────────────────────────────────────────────────────
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  if (botConnected) {
    const { buildDashboardHTML } = await import('./bot/dashboard');
    res.end(buildDashboardHTML());
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
