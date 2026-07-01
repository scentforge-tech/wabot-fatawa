/** Premium dashboard CSS */
export const DASH_CSS = `<style>
*{margin:0;padding:0;box-sizing:border-box;}
:root{
  --bg:#070a12;--surface:#0d1117;--s2:#111827;--s3:#1a2234;--s4:#202b40;
  --border:rgba(255,255,255,0.06);--border2:rgba(255,255,255,0.1);
  --glass:rgba(255,255,255,0.03);--glass2:rgba(255,255,255,0.06);
  --green:#25d366;--green2:#1fad53;--green-g:rgba(37,211,102,0.12);--green-dim:rgba(37,211,102,0.3);
  --teal:#06b6d4;--teal-g:rgba(6,182,212,0.1);
  --purple:#8b5cf6;--purple-g:rgba(139,92,246,0.1);
  --amber:#f59e0b;--amber-g:rgba(245,158,11,0.1);
  --red:#ef4444;--red-g:rgba(239,68,68,0.1);
  --blue:#3b82f6;--blue-g:rgba(59,130,246,0.1);
  --text:#f1f5f9;--muted:#64748b;--muted2:#94a3b8;
  --font:'Inter',sans-serif;--r:14px;--r-sm:8px;--r-lg:20px;--sidebar:220px;
  --trans:.18s cubic-bezier(.4,0,.2,1);
}
html,body{height:100%;font-family:var(--font);background:var(--bg);color:var(--text);overflow:hidden;}
button{font-family:var(--font);cursor:pointer;}
input,textarea,select{font-family:var(--font);}
::-webkit-scrollbar{width:4px;height:4px;}
::-webkit-scrollbar-thumb{background:var(--s4);border-radius:4px;}
.app{display:grid;grid-template-columns:var(--sidebar) 1fr;height:100vh;overflow:hidden;}
.sidebar{background:var(--surface);border-right:1px solid var(--border);display:flex;flex-direction:column;overflow:hidden;position:relative;z-index:10;}
.sidebar::before{content:'';position:absolute;inset:0;background:linear-gradient(180deg,rgba(37,211,102,0.03) 0%,transparent 40%);pointer-events:none;}
.sb-brand{padding:20px 16px 12px;display:flex;align-items:center;gap:10px;border-bottom:1px solid var(--border);}
.sb-icon{width:34px;height:34px;background:linear-gradient(135deg,var(--green),var(--teal));border-radius:9px;display:flex;align-items:center;justify-content:center;font-size:1.1rem;flex-shrink:0;box-shadow:0 0 20px rgba(37,211,102,0.25);}
.sb-title{font-size:.88rem;font-weight:700;}
.sb-title span{color:var(--green);}
.sb-conn{display:flex;align-items:center;gap:6px;padding:8px 12px;margin:10px 8px 0;border-radius:var(--r-sm);font-size:.74rem;color:var(--muted2);background:var(--glass);border:1px solid var(--border);}
.sb-dot{width:7px;height:7px;border-radius:50%;flex-shrink:0;}
.sb-dot.on{background:var(--green);box-shadow:0 0 8px var(--green);animation:pulse 2s ease infinite;}
.sb-dot.off{background:var(--red);}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
.sb-nav{flex:1;padding:10px 8px;display:flex;flex-direction:column;gap:2px;overflow-y:auto;}
.nav-sec{font-size:.66rem;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.08em;padding:10px 10px 4px;}
.nav-btn{display:flex;align-items:center;gap:9px;padding:9px 12px;border-radius:var(--r-sm);border:none;background:transparent;color:var(--muted2);font-size:.83rem;font-weight:500;width:100%;text-align:left;transition:var(--trans);position:relative;cursor:pointer;}
.nav-btn:hover{background:var(--glass2);color:var(--text);}
.nav-btn.active{background:linear-gradient(135deg,rgba(37,211,102,0.15),rgba(6,182,212,0.08));color:var(--green);font-weight:600;}
.nav-btn.active::before{content:'';position:absolute;left:0;top:20%;bottom:20%;width:3px;background:var(--green);border-radius:0 3px 3px 0;}
.nb-icon{font-size:1rem;width:20px;text-align:center;flex-shrink:0;}
.badge{margin-left:auto;background:var(--red);color:#fff;font-size:.62rem;font-weight:700;padding:2px 6px;border-radius:10px;min-width:18px;text-align:center;}
.sb-footer{padding:12px;border-top:1px solid var(--border);}
.kb-stat{display:flex;align-items:center;justify-content:space-between;padding:8px 10px;background:var(--glass);border:1px solid var(--border);border-radius:var(--r-sm);font-size:.73rem;}
.kb-stat span:first-child{color:var(--muted2);}
.kb-stat span:last-child{color:var(--green);font-weight:700;}
.main{display:flex;flex-direction:column;overflow:hidden;background:var(--bg);}
.topbar{display:flex;align-items:center;gap:12px;padding:10px 20px;background:var(--surface);border-bottom:1px solid var(--border);flex-shrink:0;min-height:52px;}
.topbar-right{margin-left:auto;display:flex;align-items:center;gap:8px;}
.tpill{display:flex;align-items:center;gap:6px;padding:5px 12px;border-radius:20px;border:1px solid var(--border);font-size:.74rem;background:var(--glass);color:var(--muted2);}
.panel{display:none;flex:1;overflow:hidden;flex-direction:column;}
.panel.active{display:flex;}
.btn{display:inline-flex;align-items:center;gap:7px;padding:8px 16px;border-radius:var(--r-sm);border:none;font-size:.82rem;font-weight:600;transition:var(--trans);cursor:pointer;}
.btn-green{background:linear-gradient(135deg,var(--green),var(--green2));color:#000;box-shadow:0 2px 12px rgba(37,211,102,0.25);}
.btn-green:hover{transform:translateY(-1px);box-shadow:0 4px 20px rgba(37,211,102,0.35);}
.btn-ghost{background:var(--glass2);color:var(--text);border:1px solid var(--border2);}
.btn-ghost:hover{background:var(--s3);}
.btn-teal{background:linear-gradient(135deg,var(--teal),#0891b2);color:#000;}
.btn-teal:hover{transform:translateY(-1px);}
.btn-red{background:var(--red-g);color:var(--red);border:1px solid rgba(239,68,68,0.3);}
.btn-red:hover{background:var(--red);color:#fff;}
.btn:disabled{opacity:.4;cursor:not-allowed;transform:none!important;}
.btn-sm{padding:5px 11px;font-size:.76rem;}
.btn-xs{padding:3px 9px;font-size:.7rem;}
.card{background:var(--glass);border:1px solid var(--border);border-radius:var(--r);padding:18px;transition:var(--trans);}
.card:hover{border-color:var(--border2);}
.card-title{font-size:.85rem;font-weight:600;margin-bottom:12px;display:flex;align-items:center;gap:8px;}
.inp{background:var(--s2);border:1px solid var(--border);border-radius:var(--r-sm);color:var(--text);padding:9px 12px;font-size:.83rem;outline:none;transition:var(--trans);width:100%;}
.inp:focus{border-color:var(--green);box-shadow:0 0 0 3px rgba(37,211,102,0.08);}
.inp-sel{background:var(--s2);border:1px solid var(--border);border-radius:var(--r-sm);color:var(--text);padding:9px 12px;font-size:.83rem;outline:none;width:100%;}
.inp-ta{background:var(--s2);border:1px solid var(--border);border-radius:var(--r-sm);color:var(--text);padding:9px 12px;font-size:.83rem;outline:none;resize:vertical;line-height:1.5;width:100%;}
.inp-ta:focus,.inp-sel:focus{border-color:var(--green);box-shadow:0 0 0 3px rgba(37,211,102,0.08);}
.field{display:flex;flex-direction:column;gap:5px;}
.field label{font-size:.71rem;font-weight:600;color:var(--muted2);text-transform:uppercase;letter-spacing:.05em;}
.toast{padding:9px 14px;border-radius:var(--r-sm);font-size:.8rem;}
.toast-ok{background:var(--green-g);color:var(--green);border:1px solid var(--green-dim);}
.toast-err{background:var(--red-g);color:var(--red);border:1px solid rgba(239,68,68,0.3);}
@keyframes slideIn{from{opacity:0;transform:translateY(6px)}}
@keyframes fadeUp{from{opacity:0;transform:translateY(12px)}}
.ov-wrap{flex:1;overflow-y:auto;padding:20px;}
.ov-hdr{display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;}
.ov-title{font-size:1.1rem;font-weight:800;letter-spacing:-.02em;}
.ov-sub{font-size:.78rem;color:var(--muted);margin-top:2px;}
.stat-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(165px,1fr));gap:12px;margin-bottom:20px;}
.sc{background:var(--glass);border:1px solid var(--border);border-radius:var(--r);padding:16px;position:relative;overflow:hidden;transition:var(--trans);animation:fadeUp .35s ease both;}
.sc::before{content:'';position:absolute;top:-40%;right:-20%;width:80px;height:80px;border-radius:50%;opacity:.12;filter:blur(20px);}
.sc.gn::before{background:var(--green);}
.sc.te::before{background:var(--teal);}
.sc.pu::before{background:var(--purple);}
.sc.am::before{background:var(--amber);}
.sc.bl::before{background:var(--blue);}
.sc:hover{transform:translateY(-2px);border-color:var(--border2);}
.sc-val{font-size:1.7rem;font-weight:800;letter-spacing:-.04em;line-height:1;margin:8px 0 4px;}
.sc-val.gn{color:var(--green);}
.sc-val.te{color:var(--teal);}
.sc-val.pu{color:var(--purple);}
.sc-val.am{color:var(--amber);}
.sc-val.bl{color:var(--blue);}
.sc-lbl{font-size:.73rem;color:var(--muted);font-weight:500;}
.charts-grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:14px;margin-bottom:20px;}
.cc{background:var(--glass);border:1px solid var(--border);border-radius:var(--r);padding:16px;}
.cc-title{font-size:.82rem;font-weight:600;margin-bottom:12px;color:var(--muted2);}
.cc-wrap{position:relative;height:160px;}
.qa-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;}
.qa{background:var(--glass);border:1px solid var(--border);border-radius:var(--r);padding:16px;display:flex;align-items:center;gap:12px;transition:var(--trans);cursor:pointer;}
.qa:hover{border-color:var(--green-dim);background:var(--green-g);}
.qa-ic{width:40px;height:40px;border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:1.2rem;flex-shrink:0;}
.qa-ic.gn{background:var(--green-g);border:1px solid var(--green-dim);}
.qa-ic.te{background:var(--teal-g);border:1px solid rgba(6,182,212,0.3);}
.qa-ic.pu{background:var(--purple-g);border:1px solid rgba(139,92,246,0.3);}
.qa-ic.am{background:var(--amber-g);border:1px solid rgba(245,158,11,0.3);}
.qa-tx strong{font-size:.85rem;font-weight:600;display:block;margin-bottom:2px;}
.qa-tx span{font-size:.74rem;color:var(--muted);}
.setup-wrap{flex:1;overflow-y:auto;padding:20px;max-width:860px;width:100%;}
.group-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:8px;margin-top:12px;}
.gc{background:var(--s2);border:2px solid var(--border);border-radius:var(--r-sm);padding:12px 14px;cursor:pointer;transition:var(--trans);position:relative;}
.gc:hover{border-color:var(--green);}
.gc.sp{border-color:var(--green);background:var(--green-g);}
.gc.sa{border-color:var(--amber);background:var(--amber-g);}
.gname{font-size:.85rem;font-weight:600;margin-bottom:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.gjid{font-size:.68rem;color:var(--muted);font-family:monospace;}
.gbadge{position:absolute;top:8px;right:8px;font-size:.63rem;font-weight:700;padding:2px 7px;border-radius:20px;}
.gbadge-pub{background:var(--green);color:#000;}
.gbadge-adm{background:var(--amber);color:#000;}
.sel-row{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:10px;}
.sel-box{padding:10px 14px;border-radius:var(--r-sm);font-size:.82rem;}
.sel-box.set{background:var(--green-g);border:1px solid var(--green-dim);}
.sel-box.unset{background:var(--glass);border:1px solid var(--border);}
.sel-box strong{display:block;font-size:.68rem;color:var(--muted);margin-bottom:3px;}
.leg{display:flex;gap:14px;margin-bottom:10px;font-size:.76rem;color:var(--muted);flex-wrap:wrap;}
.leg span{display:flex;align-items:center;gap:5px;}
.ld{width:8px;height:8px;border-radius:2px;flex-shrink:0;}
.mon-layout{flex:1;display:grid;grid-template-columns:1fr 300px;overflow:hidden;}
.feed-wrap{display:flex;flex-direction:column;overflow:hidden;border-right:1px solid var(--border);}
.feed-hdr{display:flex;align-items:center;gap:10px;padding:10px 16px;border-bottom:1px solid var(--border);flex-shrink:0;background:var(--surface);}
.feed-hdr h3{font-size:.86rem;font-weight:700;}
.cpill{background:var(--glass2);color:var(--muted2);font-size:.68rem;padding:2px 8px;border-radius:10px;font-weight:600;}
.feed{flex:1;overflow-y:auto;padding:10px 14px;display:flex;flex-direction:column;gap:5px;}
.sys-msg{background:var(--glass);border:1px dashed var(--border2);border-radius:var(--r-sm);padding:7px 14px;font-size:.74rem;color:var(--muted);text-align:center;align-self:center;}
.bub{padding:9px 12px;border-radius:10px;font-size:.81rem;max-width:88%;animation:slideIn .2s ease;}
.bub.in{background:var(--s2);border:1px solid var(--border);align-self:flex-start;}
.bub.out{background:var(--green-g);border:1px solid var(--green-dim);align-self:flex-end;}
.bub.ai{background:var(--amber-g);border:1px solid rgba(245,158,11,0.3);align-self:flex-start;}
.b-meta{display:flex;align-items:center;gap:7px;margin-bottom:3px;}
.b-sender{font-weight:700;font-size:.76rem;}
.b-sender.pub{color:var(--green);}
.b-sender.adm{color:var(--amber);}
.b-time{font-size:.68rem;color:var(--muted);margin-left:auto;}
.b-text{word-break:break-word;line-height:1.5;}
.send-panel{display:flex;flex-direction:column;background:var(--surface);overflow:hidden;}
.send-hdr{padding:10px 14px;border-bottom:1px solid var(--border);flex-shrink:0;}
.send-hdr h3{font-size:.86rem;font-weight:700;}
.send-body{flex:1;overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:10px;}
.send-footer{padding:10px 12px;flex-shrink:0;}
.app-layout{flex:1;display:grid;grid-template-columns:1fr 340px;overflow:hidden;}
.pend-wrap{overflow-y:auto;padding:14px;}
.pend-hdr{display:flex;align-items:center;gap:10px;margin-bottom:12px;}
.pend-hdr h3{font-size:.9rem;font-weight:700;}
.pend-empty{text-align:center;padding:48px 20px;color:var(--muted);}
.pcard{background:var(--glass);border:1px solid var(--border);border-radius:var(--r);padding:14px;margin-bottom:8px;transition:var(--trans);cursor:pointer;}
.pcard:hover{border-color:var(--blue);}
.pcard.sel{border-color:var(--green);background:var(--green-g);}
.pcard-q{font-size:.84rem;font-weight:600;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;margin-bottom:8px;}
.cbar{height:4px;background:var(--s3);border-radius:3px;overflow:hidden;margin:5px 0;}
.cbar-fill{height:100%;border-radius:3px;transition:width .5s;}
.pcard-meta{font-size:.68rem;color:var(--muted);}
.det-panel{background:var(--surface);border-left:1px solid var(--border);display:flex;flex-direction:column;overflow:hidden;}
.det-hdr{padding:12px 16px;border-bottom:1px solid var(--border);flex-shrink:0;}
.det-hdr h3{font-size:.88rem;font-weight:700;}
.det-body{flex:1;overflow-y:auto;padding:14px;}
.det-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;color:var(--muted);text-align:center;padding:24px;}
.det-sec{margin-bottom:14px;}
.det-lbl{font-size:.7rem;color:var(--muted);font-weight:600;text-transform:uppercase;letter-spacing:.05em;margin-bottom:5px;}
.det-val{font-size:.83rem;line-height:1.5;word-break:break-word;}
.cbig{font-size:1.8rem;font-weight:800;}
.cbig.hi{color:var(--green);}
.cbig.md{color:var(--amber);}
.cbig.lo{color:var(--red);}
.det-footer{padding:10px 14px;border-top:1px solid var(--border);flex-shrink:0;display:flex;flex-direction:column;gap:8px;}
.act-row{display:flex;gap:8px;}
.act-row .btn{flex:1;justify-content:center;}
.kb-layout{flex:1;display:grid;grid-template-columns:200px 1fr;overflow:hidden;}
.kb-sidebar{background:var(--surface);border-right:1px solid var(--border);overflow-y:auto;padding:10px 6px;}
.kb-stitle{font-size:.68rem;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.07em;padding:4px 10px 8px;}
.kbt{width:100%;text-align:left;background:none;border:none;color:var(--muted2);font-size:.8rem;padding:6px 10px;border-radius:var(--r-sm);cursor:pointer;display:flex;align-items:center;justify-content:space-between;transition:var(--trans);}
.kbt:hover{background:var(--glass2);color:var(--text);}
.kbt.active{background:linear-gradient(135deg,rgba(37,211,102,0.12),rgba(6,182,212,0.05));color:var(--green);font-weight:600;}
.kbt-cnt{font-size:.67rem;color:var(--muted);background:var(--s3);padding:1px 6px;border-radius:8px;}
.kb-main{display:flex;flex-direction:column;overflow:hidden;}
.kb-tb{display:flex;align-items:center;gap:8px;padding:9px 12px;border-bottom:1px solid var(--border);background:var(--surface);flex-shrink:0;flex-wrap:wrap;}
.kb-srch{flex:1;min-width:160px;background:var(--s2);border:1px solid var(--border);border-radius:var(--r-sm);color:var(--text);padding:7px 12px;font-size:.82rem;outline:none;font-family:var(--font);transition:var(--trans);}
.kb-srch:focus{border-color:var(--green);box-shadow:0 0 0 3px rgba(37,211,102,0.07);}
.kb-cnt{font-size:.76rem;color:var(--muted);white-space:nowrap;}
.kb-tw{flex:1;overflow-y:auto;}
.kb-t{width:100%;border-collapse:collapse;font-size:.8rem;}
.kb-t th{position:sticky;top:0;background:var(--surface);padding:8px 10px;text-align:left;font-size:.68rem;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;border-bottom:1px solid var(--border);z-index:1;}
.kb-t td{padding:9px 10px;border-bottom:1px solid var(--border);vertical-align:middle;max-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.kb-t tr:hover td{background:var(--glass2);cursor:pointer;}
.cpill{display:inline-block;padding:2px 7px;border-radius:8px;font-size:.68rem;font-weight:700;}
.cp-h{background:var(--green-g);color:var(--green);border:1px solid var(--green-dim);}
.cp-m{background:var(--amber-g);color:var(--amber);border:1px solid rgba(245,158,11,0.3);}
.cp-l{background:var(--red-g);color:var(--red);border:1px solid rgba(239,68,68,0.3);}
.achip{display:inline-flex;align-items:center;gap:3px;background:var(--blue-g);color:var(--blue);font-size:.66rem;padding:1px 6px;border-radius:6px;border:1px solid rgba(59,130,246,0.2);}
.kb-pg{display:flex;align-items:center;gap:8px;padding:7px 12px;border-top:1px solid var(--border);background:var(--surface);flex-shrink:0;}
.pgb{padding:4px 12px;border-radius:var(--r-sm);border:1px solid var(--border);background:var(--glass2);color:var(--text);cursor:pointer;font-size:.76rem;font-family:var(--font);transition:var(--trans);}
.pgb:hover:not(:disabled){background:var(--s3);}
.pgb:disabled{opacity:.3;cursor:not-allowed;}
.mbg{position:fixed;inset:0;background:rgba(0,0,0,.75);z-index:1000;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(6px);}
.modal{background:var(--surface);border:1px solid var(--border2);border-radius:var(--r-lg);width:min(700px,96vw);max-height:92vh;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 24px 80px rgba(0,0,0,.7);animation:mpop .2s cubic-bezier(.34,1.56,.64,1);}
@keyframes mpop{from{opacity:0;transform:scale(.95) translateY(10px)}}
.mhdr{display:flex;align-items:center;padding:16px 20px;border-bottom:1px solid var(--border);flex-shrink:0;gap:10px;}
.mhdr h3{font-size:.95rem;font-weight:700;flex:1;}
.mclose{background:none;border:none;color:var(--muted);font-size:1.2rem;cursor:pointer;padding:3px 7px;border-radius:var(--r-sm);transition:var(--trans);}
.mclose:hover{background:var(--glass2);color:var(--text);}
.mbody{flex:1;overflow-y:auto;padding:20px;display:flex;flex-direction:column;gap:14px;}
.mfoot{display:flex;align-items:center;gap:8px;padding:14px 20px;border-top:1px solid var(--border);flex-shrink:0;}
.mst{flex:1;font-size:.77rem;}
.g2{display:grid;grid-template-columns:1fr 1fr;gap:12px;}
.inp-ro{background:var(--bg);color:var(--muted);cursor:default;}
.eprog{background:var(--glass2);border:1px solid var(--border);border-radius:var(--r-sm);padding:10px 14px;font-size:.78rem;color:var(--muted2);display:flex;align-items:center;gap:10px;}
.epbw{flex:1;height:4px;background:var(--s3);border-radius:3px;overflow:hidden;}
.epb{height:100%;background:linear-gradient(90deg,var(--green),var(--teal));border-radius:3px;transition:width .4s ease;width:0%;}
.sbar{display:flex;align-items:center;gap:14px;padding:5px 20px;background:var(--surface);border-top:1px solid var(--border);flex-shrink:0;font-size:.72rem;color:var(--muted);}
.sbar .st{display:flex;align-items:center;gap:5px;}
.sdot{width:5px;height:5px;border-radius:50%;}
.sdot.ok{background:var(--green);}
.sdot.off{background:var(--red);}
</style>`;
