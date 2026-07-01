/**
 * Admin Dashboard HTML
 * Tabs: Setup | Monitor (real-time) | Approvals (pending questions)
 */

export function buildDashboardHTML(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Fatawa Bot — Admin Dashboard</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box;}
:root{
  --bg:#07090f;--surface:#0f1420;--surface2:#161d2e;--surface3:#1c253a;
  --border:#1e2d45;--border2:#263552;
  --green:#25d366;--green-dim:#1a9e4a;--green-bg:#071910;
  --amber:#f59e0b;--amber-bg:#1a1200;
  --red:#ef4444;--red-bg:#1a0707;
  --blue:#3b82f6;--blue-bg:#071a2e;
  --purple:#a855f7;--purple-bg:#130720;
  --text:#e2e8f0;--muted:#64748b;--muted2:#4a5568;
  --font:'Inter',sans-serif;
  --radius:12px;
}
html,body{height:100%;font-family:var(--font);background:var(--bg);color:var(--text);}
button{font-family:var(--font);cursor:pointer;}
input,textarea,select{font-family:var(--font);}

/* ── Layout ── */
.app{display:flex;flex-direction:column;height:100vh;}

/* ── Topbar ── */
.topbar{display:flex;align-items:center;gap:16px;padding:10px 20px;
  background:var(--surface);border-bottom:1px solid var(--border);flex-shrink:0;
  backdrop-filter:blur(10px);}
.topbar-brand{display:flex;align-items:center;gap:10px;}
.topbar-icon{width:32px;height:32px;background:var(--green);border-radius:8px;
  display:flex;align-items:center;justify-content:center;font-size:1rem;}
.topbar-name{font-size:.95rem;font-weight:700;color:var(--text);}
.topbar-name span{color:var(--green);}
.conn-pill{display:flex;align-items:center;gap:7px;padding:5px 12px;border-radius:20px;
  background:var(--surface2);border:1px solid var(--border);font-size:.78rem;}
.conn-dot{width:8px;height:8px;border-radius:50%;}
.conn-dot.on{background:var(--green);box-shadow:0 0 8px var(--green);animation:pulse 2s infinite;}
.conn-dot.off{background:var(--red);}
@keyframes pulse{0%,100%{opacity:1;}50%{opacity:.4;}}
.tabs{display:flex;gap:4px;margin-left:auto;}
.tab{padding:7px 16px;border-radius:8px;border:none;background:transparent;
  color:var(--muted);font-size:.83rem;font-weight:500;transition:.15s;position:relative;}
.tab.active{background:var(--green);color:#000;font-weight:700;}
.tab:hover:not(.active){background:var(--surface2);}
.tab .badge{position:absolute;top:-4px;right:-4px;background:var(--red);color:#fff;
  font-size:.6rem;font-weight:700;padding:1px 5px;border-radius:10px;min-width:16px;text-align:center;}

/* ── Panel switching ── */
.content{flex:1;overflow:hidden;display:flex;flex-direction:column;}
.panel{display:none;flex:1;overflow:hidden;flex-direction:column;}
.panel.active{display:flex;}

/* ── Scrollbar ── */
::-webkit-scrollbar{width:4px;}
::-webkit-scrollbar-track{background:transparent;}
::-webkit-scrollbar-thumb{background:var(--border2);border-radius:10px;}

/* ─────────────────────────────────────────────────────────────────────
   SETUP TAB
───────────────────────────────────────────────────────────────────── */
.setup-wrap{flex:1;overflow-y:auto;padding:24px;max-width:860px;width:100%;margin:0 auto;}
.page-title{font-size:1.15rem;font-weight:700;margin-bottom:4px;}
.page-sub{font-size:.83rem;color:var(--muted);margin-bottom:20px;}
.card{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:20px;margin-bottom:16px;}
.card-title{font-size:.88rem;font-weight:600;margin-bottom:12px;color:var(--text);display:flex;align-items:center;gap:8px;}
.btn{display:inline-flex;align-items:center;gap:8px;padding:8px 16px;border-radius:8px;
  border:none;font-size:.83rem;font-weight:600;transition:.15s;}
.btn-green{background:var(--green);color:#000;}.btn-green:hover{opacity:.85;}
.btn-ghost{background:var(--surface2);color:var(--text);border:1px solid var(--border);}.btn-ghost:hover{background:var(--border);}
.btn-amber{background:var(--amber);color:#000;}.btn-amber:hover{opacity:.85;}
.btn-red{background:var(--red);color:#fff;}.btn-red:hover{opacity:.85;}
.btn:disabled{opacity:.4;cursor:not-allowed;}
.group-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:8px;margin-top:12px;}
.group-card{background:var(--surface2);border:2px solid var(--border);border-radius:10px;
  padding:12px 14px;cursor:pointer;transition:.15s;position:relative;user-select:none;}
.group-card:hover{border-color:var(--green);}
.group-card.sel-public{border-color:var(--green);background:var(--green-bg);}
.group-card.sel-admin{border-color:var(--amber);background:var(--amber-bg);}
.gname{font-size:.86rem;font-weight:600;margin-bottom:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.gjid{font-size:.7rem;color:var(--muted);font-family:monospace;}
.gbadge{position:absolute;top:8px;right:8px;font-size:.65rem;font-weight:700;
  padding:2px 7px;border-radius:20px;}
.gbadge-pub{background:var(--green);color:#000;}
.gbadge-adm{background:var(--amber);color:#000;}
.sel-summary{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:10px;}
.sel-box{padding:10px 14px;border-radius:8px;font-size:.82rem;}
.sel-box.set{background:var(--green-bg);border:1px solid var(--green-dim);}
.sel-box.unset{background:var(--surface2);border:1px solid var(--border);}
.sel-box strong{display:block;font-size:.7rem;color:var(--muted);margin-bottom:3px;}
.toast{padding:9px 14px;border-radius:8px;font-size:.82rem;margin-top:8px;}
.toast-ok{background:var(--green-bg);color:var(--green);border:1px solid var(--green-dim);}
.toast-err{background:var(--red-bg);color:var(--red);border:1px solid #7f1d1d;}
.toast-info{background:var(--surface2);color:var(--text);border:1px solid var(--border);}
.legend-row{display:flex;gap:16px;margin-bottom:10px;font-size:.78rem;color:var(--muted);flex-wrap:wrap;}
.legend-row span{display:flex;align-items:center;gap:6px;}
.ldot{width:8px;height:8px;border-radius:2px;flex-shrink:0;}

/* ─────────────────────────────────────────────────────────────────────
   MONITOR TAB
───────────────────────────────────────────────────────────────────── */
.monitor-layout{flex:1;display:grid;grid-template-columns:1fr 310px;overflow:hidden;}
.feed-wrap{display:flex;flex-direction:column;overflow:hidden;border-right:1px solid var(--border);}
.feed-hdr{display:flex;align-items:center;gap:10px;padding:10px 16px;
  border-bottom:1px solid var(--border);flex-shrink:0;background:var(--surface);}
.feed-hdr h3{font-size:.88rem;font-weight:600;}
.count-pill{background:var(--surface2);color:var(--muted);font-size:.7rem;
  padding:2px 8px;border-radius:20px;font-weight:600;}
.feed{flex:1;overflow-y:auto;padding:12px 16px;display:flex;flex-direction:column;gap:6px;}
.sys-msg{background:var(--surface2);border:1px dashed var(--border2);border-radius:8px;
  padding:7px 14px;font-size:.76rem;color:var(--muted);text-align:center;align-self:center;}
.bubble{padding:9px 12px;border-radius:10px;font-size:.83rem;max-width:88%;
  animation:slideIn .2s ease;}
@keyframes slideIn{from{opacity:0;transform:translateY(5px);}}
.bubble.in{background:var(--surface);border:1px solid var(--border);align-self:flex-start;}
.bubble.out{background:var(--green-bg);border:1px solid var(--green-dim);align-self:flex-end;}
.bubble.admin-in{background:var(--amber-bg);border:1px solid #7a5800;align-self:flex-start;}
.bubble.admin-out{background:var(--amber-bg);border:1px solid var(--amber);align-self:flex-end;}
.b-meta{display:flex;align-items:center;gap:7px;margin-bottom:3px;flex-wrap:wrap;}
.b-sender{font-weight:600;font-size:.78rem;}
.b-sender.pub{color:var(--green);}
.b-sender.adm{color:var(--amber);}
.b-time{font-size:.7rem;color:var(--muted);margin-left:auto;}
.b-type{font-size:.65rem;padding:1px 6px;border-radius:4px;background:var(--surface2);color:var(--muted);}
.b-text{word-break:break-word;line-height:1.5;}
.b-text.empty{color:var(--muted);font-style:italic;}
.b-group-tag{font-size:.65rem;color:var(--muted);}

/* send panel */
.send-panel{display:flex;flex-direction:column;background:var(--surface);overflow:hidden;}
.send-hdr{padding:10px 14px;border-bottom:1px solid var(--border);flex-shrink:0;}
.send-hdr h3{font-size:.88rem;font-weight:600;}
.send-body{flex:1;overflow-y:auto;padding:12px;}
.field{margin-bottom:10px;}
.field label{display:block;font-size:.76rem;color:var(--muted);font-weight:500;margin-bottom:4px;}
.field select,.field textarea,.field input{width:100%;background:var(--surface2);
  border:1px solid var(--border);border-radius:8px;color:var(--text);
  padding:8px 10px;font-size:.83rem;outline:none;transition:.15s;}
.field select:focus,.field textarea:focus,.field input:focus{border-color:var(--green);}
.field textarea{height:80px;resize:none;line-height:1.5;}
.send-footer{padding:10px 12px;flex-shrink:0;}
.send-footer .btn{width:100%;justify-content:center;}
.send-st{font-size:.75rem;text-align:center;margin-top:6px;min-height:18px;}

/* ─────────────────────────────────────────────────────────────────────
   APPROVALS TAB
───────────────────────────────────────────────────────────────────── */
.approvals-layout{flex:1;display:grid;grid-template-columns:1fr 340px;overflow:hidden;gap:0;}
.pending-wrap{overflow-y:auto;padding:16px;}
.pending-hdr{display:flex;align-items:center;gap:10px;margin-bottom:12px;}
.pending-hdr h3{font-size:.92rem;font-weight:700;}
.refresh-btn{margin-left:auto;}
.pending-empty{text-align:center;padding:48px 20px;color:var(--muted);}
.pending-empty .empty-icon{font-size:3rem;margin-bottom:12px;}
.pcard{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);
  padding:16px;margin-bottom:10px;transition:.15s;cursor:pointer;}
.pcard:hover{border-color:var(--blue);}
.pcard.selected{border-color:var(--green);background:var(--green-bg);}
.pcard-top{display:flex;align-items:center;gap:8px;margin-bottom:8px;}
.pcard-q{font-size:.85rem;font-weight:600;flex:1;overflow:hidden;display:-webkit-box;
  -webkit-line-clamp:2;-webkit-box-orient:vertical;}
.conf-bar-wrap{margin:8px 0 6px;}
.conf-label{font-size:.72rem;color:var(--muted);margin-bottom:3px;display:flex;justify-content:space-between;}
.conf-bar{height:5px;background:var(--surface2);border-radius:3px;overflow:hidden;}
.conf-fill{height:100%;border-radius:3px;transition:width .5s;}
.pcard-meta{display:flex;gap:8px;flex-wrap:wrap;margin-top:6px;}
.pmeta{font-size:.7rem;color:var(--muted);display:flex;align-items:center;gap:3px;}
.pcard-audio{margin-top:8px;padding:7px 10px;background:var(--surface2);border-radius:8px;
  font-size:.78rem;color:var(--text);display:flex;align-items:center;gap:6px;}
.pcard-transcript{margin-top:6px;font-size:.78rem;color:var(--muted);line-height:1.5;
  display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;}

/* detail panel */
.detail-panel{background:var(--surface);border-left:1px solid var(--border);
  display:flex;flex-direction:column;overflow:hidden;}
.detail-hdr{padding:14px 16px;border-bottom:1px solid var(--border);flex-shrink:0;}
.detail-hdr h3{font-size:.9rem;font-weight:600;}
.detail-body{flex:1;overflow-y:auto;padding:16px;}
.detail-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;
  height:100%;color:var(--muted);text-align:center;padding:24px;}
.detail-section{margin-bottom:16px;}
.detail-label{font-size:.72rem;color:var(--muted);font-weight:600;text-transform:uppercase;
  letter-spacing:.05em;margin-bottom:6px;}
.detail-value{font-size:.84rem;line-height:1.5;word-break:break-word;}
.conf-big{font-size:2rem;font-weight:800;}
.conf-big.high{color:var(--green);}
.conf-big.med{color:var(--amber);}
.conf-big.low{color:var(--red);}
.detail-footer{padding:12px 16px;border-top:1px solid var(--border);flex-shrink:0;
  display:flex;flex-direction:column;gap:8px;}
.action-row{display:flex;gap:8px;}
.action-row .btn{flex:1;justify-content:center;}

/* ─────────────────────────────────────────────────────────────────────
   DEBUG / STATUS BAR
───────────────────────────────────────────────────────────────────── */
.status-bar{display:flex;align-items:center;gap:16px;padding:6px 20px;
  background:var(--surface);border-top:1px solid var(--border);flex-shrink:0;
  font-size:.73rem;color:var(--muted);}
.status-bar .stat{display:flex;align-items:center;gap:5px;}
.stat-dot{width:6px;height:6px;border-radius:50%;}
.stat-dot.ok{background:var(--green);}
.stat-dot.warn{background:var(--amber);}
.stat-dot.err{background:var(--red);}

/* ─────────────────────────────────────────────────────────────────────
   KNOWLEDGE BASE TAB
───────────────────────────────────────────────────────────────────── */
.kb-layout{flex:1;display:grid;grid-template-columns:200px 1fr;overflow:hidden;}
.kb-sidebar{background:var(--surface);border-right:1px solid var(--border);overflow-y:auto;padding:12px 8px;}
.kb-sidebar-title{font-size:.72rem;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;padding:4px 8px 8px;}
.kb-topic-btn{width:100%;text-align:left;background:none;border:none;color:var(--text);font-size:.82rem;
  padding:6px 10px;border-radius:7px;cursor:pointer;display:flex;align-items:center;justify-content:space-between;transition:.12s;}
.kb-topic-btn:hover{background:var(--surface2);}
.kb-topic-btn.active{background:var(--green-bg);color:var(--green);font-weight:600;}
.kb-topic-cnt{font-size:.7rem;color:var(--muted);background:var(--surface2);padding:1px 7px;border-radius:10px;}
.kb-main{display:flex;flex-direction:column;overflow:hidden;}
.kb-toolbar{display:flex;align-items:center;gap:8px;padding:10px 14px;
  border-bottom:1px solid var(--border);background:var(--surface);flex-shrink:0;flex-wrap:wrap;}
.kb-search{flex:1;min-width:180px;background:var(--surface2);border:1px solid var(--border);
  border-radius:8px;color:var(--text);padding:7px 12px;font-size:.83rem;outline:none;font-family:var(--font);}
.kb-search:focus{border-color:var(--green);}
.kb-count{font-size:.78rem;color:var(--muted);white-space:nowrap;}
.kb-table-wrap{flex:1;overflow-y:auto;}
.kb-table{width:100%;border-collapse:collapse;font-size:.82rem;}
.kb-table th{position:sticky;top:0;background:var(--surface);padding:8px 12px;text-align:left;
  font-size:.72rem;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;
  border-bottom:1px solid var(--border);z-index:1;}
.kb-table td{padding:9px 12px;border-bottom:1px solid var(--border);vertical-align:top;
  max-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.kb-table tr:hover td{background:var(--surface2);cursor:pointer;}
.kb-q{max-width:260px;}
.kb-ruling{max-width:200px;}
.kb-conf-pill{display:inline-block;padding:2px 8px;border-radius:10px;font-size:.7rem;font-weight:600;}
.kb-conf-high{background:var(--green-bg);color:var(--green);}
.kb-conf-med{background:var(--amber-bg);color:var(--amber);}
.kb-conf-low{background:var(--red-bg);color:var(--red);}
.kb-audio-chip{display:inline-flex;align-items:center;gap:4px;background:var(--blue-bg);
  color:var(--blue);font-size:.68rem;padding:1px 7px;border-radius:8px;border:1px solid #1e3a5f;}
.kb-pagination{display:flex;align-items:center;gap:8px;padding:8px 14px;
  border-top:1px solid var(--border);background:var(--surface);flex-shrink:0;font-size:.8rem;}
.kb-pagination button{padding:4px 12px;border-radius:6px;border:1px solid var(--border);
  background:var(--surface2);color:var(--text);cursor:pointer;font-size:.78rem;}
.kb-pagination button:disabled{opacity:.35;cursor:not-allowed;}
/* Modal */
.kb-modal-bg{position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:1000;display:flex;
  align-items:center;justify-content:center;backdrop-filter:blur(4px);animation:fadeIn .15s;}
@keyframes fadeIn{from{opacity:0;}}
.kb-modal{background:var(--surface);border:1px solid var(--border2);border-radius:14px;
  width:min(680px,95vw);max-height:90vh;display:flex;flex-direction:column;overflow:hidden;
  box-shadow:0 20px 60px rgba(0,0,0,.6);}
.kb-modal-hdr{display:flex;align-items:center;padding:16px 20px;border-bottom:1px solid var(--border);
  flex-shrink:0;}
.kb-modal-hdr h3{font-size:1rem;font-weight:700;flex:1;}
.kb-modal-close{background:none;border:none;color:var(--muted);font-size:1.3rem;cursor:pointer;line-height:1;
  padding:2px 6px;border-radius:4px;}
.kb-modal-close:hover{background:var(--surface2);color:var(--text);}
.kb-modal-body{flex:1;overflow-y:auto;padding:20px;display:flex;flex-direction:column;gap:14px;}
.kb-field{display:flex;flex-direction:column;gap:5px;}
.kb-field label{font-size:.72rem;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;}
.kb-field input,.kb-field textarea,.kb-field select{background:var(--surface2);border:1px solid var(--border);
  border-radius:8px;color:var(--text);padding:8px 10px;font-size:.83rem;font-family:var(--font);outline:none;}
.kb-field input:focus,.kb-field textarea:focus,.kb-field select:focus{border-color:var(--green);}
.kb-field textarea{resize:vertical;min-height:70px;line-height:1.5;}
.kb-field .kb-readonly{background:var(--bg);color:var(--muted);cursor:default;}
.kb-modal-footer{display:flex;align-items:center;gap:8px;padding:14px 20px;
  border-top:1px solid var(--border);flex-shrink:0;}
.kb-modal-footer .btn{min-width:100px;justify-content:center;}
.kb-modal-status{flex:1;font-size:.78rem;color:var(--muted);}
</style>
</head>
<body>
<div class="app">

  <!-- ── Topbar ── -->
  <div class="topbar">
    <div class="topbar-brand">
      <div class="topbar-icon">🕌</div>
      <div class="topbar-name">Fatawa Bot <span>Admin</span></div>
    </div>
    <div class="conn-pill">
      <div class="conn-dot on" id="conn-dot"></div>
      <span id="conn-label">Connected</span>
    </div>
    <div class="tabs">
      <button class="tab active" onclick="switchTab('setup')" id="tab-setup">⚙️ Setup</button>
      <button class="tab" onclick="switchTab('monitor')" id="tab-monitor">📡 Monitor</button>
      <button class="tab" onclick="switchTab('approvals')" id="tab-approvals">
        ✅ Approvals<span class="badge" id="pending-badge" style="display:none">0</span>
      </button>
      <button class="tab" onclick="switchTab('kb')" id="tab-kb">🗄️ Knowledge Base</button>
    </div>
  </div>

  <div class="content">

    <!-- ═══════════════════════════════════════════════
         SETUP TAB
    ═══════════════════════════════════════════════ -->
    <div class="panel active" id="panel-setup">
      <div class="setup-wrap">
        <div class="page-title">Group Configuration</div>
        <div class="page-sub">Assign which group is the Public pilgrim group and which is the Admin/Sheikh group.</div>

        <!-- Debug card -->
        <div class="card" id="debug-card">
          <div class="card-title">🔍 Bot Status</div>
          <div id="debug-content" style="font-size:.82rem;color:var(--muted);">Loading...</div>
        </div>

        <!-- Current selection -->
        <div class="card">
          <div class="card-title">📌 Active Routing</div>
          <div class="sel-summary">
            <div class="sel-box unset" id="box-pub">
              <strong>📢 PUBLIC GROUP (Questions)</strong>
              <span id="pub-val">Not configured</span>
            </div>
            <div class="sel-box unset" id="box-adm">
              <strong>🔐 ADMIN GROUP (Approvals)</strong>
              <span id="adm-val">Not configured</span>
            </div>
          </div>
        </div>

        <!-- Group list -->
        <div class="card">
          <div class="card-title">📋 WhatsApp Groups</div>
          <div class="legend-row">
            <span><div class="ldot" style="background:var(--green)"></div>Click once → Public group</span>
            <span><div class="ldot" style="background:var(--amber)"></div>Click twice → Admin group</span>
            <span><div class="ldot" style="background:var(--border2)"></div>Click thrice → Deselect</span>
          </div>
          <button class="btn btn-ghost" id="load-btn" onclick="loadGroups()">🔄 Load Groups from WhatsApp</button>
          <div id="groups-alert" style="margin-top:8px;"></div>
          <div class="group-grid" id="groups-grid"></div>
        </div>

        <div style="display:flex;gap:10px;align-items:center;">
          <button class="btn btn-green" onclick="saveSettings()">💾 Save Settings</button>
          <div id="save-alert" style="flex:1;"></div>
        </div>
      </div>
    </div>

    <!-- ═══════════════════════════════════════════════
         MONITOR TAB
    ═══════════════════════════════════════════════ -->
    <div class="panel" id="panel-monitor">
      <div class="monitor-layout">
        <!-- Feed -->
        <div class="feed-wrap">
          <div class="feed-hdr">
            <h3>📡 Live Message Feed</h3>
            <span class="count-pill" id="msg-count">0 messages</span>
            <button class="btn btn-ghost" style="margin-left:auto;padding:5px 10px;font-size:.75rem;" onclick="clearFeed()">Clear</button>
          </div>
          <div class="feed" id="msg-feed">
            <div class="sys-msg">Listening for WhatsApp messages via SSE…</div>
          </div>
        </div>

        <!-- Send panel -->
        <div class="send-panel">
          <div class="send-hdr">
            <h3>✉️ Manual Send</h3>
            <div style="font-size:.74rem;color:var(--muted);margin-top:2px;">Send a message from the bot</div>
          </div>
          <div class="send-body">
            <div class="field">
              <label>Target Group</label>
              <select id="send-target">
                <option value="">— Select —</option>
                <option value="__public__">📢 Public Group</option>
                <option value="__admin__">🔐 Admin Group</option>
                <option value="__custom__">✏️ Custom JID…</option>
              </select>
            </div>
            <div class="field" id="custom-jid-field" style="display:none;">
              <label>Custom JID</label>
              <input type="text" id="custom-jid" placeholder="1234567890@g.us">
            </div>
            <div class="field">
              <label>Message</label>
              <textarea id="send-text" placeholder="Type your message…"></textarea>
            </div>
          </div>
          <div class="send-footer">
            <button class="btn btn-green" id="send-btn" onclick="sendMessage()">📤 Send Message</button>
            <div class="send-st" id="send-status"></div>
          </div>
        </div>
      </div>
    </div>

    <!-- ═══════════════════════════════════════════════
         APPROVALS TAB
    ═══════════════════════════════════════════════ -->
    <div class="panel" id="panel-approvals">
      <div class="approvals-layout">
        <!-- Pending list -->
        <div class="pending-wrap">
          <div class="pending-hdr">
            <h3>⏳ Pending Approval Queue</h3>
            <button class="btn btn-ghost refresh-btn" style="padding:5px 12px;font-size:.78rem;" onclick="loadPending()">🔄 Refresh</button>
          </div>
          <div id="pending-list">
            <div class="pending-empty">
              <div class="empty-icon">✅</div>
              <div>Loading pending questions…</div>
            </div>
          </div>
        </div>

        <!-- Detail panel -->
        <div class="detail-panel">
          <div class="detail-hdr">
            <h3>📋 Question Detail</h3>
          </div>
          <div class="detail-body" id="detail-body">
            <div class="detail-empty">
              <div style="font-size:2.5rem;margin-bottom:12px;">👆</div>
              <div>Select a pending question<br>to see details and take action</div>
            </div>
          </div>
          <div class="detail-footer" id="detail-footer" style="display:none;">
            <div class="action-row">
              <button class="btn btn-green" onclick="approveSelected()">✅ Approve &amp; Send Audio</button>
              <button class="btn btn-red" onclick="rejectSelected()">❌ Reject</button>
            </div>
            <div id="action-status" style="font-size:.77rem;text-align:center;color:var(--muted);"></div>
          </div>
        </div>
      </div>
    </div>

    <!-- ═══════════════════════════════════════════════
         KNOWLEDGE BASE TAB
    ═══════════════════════════════════════════════ -->
    <div class="panel" id="panel-kb">
      <div class="kb-layout">
        <!-- Sidebar: topic filters -->
        <div class="kb-sidebar">
          <div class="kb-sidebar-title">Topics</div>
          <button class="kb-topic-btn active" id="kbtopic-ALL" onclick="kbSetTopic('')">📚 All <span class="kb-topic-cnt" id="kb-cnt-ALL">—</span></button>
          <div id="kb-topic-list"></div>
        </div>
        <!-- Main area -->
        <div class="kb-main">
          <div class="kb-toolbar">
            <input class="kb-search" id="kb-search" placeholder="🔍 Search questions, rulings, audio…" oninput="kbOnSearch()">
            <button class="btn btn-ghost" style="padding:6px 12px;font-size:.78rem;" onclick="kbLoad()">🔄 Refresh</button>
            <span class="kb-count" id="kb-total-lbl">Loading…</span>
          </div>
          <div class="kb-table-wrap">
            <table class="kb-table">
              <thead>
                <tr>
                  <th style="width:36px">#</th>
                  <th style="width:280px">Question</th>
                  <th style="width:90px">Topic</th>
                  <th style="width:70px">Lang</th>
                  <th style="width:80px">Confidence</th>
                  <th style="width:160px">Islamic Ruling</th>
                  <th style="width:140px">Audio File</th>
                  <th style="width:70px">Actions</th>
                </tr>
              </thead>
              <tbody id="kb-tbody"></tbody>
            </table>
          </div>
          <div class="kb-pagination">
            <button id="kb-prev" onclick="kbPage(-1)" disabled>← Prev</button>
            <span id="kb-page-lbl" style="flex:1;text-align:center;color:var(--muted);">Page 1</span>
            <button id="kb-next" onclick="kbPage(1)">Next →</button>
          </div>
        </div>
      </div>
    </div>

    <!-- KB Edit Modal -->
    <div class="kb-modal-bg" id="kb-modal" style="display:none;" onclick="kbModalClose(event)">
      <div class="kb-modal" onclick="event.stopPropagation()">
        <div class="kb-modal-hdr">
          <h3 id="kb-modal-title">Edit Record</h3>
          <button class="kb-modal-close" onclick="kbCloseModal()">✕</button>
        </div>
        <div class="kb-modal-body">
          <input type="hidden" id="kb-edit-id">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
            <div class="kb-field">
              <label>Record ID</label>
              <input type="text" id="kb-edit-id-disp" class="kb-readonly" readonly>
            </div>
            <div class="kb-field">
              <label>Topic</label>
              <select id="kb-edit-topic">
                <option>GENERAL</option><option>IHRAM</option><option>TAWAF</option>
                <option>SAEE</option><option>ARAFAT</option><option>MINA</option>
                <option>JAMARAT</option><option>QURBANI</option><option>HALQ</option>
                <option>SALAH</option><option>UMRAH</option><option>MADINAH</option>
                <option>MENSTRUATION</option><option>HAIZ</option><option>WUDU</option>
              </select>
            </div>
          </div>
          <div class="kb-field">
            <label>Question (Original)</label>
            <textarea id="kb-edit-q" rows="3"></textarea>
          </div>
          <div class="kb-field">
            <label>⚖️ Authentic Islamic Ruling (verified)</label>
            <textarea id="kb-edit-ruling" rows="2"></textarea>
          </div>
          <div class="kb-field">
            <label>📋 Ruling Key Points (one per line)</label>
            <textarea id="kb-edit-keypoints" rows="4"></textarea>
          </div>
          <div class="kb-field">
            <label>📝 Answer Text (text reply)</label>
            <textarea id="kb-edit-anstext" rows="3"></textarea>
          </div>
          <div class="kb-field">
            <label>🎙️ Urdu Transcript (of audio answer)</label>
            <textarea id="kb-edit-transcript" rows="3" dir="rtl"></textarea>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
            <div class="kb-field">
              <label>🎵 Audio File (GCS filename)</label>
              <input type="text" id="kb-edit-audio" class="kb-readonly" readonly placeholder="(linked from GCS)">
            </div>
            <div class="kb-field">
              <label>🌐 English Translation (AI-generated)</label>
              <input type="text" id="kb-edit-english" class="kb-readonly" readonly>
            </div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
            <div class="kb-field">
              <label>Confidence (0.0–1.0)</label>
              <input type="number" id="kb-edit-conf" min="0" max="1" step="0.01">
            </div>
            <div class="kb-field">
              <label>Accuracy Label</label>
              <input type="text" id="kb-edit-label">
            </div>
          </div>
          <div class="kb-field">
            <label>🔑 Keywords (read-only)</label>
            <input type="text" id="kb-edit-keywords" class="kb-readonly" readonly>
          </div>
        </div>
        <div class="kb-modal-footer">
          <button class="btn btn-red" onclick="kbDelete()" style="margin-right:auto;">🗑️ Delete</button>
          <span class="kb-modal-status" id="kb-modal-st"></span>
          <button class="btn btn-ghost" onclick="kbCloseModal()">Cancel</button>
          <button class="btn btn-green" onclick="kbSave()">💾 Save Changes</button>
        </div>
      </div>
    </div>

  </div>

  <!-- ── Status bar ── -->
  <div class="status-bar">
    <div class="stat"><div class="stat-dot ok" id="sb-conn"></div><span id="sb-conn-lbl">WhatsApp Connected</span></div>
    <div class="stat">🗄️ KB: <span id="sb-kb">—</span> records</div>
    <div class="stat">📋 Public: <span id="sb-pub-jid" style="font-family:monospace;">—</span></div>
    <div class="stat">🔐 Admin: <span id="sb-adm-jid" style="font-family:monospace;">—</span></div>
    <div class="stat" style="margin-left:auto;">Last updated: <span id="sb-time">—</span></div>
  </div>

</div>

<script>
// ═══════════════════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════════════════
const S = {
  groups: [],
  publicJid: null,
  adminJid: null,
  msgCount: 0,
  pending: [],
  selectedPending: null,
  kbCount: 0,
};

// ═══════════════════════════════════════════════════════════════════
// TAB SWITCHING
// ═══════════════════════════════════════════════════════════════════
function switchTab(name) {
  ['setup','monitor','approvals','kb'].forEach(t => {
    document.getElementById('tab-' + t).classList.toggle('active', t === name);
    document.getElementById('panel-' + t).classList.toggle('active', t === name);
  });
  if (name === 'approvals') loadPending();
  if (name === 'kb') kbLoad();
}

// ═══════════════════════════════════════════════════════════════════
// DEBUG / STATUS BAR
// ═══════════════════════════════════════════════════════════════════
async function loadDebug() {
  try {
    const r = await fetch('/api/debug');
    const d = await r.json();
    S.kbCount = d.kbCount ?? 0;

    // Status bar
    document.getElementById('sb-kb').textContent = S.kbCount.toLocaleString();
    const pubJid = d.settings?.publicGroupJid;
    const admJid = d.settings?.adminGroupJid;
    document.getElementById('sb-pub-jid').textContent = pubJid ? pubJid.split('@')[0].slice(-8) + '…' : 'Not set';
    document.getElementById('sb-adm-jid').textContent = admJid ? admJid.split('@')[0].slice(-8) + '…' : 'Not set';
    document.getElementById('sb-time').textContent = new Date().toLocaleTimeString();

    // Debug card in setup
    const pubName = S.groups.find(g => g.id === pubJid)?.name ?? pubJid ?? 'Not set';
    const admName = S.groups.find(g => g.id === admJid)?.name ?? admJid ?? 'Not set';
    document.getElementById('debug-content').innerHTML =
      '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;">' +
        stat('📢 Public Group', pubName || 'Not set', pubJid ? 'ok' : 'err') +
        stat('🔐 Admin Group', admName || 'Not set', admJid ? 'ok' : 'err') +
        stat('🗄️ Fatawa KB', S.kbCount + ' records', S.kbCount > 0 ? 'ok' : 'warn') +
      '</div>';

    // Update public/admin selection boxes
    if (d.settings) {
      if (pubJid) { S.publicJid = pubJid; }
      if (admJid) { S.adminJid = admJid; }
      updateSummary();
    }
  } catch(e) {
    document.getElementById('debug-content').innerHTML = '<span style="color:var(--red)">Failed to load debug info</span>';
  }
}

function stat(label, value, status) {
  const c = status === 'ok' ? 'var(--green)' : status === 'warn' ? 'var(--amber)' : 'var(--red)';
  return \`<div style="background:var(--surface2);border:1px solid var(--border);border-radius:8px;padding:10px 12px;">
    <div style="font-size:.7rem;color:var(--muted);margin-bottom:4px;">\${label}</div>
    <div style="font-size:.83rem;font-weight:600;color:\${c};overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="\${esc(value)}">\${esc(value)}</div>
  </div>\`;
}

// ═══════════════════════════════════════════════════════════════════
// SETUP TAB
// ═══════════════════════════════════════════════════════════════════
async function initSettings() {
  try {
    const r = await fetch('/api/settings');
    const d = await r.json();
    if (d.publicGroupJid) S.publicJid = d.publicGroupJid;
    if (d.adminGroupJid)  S.adminJid  = d.adminGroupJid;
    updateSummary();
  } catch {}
}

function updateSummary() {
  const pub = S.groups.find(g => g.id === S.publicJid);
  const adm = S.groups.find(g => g.id === S.adminJid);
  const pubEl = document.getElementById('box-pub');
  const admEl = document.getElementById('box-adm');
  document.getElementById('pub-val').textContent = pub ? pub.name : (S.publicJid || 'Not configured');
  document.getElementById('adm-val').textContent = adm ? adm.name : (S.adminJid  || 'Not configured');
  pubEl.className = 'sel-box ' + (S.publicJid ? 'set' : 'unset');
  admEl.className = 'sel-box ' + (S.adminJid  ? 'set' : 'unset');
}

async function loadGroups() {
  const btn = document.getElementById('load-btn');
  const alertEl = document.getElementById('groups-alert');
  btn.disabled = true; btn.textContent = '⏳ Loading…'; alertEl.innerHTML = '';
  try {
    const r = await fetch('/api/groups');
    const d = await r.json();
    if (!d.groups || d.groups.length === 0) {
      alertEl.innerHTML = toast('info', 'No groups found — make sure bot is in at least one group.');
      return;
    }
    S.groups = d.groups;
    renderGroups();
    alertEl.innerHTML = toast('ok', '✅ ' + d.groups.length + ' groups loaded.');
    updateSummary();
  } catch(e) {
    alertEl.innerHTML = toast('err', '❌ ' + e.message);
  } finally { btn.disabled = false; btn.textContent = '🔄 Reload Groups'; }
}

function renderGroups() {
  const grid = document.getElementById('groups-grid');
  grid.innerHTML = '';
  for (const g of S.groups) {
    const c = document.createElement('div');
    c.className = 'group-card' + (g.id === S.publicJid ? ' sel-public' : '') + (g.id === S.adminJid ? ' sel-admin' : '');
    c.dataset.jid = g.id;
    c.innerHTML =
      '<div class="gname" title="' + esc(g.name) + '">' + esc(g.name) + '</div>' +
      '<div class="gjid">' + g.id + '</div>' +
      (g.id === S.publicJid ? '<div class="gbadge gbadge-pub">PUBLIC</div>' : '') +
      (g.id === S.adminJid  ? '<div class="gbadge gbadge-adm">ADMIN</div>'  : '');
    c.addEventListener('click', () => cycleGroup(g.id));
    grid.appendChild(c);
  }
}

function cycleGroup(jid) {
  if (S.publicJid !== jid && S.adminJid !== jid) { S.publicJid = jid; }
  else if (S.publicJid === jid) { S.publicJid = null; S.adminJid = jid; }
  else { S.adminJid = null; }
  renderGroups(); updateSummary();
}

async function saveSettings() {
  const alertEl = document.getElementById('save-alert');
  try {
    const r = await fetch('/api/settings', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ publicGroupJid: S.publicJid, adminGroupJid: S.adminJid }),
    });
    const d = await r.json();
    if (d.ok) {
      alertEl.innerHTML = toast('ok', '✅ Saved! Bot is now routing messages.');
      setTimeout(() => { alertEl.innerHTML = ''; loadDebug(); }, 3000);
    } else throw new Error(d.error || 'Save failed');
  } catch(e) { alertEl.innerHTML = toast('err', '❌ ' + e.message); }
}

// ═══════════════════════════════════════════════════════════════════
// MONITOR TAB — SSE
// ═══════════════════════════════════════════════════════════════════
function connectSSE() {
  const es = new EventSource('/api/events');
  es.addEventListener('message', e => {
    const msg = JSON.parse(e.data);
    appendBubble(msg);
    // If it's an inbound public message check for pending
    if (!msg.fromMe && msg.isPublicGroup) setTimeout(loadPendingBadge, 2000);
  });
  es.addEventListener('bot_message', e => {
    const msg = JSON.parse(e.data);
    appendBubble({ ...msg, fromMe: true });
  });
  es.addEventListener('status', e => {
    const d = JSON.parse(e.data);
    const dot = document.getElementById('conn-dot');
    const lbl = document.getElementById('conn-label');
    const sbDot = document.getElementById('sb-conn');
    const sbLbl = document.getElementById('sb-conn-lbl');
    if (d.connected) {
      dot.className = 'conn-dot on'; lbl.textContent = 'Connected';
      sbDot.className = 'stat-dot ok'; sbLbl.textContent = 'WhatsApp Connected';
    } else {
      dot.className = 'conn-dot off'; lbl.textContent = 'Disconnected';
      sbDot.className = 'stat-dot err'; sbLbl.textContent = 'WhatsApp Disconnected';
    }
  });
  es.onerror = () => setTimeout(connectSSE, 3000);
}

function appendBubble(msg) {
  const feed = document.getElementById('msg-feed');
  const isOut = msg.fromMe;
  const isAdmin = msg.isAdminGroup;
  const b = document.createElement('div');

  let cls = 'bubble ';
  if (isAdmin) cls += isOut ? 'admin-out' : 'admin-in';
  else cls += isOut ? 'out' : 'in';
  b.className = cls;

  const time = new Date(msg.timestamp).toLocaleTimeString();
  const sender = msg.pushName || msg.remoteJid?.split('@')[0] || '?';
  const groupTag = msg.isPublicGroup ? '📢' : msg.isAdminGroup ? '🔐' : '📱';
  const typeTag = (msg.msgType !== 'conversation' && msg.msgType !== 'extendedTextMessage')
    ? '<span class="b-type">' + esc(msg.msgType) + '</span>' : '';

  b.innerHTML =
    '<div class="b-meta">' +
      '<span class="b-sender ' + (isAdmin ? 'adm' : 'pub') + '">' + groupTag + ' ' + esc(sender) + '</span>' +
      typeTag +
      '<span class="b-time">' + time + '</span>' +
    '</div>' +
    '<div class="b-text ' + (msg.text ? '' : 'empty') + '">' +
      esc(msg.text || '[' + (msg.msgType || 'media') + ']') +
    '</div>';

  // Remove initial placeholder
  const placeholder = feed.querySelector('.sys-msg');
  if (placeholder && feed.children.length <= 2) placeholder.remove();

  feed.appendChild(b);
  feed.scrollTop = feed.scrollHeight;
  S.msgCount++;
  document.getElementById('msg-count').textContent = S.msgCount + ' message' + (S.msgCount !== 1 ? 's' : '');
}

function clearFeed() {
  document.getElementById('msg-feed').innerHTML = '<div class="sys-msg">Feed cleared.</div>';
  S.msgCount = 0;
  document.getElementById('msg-count').textContent = '0 messages';
}

// Manual send
document.getElementById('send-target').addEventListener('change', function() {
  document.getElementById('custom-jid-field').style.display = this.value === '__custom__' ? 'block' : 'none';
});

async function sendMessage() {
  const btn = document.getElementById('send-btn');
  const status = document.getElementById('send-status');
  const target = document.getElementById('send-target').value;
  const text = document.getElementById('send-text').value.trim();
  let jid = target;
  if (target === '__public__') jid = S.publicJid;
  if (target === '__admin__')  jid = S.adminJid;
  if (target === '__custom__') jid = document.getElementById('custom-jid').value.trim();
  if (!jid) { status.innerHTML = '<span style="color:var(--red)">Select a group first</span>'; return; }
  if (!text) { status.innerHTML = '<span style="color:var(--red)">Enter a message</span>'; return; }
  btn.disabled = true;
  status.innerHTML = '<span style="color:var(--muted)">Sending…</span>';
  try {
    const r = await fetch('/api/send', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ jid, text }),
    });
    const d = await r.json();
    if (d.ok) {
      status.innerHTML = '<span style="color:var(--green)">✅ Sent!</span>';
      document.getElementById('send-text').value = '';
    } else throw new Error(d.error || 'Failed');
  } catch(e) {
    status.innerHTML = '<span style="color:var(--red)">❌ ' + esc(e.message) + '</span>';
  } finally {
    btn.disabled = false;
    setTimeout(() => status.innerHTML = '', 3000);
  }
}

// ═══════════════════════════════════════════════════════════════════
// APPROVALS TAB
// ═══════════════════════════════════════════════════════════════════
async function loadPendingBadge() {
  try {
    const r = await fetch('/api/pending');
    const d = await r.json();
    const count = (d.pending || []).length;
    const badge = document.getElementById('pending-badge');
    badge.textContent = count;
    badge.style.display = count > 0 ? 'inline-block' : 'none';
  } catch {}
}

async function loadPending() {
  document.getElementById('pending-list').innerHTML =
    '<div class="pending-empty"><div class="empty-icon">⏳</div><div>Loading…</div></div>';
  try {
    const r = await fetch('/api/pending');
    const d = await r.json();
    S.pending = d.pending || [];
    renderPending();
    const badge = document.getElementById('pending-badge');
    badge.textContent = S.pending.length;
    badge.style.display = S.pending.length > 0 ? 'inline-block' : 'none';
  } catch(e) {
    document.getElementById('pending-list').innerHTML =
      '<div class="pending-empty"><div>❌ Failed: ' + esc(e.message) + '</div></div>';
  }
}

function renderPending() {
  const list = document.getElementById('pending-list');
  if (S.pending.length === 0) {
    list.innerHTML = '<div class="pending-empty"><div class="empty-icon">✅</div><div>No pending questions — all clear!</div></div>';
    document.getElementById('detail-body').innerHTML = '<div class="detail-empty"><div style="font-size:2.5rem;margin-bottom:12px;">✅</div><div>No pending questions</div></div>';
    document.getElementById('detail-footer').style.display = 'none';
    return;
  }
  list.innerHTML = '';
  S.pending.forEach((p, i) => {
    const conf = Math.round((p.confidence || 0) * 100);
    const confColor = conf >= 72 ? 'var(--green)' : conf >= 55 ? 'var(--amber)' : 'var(--red)';
    const card = document.createElement('div');
    card.className = 'pcard' + (S.selectedPending?.questionId === p.questionId ? ' selected' : '');
    card.innerHTML =
      '<div class="pcard-top">' +
        '<div class="pcard-q">' + esc(p.questionText || '—') + '</div>' +
        confBadge(conf) +
      '</div>' +
      (conf > 0 ? '<div class="conf-bar-wrap"><div class="conf-label"><span>Match confidence</span><span>' + conf + '%</span></div>' +
        '<div class="conf-bar"><div class="conf-fill" style="width:' + conf + '%;background:' + confColor + '"></div></div></div>' : '') +
      '<div class="pcard-meta">' +
        '<span class="pmeta">👤 ' + esc(p.senderName || p.senderJid?.split('@')[0] || '?') + '</span>' +
        '<span class="pmeta">⏱️ ' + timeAgo(p.createdAt?._seconds * 1000 || Date.now()) + '</span>' +
        (p.suggestedAudioFileName ? '<span class="pmeta">🎙️ ' + esc(p.suggestedAudioFileName) + '</span>' : '<span class="pmeta" style="color:var(--red)">⚠️ No audio match</span>') +
      '</div>' +
      (p.suggestedTranscript ? '<div class="pcard-transcript">' + esc(p.suggestedTranscript) + '</div>' : '');
    card.addEventListener('click', () => selectPending(p));
    list.appendChild(card);
  });
}

function selectPending(p) {
  S.selectedPending = p;
  renderPending();
  const conf = Math.round((p.confidence || 0) * 100);
  const confClass = conf >= 72 ? 'high' : conf >= 55 ? 'med' : 'low';
  document.getElementById('detail-body').innerHTML =
    '<div class="detail-section">' +
      '<div class="detail-label">❓ User Question</div>' +
      '<div class="detail-value" style="font-size:.9rem;font-weight:600;">' + esc(p.questionText || '—') + '</div>' +
    '</div>' +
    '<div class="detail-section">' +
      '<div class="detail-label">👤 From</div>' +
      '<div class="detail-value">' + esc(p.senderName || p.senderJid || '?') + '</div>' +
    '</div>' +
    '<div class="detail-section">' +
      '<div class="detail-label">📊 Match Confidence</div>' +
      '<div class="conf-big ' + confClass + '">' + (conf > 0 ? conf + '%' : 'No match') + '</div>' +
    '</div>' +
    (p.suggestedAudioFileName ?
      '<div class="detail-section">' +
        '<div class="detail-label">🎙️ Suggested Audio File</div>' +
        '<div class="detail-value" style="font-family:monospace;font-size:.78rem;">' + esc(p.suggestedAudioFileName) + '</div>' +
      '</div>' : '') +
    (p.suggestedTranscript ?
      '<div class="detail-section">' +
        '<div class="detail-label">📝 Answer Transcript</div>' +
        '<div class="detail-value">' + esc(p.suggestedTranscript) + '</div>' +
      '</div>' : '<div class="detail-section"><div style="color:var(--red);font-size:.83rem;">⚠️ No historical audio found for this question. Sheikh needs to record a manual answer.</div></div>') +
    '<div class="detail-section">' +
      '<div class="detail-label">⏱️ Received</div>' +
      '<div class="detail-value">' + new Date((p.createdAt?._seconds || 0) * 1000).toLocaleString() + '</div>' +
    '</div>' +
    '<div class="detail-section">' +
      '<div class="detail-label">🆔 Question ID</div>' +
      '<div class="detail-value" style="font-family:monospace;font-size:.75rem;">' + esc(p.questionId) + '</div>' +
    '</div>';
  document.getElementById('detail-footer').style.display = '';
  document.getElementById('action-status').textContent = '';
}

async function approveSelected() {
  if (!S.selectedPending) return;
  const p = S.selectedPending;
  document.getElementById('action-status').textContent = '⏳ Sending approval…';
  try {
    const jid = S.adminJid;
    if (!jid) throw new Error('Admin group not configured');
    const r = await fetch('/api/send', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ jid, text: 'thik hai' }),
    });
    const d = await r.json();
    if (d.ok) {
      document.getElementById('action-status').innerHTML = '<span style="color:var(--green)">✅ Approval sent! Audio will be forwarded to pilgrim.</span>';
      setTimeout(() => { S.selectedPending = null; loadPending(); }, 2500);
    } else throw new Error(d.error);
  } catch(e) {
    document.getElementById('action-status').innerHTML = '<span style="color:var(--red)">❌ ' + esc(e.message) + '</span>';
  }
}

async function rejectSelected() {
  if (!S.selectedPending) return;
  document.getElementById('action-status').textContent = '⏳ Sending rejection…';
  try {
    const jid = S.adminJid;
    if (!jid) throw new Error('Admin group not configured');
    const r = await fetch('/api/send', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ jid, text: 'nahi' }),
    });
    const d = await r.json();
    if (d.ok) {
      document.getElementById('action-status').innerHTML = '<span style="color:var(--amber)">❌ Rejected.</span>';
      setTimeout(() => { S.selectedPending = null; loadPending(); }, 2000);
    }
  } catch(e) {
    document.getElementById('action-status').innerHTML = '<span style="color:var(--red)">❌ ' + esc(e.message) + '</span>';
  }
}

// ═══════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════
function esc(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function toast(type, msg) {
  const cls = type === 'ok' ? 'toast-ok' : type === 'err' ? 'toast-err' : 'toast-info';
  return '<div class="toast ' + cls + '">' + msg + '</div>';
}

function confBadge(conf) {
  const c = conf >= 72 ? 'var(--green)' : conf >= 55 ? 'var(--amber)' : 'var(--red)';
  const label = conf >= 72 ? 'HIGH' : conf >= 55 ? 'MED' : conf > 0 ? 'LOW' : 'NONE';
  return '<span style="font-size:.68rem;font-weight:700;padding:2px 7px;border-radius:20px;background:' + c + ';color:#000;flex-shrink:0;">' + label + ' ' + conf + '%</span>';
}

function timeAgo(ts) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return s + 's ago';
  if (s < 3600) return Math.floor(s/60) + 'm ago';
  return Math.floor(s/3600) + 'h ago';
}

// ═══════════════════════════════════════════════════════════════════
// KNOWLEDGE BASE TAB
// ═══════════════════════════════════════════════════════════════════
const KB = {
  items: [], total: -1, page: 1, limit: 20,
  topic: '', query: '', searchTimer: null,
  nextCursor: '',
  cursors: [''],   // cursors[0]=start, cursors[1]=after page1, etc.
  topicCounts: {},
  topicsLoaded: false,
};

async function kbLoad() {
  document.getElementById('kb-total-lbl').textContent = 'Loading…';
  document.getElementById('kb-tbody').innerHTML = '<tr><td colspan="8" style="text-align:center;padding:24px;color:var(--muted);">Loading…</td></tr>';
  try {
    const params = new URLSearchParams({ page: KB.page, limit: KB.limit });
    if (KB.topic) params.set('topic', KB.topic);
    if (KB.query) params.set('q', KB.query);
    // Use cursor for non-search navigation
    const cursor = !KB.query && KB.cursors[KB.page - 1];
    if (cursor) params.set('cursor', cursor);
    const r = await fetch('/api/kb?' + params);
    const d = await r.json();
    if (!d.ok) throw new Error(d.error || 'Load failed');
    KB.items = d.items;
    KB.total = d.total;
    KB.nextCursor = d.nextCursor || '';
    // Store cursor for next page
    if (d.nextCursor) KB.cursors[KB.page] = d.nextCursor;
    // Only update sidebar on first load or topic change
    if (d.topicCounts && Object.keys(d.topicCounts).length) {
      KB.topicCounts = d.topicCounts;
      KB.topicsLoaded = true;
      kbRenderSidebar(d.topicCounts);
    } else if (!KB.topicsLoaded) {
      kbRenderSidebar({});
    }
    kbRenderTable();
  } catch(e) {
    document.getElementById('kb-tbody').innerHTML = '<tr><td colspan="8" style="color:var(--red);padding:16px;">' + esc(e.message) + '</td></tr>';
    document.getElementById('kb-total-lbl').textContent = 'Error';
  }
}

function kbRenderSidebar(topicCounts) {
  document.getElementById('kb-cnt-ALL').textContent = Object.values(topicCounts).reduce((a,b) => a+b, 0);
  const topics = Object.entries(topicCounts).sort((a,b) => b[1]-a[1]);
  const topicEmojis = { TAWAF:'🕋', IHRAM:'🤍', JAMARAT:'🪨', QURBANI:'🐑', SALAH:'🙏', MINA:'⛺', ARAFAT:'🌄', SAEE:'🚶', HALQ:'✂️', UMRAH:'🌙', MADINAH:'🕌', MENSTRUATION:'🩺', HAIZ:'🩺', WUDU:'💧', GENERAL:'📁' };
  document.getElementById('kb-topic-list').innerHTML = topics.map(([t,c]) =>
    '<button class="kb-topic-btn' + (KB.topic===t?' active':'') + '" id="kbtopic-' + t + '" onclick="kbSetTopic(\'' + t + '\')">' +
    (topicEmojis[t]||'📂') + ' ' + t + '<span class="kb-topic-cnt">' + c + '</span></button>'
  ).join('');
}

function kbRenderTable() {
  const tb = document.getElementById('kb-tbody');
  const totalLbl = document.getElementById('kb-total-lbl');
  totalLbl.textContent = KB.total >= 0 ? KB.total + ' results' : KB.items.length + ' on this page';
  const totalPages = KB.total >= 0 ? Math.max(1, Math.ceil(KB.total / KB.limit)) : '?';
  document.getElementById('kb-page-lbl').textContent = 'Page ' + KB.page + (totalPages !== '?' ? ' of ' + totalPages : '');
  document.getElementById('kb-prev').disabled = KB.page <= 1;
  document.getElementById('kb-next').disabled = !KB.nextCursor && (KB.total < 0 ? KB.items.length < KB.limit : KB.page * KB.limit >= KB.total);

  if (!KB.items.length) {
    tb.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:32px;color:var(--muted);">No records found</td></tr>';
    return;
  }

  const offset = (KB.page - 1) * KB.limit;
  tb.innerHTML = KB.items.map((rec, i) => {
    const conf = rec.confidence || 0;
    const confCls = conf >= 0.85 ? 'kb-conf-high' : conf >= 0.65 ? 'kb-conf-med' : 'kb-conf-low';
    const confPct = Math.round(conf * 100) + '%';
    const audio = rec.audioFileName
      ? '<span class="kb-audio-chip">🎵 ' + esc(rec.audioFileName.slice(0,18)) + '</span>'
      : '<span style="color:var(--muted);font-size:.72rem;">text only</span>';
    const ruling = rec.authenticRuling
      ? esc(rec.authenticRuling.slice(0,50)) + (rec.authenticRuling.length > 50 ? '…' : '')
      : '<span style="color:var(--muted)">—</span>';
    return '<tr onclick="kbOpen(\'' + esc(rec.id) + '\')">' +
      '<td style="color:var(--muted);font-size:.72rem;">' + (offset + i + 1) + '</td>' +
      '<td class="kb-q" title="' + esc(rec.question||'') + '">' + esc((rec.question||'').slice(0,70)) + '</td>' +
      '<td><span style="font-size:.72rem;font-weight:600;">' + esc(rec.topic||'?') + '</span></td>' +
      '<td style="font-size:.72rem;color:var(--muted);">' + esc(rec.questionLang||'?') + '</td>' +
      '<td><span class="kb-conf-pill ' + confCls + '">' + confPct + '</span></td>' +
      '<td class="kb-ruling" title="' + esc(rec.authenticRuling||'') + '">' + ruling + '</td>' +
      '<td>' + audio + '</td>' +
      '<td><button class="btn btn-ghost" style="padding:3px 10px;font-size:.74rem;" onclick="event.stopPropagation();kbOpen(\'' + esc(rec.id) + '\')">✏️ Edit</button></td>' +
      '</tr>';
  }).join('');
}

function kbSetTopic(t) {
  KB.topic = t;
  KB.page = 1;
  KB.cursors = [''];
  KB.nextCursor = '';
  KB.topicsLoaded = (t === '' && KB.topicsLoaded); // re-fetch counts on all-topics view
  // Update active state
  document.querySelectorAll('.kb-topic-btn').forEach(b => b.classList.remove('active'));
  const activeId = t ? 'kbtopic-' + t : 'kbtopic-ALL';
  const btn = document.getElementById(activeId);
  if (btn) btn.classList.add('active');
  kbLoad();
}

function kbPage(dir) {
  if (dir > 0 && KB.nextCursor) KB.cursors[KB.page] = KB.nextCursor;
  KB.page = Math.max(1, KB.page + dir);
  kbLoad();
}

function kbOnSearch() {
  clearTimeout(KB.searchTimer);
  KB.searchTimer = setTimeout(() => {
    KB.query = document.getElementById('kb-search').value.trim();
    KB.page = 1;
    KB.cursors = [''];
    KB.nextCursor = '';
    kbLoad();
  }, 400);
}

// ── Open edit modal ───────────────────────────────────────────────
async function kbOpen(id) {
  document.getElementById('kb-modal-st').textContent = 'Loading…';
  document.getElementById('kb-modal').style.display = 'flex';
  document.getElementById('kb-modal-title').textContent = '✏️ Edit: ' + id;
  try {
    const r = await fetch('/api/kb/' + id);
    const d = await r.json();
    if (!d.ok) throw new Error(d.error || 'Not found');
    const rec = d.record;
    document.getElementById('kb-edit-id').value         = rec.id || id;
    document.getElementById('kb-edit-id-disp').value    = rec.id || id;
    document.getElementById('kb-edit-q').value          = rec.question || '';
    document.getElementById('kb-edit-ruling').value     = rec.authenticRuling || '';
    document.getElementById('kb-edit-keypoints').value  = rec.rulingKeyPoints || '';
    document.getElementById('kb-edit-anstext').value    = rec.answerText || '';
    document.getElementById('kb-edit-transcript').value = rec.answerTranscript || '';
    document.getElementById('kb-edit-audio').value      = rec.audioFileName || '';
    document.getElementById('kb-edit-english').value    = rec.englishTranslation || '';
    document.getElementById('kb-edit-conf').value       = rec.confidence ?? '';
    document.getElementById('kb-edit-label').value      = rec.accuracyLabel || '';
    document.getElementById('kb-edit-keywords').value   = (rec.keywords || []).join(', ');
    // Set topic dropdown
    const sel = document.getElementById('kb-edit-topic');
    const topicVal = (rec.topic||'GENERAL').toUpperCase();
    for (let i=0;i<sel.options.length;i++) { if (sel.options[i].value===topicVal||sel.options[i].text===topicVal) { sel.selectedIndex=i; break; } }
    document.getElementById('kb-modal-st').textContent = '';
  } catch(e) {
    document.getElementById('kb-modal-st').textContent = '❌ ' + e.message;
  }
}

async function kbSave() {
  const id = document.getElementById('kb-edit-id').value;
  const st = document.getElementById('kb-modal-st');
  st.textContent = '⏳ Saving…'; st.style.color = 'var(--muted)';
  try {
    const body = {
      question:        document.getElementById('kb-edit-q').value,
      topic:           document.getElementById('kb-edit-topic').value,
      answerText:      document.getElementById('kb-edit-anstext').value,
      answerTranscript:document.getElementById('kb-edit-transcript').value,
      authenticRuling: document.getElementById('kb-edit-ruling').value,
      rulingKeyPoints: document.getElementById('kb-edit-keypoints').value,
      confidence:      parseFloat(document.getElementById('kb-edit-conf').value) || 0,
      accuracyLabel:   document.getElementById('kb-edit-label').value,
    };
    const r = await fetch('/api/kb/' + id, {
      method: 'PUT', headers: {'Content-Type':'application/json'}, body: JSON.stringify(body),
    });
    const d = await r.json();
    if (!d.ok) throw new Error(d.error || 'Save failed');
    st.style.color = 'var(--green)'; st.textContent = '✅ Saved!';
    setTimeout(() => { kbCloseModal(); kbLoad(); }, 800);
  } catch(e) {
    st.style.color = 'var(--red)'; st.textContent = '❌ ' + e.message;
  }
}

async function kbDelete() {
  const id = document.getElementById('kb-edit-id').value;
  if (!confirm('Delete record ' + id + '? This cannot be undone.')) return;
  const st = document.getElementById('kb-modal-st');
  st.textContent = '⏳ Deleting…'; st.style.color = 'var(--amber)';
  try {
    const r = await fetch('/api/kb/' + id, { method: 'DELETE' });
    const d = await r.json();
    if (!d.ok) throw new Error(d.error || 'Delete failed');
    kbCloseModal(); kbLoad();
  } catch(e) {
    st.style.color = 'var(--red)'; st.textContent = '❌ ' + e.message;
  }
}

function kbCloseModal() {
  document.getElementById('kb-modal').style.display = 'none';
}
function kbModalClose(e) {
  if (e.target.id === 'kb-modal') kbCloseModal();
}

// ═══════════════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════════════
initSettings();
connectSSE();
loadDebug();
loadPendingBadge();
setInterval(() => { loadDebug(); loadPendingBadge(); }, 30000);

</script>
</body>
</html>`;
}
