/** Premium dashboard JavaScript (client-side) */
export const DASH_JS = `<script>
const S={groups:[],pJid:null,aJid:null,msgCnt:0,pending:[],selPend:null,conn:false,charts:{},anal:false};
const KB={items:[],total:-1,page:1,limit:20,topic:'',q:'',timer:null,next:'',cursors:[''],tl:false,tc:{}};
let kbMode='edit';
function esc(s){const d=document.createElement('div');d.textContent=String(s||'');return d.innerHTML;}
function animN(el,t,dur){if(!el)return;dur=dur||700;let i=0;const step=dur/50;const iv=setInterval(function(){i++;const v=Math.min(t,Math.round(t*(i*step/dur)));el.textContent=v.toLocaleString();if(v>=t)clearInterval(iv);},step);}
const PANELS=['overview','setup','monitor','approvals','kb'];
const CRUMBS={overview:'📊 Overview',setup:'⚙️ Setup',monitor:'📡 Monitor',approvals:'✅ Approvals',kb:'🗄️ Knowledge Base'};
function gp(n){
  PANELS.forEach(function(t){
    document.getElementById('panel-'+t).classList.toggle('active',t===n);
    document.getElementById('nav-'+t).classList.toggle('active',t===n);
  });
  document.getElementById('crumb').textContent=CRUMBS[n]||n;
  if(n==='approvals')loadPending();
  if(n==='kb')kbLoad();
  if(n==='overview'&&!S.anal)loadAnalytics();
}
const CC=['#25d366','#06b6d4','#8b5cf6','#f59e0b','#ef4444','#3b82f6','#10b981','#f97316','#ec4899','#6366f1','#14b8a6'];
async function loadAnalytics(){
  try{
    const r=await fetch('/api/analytics');
    const d=await r.json();
    if(!d.ok)throw new Error(d.error||'Failed');
    S.anal=true;
    animN(document.getElementById('ov-total'),d.totalRecords||0);
    animN(document.getElementById('ov-audio'),d.audioRecords||0);
    animN(document.getElementById('ov-v3'),d.v3Records||0);
    animN(document.getElementById('ov-pend'),d.pendingApprovals||0);
    animN(document.getElementById('ov-text'),d.textRecords||0);
    document.getElementById('ov-conn').textContent=S.conn?'Connected':'Offline';
    document.getElementById('sb-kb').textContent=d.totalRecords||'0';
    document.getElementById('sb-k2').textContent=d.totalRecords||'0';
    document.getElementById('ov-upd').textContent='Updated '+new Date().toLocaleTimeString();
    mkChart('ch-topics',Object.keys(d.topicCounts||{}).slice(0,10),Object.values(d.topicCounts||{}).slice(0,10),'doughnut');
    mkChart('ch-lang',Object.keys(d.langCounts||{}),Object.values(d.langCounts||{}),'pie');
    var cb=d.confBuckets||{};
    mkChart('ch-conf',['<65%','65-80%','80-90%','90%+'],[cb.low||0,cb.med||0,cb.high||0,cb.vhigh||0],'bar');
  }catch(e){
    var el=document.getElementById('ov-upd');
    if(el)el.textContent='Error: '+e.message;
  }
}
function mkChart(id,labels,data,type){
  var ctx=document.getElementById(id);
  if(!ctx)return;
  if(S.charts[id])S.charts[id].destroy();
  var opts={responsive:true,maintainAspectRatio:false,plugins:{legend:{display:type!=='bar',position:'bottom',labels:{color:'#64748b',boxWidth:10,font:{size:10},padding:8}}}};
  if(type==='bar'){
    S.charts[id]=new Chart(ctx,{type:'bar',data:{labels:labels,datasets:[{data:data,backgroundColor:CC.slice(0,data.length),borderRadius:4}]},
      options:Object.assign({},opts,{scales:{x:{ticks:{color:'#64748b',font:{size:9}},grid:{color:'rgba(255,255,255,0.04)'}},y:{ticks:{color:'#64748b'},grid:{color:'rgba(255,255,255,0.04)'}}}})});
  }else{
    S.charts[id]=new Chart(ctx,{type:type,data:{labels:labels,datasets:[{data:data,backgroundColor:CC.slice(0,data.length),borderWidth:0}]},options:opts});
  }
}
async function loadDebug(){
  try{
    var r=await fetch('/api/debug');
    var d=await r.json();
    S.conn=d.connected;
    S.pJid=d.settings&&d.settings.publicGroupJid||null;
    S.aJid=d.settings&&d.settings.adminGroupJid||null;
    var on=d.connected;
    ['sb-dot','sb-d2'].forEach(function(id){
      var e=document.getElementById(id);
      if(e)e.className=e.className.replace(/\bon\b|\boff\b/g,'')+' '+(on?'on':'off');
    });
    var sl=document.getElementById('sb-lbl');if(sl)sl.textContent=on?'Connected':'Disconnected';
    var sl2=document.getElementById('sb-l2');if(sl2)sl2.textContent=on?'WhatsApp Connected':'Offline';
    var st2=document.getElementById('sb-t2');if(st2)st2.textContent=new Date().toLocaleTimeString();
    var tbt=document.getElementById('tb-time');if(tbt)tbt.textContent=new Date().toLocaleTimeString();
    var skb=document.getElementById('sb-kb');if(skb)skb.textContent=d.kbCount||'0';
    var sk2=document.getElementById('sb-k2');if(sk2)sk2.textContent=d.kbCount||'0';
    function sj(j){return j?(j.split('@')[0].slice(0,12)+'…'):'—';}
    var tp=document.getElementById('tb-pub');if(tp)tp.textContent=sj(S.pJid);
    var ta=document.getElementById('tb-adm');if(ta)ta.textContent=sj(S.aJid);
    var pv=document.getElementById('pub-val');if(pv)pv.textContent=S.pJid||'Not configured';
    var av=document.getElementById('adm-val');if(av)av.textContent=S.aJid||'Not configured';
    var bp=document.getElementById('box-pub');if(bp)bp.className='sel-box '+(S.pJid?'set':'unset');
    var ba=document.getElementById('box-adm');if(ba)ba.className='sel-box '+(S.aJid?'set':'unset');
    var dbg=document.getElementById('dbg');
    if(dbg)dbg.innerHTML='<span style="color:var(--'+(on?'green':'red')+')">'+
      (on?'🟢 Connected':'🔴 Offline')+'</span> | KB: <strong>'+d.kbCount+'</strong>'+
      (S.pJid?' | 📢 '+S.pJid.split('@')[0]:' | ⚠️ No public')+
      (S.aJid?' | 🔐 '+S.aJid.split('@')[0]:' | ⚠️ No admin')+
      ' | 🤖 '+((d.settings&&d.settings.replyMode)||'approval');
    if(!S.replyTouched)applyReplySettings(d.settings||{});
  }catch(e){var dbg2=document.getElementById('dbg');if(dbg2)dbg2.textContent='Error: '+e.message;}
}
function applyReplySettings(s){
  var mode=s.replyMode||'approval';
  var rb=document.querySelector('input[name="replyMode"][value="'+mode+'"]');
  if(rb)rb.checked=true;
  document.querySelectorAll('.rmode').forEach(function(l){
    var inp=l.querySelector('input');l.classList.toggle('on',inp&&inp.checked);
  });
  var thr=Math.round((typeof s.autoReplyThreshold==='number'?s.autoReplyThreshold:0.72)*100);
  var ti=document.getElementById('autoThreshold');if(ti)ti.value=thr;
  var tv=document.getElementById('thr-val');if(tv)tv.textContent=thr+'%';
  var dm=document.getElementById('answerDMs');if(dm)dm.checked=!!s.answerDMs;
  var ao=document.getElementById('auto-opts');if(ao)ao.style.display=(mode==='approval')?'none':'block';
}
function onReplyModeChange(){
  S.replyTouched=true;
  var sel=document.querySelector('input[name="replyMode"]:checked');
  var mode=sel?sel.value:'approval';
  document.querySelectorAll('.rmode').forEach(function(l){
    var inp=l.querySelector('input');l.classList.toggle('on',inp&&inp.checked);
  });
  var ao=document.getElementById('auto-opts');if(ao)ao.style.display=(mode==='approval')?'none':'block';
}
var grpSt={};
async function loadGroups(){
  var btn=document.getElementById('lg-btn');
  var al=document.getElementById('grp-alert');
  btn.disabled=true;btn.textContent='Loading…';al.innerHTML='';
  try{
    var r=await fetch('/api/groups');
    var d=await r.json();
    if(!d.groups||!d.groups.length){al.innerHTML='<div class="toast toast-err">No groups found. Check WhatsApp connection.</div>';return;}
    S.groups=d.groups;grpSt={};
    d.groups.forEach(function(g){grpSt[g.id]=g.id===S.pJid?'pub':g.id===S.aJid?'adm':'none';});
    renderGrps();
    al.innerHTML='<div class="toast toast-ok">✅ '+d.groups.length+' groups loaded</div>';
  }catch(e){al.innerHTML='<div class="toast toast-err">❌ '+esc(e.message)+'</div>';}
  finally{btn.disabled=false;btn.textContent='🔄 Load Groups from WhatsApp';}
}
function renderGrps(){
  var gg=document.getElementById('grp-grid');
  if(!gg)return;
  gg.innerHTML=S.groups.map(function(g){
    var st=grpSt[g.id]||'none';
    var cls=st==='pub'?'sp':st==='adm'?'sa':'';
    var b=st==='pub'?'<div class="gbadge gbadge-pub">PUBLIC</div>':st==='adm'?'<div class="gbadge gbadge-adm">ADMIN</div>':'';
    return '<div class="gc '+cls+'" onclick="cycleGrp(\\''+g.id+'\\')">'+b+'<div class="gname">'+esc(g.name)+'</div><div class="gjid">'+g.id+'</div></div>';
  }).join('');
}
function cycleGrp(id){
  var cur=grpSt[id]||'none';
  if(cur==='none'){Object.keys(grpSt).forEach(function(k){if(grpSt[k]==='pub')grpSt[k]='none';});grpSt[id]='pub';}
  else if(cur==='pub'){Object.keys(grpSt).forEach(function(k){if(grpSt[k]==='adm')grpSt[k]='none';});grpSt[id]='adm';}
  else{grpSt[id]='none';}
  var pe=Object.entries(grpSt).find(function(e){return e[1]==='pub';});
  var ae=Object.entries(grpSt).find(function(e){return e[1]==='adm';});
  S.pJid=pe?pe[0]:null;S.aJid=ae?ae[0]:null;
  var pv=document.getElementById('pub-val');if(pv)pv.textContent=S.pJid||'Not configured';
  var av=document.getElementById('adm-val');if(av)av.textContent=S.aJid||'Not configured';
  var bp=document.getElementById('box-pub');if(bp)bp.className='sel-box '+(S.pJid?'set':'unset');
  var ba=document.getElementById('box-adm');if(ba)ba.className='sel-box '+(S.aJid?'set':'unset');
  renderGrps();
}
async function saveSettings(){
  var al=document.getElementById('save-alert');
  if(!S.pJid||!S.aJid){al.innerHTML='<div class="toast toast-err">Please select both Public and Admin groups</div>';return;}
  var modeSel=document.querySelector('input[name="replyMode"]:checked');
  var replyMode=modeSel?modeSel.value:'approval';
  var thrEl=document.getElementById('autoThreshold');
  var autoReplyThreshold=(thrEl?parseInt(thrEl.value,10):72)/100;
  var dmEl=document.getElementById('answerDMs');
  var answerDMs=dmEl?dmEl.checked:false;
  try{
    var r=await fetch('/api/settings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({publicGroupJid:S.pJid,adminGroupJid:S.aJid,replyMode:replyMode,autoReplyThreshold:autoReplyThreshold,answerDMs:answerDMs})});
    var d=await r.json();
    if(d.ok){al.innerHTML='<div class="toast toast-ok">✅ Settings saved!</div>';S.replyTouched=false;}
    else throw new Error(d.error);
    setTimeout(loadDebug,500);
  }catch(e){al.innerHTML='<div class="toast toast-err">❌ '+esc(e.message)+'</div>';}
}
var sse=null;
function connectSSE(){
  if(sse)return;
  try{
    sse=new EventSource('/api/events');
    sse.addEventListener('message',function(e){try{appendBub(JSON.parse(e.data));}catch(err){}});
    sse.addEventListener('question',function(e){try{appendBub(JSON.parse(e.data));loadBadge();}catch(err){}});
    sse.addEventListener('bot_message',function(e){try{var m=JSON.parse(e.data);m.fromMe=true;appendBub(m);}catch(err){}});
    sse.onerror=function(){sse=null;setTimeout(connectSSE,5000);};
  }catch(e){}
}
function appendBub(msg){
  var feed=document.getElementById('feed');
  if(!feed)return;
  var isAdm=msg.remoteJid===S.aJid;
  var cls=msg.fromMe?(isAdm?'ai':'out'):(isAdm?'ai':'in');
  var div=document.createElement('div');
  div.className='bub '+cls;
  div.innerHTML='<div class="b-meta"><span class="b-sender '+(isAdm?'adm':'pub')+'">'+esc(msg.pushName||'Bot')+'</span><span class="b-time">'+new Date().toLocaleTimeString()+'</span></div><div class="b-text">'+esc(msg.text||'[media]')+'</div>';
  feed.appendChild(div);
  feed.scrollTop=feed.scrollHeight;
  S.msgCnt++;
  var mc=document.getElementById('msg-cnt');if(mc)mc.textContent=S.msgCnt+' msgs';
}
function clearFeed(){
  var feed=document.getElementById('feed');
  if(feed)feed.innerHTML='<div class="sys-msg">Feed cleared</div>';
  S.msgCnt=0;
  var mc=document.getElementById('msg-cnt');if(mc)mc.textContent='0 msgs';
}
var sndTgt=document.getElementById('snd-tgt');
if(sndTgt)sndTgt.addEventListener('change',function(){
  var cjf=document.getElementById('cjf');
  if(cjf)cjf.style.display=this.value==='cus'?'flex':'none';
});
async function sendMsg(){
  var tgt=document.getElementById('snd-tgt').value;
  var txt=document.getElementById('snd-txt').value.trim();
  var st=document.getElementById('snd-st');
  if(!tgt||!txt){if(st)st.textContent='Select target and enter message';return;}
  var jid=tgt==='pub'?S.pJid:tgt==='adm'?S.aJid:(document.getElementById('cji')||{}).value&&document.getElementById('cji').value.trim();
  if(!jid){if(st)st.textContent='Group not configured';return;}
  var btn=document.getElementById('snd-btn');btn.disabled=true;if(st)st.textContent='Sending…';
  try{
    var r=await fetch('/api/send',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jid:jid,text:txt})});
    var d=await r.json();
    if(d.ok){if(st)st.textContent='✅ Sent!';document.getElementById('snd-txt').value='';}
    else throw new Error(d.error);
  }catch(e){if(st)st.textContent='❌ '+e.message;}
  finally{btn.disabled=false;setTimeout(function(){if(st)st.textContent='';},3000);}
}
async function loadPending(){
  try{
    var r=await fetch('/api/pending');
    var d=await r.json();
    S.pending=d.pending||[];
    renderPend();
  }catch(e){
    var pl=document.getElementById('pend-list');
    if(pl)pl.innerHTML='<div class="pend-empty">❌ '+esc(e.message)+'</div>';
  }
}
async function loadBadge(){
  try{
    var r=await fetch('/api/pending');
    var d=await r.json();
    var c=(d.pending||[]).length;
    var b=document.getElementById('pb');
    if(b){b.style.display=c>0?'inline':'none';if(c>0)b.textContent=c;}
  }catch(e){}
}
function renderPend(){
  var l=document.getElementById('pend-list');if(!l)return;
  if(!S.pending.length){
    l.innerHTML='<div class="pend-empty"><div style="font-size:3rem;margin-bottom:12px">✅</div><div>No pending questions</div></div>';
    return;
  }
  l.innerHTML=S.pending.map(function(p){
    var c=p.confidence||0;
    var cp=Math.round(c*100)+'%';
    var cc=c>=0.8?'var(--green)':c>=0.6?'var(--amber)':'var(--red)';
    var isSel=S.selPend&&S.selPend.questionId===p.questionId?'sel':'';
    return '<div class="pcard '+isSel+'" onclick="selPend(\\''+esc(p.questionId)+'\\')">'+
      '<div class="pcard-q">'+esc(p.questionText||'No text')+'</div>'+
      '<div class="cbar"><div class="cbar-fill" style="width:'+cp+';background:'+cc+'"></div></div>'+
      '<div class="pcard-meta">👤 '+esc(p.senderName||'?')+' • '+new Date(p.timestamp||Date.now()).toLocaleTimeString()+'</div></div>';
  }).join('');
}
function selPend(qId){
  S.selPend=S.pending.find(function(p){return p.questionId===qId;})||null;
  renderPend();
  var df=document.getElementById('det-foot');
  if(!S.selPend){if(df)df.style.display='none';return;}
  var p=S.selPend;
  var c=p.confidence||0;
  var cp=Math.round(c*100)+'%';
  var cc=c>=0.8?'hi':c>=0.6?'md':'lo';
  var db=document.getElementById('det-body');
  if(db)db.innerHTML=
    '<div class="det-sec"><div class="det-lbl">Question</div><div class="det-val" style="font-size:.9rem;font-weight:600">'+esc(p.questionText||'—')+'</div></div>'+
    '<div class="det-sec"><div class="det-lbl">Sender</div><div class="det-val">'+esc(p.senderName||'—')+'</div></div>'+
    '<div class="det-sec"><div class="cbig '+cc+'">'+cp+'</div><div class="det-lbl" style="margin-top:4px">AI Confidence</div></div>'+
    (p.suggestedAudioFileName?'<div class="det-sec"><div class="det-lbl">Linked Audio</div><div class="det-val" style="font-family:monospace;font-size:.78rem">'+esc(p.suggestedAudioFileName)+'</div></div>':'')+
    (p.suggestedTranscript?'<div class="det-sec"><div class="det-lbl">Transcript</div><div class="det-val">'+esc(p.suggestedTranscript)+'</div></div>':'');
  if(df)df.style.display='flex';
  var ast=document.getElementById('act-st');if(ast)ast.textContent='';
}
async function doApprove(){
  if(!S.selPend||!S.aJid)return;
  var ast=document.getElementById('act-st');if(ast)ast.textContent='⏳ Approving…';
  try{
    var r=await fetch('/api/send',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jid:S.aJid,text:'Y'})});
    var d=await r.json();
    if(d.ok){if(ast)ast.innerHTML='<span style="color:var(--green)">✅ Approved & Sent!</span>';setTimeout(function(){S.selPend=null;loadPending();},2500);}
    else throw new Error(d.error);
  }catch(e){if(ast)ast.innerHTML='<span style="color:var(--red)">❌ '+esc(e.message)+'</span>';}
}
async function doReject(){
  if(!S.selPend||!S.aJid)return;
  var ast=document.getElementById('act-st');if(ast)ast.textContent='⏳ Rejecting…';
  try{
    var r=await fetch('/api/send',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jid:S.aJid,text:'N'})});
    var d=await r.json();
    if(d.ok){if(ast)ast.innerHTML='<span style="color:var(--amber)">❌ Rejected</span>';setTimeout(function(){S.selPend=null;loadPending();},2000);}
    else throw new Error(d.error);
  }catch(e){if(ast)ast.innerHTML='<span style="color:var(--red)">❌ '+esc(e.message)+'</span>';}
}
async function kbLoad(){
  var kc=document.getElementById('kb-cnt');if(kc)kc.textContent='Loading…';
  var kb=document.getElementById('kb-body');if(kb)kb.innerHTML='<tr><td colspan="8" style="text-align:center;padding:24px;color:var(--muted)">Loading…</td></tr>';
  try{
    var p=new URLSearchParams({page:KB.page,limit:KB.limit});
    if(KB.topic)p.set('topic',KB.topic);
    if(KB.q)p.set('q',KB.q);
    var cur=!KB.q&&KB.cursors[KB.page-1];if(cur)p.set('cursor',cur);
    var r=await fetch('/api/kb?'+p.toString());
    var d=await r.json();
    if(!d.ok)throw new Error(d.error||'Failed');
    KB.items=d.items||[];KB.total=d.total;KB.next=d.nextCursor||'';
    if(d.nextCursor)KB.cursors[KB.page]=d.nextCursor;
    if(d.topicCounts&&Object.keys(d.topicCounts).length){KB.tc=d.topicCounts;KB.tl=true;renderKbSide(d.topicCounts);}
    else if(!KB.tl)renderKbSide({});
    renderKbTable();
  }catch(e){
    var kb2=document.getElementById('kb-body');if(kb2)kb2.innerHTML='<tr><td colspan="8" style="color:var(--red);padding:16px">'+esc(e.message)+'</td></tr>';
    var kc2=document.getElementById('kb-cnt');if(kc2)kc2.textContent='Error';
  }
}
var TE={TAWAF:'🕋',IHRAM:'🤍',JAMARAT:'🪨',QURBANI:'🐑',SALAH:'🙏',MINA:'⛺',ARAFAT:'🌄',SAEE:'🚶',HALQ:'✂️',UMRAH:'🌙',MADINAH:'🕌',HAIZ:'🩺',WUDU:'💧',GENERAL:'📁'};
function renderKbSide(tc){
  var allCnt=Object.values(tc).reduce(function(a,b){return a+b;},0);
  var kac=document.getElementById('kbc-ALL');if(kac)kac.textContent=allCnt||'—';
  var kl=document.getElementById('kbt-list');
  if(!kl)return;
  kl.innerHTML=Object.entries(tc).sort(function(a,b){return b[1]-a[1];}).map(function(e){
    var t=e[0];var c=e[1];
    return '<button class="kbt'+(KB.topic===t?' active':'')+'" id="kbt-'+t+'" onclick="kbTopic(\\''+t+'\\')">'+
      (TE[t]||'📂')+' '+t+'<span class="kbt-cnt">'+c+'</span></button>';
  }).join('');
}
function renderKbTable(){
  var kc=document.getElementById('kb-cnt');
  if(kc)kc.textContent=KB.total>=0?KB.total+' results':KB.items.length+' on page';
  var pgl=document.getElementById('kb-pglbl');
  if(pgl)pgl.textContent='Page '+KB.page+(KB.total>=0?' of '+Math.max(1,Math.ceil(KB.total/KB.limit)):'');
  var pp=document.getElementById('kb-prev');if(pp)pp.disabled=KB.page<=1;
  var pn=document.getElementById('kb-next');
  if(pn)pn.disabled=!KB.next&&(KB.total<0?KB.items.length<KB.limit:KB.page*KB.limit>=KB.total);
  var tb=document.getElementById('kb-body');
  if(!tb)return;
  var off=(KB.page-1)*KB.limit;
  if(!KB.items.length){tb.innerHTML='<tr><td colspan="8" style="text-align:center;padding:32px;color:var(--muted)">No records found</td></tr>';return;}
  tb.innerHTML=KB.items.map(function(rec,i){
    var c=rec.confidence||0;
    var cls=c>=0.85?'cp-h':c>=0.65?'cp-m':'cp-l';
    var aud=rec.audioFileName?'<span class="achip">🎵 '+esc(rec.audioFileName.slice(0,14))+'</span>':'<span style="color:var(--muted);font-size:.68rem">text</span>';
    var rul=rec.authenticRuling?esc(rec.authenticRuling.slice(0,50))+'…':'<span style="color:var(--muted)">—</span>';
    return '<tr onclick="mOpen(\\''+esc(rec.id)+'\\')">'+
      '<td style="color:var(--muted);font-size:.7rem">'+(off+i+1)+'</td>'+
      '<td title="'+esc(rec.question||'')+'">'+esc((rec.question||'').slice(0,65))+'</td>'+
      '<td><span style="font-size:.7rem;font-weight:700;color:var(--teal)">'+esc(rec.topic||'?')+'</span></td>'+
      '<td style="font-size:.7rem;color:var(--muted)">'+esc(rec.questionLang||'?')+'</td>'+
      '<td><span class="cpill '+cls+'">'+Math.round(c*100)+'%</span></td>'+
      '<td title="'+esc(rec.authenticRuling||'')+'">'+rul+'</td>'+
      '<td>'+aud+'</td>'+
      '<td><button class="btn btn-ghost btn-xs" onclick="event.stopPropagation();mOpen(\\''+esc(rec.id)+'\\')">✏️</button></td></tr>';
  }).join('');
}
function kbTopic(t){
  KB.topic=t;KB.page=1;KB.cursors=[''];KB.next='';
  document.querySelectorAll('.kbt').forEach(function(b){b.classList.remove('active');});
  var b=document.getElementById(t?'kbt-'+t:'kbt-ALL');if(b)b.classList.add('active');
  kbLoad();
}
function kbPage(dir){
  if(dir>0&&KB.next)KB.cursors[KB.page]=KB.next;
  KB.page=Math.max(1,KB.page+dir);
  kbLoad();
}
function kbSearch(){
  clearTimeout(KB.timer);
  KB.timer=setTimeout(function(){
    var el=document.getElementById('kb-srch');
    KB.q=el?el.value.trim():'';
    KB.page=1;KB.cursors=[''];KB.next='';
    kbLoad();
  },400);
}
function openAdd(){
  kbMode='add';
  var mt=document.getElementById('m-title');if(mt)mt.textContent='➕ Add New KB Record';
  var mid=document.getElementById('m-id');if(mid)mid.value='';
  var midd=document.getElementById('m-id-d');if(midd)midd.value='(auto-generated)';
  ['m-q','m-ruling','m-kp','m-ans','m-tr','m-audio','m-en','m-kw'].forEach(function(id){
    var e=document.getElementById(id);if(e)e.value='';
  });
  renderRefs(null);
  var af=document.getElementById('m-audio-file');if(af)af.value='';
  var aus=document.getElementById('m-audio-upload-st');if(aus)aus.textContent='';
  var mc=document.getElementById('m-conf');if(mc)mc.value='0.80';
  var ml=document.getElementById('m-label');if(ml)ml.value='Dashboard Added';
  var mtp=document.getElementById('m-topic');if(mtp)mtp.value='GENERAL';
  var mlg=document.getElementById('m-lang');if(mlg)mlg.value='English';
  var md=document.getElementById('m-del');if(md)md.style.display='none';
  var me=document.getElementById('m-emb');if(me)me.style.display='none';
  var ms=document.getElementById('m-save');if(ms)ms.textContent='🤖 Add & Embed';
  var mst=document.getElementById('m-st');if(mst)mst.textContent='';
  var ep=document.getElementById('eprog');if(ep)ep.style.display='none';
  var modal=document.getElementById('kb-modal');if(modal)modal.style.display='flex';
}
async function mOpen(id){
  kbMode='edit';
  var mst=document.getElementById('m-st');if(mst)mst.textContent='Loading…';
  var modal=document.getElementById('kb-modal');if(modal)modal.style.display='flex';
  var mt=document.getElementById('m-title');if(mt)mt.textContent='✏️ Edit: '+id;
  var ep=document.getElementById('eprog');if(ep)ep.style.display='none';
  try{
    var r=await fetch('/api/kb/'+id);
    var d=await r.json();
    if(!d.ok)throw new Error(d.error||'Not found');
    var rec=d.record;
    document.getElementById('m-id').value=rec.id||id;
    document.getElementById('m-id-d').value=rec.id||id;
    document.getElementById('m-q').value=rec.question||'';
    document.getElementById('m-ruling').value=rec.authenticRuling||'';
    document.getElementById('m-kp').value=rec.rulingKeyPoints||'';
    document.getElementById('m-ans').value=rec.answerText||'';
    document.getElementById('m-tr').value=rec.answerTranscript||'';
    document.getElementById('m-audio').value=rec.audioFileName||'';
    document.getElementById('m-en').value=rec.englishTranslation||'';
    document.getElementById('m-conf').value=rec.confidence!=null?rec.confidence:'';
    document.getElementById('m-label').value=rec.accuracyLabel||'';
    document.getElementById('m-kw').value=(rec.keywords||[]).join(', ');
    var sel=document.getElementById('m-topic');
    var tv=(rec.topic||'GENERAL').toUpperCase();
    for(var i=0;i<sel.options.length;i++){if(sel.options[i].text===tv){sel.selectedIndex=i;break;}}
    var ls=document.getElementById('m-lang');
    var lv=rec.questionLang||'English';
    for(var j=0;j<ls.options.length;j++){if(ls.options[j].text===lv){ls.selectedIndex=j;break;}}
    var md=document.getElementById('m-del');if(md)md.style.display='';
    var me=document.getElementById('m-emb');if(me)me.style.display='';
    var ms=document.getElementById('m-save');if(ms)ms.textContent='💾 Save Changes';
    renderRefs(rec.authenticReferences);
    var af=document.getElementById('m-audio-file');if(af)af.value='';
    var aus=document.getElementById('m-audio-upload-st');if(aus)aus.textContent='';
    if(mst)mst.textContent='';
  }catch(e){if(mst)mst.textContent='❌ '+e.message;}
}
function renderRefs(refs){
  var box=document.getElementById('m-refs');if(!box)return;
  if(!refs||!refs.length){box.innerHTML='<span style="color:var(--muted)">No verified references yet for this topic.</span>';return;}
  box.innerHTML=refs.map(function(r){
    var icon=r.type==='quran'?'📗':'📘';
    var grading=r.grading?' <span style="color:var(--muted)">('+esc(r.grading)+')</span>':'';
    return '<div style="border:1px solid var(--border2);border-radius:8px;padding:8px 10px;margin-bottom:6px">'+
      '<div style="font-weight:700">'+icon+' '+esc(r.citation)+grading+'</div>'+
      '<div dir="rtl" style="margin:4px 0;font-family:inherit">'+esc(r.arabic||'')+'</div>'+
      '<div>EN: '+esc(r.english||'')+'</div>'+
      '<div>اردو: '+esc(r.urdu||'')+'</div>'+
      '<div>Roman Urdu: '+esc(r.romanUrdu||'')+'</div>'+
      (r.sourceUrl?'<div style="font-size:.7rem;margin-top:3px"><a href="'+esc(r.sourceUrl)+'" target="_blank" rel="noopener" style="color:var(--teal)">source ↗</a></div>':'')+
      '</div>';
  }).join('');
}
async function mUploadAudio(){
  var st=document.getElementById('m-audio-upload-st');
  var id=document.getElementById('m-id').value;
  if(!id){if(st)st.innerHTML='<span style="color:var(--red)">❌ Save the record first, then upload audio</span>';return;}
  var fi=document.getElementById('m-audio-file');
  var file=fi&&fi.files&&fi.files[0];
  if(!file){if(st)st.innerHTML='<span style="color:var(--red)">❌ Choose an audio file first</span>';return;}
  if(st)st.innerHTML='<span style="color:var(--teal)">⏳ Uploading…</span>';
  try{
    var b64=await new Promise(function(resolve,reject){
      var r=new FileReader();
      r.onload=function(){resolve(r.result.split(',')[1]);};
      r.onerror=reject;
      r.readAsDataURL(file);
    });
    var res=await fetch('/api/kb/'+id+'/upload-audio',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({filename:file.name,dataBase64:b64})});
    var d=await res.json();
    if(!d.ok)throw new Error(d.error||'Upload failed');
    document.getElementById('m-audio').value=d.audioFileName;
    if(st)st.innerHTML='<span style="color:var(--green)">✅ Uploaded: '+esc(d.audioFileName)+'</span>';
  }catch(e){if(st)st.innerHTML='<span style="color:var(--red)">❌ '+esc(e.message)+'</span>';}
}
async function mSave(){
  var id=document.getElementById('m-id').value;
  var st=document.getElementById('m-st');
  if(kbMode==='add'){
    var body={
      question:document.getElementById('m-q').value,
      topic:document.getElementById('m-topic').value,
      questionLang:document.getElementById('m-lang').value,
      answerText:document.getElementById('m-ans').value,
      answerTranscript:document.getElementById('m-tr').value,
      authenticRuling:document.getElementById('m-ruling').value,
      rulingKeyPoints:document.getElementById('m-kp').value,
      audioFileName:document.getElementById('m-audio').value,
      confidence:document.getElementById('m-conf').value,
      accuracyLabel:document.getElementById('m-label').value
    };
    if(!body.question.trim()){if(st)st.innerHTML='<span style="color:var(--red)">❌ Question is required</span>';return;}
    var prog=document.getElementById('eprog');
    var bar=document.getElementById('epb');
    var epl=document.getElementById('epl');
    if(prog)prog.style.display='flex';
    if(bar)bar.style.width='15%';
    if(epl)epl.textContent='🤖 Generating multilingual augmentation & 768-dim embedding…';
    var savebtn=document.getElementById('m-save');if(savebtn)savebtn.disabled=true;
    if(st)st.innerHTML='<span style="color:var(--teal)">⏳ Processing with Gemini AI…</span>';
    var iv=setInterval(function(){if(bar){var c=parseFloat(bar.style.width)||15;if(c<85)bar.style.width=(c+4)+'%';}},400);
    try{
      var r=await fetch('/api/kb',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
      clearInterval(iv);if(bar)bar.style.width='100%';
      var d=await r.json();
      if(!d.ok)throw new Error(d.error||'Failed');
      if(epl)epl.textContent='✅ Embedded! 768-dim vector generated. ID: '+d.id;
      if(st)st.innerHTML='<span style="color:var(--green)">✅ Added & embedded! '+esc(d.id)+'</span>';
      setTimeout(function(){mcl();kbLoad();loadAnalytics();},1500);
    }catch(e){
      clearInterval(iv);if(bar)bar.style.width='0%';
      if(epl)epl.textContent='❌ Failed: '+e.message;
      if(st)st.innerHTML='<span style="color:var(--red)">❌ '+esc(e.message)+'</span>';
    }finally{if(savebtn)savebtn.disabled=false;}
    return;
  }
  if(st)st.innerHTML='<span style="color:var(--muted)">⏳ Saving…</span>';
  var sb=document.getElementById('m-save');if(sb)sb.disabled=true;
  try{
    var body2={
      question:document.getElementById('m-q').value,
      topic:document.getElementById('m-topic').value,
      answerText:document.getElementById('m-ans').value,
      answerTranscript:document.getElementById('m-tr').value,
      authenticRuling:document.getElementById('m-ruling').value,
      rulingKeyPoints:document.getElementById('m-kp').value,
      confidence:parseFloat(document.getElementById('m-conf').value)||0,
      accuracyLabel:document.getElementById('m-label').value
    };
    var r2=await fetch('/api/kb/'+id,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(body2)});
    var d2=await r2.json();
    if(!d2.ok)throw new Error(d2.error||'Failed');
    if(st)st.innerHTML='<span style="color:var(--green)">✅ Saved!</span>';
    setTimeout(function(){mcl();kbLoad();},800);
  }catch(e){if(st)st.innerHTML='<span style="color:var(--red)">❌ '+esc(e.message)+'</span>';}
  finally{if(sb)sb.disabled=false;}
}
async function mEmbed(){
  var id=document.getElementById('m-id').value;
  var st=document.getElementById('m-st');
  if(!confirm('Re-embed record "'+id+'" using latest Gemini model?'))return;
  var prog=document.getElementById('eprog');var bar=document.getElementById('epb');var epl=document.getElementById('epl');
  if(prog)prog.style.display='flex';if(bar)bar.style.width='25%';
  if(epl)epl.textContent='🤖 Re-generating 768-dim embedding via Gemini…';
  if(st)st.innerHTML='<span style="color:var(--teal)">⏳ Re-embedding…</span>';
  var eb=document.getElementById('m-emb');if(eb)eb.disabled=true;
  var iv=setInterval(function(){if(bar){var c=parseFloat(bar.style.width)||25;if(c<85)bar.style.width=(c+7)+'%';}},300);
  try{
    var r=await fetch('/api/kb/'+id+'/embed',{method:'POST'});
    clearInterval(iv);if(bar)bar.style.width='100%';
    var d=await r.json();
    if(!d.ok)throw new Error(d.error||'Failed');
    if(epl)epl.textContent='✅ Re-embedded! '+d.dims+' dimensions';
    if(st)st.innerHTML='<span style="color:var(--green)">✅ Re-embedded ('+d.dims+' dims)</span>';
  }catch(e){
    clearInterval(iv);if(bar)bar.style.width='0%';
    if(epl)epl.textContent='❌ Failed';
    if(st)st.innerHTML='<span style="color:var(--red)">❌ '+esc(e.message)+'</span>';
  }finally{if(eb)eb.disabled=false;}
}
async function mDel(){
  var id=document.getElementById('m-id').value;
  var st=document.getElementById('m-st');
  if(!confirm('Delete record "'+id+'"? This cannot be undone.'))return;
  if(st)st.innerHTML='<span style="color:var(--amber)">⏳ Deleting…</span>';
  try{
    var r=await fetch('/api/kb/'+id,{method:'DELETE'});
    var d=await r.json();
    if(!d.ok)throw new Error(d.error||'Failed');
    mcl();kbLoad();loadAnalytics();
  }catch(e){if(st)st.innerHTML='<span style="color:var(--red)">❌ '+esc(e.message)+'</span>';}
}
function mcl(){var modal=document.getElementById('kb-modal');if(modal)modal.style.display='none';}
/* Init */
loadDebug();loadBadge();connectSSE();loadAnalytics();
setInterval(function(){loadDebug();loadBadge();},30000);
<\/script>`;
