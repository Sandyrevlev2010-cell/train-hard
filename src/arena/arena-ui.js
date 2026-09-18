/* =============================================================
 * Train Hard — ARENA v4
 *
 * Changes:
 *  • Premium badge is visible next to premium members.
 *  • Group screen shows all members directly under the group name.
 *  • Owner-only member management at the very bottom.
 *  • Owner can remove members, but never the owner himself.
 *  • Owner can still delete the whole group.
 *  • Home bottom button becomes «Группа» while the user is in a group.
 *  • Premium state is synchronized to Arena without touching strength timestamps.
 *  • Existing Telegram invite/startapp flow and one-group invariant remain intact.
 * ============================================================= */
(function () {
  'use strict';

  var API = window.__THAPI;
  var cfg = window.TRAINHARD_ARENA || {};
  if (!API) return;

  var CSS = [
    '.thar-root{position:fixed;inset:0;z-index:70;display:flex;align-items:flex-end;justify-content:center;background:rgba(0,0,0,.76);backdrop-filter:blur(10px);font-family:inherit}',
    '.thar-panel{position:relative;width:100%;max-width:480px;max-height:94vh;overflow:auto;background:#080809;color:#fff;box-shadow:0 -18px 70px rgba(0,0,0,.8);padding:0 0 28px;overflow-x:hidden}',
    '.thar-panel:before{content:"";position:absolute;left:0;right:0;top:0;height:170px;pointer-events:none;background:radial-gradient(circle at 12% 0,rgba(239,35,60,.42),transparent 48%),radial-gradient(circle at 88% 0,rgba(255,122,0,.28),transparent 44%);opacity:.95}',
    '.thar-head{position:sticky;top:0;display:flex;align-items:center;gap:10px;padding:17px 18px;background:rgba(8,8,9,.9);border-bottom:1px solid rgba(255,255,255,.08);z-index:4;backdrop-filter:blur(14px)}',
    '.thar-title{font-size:15px;font-weight:950;letter-spacing:.16em;text-transform:uppercase;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.thar-x{background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);color:#d4d4d8;font-size:17px;cursor:pointer;padding:6px 9px;line-height:1;border-radius:12px!important}',
    '.thar-body{position:relative;z-index:1;padding:18px}',
    '.thar-hero{position:relative;overflow:hidden;background:linear-gradient(135deg,#2a080d 0%,#100b0c 52%,#17100a 100%);border:1px solid rgba(255,73,61,.25);padding:20px;margin-bottom:14px;box-shadow:inset 0 1px 0 rgba(255,255,255,.06),0 14px 40px rgba(0,0,0,.25)}',
    '.thar-hero:after{content:"";position:absolute;width:150px;height:150px;right:-45px;top:-55px;border-radius:50%;background:rgba(255,92,0,.18);filter:blur(3px)}',
    '.thar-kicker{position:relative;z-index:1;font-size:9px;font-weight:950;letter-spacing:.25em;text-transform:uppercase;color:#ff6b4a}',
    '.thar-hero-title{position:relative;z-index:1;font-size:30px;line-height:.95;font-weight:950;font-style:italic;margin-top:7px;font-family:"Playfair Display",Georgia,serif}',
    '.thar-hero-copy{position:relative;z-index:1;color:#a1a1aa;font-size:12px;line-height:1.55;margin-top:10px;max-width:340px}',
    '.thar-card{background:linear-gradient(180deg,#131315,#0f0f11);border:1px solid rgba(255,255,255,.08);padding:16px;margin-bottom:12px;box-shadow:0 10px 30px rgba(0,0,0,.2)}',
    '.thar-action{position:relative;display:flex;align-items:center;gap:14px;width:100%;box-sizing:border-box;text-align:left;padding:17px;margin-bottom:10px;background:#111113;color:#fff;border:1px solid rgba(255,255,255,.09);cursor:pointer;transition:transform .15s,border-color .15s,background .15s;overflow:hidden}',
    '.thar-action:hover{border-color:rgba(255,73,61,.5);background:#171315}',
    '.thar-action:active{transform:scale(.985)}',
    '.thar-action:last-child{margin-bottom:0}',
    '.thar-action.primary{background:linear-gradient(135deg,#e51f38,#9e1025);border-color:rgba(255,110,100,.5);box-shadow:0 12px 28px rgba(207,25,48,.24)}',
    '.thar-action-icon{width:44px;height:44px;display:flex;align-items:center;justify-content:center;flex:0 0 44px;background:rgba(255,255,255,.08);font-size:21px;border:1px solid rgba(255,255,255,.1)}',
    '.thar-action.primary .thar-action-icon{background:rgba(0,0,0,.16)}',
    '.thar-action-title{font-size:14px;font-weight:950;letter-spacing:.04em}',
    '.thar-action-copy{font-size:10px;color:#9ca3af;margin-top:3px;line-height:1.35}',
    '.thar-action.primary .thar-action-copy{color:#ffd7d4}',
    '.thar-arrow{margin-left:auto;color:#ff6b4a;font-size:22px}',
    '.thar-sub{font-size:9px;font-weight:950;letter-spacing:.17em;text-transform:uppercase;color:#71717a;margin-bottom:10px}',
    '.thar-note{font-size:11px;color:#71717a;line-height:1.45;margin-top:7px}',
    '.thar-empty{font-size:12px;color:#71717a;line-height:1.5}',
    '.thar-input{width:100%;box-sizing:border-box;background:#0a0a0c;color:#fff;border:1px solid rgba(255,255,255,.14);padding:13px 12px;font-size:13px;font-family:inherit;margin-bottom:9px;outline:none}',
    '.thar-input:focus{border-color:#ef233c;box-shadow:0 0 0 3px rgba(239,35,60,.12)}',
    '.thar-btn{display:inline-flex;align-items:center;justify-content:center;gap:7px;background:#fff;color:#09090b;border:0;padding:12px 16px;font-size:12px;font-weight:950;cursor:pointer;font-family:inherit;transition:opacity .15s,transform .15s}',
    '.thar-btn:active{transform:scale(.985)}',
    '.thar-btn:disabled{opacity:.45;cursor:default}',
    '.thar-btn.wide{width:100%}',
    '.thar-btn.red{background:linear-gradient(135deg,#ef233c,#bd1027);color:#fff;box-shadow:0 10px 25px rgba(239,35,60,.22)}',
    '.thar-btn.ghost{background:transparent;color:#fff;border:1px solid rgba(255,255,255,.13)}',
    '.thar-btn.danger{background:transparent;color:#f87171;border:1px solid rgba(248,113,113,.35)}',
    '.thar-stat-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}',
    '.thar-stat{background:#0b0b0d;border:1px solid rgba(255,255,255,.08);padding:11px 8px;text-align:center}',
    '.thar-stat-label{font-size:8px;font-weight:950;text-transform:uppercase;letter-spacing:.08em;color:#71717a;margin-bottom:6px}',
    '.thar-stat-value{font-size:19px;font-weight:950}',
    '.thar-stat-unit{font-size:8px;color:#71717a;margin-top:2px}',
    '.thar-stat input{width:100%;box-sizing:border-box;background:transparent;border:0;border-bottom:1px solid rgba(255,255,255,.18);color:#fff;text-align:center;font-size:20px;font-weight:950;padding:3px 0;outline:none}',
    '.thar-stat input:focus{border-bottom-color:#ef233c}',
    '.thar-tabs{display:flex;gap:6px;margin-bottom:12px;overflow:auto;padding-bottom:2px}',
    '.thar-tab{white-space:nowrap;background:#121214;border:1px solid rgba(255,255,255,.08);color:#9ca3af;padding:8px 11px;font-size:10px;font-weight:900;cursor:pointer}',
    '.thar-tab.on{background:#ef233c;color:#fff;border-color:#ef233c;box-shadow:0 6px 18px rgba(239,35,60,.2)}',
    '.thar-row{display:flex;align-items:center;gap:10px;padding:12px 0;border-bottom:1px solid rgba(255,255,255,.055)}',
    '.thar-row:last-child{border-bottom:0}',
    '.thar-place{width:28px;text-align:center;font-size:15px;font-weight:950;flex-shrink:0}',
    '.thar-name{flex:1;min-width:0;font-size:12px;font-weight:800;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.thar-val{font-size:12px;font-weight:950;color:#f4f4f5;flex-shrink:0}',
    '.thar-row.me .thar-name{color:#ff6b4a}',
    '.thar-role{font-size:8px;font-weight:900;color:#a1a1aa;background:#1b1b1f;padding:4px 7px;flex-shrink:0}',
    '.thar-premium{display:inline-flex;align-items:center;vertical-align:middle;margin-left:6px;padding:3px 6px;border-radius:999px;background:rgba(245,158,11,.13);border:1px solid rgba(245,158,11,.34);color:#fbbf24;font-size:7px;font-weight:950;letter-spacing:.08em;text-transform:uppercase;white-space:nowrap}',
    '.thar-member-list{margin-top:2px}',
    '.thar-member{display:flex;align-items:center;gap:9px;padding:10px 0;border-bottom:1px solid rgba(255,255,255,.055)}',
    '.thar-member:last-child{border-bottom:0}',
    '.thar-member-avatar{width:34px;height:34px;border-radius:50%;background:#1b1b1f;border:1px solid rgba(255,255,255,.09);display:flex;align-items:center;justify-content:center;overflow:hidden;flex:0 0 34px;color:#a1a1aa;font-size:12px;font-weight:900}',
    '.thar-member-avatar img{width:100%;height:100%;object-fit:cover}',
    '.thar-member-main{flex:1;min-width:0}',
    '.thar-member-name{font-size:12px;font-weight:850;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.thar-member-meta{font-size:8px;color:#71717a;margin-top:2px}',
    '.thar-member-delete{flex:0 0 auto;padding:7px 9px;font-size:9px}',
    '.thar-bottom-actions{margin-top:22px;padding-top:16px;border-top:1px solid rgba(255,255,255,.08)}',
    '.thar-podium{display:flex;align-items:flex-end;justify-content:center;gap:7px;margin:3px 0 15px}',
    '.thar-pod{flex:1;max-width:125px;background:linear-gradient(180deg,#17171a,#0e0e10);border:1px solid rgba(255,255,255,.08);padding:12px 6px;text-align:center}',
    '.thar-pod.first{border-color:rgba(255,167,38,.5);box-shadow:0 12px 30px rgba(255,122,0,.1)}',
    '.thar-pod .m{font-size:23px;line-height:1}',
    '.thar-pod .v{font-size:15px;font-weight:950;margin-top:7px}',
    '.thar-pod .n{font-size:9px;color:#a1a1aa;margin-top:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.thar-link{display:block;padding:13px;background:#09090b;border:1px dashed rgba(255,255,255,.18);color:#ff7056;font-size:11px;line-height:1.4;word-break:break-all;cursor:pointer}',
    '.thar-link-box{background:linear-gradient(135deg,rgba(239,35,60,.08),rgba(255,122,0,.06));border:1px solid rgba(239,35,60,.2);padding:14px}',
    '.thar-err{background:#261014;border:1px solid rgba(248,113,113,.3);padding:12px 14px;font-size:12px;color:#fca5a5;margin-bottom:12px}',
    '.thar-skel{height:54px;background:linear-gradient(90deg,#111113 25%,#1c1c20 50%,#111113 75%);background-size:200% 100%;animation:thar-pulse 1.1s infinite;margin-bottom:8px}',
    '@keyframes thar-pulse{0%{background-position:200% 0}100%{background-position:-200% 0}}'
  ].join('');

  var METRICS = [
    { key: 'total', label: 'Троеборье', api: 'TOTAL' },
    { key: 'squat', label: 'Присед', api: 'SQUAT' },
    { key: 'bench', label: 'Жим', api: 'BENCH' },
    { key: 'deadlift', label: 'Становая', api: 'DEADLIFT' }
  ];
  var MEDALS = { 1: '🥇', 2: '🥈', 3: '🥉' };
  var ROLE_LABEL = { OWNER: '👑 владелец', ADMIN: 'админ', MEMBER: 'участник' };
  var st = { view: 'home', group: null, role: 'MEMBER', members: [], stats: { squat: null, bench: null, deadlift: null }, boards: {}, metric: METRICS[0], busy: {}, inviteCode: null, premium: false };
  var root = null, panel = null, open = false;

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;' }[c]; }); }
  function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = String(text); return n; }
  function nameOf(u) { return u && u.username ? '@' + u.username : (u && (u.first_name || u.last_name)) ? [u.first_name,u.last_name].filter(Boolean).join(' ') : 'Спортсмен'; }
  function initials(u) { var n = nameOf(u).replace(/^@/,'').trim(); return n ? n.slice(0,2).toUpperCase() : 'TH'; }
  function buzz(p) { try { if (navigator.vibrate) navigator.vibrate(p); } catch (e) {} }
  function sound(n) { try { if (window.TrainHardEffects) window.TrainHardEffects.play(n); } catch (e) {} }
  function isPremiumLocal() { try { return !!(window.__THPrem && typeof window.__THPrem.isPremium === 'function' && window.__THPrem.isPremium()); } catch (e) { return false; } }
  function syncHomeButton(hasGroup) { try { var btn=document.querySelector('[aria-label="Arena"]'); if(!btn)return; var spans=btn.querySelectorAll('span'); if(spans.length) spans[spans.length-1].textContent=hasGroup?'Группа':'Arena'; btn.setAttribute('data-th-arena-group',hasGroup?'1':'0'); } catch(e){} }
  function ensureDom() { if (document.getElementById('thar-css')) return; var style = document.createElement('style'); style.id = 'thar-css'; style.textContent = CSS; document.head.appendChild(style); }
  function body() { return document.getElementById('thar-body'); }
  function alive() { try { return !!document.body; } catch (e) { return false; } }
  function clear() { var b = body(); if (!b) return; while (b.firstChild) b.removeChild(b.firstChild); }
  function setTitle(t) { var n = document.getElementById('thar-title'); if (n) n.textContent = t; }
  function skeletons(n) { var f = document.createDocumentFragment(); for (var i=0;i<(n||3);i++) f.appendChild(el('div','thar-skel')); return f; }
  function busy(key,on) { st.busy[key]=on; try { document.querySelectorAll('.thar-btn[data-busy="'+key+'"],.thar-action[data-busy="'+key+'"],.thar-member-delete[data-busy="'+key+'"],.thar-member-delete[data-busy^="'+key+':"]').forEach(function(x){x.disabled=on;}); } catch(e){} }
  function errorBox(msg,retry) { var b=el('div','thar-err',msg); if(retry){var x=el('button','thar-btn ghost','Повторить'); x.style.marginTop='8px'; x.addEventListener('click',retry); b.appendChild(document.createElement('br')); b.appendChild(x);} return b; }
  function networkFail(r,retry) {
    var msg = r && r.status === 409 ? 'Ты уже состоишь в другой группе.' : r && r.status === 403 ? 'Недостаточно прав для этого действия.' : r && r.reason === 'telegram-required' ? 'Открой Train Hard внутри Telegram.' : r && (r.reason === 'network' || r.status === 0) ? 'Нет соединения с сервером. Проверь интернет и попробуй снова.' : 'Сервер недоступен (' + ((r&&r.status)||'нет ответа') + '). Попробуй позже.';
    return errorBox(msg,retry);
  }

  function parseInviteLink(value) { var raw = String(value || '').trim(); if (!raw) return null; try { var u = new URL(raw); var p = u.searchParams.get('startapp'); if (p && /^[A-Za-z0-9_-]{8,64}$/.test(p)) return p; } catch (e) {} var m = raw.match(/[?&]startapp=([A-Za-z0-9_-]{8,64})/i); return m ? m[1] : null; }
  function inviteLink(code) { return String(cfg.botAppLink || 'https://t.me/trainhard_power_bot/trainhard?startapp=') + encodeURIComponent(code); }
  function rememberInvite(code) { try { localStorage.setItem('trainhard_arena_invite_' + code, '1'); } catch(e){} }
  function wasInviteProcessed(code) { try { return localStorage.getItem('trainhard_arena_invite_' + code) === '1'; } catch(e){ return false; } }

  function openModal() {
    if (open) return; open = true; ensureDom(); root = el('div','thar-root'); root.id='thar-root'; panel = el('div','thar-panel');
    var head=el('div','thar-head'); var title=el('div','thar-title','ARENA'); title.id='thar-title'; var x=el('button','thar-x','✕'); x.addEventListener('click',closeModal);
    head.appendChild(title); head.appendChild(x); panel.appendChild(head); var b=el('div','thar-body'); b.id='thar-body'; panel.appendChild(b); root.appendChild(panel); root.addEventListener('click',function(e){if(e.target===root)closeModal();});
    document.body.appendChild(root); document.body.classList.add('thch-open'); goHome();
  }
  function closeModal(){ open=false; if(root&&root.parentNode)root.parentNode.removeChild(root); root=null; panel=null; document.body.classList.remove('thch-open'); }
  function renderHero(subtitle) { var h=el('section','thar-hero'); h.appendChild(el('div','thar-kicker','TRAIN HARD · COMPETITION')); h.appendChild(el('div','thar-hero-title','ARENA')); h.appendChild(el('div','thar-hero-copy',subtitle || 'Группы, силовые результаты и общий рейтинг. Твои результаты в Arena не зависят от тренировочного журнала.')); return h; }
  function actionButton(icon,title,copy,primary,fn) { var b=el('button','thar-action'+(primary?' primary':'')); b.type='button'; b.appendChild(el('div','thar-action-icon',icon)); var c=el('div'); c.appendChild(el('div','thar-action-title',title)); c.appendChild(el('div','thar-action-copy',copy)); b.appendChild(c); b.appendChild(el('div','thar-arrow','›')); b.addEventListener('click',function(){buzz(10);sound('tap');fn();}); return b; }

  async function goHome(autoCode) {
    st.view='home'; st.group=null; st.members=[]; st.role='MEMBER'; syncHomeButton(false); setTitle('ARENA'); var b=body(); clear(); b.appendChild(skeletons(2));
    var r=await API.request('GET','/api/groups'); if(!alive())return; if(!r.ok){clear();b.appendChild(networkFail(r,function(){goHome(autoCode);}));return;}
    var groups=(r.body&&r.body.groups)||[]; if(groups.length){syncHomeButton(true); openGroup(groups[0].group ? groups[0].group.id : groups[0].id,false);return;}
    clear(); b.appendChild(renderHero('Создавай свою силовую тусовку или заходи к друзьям по приглашению. Здесь будет твой общий рейтинг.'));
    var actions=el('div','thar-card'); actions.appendChild(actionButton('↗','Вступить в группу','Открой приглашение или вставь ссылку от друга.',true,showJoin)); actions.appendChild(actionButton('＋','Создать группу','Создай свою группу и пригласи участников ссылкой.',false,showCreate)); b.appendChild(actions); if(autoCode) autoJoin(autoCode);
  }

  function showJoin(){var b=body();clear();setTitle('ВСТУПИТЬ');b.appendChild(renderHero('Вставь ссылку-приглашение Train Hard. Код из ссылки скрыт — после открытия ссылка сама подключит тебя к группе.'));var card=el('div','thar-card');var input=el('input','thar-input');input.placeholder='https://t.me/trainhard_power_bot/trainhard?startapp=…';input.autocomplete='off';var btn=el('button','thar-btn red wide','Вступить в группу');btn.dataset.busy='join';btn.addEventListener('click',function(){var code=parseInviteLink(input.value);if(!code){input.style.borderColor='#ef233c';return;}joinByCode(code,false);});card.appendChild(el('div','thar-sub','Ссылка-приглашение'));card.appendChild(input);card.appendChild(btn);var back=el('button','thar-btn ghost wide','← Назад');back.style.marginTop='9px';back.addEventListener('click',goHome);card.appendChild(back);b.appendChild(card);}
  async function showCreate(){var b=body();clear();setTitle('СОЗДАТЬ ГРУППУ');b.appendChild(renderHero('После создания сразу введи свои присед, жим и становую — они станут основой рейтинга.'));var card=el('div','thar-card');card.appendChild(el('div','thar-sub','Название группы'));var input=el('input','thar-input');input.placeholder='Например: POWERLIFTING FRIENDS';input.maxLength=80;input.autocomplete='off';var btn=el('button','thar-btn red wide','Создать группу');btn.dataset.busy='create';btn.addEventListener('click',async function(){var name=input.value.trim();if(name.length<3){input.style.borderColor='#ef233c';return;}busy('create',true);var r=await API.request('POST','/api/groups',{name:name});busy('create',false);if(r.ok&&r.body&&r.body.group){syncHomeButton(true);buzz([12,40,12]);openGroup(r.body.group.id,true);return;}clear();body().appendChild(networkFail(r,showCreate));});card.appendChild(input);card.appendChild(btn);var back=el('button','thar-btn ghost wide','← Назад');back.style.marginTop='9px';back.addEventListener('click',goHome);card.appendChild(back);b.appendChild(card);}
  async function autoJoin(code){if(!code||wasInviteProcessed(code))return;await joinByCode(code,true);}
  async function joinByCode(code,fromDeepLink){busy('join',true);var r=await API.request('POST','/api/invites/'+encodeURIComponent(code)+'/join',{});busy('join',false);if(!alive())return;if(r.ok&&r.body&&r.body.group){rememberInvite(code);syncHomeButton(true);buzz([15,40,15]);openGroup(r.body.group.id,true);return;}if(fromDeepLink&&r.status===409){goHome();return;}var b=body();clear();b.appendChild(networkFail(r,goHome));}

  function renderStatsCard(edit,onboarding){var card=el('div','thar-card');card.appendChild(el('div','thar-sub',onboarding?'Твои силовые':'Мои результаты'));if(onboarding)card.appendChild(el('div','thar-note','Введи последние рабочие максимумы. Их можно изменить позже.'));var grid=el('div','thar-stat-grid');[['squat','Присед'],['bench','Жим'],['deadlift','Становая']].forEach(function(x){var wrap=el('div','thar-stat');wrap.appendChild(el('div','thar-stat-label',x[1]));if(edit){var inp=document.createElement('input');inp.type='number';inp.min='0';inp.max='1000';inp.step='0.5';inp.inputMode='decimal';inp.value=st.stats[x[0]]==null?'':st.stats[x[0]];inp.dataset.stat=x[0];wrap.appendChild(inp);}else{wrap.appendChild(el('div','thar-stat-value',st.stats[x[0]]==null?'—':st.stats[x[0]]));wrap.appendChild(el('div','thar-stat-unit','КГ'));}grid.appendChild(wrap);});card.appendChild(grid);return card;}
  function renderStatsEditor(){var b=body();clear();setTitle(st.group.name);b.appendChild(renderHero('Группа создана. Теперь добавь свои силовые, чтобы попасть в рейтинг.'));var card=renderStatsCard(true,true);var save=el('button','thar-btn red wide','Сохранить силовые');save.dataset.busy='stats';save.addEventListener('click',async function(){var inputs=card.querySelectorAll('input[data-stat]');var bodyStats={};for(var i=0;i<inputs.length;i++){var key=inputs[i].dataset.stat;var raw=String(inputs[i].value||'').trim();if(!raw){bodyStats[key]=null;continue;}var n=Number(raw);if(!Number.isFinite(n)||n<0||n>1000){inputs[i].style.borderColor='#ef233c';inputs[i].focus();return;}bodyStats[key]=Math.round(n*100)/100;}busy('stats',true);var r=await API.request('PUT','/api/arena/stats',bodyStats);busy('stats',false);if(!alive())return;if(!r.ok){clear();body().appendChild(networkFail(r,renderStatsEditor));return;}st.stats=r.body.stats;openGroup(st.group.id,false);});card.appendChild(save);b.appendChild(card);var note=el('div','thar-card');note.appendChild(el('div','thar-sub','Что дальше'));note.appendChild(el('div','thar-note','После сохранения откроется общий рейтинг группы. Ты сможешь менять результаты в любой момент.'));b.appendChild(note);}

  async function syncPremium(force){
    var local=isPremiumLocal();
    if(!force && st.premium===local)return;
    var r=await API.request('PUT','/api/arena/premium',{premium:local});
    if(r.ok&&r.body&&typeof r.body.premium==='boolean')st.premium=r.body.premium; else if(r.ok)st.premium=local;
  }

  function memberNameWithBadge(user,premium){
    var wrap=el('div','thar-name'); wrap.textContent=nameOf(user); if(premium)wrap.appendChild(el('span','thar-premium','Premium')); return wrap;
  }
  function renderMembersCard(){
    var card=el('div','thar-card'); card.appendChild(el('div','thar-sub','Участники группы'));
    var list=el('div','thar-member-list');
    if(!st.members.length){list.appendChild(el('div','thar-empty','Пока участников нет.'));card.appendChild(list);return card;}
    st.members.forEach(function(m){var row=el('div','thar-member');var av=el('div','thar-member-avatar');if(m.user&&m.user.photo_url){var img=document.createElement('img');img.src=m.user.photo_url;img.alt='';img.referrerPolicy='no-referrer';img.onerror=function(){av.textContent=initials(m.user);};av.appendChild(img);}else av.textContent=initials(m.user);row.appendChild(av);var main=el('div','thar-member-main');var name=el('div','thar-member-name');name.textContent=nameOf(m.user);if(m.premium)name.appendChild(el('span','thar-premium','Premium'));main.appendChild(name);main.appendChild(el('div','thar-member-meta',ROLE_LABEL[m.role]||'участник'));row.appendChild(main);list.appendChild(row);});
    card.appendChild(list);return card;
  }

  async function openGroup(gid,forceStats){
    st.view='group';st.group=null;st.members=[];syncHomeButton(true);setTitle('Загрузка…');var b=body();clear();b.appendChild(skeletons(4));
    try{
      var pair=await Promise.all([API.request('GET','/api/groups/'+encodeURIComponent(gid)),API.request('GET','/api/groups/'+encodeURIComponent(gid)+'/leaderboard?metric=ALL'),API.request('GET','/api/arena/stats')]);
      if(!alive())return;var g=pair[0],lb=pair[1],sr=pair[2];if(!g.ok){clear();b.appendChild(networkFail(g,function(){openGroup(gid,forceStats);}));return;}
      st.group=g.body.group;st.role=(g.body.me&&g.body.me.role)||'MEMBER';st.stats=(sr.ok&&sr.body&&sr.body.stats)?sr.body.stats:st.stats;st.premium=!!(sr.ok&&sr.body&&sr.body.stats&&sr.body.stats.premium);st.members=(lb.ok&&lb.body&&Array.isArray(lb.body.members))?lb.body.members:[];if(lb.ok&&lb.body&&lb.body.boards)st.boards=lb.body.boards;else st.boards={};
      await syncPremium(false);
      if(forceStats){renderStatsEditor();return;}
      renderGroupShell(false);if(!lb.ok){var card=document.getElementById('thar-board');if(card){card.textContent='';card.appendChild(networkFail(lb,loadBoard));}}else renderBoard();
    }catch(e){clear();b.appendChild(errorBox('Не удалось загрузить Arena.',function(){openGroup(gid,forceStats);}));}
  }

  function renderGroupShell(editStats){
    var b=body();clear();setTitle(st.group.name);b.appendChild(renderHero('Твоя группа · общий силовой рейтинг'));var info=el('div','thar-card');var row=el('div','thar-row');row.appendChild(el('div','thar-name',st.group.name));row.appendChild(el('div','thar-role',ROLE_LABEL[st.role]||'участник'));info.appendChild(row);info.appendChild(el('div','thar-note','Участников: '+(st.group.member_count||st.members.length||'—')));var inv=el('button','thar-btn red wide','🔗 Пригласить по ссылке');inv.dataset.busy='invite';inv.addEventListener('click',showInvite);info.appendChild(inv);var edit=el('button','thar-btn ghost wide','Изменить мои силовые');edit.style.marginTop='8px';edit.addEventListener('click',renderStatsEditor);info.appendChild(edit);b.appendChild(info);b.appendChild(renderMembersCard());b.appendChild(renderStatsCard(false,false));
    var tabs=el('div','thar-tabs');METRICS.forEach(function(m){var t=el('button','thar-tab'+(st.metric.key===m.key?' on':''),m.label);t.addEventListener('click',function(){st.metric=m;Array.from(tabs.children).forEach(function(x){x.classList.remove('on');});t.classList.add('on');renderBoard();});tabs.appendChild(t);});b.appendChild(tabs);var board=el('div','thar-card');board.id='thar-board';b.appendChild(board);renderBoard();
    var bottom=el('div','thar-bottom-actions');
    if(st.role==='OWNER'&&API.user()&&st.group.owner_id===API.user().id){var manage=el('button','thar-btn danger wide','Удалить участников из группы');manage.addEventListener('click',showMemberManagement);bottom.appendChild(manage);var db=el('button','thar-btn danger wide','Удалить группу');db.style.marginTop='8px';db.dataset.busy='del';db.addEventListener('click',async function(){if(!window.confirm('Удалить группу «'+st.group.name+'»?'))return;busy('del',true);var r=await API.request('DELETE','/api/groups/'+st.group.id);busy('del',false);if(r.ok)goHome();else{clear();body().appendChild(networkFail(r,renderGroupShell));}});bottom.appendChild(db);}else{var leave=el('button','thar-btn danger wide','Выйти из группы');leave.dataset.busy='leave';leave.addEventListener('click',async function(){busy('leave',true);var r=await API.request('POST','/api/groups/'+st.group.id+'/leave',{});busy('leave',false);if(r.ok)goHome();else{clear();body().appendChild(networkFail(r,renderGroupShell));}});bottom.appendChild(leave);}b.appendChild(bottom);
  }

  function showMemberManagement(){
    var b=body();clear();setTitle('УПРАВЛЕНИЕ УЧАСТНИКАМИ');b.appendChild(renderHero('Только владелец группы может удалять участников. Владелец группы удалить самого себя не может.'));
    var card=el('div','thar-card');card.appendChild(el('div','thar-sub','Участники'));
    var list=el('div','thar-member-list');
    st.members.forEach(function(m){var row=el('div','thar-member');var av=el('div','thar-member-avatar');av.textContent=initials(m.user);row.appendChild(av);var main=el('div','thar-member-main');var nm=el('div','thar-member-name');nm.textContent=nameOf(m.user);if(m.premium)nm.appendChild(el('span','thar-premium','Premium'));main.appendChild(nm);main.appendChild(el('div','thar-member-meta',ROLE_LABEL[m.role]||'участник'));row.appendChild(main);if(m.role!=='OWNER'){var del=el('button','thar-btn danger thar-member-delete','Удалить');del.dataset.busy='member:'+m.user.id;del.addEventListener('click',function(){removeMember(m.user.id,nameOf(m.user));});row.appendChild(del);}list.appendChild(row);});
    if(!st.members.some(function(m){return m.role!=='OWNER';}))list.appendChild(el('div','thar-empty','Кроме тебя участников для удаления пока нет.'));
    card.appendChild(list);b.appendChild(card);var back=el('button','thar-btn ghost wide','← К группе');back.addEventListener('click',function(){openGroup(st.group.id,false);});b.appendChild(back);
  }

  async function removeMember(uid,name){
    if(st.role!=='OWNER'||!st.group)return; if(!window.confirm('Удалить участника «'+name+'» из группы?'))return;
    busy('member:'+uid,true);var r=await API.request('DELETE','/api/groups/'+encodeURIComponent(st.group.id)+'/members/'+encodeURIComponent(uid));busy('member:'+uid,false);if(!alive())return;
    if(!r.ok){var b=body();clear();b.appendChild(networkFail(r,showMemberManagement));return;}buzz([10,35,10]);await openGroup(st.group.id,false);
  }

  function renderBoard(){var card=document.getElementById('thar-board');if(!card)return;card.textContent='';var rows=st.boards[st.metric.api]||[];if(!rows.length){card.appendChild(el('div','thar-empty','Пока никто не ввёл результат для этого рейтинга.'));return;}var podium=rows.slice(0,3);if(podium.length){var pw=el('div','thar-podium');podium.forEach(function(x,idx){var p=el('div','thar-pod'+(idx===0?' first':''));p.appendChild(el('div','m',MEDALS[x.place]||x.place));p.appendChild(el('div','v',x.value+' кг'));var n=el('div','n');n.textContent=nameOf(x.user);if(x.user&&x.user.premium)n.appendChild(el('span','thar-premium','Premium'));p.appendChild(n);pw.appendChild(p);});card.appendChild(pw);}var me=API.user();rows.forEach(function(x){var row=el('div','thar-row'+(me&&x.user&&x.user.id===me.id?' me':''));row.appendChild(el('div','thar-place',MEDALS[x.place]||x.place));row.appendChild(memberNameWithBadge(x.user,!!(x.user&&x.user.premium)));row.appendChild(el('div','thar-val',x.value+' кг'));card.appendChild(row);});}
  async function loadBoard(){if(!st.group)return;var r=await API.request('GET','/api/groups/'+encodeURIComponent(st.group.id)+'/leaderboard?metric=ALL');if(!alive())return;if(r.ok&&r.body&&r.body.boards){st.boards=r.body.boards;st.members=Array.isArray(r.body.members)?r.body.members:st.members;renderBoard();}else{var c=document.getElementById('thar-board');if(c){c.textContent='';c.appendChild(networkFail(r,loadBoard));}}}
  async function showInvite(){busy('invite',true);var r=await API.request('POST','/api/groups/'+st.group.id+'/invite',{});busy('invite',false);if(!alive())return;var b=body();clear();setTitle(st.group.name);if(!r.ok){b.appendChild(networkFail(r,renderGroupShell));return;}var link=inviteLink(r.body.code);var card=el('div','thar-card');card.appendChild(renderHero('Одна ссылка — и участник сразу откроет Train Hard и попадёт в твою группу.'));var box=el('div','thar-link-box');box.appendChild(el('div','thar-sub','Ссылка-приглашение'));var a=el('div','thar-link',link);a.title='Нажми, чтобы скопировать';a.addEventListener('click',function(){try{navigator.clipboard&&navigator.clipboard.writeText(link);a.textContent='Ссылка скопирована ✓';setTimeout(function(){a.textContent=link;},1800);}catch(e){}});box.appendChild(a);card.appendChild(box);var cp=el('button','thar-btn red wide','Скопировать ссылку');cp.style.marginTop='10px';cp.addEventListener('click',function(){try{if(navigator.clipboard){navigator.clipboard.writeText(link);cp.textContent='Скопировано ✓';setTimeout(function(){cp.textContent='Скопировать ссылку';},1800);}}catch(e){}});card.appendChild(cp);var share=el('button','thar-btn ghost wide','Поделиться приглашением');share.style.marginTop='8px';share.addEventListener('click',function(){try{var tg=window.Telegram&&window.Telegram.WebApp;if(tg&&tg.openTelegramLink){tg.openTelegramLink(link);return;}if(navigator.share){navigator.share({title:'Train Hard — приглашение в группу',text:'Вступай в мою группу Train Hard',url:link});return;}window.open(link,'_blank');}catch(e){}});card.appendChild(share);card.appendChild(el('div','thar-note',cfg.inviteTtlNote||'Ссылка одноразовая и действует ограниченное время.'));var back=el('button','thar-btn ghost wide','← К группе');back.style.marginTop='10px';back.addEventListener('click',function(){openGroup(st.group.id,false);});card.appendChild(back);b.appendChild(card);}

  function boot(){
    ensureDom();syncHomeButton(false);if(!API.available())return;
    try{if(window.__THPrem&&typeof window.__THPrem.onChange==='function'){window.__THPrem.onChange(function(){if(st.group){syncPremium(true).catch(function(){});} });}}catch(e){}
    var sp=API.startParam();if(sp&&/^[A-Za-z0-9_-]{8,64}$/.test(sp)&&!wasInviteProcessed(sp)){setTimeout(openModal,150);}
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
  window.__THArena={open:openModal,close:closeModal,_goHome:goHome,_state:st};
})();