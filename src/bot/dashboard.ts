/**
 * Admin Dashboard HTML
 * Two-tab SPA served at the root URL when WhatsApp is connected.
 * Tab 1 – Setup:   select public & admin groups from live WhatsApp group list
 * Tab 2 – Monitor: real-time SSE message feed + manual send panel
 */

export function buildDashboardHTML(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>WhatsApp Bot Dashboard</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box;}
:root{
  --bg:#0a0d12;--surface:#111620;--surface2:#181f2e;--border:#1e2a3a;
  --green:#25d366;--green-dim:#1a9e4a;--amber:#f59e0b;--red:#ef4444;
  --blue:#3b82f6;--text:#e2e8f0;--muted:#64748b;--font:'Inter',sans-serif;
}
html,body{height:100%;font-family:var(--font);background:var(--bg);color:var(--text);}
a{color:inherit;text-decoration:none;}
button{font-family:var(--font);cursor:pointer;}
input,textarea,select{font-family:var(--font);}

/* ── Layout ── */
.app{display:flex;flex-direction:column;height:100vh;}
.topbar{display:flex;align-items:center;gap:16px;padding:12px 20px;
  background:var(--surface);border-bottom:1px solid var(--border);flex-shrink:0;}
.topbar-logo{font-size:1.1rem;font-weight:700;color:var(--green);}
.topbar-logo span{color:var(--text);font-weight:400;}
.status-dot{width:9px;height:9px;border-radius:50%;background:var(--green);
  box-shadow:0 0 8px var(--green);flex-shrink:0;}
.status-dot.offline{background:var(--red);box-shadow:0 0 8px var(--red);}
.status-label{font-size:.82rem;color:var(--muted);}
.tabs{display:flex;gap:4px;margin-left:auto;}
.tab{padding:6px 16px;border-radius:8px;border:none;background:transparent;
  color:var(--muted);font-size:.85rem;font-weight:500;transition:.15s;}
.tab.active{background:var(--green);color:#000;}
.tab:hover:not(.active){background:var(--surface2);}
.content{flex:1;overflow:hidden;display:flex;flex-direction:column;}
.panel{display:none;flex:1;overflow:hidden;flex-direction:column;}
.panel.active{display:flex;}

/* ── Setup Tab ── */
.setup-wrap{flex:1;overflow-y:auto;padding:24px;max-width:900px;width:100%;margin:0 auto;}
.setup-wrap h2{font-size:1.1rem;font-weight:600;margin-bottom:4px;}
.setup-wrap p.sub{font-size:.84rem;color:var(--muted);margin-bottom:20px;}
.card{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:20px;margin-bottom:16px;}
.card h3{font-size:.9rem;font-weight:600;margin-bottom:12px;color:var(--text);}
.btn{display:inline-flex;align-items:center;gap:8px;padding:8px 18px;border-radius:8px;
  border:none;font-size:.85rem;font-weight:600;transition:.15s;}
.btn-primary{background:var(--green);color:#000;}
.btn-primary:hover{background:var(--green-dim);}
.btn-secondary{background:var(--surface2);color:var(--text);border:1px solid var(--border);}
.btn-secondary:hover{background:var(--border);}
.btn-amber{background:var(--amber);color:#000;}
.btn-amber:hover{opacity:.9;}
.btn:disabled{opacity:.5;cursor:not-allowed;}
.group-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:10px;margin-top:12px;}
.group-card{background:var(--surface2);border:2px solid var(--border);border-radius:10px;
  padding:12px 14px;cursor:pointer;transition:.15s;position:relative;}
.group-card:hover{border-color:var(--green);}
.group-card.selected-public{border-color:var(--green);background:#0d1f17;}
.group-card.selected-admin{border-color:var(--amber);background:#1f150d;}
.group-card .gname{font-size:.88rem;font-weight:600;margin-bottom:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.group-card .gjid{font-size:.72rem;color:var(--muted);font-family:monospace;}
.group-card .badge{position:absolute;top:8px;right:8px;font-size:.68rem;font-weight:700;
  padding:2px 8px;border-radius:20px;}
.badge-public{background:var(--green);color:#000;}
.badge-admin{background:var(--amber);color:#000;}
.legend{display:flex;gap:16px;margin-bottom:12px;font-size:.8rem;color:var(--muted);}
.legend span{display:flex;align-items:center;gap:6px;}
.legend-dot{width:8px;height:8px;border-radius:2px;flex-shrink:0;}
.alert{padding:10px 14px;border-radius:8px;font-size:.84rem;margin-top:8px;}
.alert-success{background:#0d1f17;color:var(--green);border:1px solid var(--green-dim);}
.alert-error{background:#1f0d0d;color:var(--red);border:1px solid #7f1d1d;}
.alert-info{background:var(--surface2);color:var(--text);border:1px solid var(--border);}
.sel-summary{display:flex;gap:12px;flex-wrap:wrap;margin-top:12px;}
.sel-item{padding:8px 14px;border-radius:8px;font-size:.82rem;flex:1;min-width:200px;}
.sel-item.set{background:#0d1f17;border:1px solid var(--green-dim);color:var(--text);}
.sel-item.unset{background:var(--surface2);border:1px solid var(--border);color:var(--muted);}
.sel-item strong{display:block;font-size:.72rem;color:var(--muted);margin-bottom:2px;}

/* ── Monitor Tab ── */
.monitor-layout{flex:1;display:grid;grid-template-columns:1fr 320px;overflow:hidden;}
.feed-wrap{display:flex;flex-direction:column;border-right:1px solid var(--border);overflow:hidden;}
.feed-header{display:flex;align-items:center;gap:10px;padding:12px 16px;
  border-bottom:1px solid var(--border);flex-shrink:0;}
.feed-header h3{font-size:.9rem;font-weight:600;}
.feed-count{background:var(--surface2);color:var(--muted);font-size:.72rem;
  padding:2px 8px;border-radius:20px;font-weight:600;}
.feed{flex:1;overflow-y:auto;padding:12px 16px;display:flex;flex-direction:column;gap:8px;}
.msg-bubble{padding:10px 12px;border-radius:10px;font-size:.84rem;max-width:90%;
  animation:fadeIn .2s ease;}
@keyframes fadeIn{from{opacity:0;transform:translateY(4px);}}
.msg-bubble.inbound{background:var(--surface);border:1px solid var(--border);align-self:flex-start;}
.msg-bubble.outbound{background:#0d1f17;border:1px solid var(--green-dim);align-self:flex-end;}
.msg-bubble.system{background:var(--surface2);border:1px dashed var(--border);
  align-self:center;color:var(--muted);font-size:.78rem;max-width:100%;text-align:center;}
.msg-meta{display:flex;align-items:center;gap:8px;margin-bottom:4px;flex-wrap:wrap;}
.msg-sender{font-weight:600;font-size:.8rem;color:var(--green);}
.msg-sender.admin{color:var(--amber);}
.msg-jid{font-size:.7rem;color:var(--muted);font-family:monospace;}
.msg-time{font-size:.7rem;color:var(--muted);margin-left:auto;}
.msg-type-badge{font-size:.68rem;padding:1px 6px;border-radius:4px;
  background:var(--surface2);color:var(--muted);}
.msg-text{word-break:break-word;line-height:1.5;}
.msg-text.empty{color:var(--muted);font-style:italic;}

/* ── Send Panel ── */
.send-panel{display:flex;flex-direction:column;overflow:hidden;background:var(--surface);}
.send-header{padding:12px 16px;border-bottom:1px solid var(--border);flex-shrink:0;}
.send-header h3{font-size:.9rem;font-weight:600;margin-bottom:4px;}
.send-body{flex:1;overflow-y:auto;padding:14px 14px 0;}
.field{margin-bottom:12px;}
.field label{display:block;font-size:.78rem;color:var(--muted);font-weight:500;margin-bottom:4px;}
.field select,.field textarea,.field input{width:100%;background:var(--surface2);
  border:1px solid var(--border);border-radius:8px;color:var(--text);
  padding:8px 10px;font-size:.84rem;outline:none;transition:.15s;resize:none;}
.field select:focus,.field textarea:focus,.field input:focus{border-color:var(--green);}
.field textarea{height:90px;line-height:1.5;}
.send-footer{padding:14px;flex-shrink:0;}
.send-footer .btn{width:100%;justify-content:center;}
.send-status{font-size:.78rem;text-align:center;margin-top:8px;min-height:20px;}

/* ── Scrollbar ── */
::-webkit-scrollbar{width:5px;}
::-webkit-scrollbar-track{background:transparent;}
::-webkit-scrollbar-thumb{background:var(--border);border-radius:10px;}
</style>
</head>
<body>
<div class="app">
  <!-- Top Bar -->
  <div class="topbar">
    <div class="status-dot" id="status-dot"></div>
    <div class="topbar-logo">WhatsApp Bot <span>Dashboard</span></div>
    <div class="status-label" id="status-label">Connected</div>
    <div class="tabs">
      <button class="tab active" onclick="switchTab('setup')">⚙️ Setup</button>
      <button class="tab" onclick="switchTab('monitor')">📡 Monitor</button>
    </div>
  </div>

  <div class="content">
    <!-- Setup Panel -->
    <div class="panel active" id="panel-setup">
      <div class="setup-wrap">
        <h2>Group Configuration</h2>
        <p class="sub">Select which WhatsApp group is the Public (questions) group and which is the Admin (approval) group. Settings are saved to Firestore instantly.</p>

        <!-- Current selection summary -->
        <div class="card">
          <h3>Current Selection</h3>
          <div class="sel-summary">
            <div class="sel-item" id="summary-public">
              <strong>📢 PUBLIC GROUP</strong>
              <span id="summary-public-val">Not set</span>
            </div>
            <div class="sel-item" id="summary-admin">
              <strong>🔐 ADMIN GROUP</strong>
              <span id="summary-admin-val">Not set</span>
            </div>
          </div>
        </div>

        <!-- Group list -->
        <div class="card">
          <h3>Available Groups</h3>
          <div class="legend">
            <span><div class="legend-dot" style="background:var(--green)"></div> Click once = Public group</span>
            <span><div class="legend-dot" style="background:var(--amber)"></div> Click twice = Admin group</span>
            <span><div class="legend-dot" style="background:var(--border)"></div> Click three times = Deselect</span>
          </div>
          <button class="btn btn-secondary" id="load-btn" onclick="loadGroups()">🔄 Load Groups from WhatsApp</button>
          <div id="groups-alert"></div>
          <div class="group-grid" id="groups-grid"></div>
        </div>

        <div style="display:flex;gap:10px;margin-top:4px;">
          <button class="btn btn-primary" onclick="saveSettings()">💾 Save Settings</button>
          <div id="save-alert" style="flex:1;"></div>
        </div>
      </div>
    </div>

    <!-- Monitor Panel -->
    <div class="panel" id="panel-monitor">
      <div class="monitor-layout">
        <!-- Message Feed -->
        <div class="feed-wrap">
          <div class="feed-header">
            <h3>📡 Live Messages</h3>
            <span class="feed-count" id="msg-count">0</span>
            <button class="btn btn-secondary" style="margin-left:auto;padding:4px 12px;font-size:.78rem;" onclick="clearFeed()">Clear</button>
          </div>
          <div class="feed" id="msg-feed">
            <div class="msg-bubble system">Listening for messages… SSE connected.</div>
          </div>
        </div>

        <!-- Send Panel -->
        <div class="send-panel">
          <div class="send-header">
            <h3>✉️ Manual Send</h3>
          </div>
          <div class="send-body">
            <div class="field">
              <label>Target Group / JID</label>
              <select id="send-target">
                <option value="">— Select group —</option>
                <option value="__public__">📢 Public Group</option>
                <option value="__admin__">🔐 Admin Group</option>
                <option value="__custom__">✏️ Custom JID...</option>
              </select>
            </div>
            <div class="field" id="custom-jid-field" style="display:none;">
              <label>Custom JID</label>
              <input type="text" id="custom-jid" placeholder="1234567890@g.us">
            </div>
            <div class="field">
              <label>Message</label>
              <textarea id="send-text" placeholder="Type your message..."></textarea>
            </div>
          </div>
          <div class="send-footer">
            <button class="btn btn-primary" id="send-btn" onclick="sendMessage()">📤 Send</button>
            <div class="send-status" id="send-status"></div>
          </div>
        </div>
      </div>
    </div>
  </div>
</div>

<script>
// ── State ──────────────────────────────────────────────────────────────────────
const state = {
  groups: [],          // [{id, name}]
  publicJid: null,
  adminJid: null,
  msgCount: 0,
};

// ── Tab switching ──────────────────────────────────────────────────────────────
function switchTab(tab) {
  document.querySelectorAll('.tab').forEach((t, i) => t.classList.toggle('active', ['setup','monitor'][i] === tab));
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  document.getElementById('panel-' + tab).classList.add('active');
}

// ── Load settings on page open ────────────────────────────────────────────────
async function initSettings() {
  try {
    const r = await fetch('/api/settings');
    const d = await r.json();
    if (d.publicGroupJid) state.publicJid = d.publicGroupJid;
    if (d.adminGroupJid) state.adminJid = d.adminGroupJid;
    updateSummary();
  } catch {}
}

function updateSummary() {
  const pub = state.groups.find(g => g.id === state.publicJid);
  const adm = state.groups.find(g => g.id === state.adminJid);

  const pubEl = document.getElementById('summary-public');
  const admEl = document.getElementById('summary-admin');
  document.getElementById('summary-public-val').textContent = pub ? pub.name : (state.publicJid || 'Not set');
  document.getElementById('summary-admin-val').textContent  = adm ? adm.name : (state.adminJid  || 'Not set');
  pubEl.className = 'sel-item ' + (state.publicJid ? 'set' : 'unset');
  admEl.className = 'sel-item ' + (state.adminJid  ? 'set' : 'unset');
}

// ── Load groups ────────────────────────────────────────────────────────────────
async function loadGroups() {
  const btn = document.getElementById('load-btn');
  const alert = document.getElementById('groups-alert');
  btn.disabled = true;
  btn.textContent = '⏳ Fetching groups...';
  alert.innerHTML = '';
  try {
    const r = await fetch('/api/groups');
    const d = await r.json();
    if (!d.groups || d.groups.length === 0) {
      alert.innerHTML = '<div class="alert alert-info">No groups found. Make sure the bot is a member of at least one group.</div>';
      return;
    }
    state.groups = d.groups;
    renderGroups();
    alert.innerHTML = '<div class="alert alert-success">✅ ' + d.groups.length + ' groups loaded</div>';
    updateSummary();
  } catch(e) {
    alert.innerHTML = '<div class="alert alert-error">❌ Failed to load groups: ' + e.message + '</div>';
  } finally {
    btn.disabled = false;
    btn.textContent = '🔄 Reload Groups';
  }
}

function renderGroups() {
  const grid = document.getElementById('groups-grid');
  grid.innerHTML = '';
  for (const g of state.groups) {
    const card = document.createElement('div');
    card.className = 'group-card';
    card.dataset.jid = g.id;
    if (g.id === state.publicJid) card.classList.add('selected-public');
    if (g.id === state.adminJid)  card.classList.add('selected-admin');
    card.innerHTML =
      '<div class="gname" title="' + escHtml(g.name) + '">' + escHtml(g.name) + '</div>' +
      '<div class="gjid">' + g.id + '</div>' +
      (g.id === state.publicJid ? '<div class="badge badge-public">PUBLIC</div>' : '') +
      (g.id === state.adminJid  ? '<div class="badge badge-admin">ADMIN</div>'  : '');
    card.addEventListener('click', () => cycleGroupSelect(g.id, g.name));
    grid.appendChild(card);
  }
}

function cycleGroupSelect(jid, name) {
  if (state.publicJid !== jid && state.adminJid !== jid) {
    // Not selected → set as public
    state.publicJid = jid;
  } else if (state.publicJid === jid) {
    // Is public → switch to admin
    state.publicJid = null;
    state.adminJid = jid;
  } else {
    // Is admin → deselect
    state.adminJid = null;
  }
  renderGroups();
  updateSummary();
}

// ── Save settings ──────────────────────────────────────────────────────────────
async function saveSettings() {
  const alertEl = document.getElementById('save-alert');
  if (!state.publicJid && !state.adminJid) {
    alertEl.innerHTML = '<div class="alert alert-error">Select at least one group first</div>';
    return;
  }
  try {
    const r = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ publicGroupJid: state.publicJid, adminGroupJid: state.adminJid }),
    });
    const d = await r.json();
    if (d.ok) {
      alertEl.innerHTML = '<div class="alert alert-success">✅ Settings saved! Bot is now routing messages.</div>';
      setTimeout(() => alertEl.innerHTML = '', 3000);
    }
  } catch(e) {
    alertEl.innerHTML = '<div class="alert alert-error">❌ ' + e.message + '</div>';
  }
}

// ── SSE message feed ───────────────────────────────────────────────────────────
function connectSSE() {
  const es = new EventSource('/api/events');
  es.addEventListener('message', e => {
    const msg = JSON.parse(e.data);
    if (msg.fromMe) return; // skip bot's own messages from feed
    appendMessage(msg);
  });
  es.addEventListener('bot_message', e => {
    const msg = JSON.parse(e.data);
    appendMessage({ ...msg, fromMe: true });
  });
  es.addEventListener('status', e => {
    const d = JSON.parse(e.data);
    const dot = document.getElementById('status-dot');
    const lbl = document.getElementById('status-label');
    if (d.connected) {
      dot.className = 'status-dot';
      lbl.textContent = 'Connected';
    } else {
      dot.className = 'status-dot offline';
      lbl.textContent = 'Disconnected';
    }
  });
  es.onerror = () => setTimeout(connectSSE, 3000);
}

function appendMessage(msg) {
  const feed = document.getElementById('msg-feed');
  const isOut = msg.fromMe;
  const isAdmin = msg.isAdminGroup;
  const div = document.createElement('div');
  div.className = 'msg-bubble ' + (isOut ? 'outbound' : 'inbound');

  const time = new Date(msg.timestamp).toLocaleTimeString();
  const jidShort = msg.remoteJid.replace('@g.us','').replace('@s.whatsapp.net','');
  const typeLabel = msg.msgType !== 'conversation' && msg.msgType !== 'extendedTextMessage'
    ? '<span class="msg-type-badge">' + msg.msgType + '</span>' : '';
  const groupTag = msg.isPublicGroup ? '📢' : msg.isAdminGroup ? '🔐' : '📱';

  div.innerHTML =
    '<div class="msg-meta">' +
      '<span class="msg-sender ' + (isAdmin ? 'admin' : '') + '">' +
        groupTag + ' ' + escHtml(msg.pushName || jidShort) +
      '</span>' +
      typeLabel +
      '<span class="msg-time">' + time + '</span>' +
    '</div>' +
    '<div class="msg-text ' + (msg.text ? '' : 'empty') + '">' +
      escHtml(msg.text || '[' + msg.msgType + ']') +
    '</div>';

  feed.appendChild(div);
  feed.scrollTop = feed.scrollHeight;
  state.msgCount++;
  document.getElementById('msg-count').textContent = state.msgCount;
}

function clearFeed() {
  document.getElementById('msg-feed').innerHTML =
    '<div class="msg-bubble system">Feed cleared.</div>';
  state.msgCount = 0;
  document.getElementById('msg-count').textContent = '0';
}

// ── Manual send ────────────────────────────────────────────────────────────────
document.getElementById('send-target').addEventListener('change', function() {
  document.getElementById('custom-jid-field').style.display =
    this.value === '__custom__' ? 'block' : 'none';
});

async function sendMessage() {
  const btn = document.getElementById('send-btn');
  const status = document.getElementById('send-status');
  const targetSel = document.getElementById('send-target').value;
  const text = document.getElementById('send-text').value.trim();

  let jid = targetSel;
  if (targetSel === '__public__') jid = state.publicJid;
  if (targetSel === '__admin__')  jid = state.adminJid;
  if (targetSel === '__custom__') jid = document.getElementById('custom-jid').value.trim();

  if (!jid) { status.innerHTML = '<span style="color:var(--red)">Select a target group first</span>'; return; }
  if (!text) { status.innerHTML = '<span style="color:var(--red)">Enter a message</span>'; return; }

  btn.disabled = true;
  status.innerHTML = '<span style="color:var(--muted)">Sending...</span>';
  try {
    const r = await fetch('/api/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jid, text }),
    });
    const d = await r.json();
    if (d.ok) {
      status.innerHTML = '<span style="color:var(--green)">✅ Sent!</span>';
      document.getElementById('send-text').value = '';
      appendMessage({ id: Date.now()+'', remoteJid: jid, pushName: 'Bot', fromMe: true,
        msgType: 'conversation', text, timestamp: Date.now(),
        isPublicGroup: jid === state.publicJid, isAdminGroup: jid === state.adminJid });
    } else {
      status.innerHTML = '<span style="color:var(--red)">❌ ' + (d.error || 'Failed') + '</span>';
    }
  } catch(e) {
    status.innerHTML = '<span style="color:var(--red)">❌ ' + e.message + '</span>';
  } finally {
    btn.disabled = false;
    setTimeout(() => status.innerHTML = '', 3000);
  }
}

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Init ───────────────────────────────────────────────────────────────────────
initSettings();
connectSSE();
</script>
</body>
</html>`;
}
