/* Train Hard — Arena UI v4
 * Group-first Arena:
 * - no group: Create / Join
 * - group: only Active group
 * - opening Arena always opens the current group
 * - one group per user is enforced by backend + DB
 * - invite is a Telegram startapp deep link
 * - owner can delete group and remove members
 */
(function () {
  'use strict';

  var root = null;
  var state = {
    group: null,
    me: null,
    members: [],
    stats: { squat: null, bench: null, deadlift: null },
    inviteLink: '',
    loading: false
  };

  function tg() {
    try {
      return window.Telegram && window.Telegram.WebApp
        ? window.Telegram.WebApp : null;
    } catch (e) { return null; }
  }

  function initTelegram() {
    var app = tg();
    if (!app) return;
    try {
      if (typeof app.ready === 'function') app.ready();
      if (typeof app.expand === 'function') app.expand();
      if (typeof app.disableVerticalSwipes === 'function') app.disableVerticalSwipes();
    } catch (e) {}
  }

  function startParam() {
    var app = tg();
    try {
      return String(app && app.initDataUnsafe && app.initDataUnsafe.start_param || '');
    } catch (e) { return ''; }
  }

  async function request(method, path, body) {
    var api = window.__THAPI;
    if (!api || typeof api.request !== 'function') {
      var unavailable = new Error('API client unavailable');
      unavailable.status = 0;
      throw unavailable;
    }
    var result = await api.request(method, path, body);
    if (!result || !result.ok) {
      var msg = result && result.body && (result.body.error || result.body.message);
      var err = new Error(msg || (result && result.reason) || ('HTTP ' + ((result && result.status) || 0)));
      err.status = result && result.status || 0;
      err.data = result && result.body || null;
      throw err;
    }
    return result.body;
  }

  function esc(v) {
    return String(v == null ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function kg(v) {
    if (v === null || v === undefined || v === '') return '—';
    var n = Number(v);
    if (!Number.isFinite(n)) return '—';
    return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);
  }

  function total(s) {
    if (!s || s.squat == null || s.bench == null || s.deadlift == null) return null;
    return Number(s.squat) + Number(s.bench) + Number(s.deadlift);
  }

  function normalizeWeight(v) {
    if (v === '' || v === null || v === undefined) return null;
    var n = Number(v);
    if (!Number.isFinite(n) || n < 0 || n > 1000) throw new Error('Вес должен быть от 0 до 1000 кг');
    return Math.round(n * 100) / 100;
  }

  function errorMessage(e) {
    if (!e) return 'Произошла ошибка';
    if (e.status === 401) return 'Не удалось подтвердить аккаунт Telegram';
    if (e.status === 403) return e.message || 'Недостаточно прав';
    if (e.status === 404) return e.message || 'Группа или приглашение не найдены';
    if (e.status === 409) return e.message || 'Вы уже состоите в группе';
    return e.message || 'Произошла ошибка';
  }

  function injectStyles() {
    if (document.getElementById('trainhard-arena-v4-style')) return;
    var s = document.createElement('style');
    s.id = 'trainhard-arena-v4-style';
    s.textContent = `
      .th-arena-overlay{position:fixed;inset:0;z-index:999999;overflow:auto;background:
        radial-gradient(circle at 10% 0%,rgba(255,74,54,.22),transparent 32%),
        radial-gradient(circle at 100% 20%,rgba(255,145,40,.16),transparent 34%),#090909;color:#fff;
        font-family:-apple-system,BlinkMacSystemFont,"SF Pro Display","Segoe UI",sans-serif}
      .th-arena{max-width:640px;min-height:100%;margin:auto;padding:calc(16px + env(safe-area-inset-top)) 14px calc(32px + env(safe-area-inset-bottom));box-sizing:border-box}
      .arena-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:18px}
      .arena-title{margin:0;font-size:29px;font-weight:950;letter-spacing:-1px}
      .arena-subtitle{margin:3px 0 0;color:#888;font-size:12px}
      .arena-back,.arena-icon{width:42px;height:42px;border:0;border-radius:14px;background:rgba(255,255,255,.08);color:#fff;font-size:22px}
      .arena-hero{position:relative;overflow:hidden;border-radius:25px;padding:25px 21px;margin-bottom:12px;background:linear-gradient(135deg,#3c100b,#a91c11 52%,#ff681a);box-shadow:0 16px 40px rgba(0,0,0,.32)}
      .arena-hero h2{position:relative;z-index:1;margin:6px 0 0;font-size:30px;line-height:1.04}
      .arena-hero-label{position:relative;z-index:1;font-size:11px;font-weight:900;letter-spacing:1.4px;opacity:.72;text-transform:uppercase}
      .arena-card{background:rgba(255,255,255,.065);border:1px solid rgba(255,255,255,.07);border-radius:20px;padding:17px;margin-bottom:11px;backdrop-filter:blur(14px)}
      .arena-card-title{margin:0 0 12px;font-size:18px;font-weight:950}
      .arena-muted{color:rgba(255,255,255,.52);font-size:12px;line-height:1.45}
      .arena-actions{display:grid;gap:10px}
      .arena-btn{width:100%;min-height:54px;border:0;border-radius:16px;padding:0 16px;color:#fff;background:#1c1c1e;font-size:15px;font-weight:850}
      .arena-btn-primary{background:linear-gradient(135deg,#e72d1c,#ff721d);box-shadow:0 10px 25px rgba(238,65,28,.22)}
      .arena-btn-secondary{background:rgba(255,255,255,.09)}
      .arena-btn-danger{background:rgba(255,50,50,.12);color:#ff958b}
      .arena-btn-small{min-height:40px;font-size:13px;border-radius:12px}
      .arena-field{margin-bottom:12px}.arena-label{display:block;margin-bottom:6px;color:#aaa;font-size:12px;font-weight:750}
      .arena-input{width:100%;height:51px;box-sizing:border-box;border:1px solid rgba(255,255,255,.1);border-radius:14px;background:rgba(0,0,0,.25);color:#fff;padding:0 14px;font-size:16px;outline:none}
      .arena-input:focus{border-color:#ff633f}
      .arena-error{display:none;margin:10px 0;padding:11px 13px;border-radius:13px;background:rgba(255,50,50,.12);color:#ff9b92;font-size:13px}
      .arena-error.show{display:block}
      .arena-group-name{font-size:26px;font-weight:950;letter-spacing:-.5px}.arena-group-meta{color:#888;font-size:12px;margin-top:3px}
      .arena-share{display:flex;gap:8px;align-items:center}.arena-share .arena-btn{flex:1}
      .arena-link{word-break:break-all;margin-top:10px;padding:11px;border-radius:12px;background:rgba(0,0,0,.25);color:#ff9b75;font-size:11px}
      .arena-power-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:8px}
      .arena-power{padding:14px;border-radius:15px;background:rgba(255,255,255,.055)}
      .arena-power-label{font-size:10px;color:#777;font-weight:850;text-transform:uppercase;letter-spacing:.7px}
      .arena-power-value{margin-top:5px;font-size:24px;font-weight:950}
      .arena-total{padding:16px;border-radius:17px;background:linear-gradient(135deg,rgba(255,74,54,.17),rgba(255,145,40,.08));margin-bottom:9px}
      .arena-total-label{font-size:10px;color:#a99;text-transform:uppercase;font-weight:900;letter-spacing:1px}.arena-total-value{margin-top:3px;font-size:36px;font-weight:950}
      .arena-member{display:grid;grid-template-columns:40px 1fr auto;gap:10px;align-items:center;padding:12px 0;border-bottom:1px solid rgba(255,255,255,.055)}
      .arena-member:last-child{border-bottom:0}.arena-place{width:36px;height:36px;display:flex;align-items:center;justify-content:center;border-radius:11px;background:rgba(255,255,255,.07);font-weight:950}
      .arena-member-name{font-size:14px;font-weight:850}.arena-member-sub{margin-top:3px;color:#777;font-size:10px}.arena-member-total{font-size:15px;font-weight:950}
      .arena-member-actions{margin-top:7px}.arena-empty{color:#777;font-size:13px;padding:8px 0}
      .arena-role{display:inline-block;margin-left:6px;padding:2px 6px;border-radius:6px;background:rgba(255,105,50,.13);color:#ff9470;font-size:9px;font-weight:900}
      .arena-loading{opacity:.72;pointer-events:none}
      @media(max-width:400px){.arena-power-grid{grid-template-columns:1fr}.arena-member{grid-template-columns:36px 1fr}.arena-member-total{grid-column:2}.arena-share{flex-direction:column}.arena-share .arena-btn{width:100%}}
    `;
    document.head.appendChild(s);
  }

  function createRoot() {
    if (root) return root;
    root = document.createElement('div');
    root.className = 'th-arena-overlay';
    document.body.appendChild(root);
    document.body.classList.add('thch-open');
    return root;
  }

  function destroyRoot() {
    if (!root) return;
    root.remove(); root = null;
    document.body.classList.remove('thch-open');
  }

  function shell(content, back) {
    return `
      <div class="th-arena">
        <div class="arena-header">
          ${back ? '<button class="arena-back" data-action="home">‹</button>' : '<div style="width:42px"></div>'}
          <div style="text-align:center"><h1 class="arena-title">ARENA</h1><p class="arena-subtitle">Train Hard</p></div>
          <div style="width:42px"></div>
        </div>
        ${content}
      </div>`;
  }

  function setLoading(v) {
    state.loading = !!v;
    if (!root) return;
    root.classList.toggle('arena-loading', state.loading);
    root.querySelectorAll('button').forEach(function(b){b.disabled=state.loading;});
  }

  function showError(message) {
    if (!root) return;
    var box = root.querySelector('.arena-error');
    if (!box) return;
    box.textContent = message || '';
    box.classList.toggle('show', !!message);
  }

  function bind() {
    if (!root) return;
    root.querySelectorAll('[data-action]').forEach(function(btn){
      btn.addEventListener('click', async function(){
        var a=btn.getAttribute('data-action');
        if(a==='home') await home();
        else if(a==='create') createForm();
        else if(a==='join') joinInfo();
        else if(a==='save-stats') await saveStats();
        else if(a==='share') await createInvite();
        else if(a==='copy') await copyInvite();
        else if(a==='edit-stats') await editStats();
        else if(a==='delete-group') await deleteGroup();
        else if(a==='remove-member') await removeMember(btn.getAttribute('data-user-id'));
      });
    });
  }

  async function getMyGroup() {
    var data = await request('GET','/api/groups');
    var groups = data && Array.isArray(data.groups) ? data.groups : Array.isArray(data) ? data : [];
    return groups.length ? groups[0] : null;
  }

  async function loadGroup() {
    var entry = await getMyGroup();
    if (!entry) {
      state.group=null; state.me=null; state.members=[]; return false;
    }
    var gid=entry.id || (entry.group && entry.group.id);
    var detail=await request('GET','/api/groups/'+encodeURIComponent(gid));
    state.group=detail.group || entry.group || entry;
    state.me=detail.me || {role:entry.role || 'MEMBER'};
    var members=await request('GET','/api/groups/'+encodeURIComponent(gid)+'/members');
    state.members=members && Array.isArray(members.members) ? members.members : [];
    var stats=await request('GET','/api/arena/stats');
    state.stats=(stats && stats.stats) || {squat:null,bench:null,deadlift:null};
    return true;
  }

  function memberName(m) {
    var u=m.user || m;
    return u.first_name || u.username || u.last_name || 'Участник';
  }

  function memberRole(m) {
    return String(m.role || '').toUpperCase();
  }

  function memberTotal(m) {
    if (m.squat != null && m.bench != null && m.deadlift != null) {
      return Number(m.squat)+Number(m.bench)+Number(m.deadlift);
    }
    if (m.stats) return total(m.stats);
    return null;
  }

  function renderMembers() {
    if (!state.members.length) return '<div class="arena-empty">В группе пока нет участников.</div>';
    var rows=state.members.slice();
    rows.sort(function(a,b){
      var at=memberTotal(a), bt=memberTotal(b);
      if(at==null && bt==null) return 0;
      if(at==null) return 1;
      if(bt==null) return -1;
      return bt-at;
    });
    return rows.map(function(m,i){
      var u=m.user || {};
      var role=memberRole(m);
      var mine=state.me && String(m.user_id)===String(state.me.user_id || (window.__THAPI.user&&window.__THAPI.user().id));
      var canRemove=state.me && String(state.me.role).toUpperCase()==='OWNER' && !mine && role!=='OWNER';
      var t=memberTotal(m);
      return `
        <div class="arena-member">
          <div class="arena-place">${i+1}</div>
          <div>
            <div class="arena-member-name">${esc(memberName(m))}${role==='OWNER'?'<span class="arena-role">ВЛАДЕЛЕЦ</span>':''}</div>
            <div class="arena-member-sub">Жим ${kg(m.bench)} · Присед ${kg(m.squat)} · Становая ${kg(m.deadlift)}</div>
            ${canRemove ? '<div class="arena-member-actions"><button class="arena-btn arena-btn-danger arena-btn-small" data-action="remove-member" data-user-id="'+esc(m.user_id)+'">Удалить участника</button></div>' : ''}
          </div>
          <div class="arena-member-total">${t==null?'—':kg(t)+' кг'}</div>
        </div>`;
    }).join('');
  }

  function renderGroup() {
    var g=state.group||{};
    var s=state.stats||{};
    var mineRole=String(state.me&&state.me.role||'MEMBER').toUpperCase();
    var owner=mineRole==='OWNER';
    var inviteBlock=state.inviteLink ? `
      <div class="arena-link" id="arena-invite-link">${esc(state.inviteLink)}</div>
      <button class="arena-btn arena-btn-secondary" data-action="copy" style="margin-top:8px">Скопировать ссылку</button>
    ` : '';
    root.innerHTML=shell(`
      <div class="arena-card">
        <div class="arena-group-name">${esc(g.name||'Моя группа')}</div>
        <div class="arena-group-meta">${state.members.length} участник(ов) · ${owner?'Вы владелец':'Участник'}</div>
        <div style="margin-top:14px" class="arena-share">
          <button class="arena-btn arena-btn-primary" data-action="share">🔗 Поделиться ссылкой</button>
        </div>
        ${inviteBlock}
      </div>

      <div class="arena-card">
        <h2 class="arena-card-title">Троеборье</h2>
        <div class="arena-total"><div class="arena-total-label">Сумма</div><div class="arena-total-value">${total(s)==null?'—':kg(total(s))+' кг'}</div></div>
        <div class="arena-power-grid">
          <div class="arena-power"><div class="arena-power-label">Жим</div><div class="arena-power-value">${kg(s.bench)} кг</div></div>
          <div class="arena-power"><div class="arena-power-label">Присед</div><div class="arena-power-value">${kg(s.squat)} кг</div></div>
          <div class="arena-power"><div class="arena-power-label">Становая</div><div class="arena-power-value">${kg(s.deadlift)} кг</div></div>
        </div>
      </div>

      <div class="arena-card">
        <h2 class="arena-card-title">Участники</h2>
        ${renderMembers()}
      </div>

      <div class="arena-card">
        <h2 class="arena-card-title">Мои последние результаты</h2>
        <div class="arena-power-grid">
          <div class="arena-power"><div class="arena-power-label">Жим</div><div class="arena-power-value">${kg(s.bench)} кг</div></div>
          <div class="arena-power"><div class="arena-power-label">Присед</div><div class="arena-power-value">${kg(s.squat)} кг</div></div>
          <div class="arena-power"><div class="arena-power-label">Становая</div><div class="arena-power-value">${kg(s.deadlift)} кг</div></div>
        </div>
        <button class="arena-btn arena-btn-secondary" data-action="edit-stats" style="margin-top:10px">Изменить результаты</button>
      </div>

      ${owner ? `
        <div class="arena-card">
          <h2 class="arena-card-title">Управление группой</h2>
          <p class="arena-muted">Только владелец может удалять участников и группу.</p>
          <button class="arena-btn arena-btn-danger" data-action="delete-group">Удалить группу</button>
        </div>
      ` : ''}
      <div class="arena-error"></div>
    `);
    bind();
  }

  async function showGroup() {
    if (!root) createRoot();
    setLoading(true);
    try {
      if (!(await loadGroup())) return home();
      renderGroup();
    } catch(e) {
      await home(errorMessage(e));
    } finally { setLoading(false); }
  }

  function home(error) {
    if (!root) createRoot();
    if (state.group) return showGroup();
    root.innerHTML=shell(`
      <div class="arena-hero"><div class="arena-hero-label">POWER · COMPETE · IMPROVE</div><h2>Твоя силовая арена</h2></div>
      <div class="arena-card">
        <div class="arena-actions">
          <button class="arena-btn arena-btn-primary" data-action="join">⚡ Вступить в группу</button>
          <button class="arena-btn arena-btn-secondary" data-action="create">＋ Создать группу</button>
        </div>
        <div class="arena-error ${error?'show':''}">${esc(error||'')}</div>
        <p class="arena-muted" style="margin:12px 2px 0">После вступления или создания группы здесь останется только кнопка «Действующая группа».</p>
      </div>
    `);
    bind();
  }

  function createForm() {
    root.innerHTML=shell(`
      <div class="arena-card">
        <h2 class="arena-card-title">Создать группу</h2>
        <div class="arena-field"><label class="arena-label">Название группы</label><input id="arena-group-name" class="arena-input" maxlength="80" placeholder="Например: Train Hard Team"></div>
        <div class="arena-error"></div>
        <button class="arena-btn arena-btn-primary" id="arena-create-submit">Создать группу</button>
      </div>`,true);
    bind();
    root.querySelector('#arena-create-submit').addEventListener('click',async function(){
      var name=String(root.querySelector('#arena-group-name').value||'').trim();
      if(name.length<3){showError('Название — от 3 до 80 символов');return;}
      setLoading(true);
      try{
        var data=await request('POST','/api/groups',{name:name});
        state.group=data.group||data;
        await statsForm('Группа создана');
      }catch(e){showError(errorMessage(e));}finally{setLoading(false);}
    });
  }

  function joinInfo() {
    root.innerHTML=shell(`
      <div class="arena-card">
        <h2 class="arena-card-title">Вступить в группу</h2>
        <p class="arena-muted">Приглашение приходит ссылкой Telegram. Открой ссылку — Arena автоматически добавит тебя в группу.</p>
        <div class="arena-error"></div>
        <button class="arena-btn arena-btn-secondary" data-action="home">Назад</button>
      </div>`,true);
    bind();
    var token=startParam();
    if(token) autoJoin(token);
  }

  async function autoJoin(token) {
    setLoading(true);
    try{
      var data=await request('POST','/api/invites/'+encodeURIComponent(token)+'/join',{});
      state.group=data.group||data;
      await loadGroup();
      renderGroup();
    }catch(e){await home(errorMessage(e));}
    finally{setLoading(false);}
  }

  function statsForm(title) {
    root.innerHTML=shell(`
      <div class="arena-hero"><div class="arena-hero-label">${esc(title||'Результаты')}</div><h2>Твоё<br>троеборье</h2></div>
      <div class="arena-card">
        <div class="arena-field"><label class="arena-label">Жим — кг</label><input id="arena-bench" class="arena-input" type="number" min="0" max="1000" step="0.01" inputmode="decimal" placeholder="100"></div>
        <div class="arena-field"><label class="arena-label">Присед — кг</label><input id="arena-squat" class="arena-input" type="number" min="0" max="1000" step="0.01" inputmode="decimal" placeholder="140"></div>
        <div class="arena-field"><label class="arena-label">Становая — кг</label><input id="arena-deadlift" class="arena-input" type="number" min="0" max="1000" step="0.01" inputmode="decimal" placeholder="180"></div>
        <div class="arena-error"></div>
        <button class="arena-btn arena-btn-primary" data-action="save-stats">Сохранить результаты</button>
      </div>`,true);
    bind();
    if(state.stats){
      root.querySelector('#arena-bench').value=state.stats.bench==null?'':state.stats.bench;
      root.querySelector('#arena-squat').value=state.stats.squat==null?'':state.stats.squat;
      root.querySelector('#arena-deadlift').value=state.stats.deadlift==null?'':state.stats.deadlift;
    }
  }

  async function saveStats() {
    setLoading(true);
    try{
      var stats={
        bench:normalizeWeight(root.querySelector('#arena-bench').value),
        squat:normalizeWeight(root.querySelector('#arena-squat').value),
        deadlift:normalizeWeight(root.querySelector('#arena-deadlift').value)
      };
      await request('PUT','/api/arena/stats',stats);
      state.stats=stats;
      await showGroup();
    }catch(e){showError(errorMessage(e));}
    finally{setLoading(false);}
  }

  async function editStats() {
    statsForm('Обновление результатов');
  }

  async function createInvite() {
    if(!state.group) return;
    setLoading(true);
    try{
      var gid=state.group.id;
      var data=await request('POST','/api/groups/'+encodeURIComponent(gid)+'/invite',{});
      var token=data && (data.code || data.token || (data.invite && (data.invite.code||data.invite.token)));
      if(!token) throw new Error('Сервер не вернул код приглашения');
      state.inviteLink='https://t.me/trainhard_power_bot/trainhard?startapp='+encodeURIComponent(token);
      renderGroup();
    }catch(e){showError(errorMessage(e));}
    finally{setLoading(false);}
  }

  async function copyInvite() {
    if(!state.inviteLink) return;
    try{
      if(navigator.clipboard && navigator.clipboard.writeText) await navigator.clipboard.writeText(state.inviteLink);
      else{
        var t=document.createElement('textarea');t.value=state.inviteLink;t.style.position='fixed';document.body.appendChild(t);t.select();document.execCommand('copy');t.remove();
      }
      var b=root.querySelector('[data-action="copy"]');
      if(b){b.textContent='✓ Ссылка скопирована';setTimeout(function(){if(b)b.textContent='Скопировать ссылку';},1600);}
    }catch(e){showError('Не удалось скопировать ссылку');}
  }

  async function removeMember(userId) {
    if(!state.group || !userId) return;
    if(!window.confirm('Удалить этого участника из группы?')) return;
    setLoading(true);
    try{
      await request('DELETE','/api/groups/'+encodeURIComponent(state.group.id)+'/members/'+encodeURIComponent(userId),{});
      await showGroup();
    }catch(e){showError(errorMessage(e));}
    finally{setLoading(false);}
  }

  async function deleteGroup() {
    if(!state.group) return;
    if(!window.confirm('Удалить группу и всех её участников? Это действие нельзя отменить.')) return;
    setLoading(true);
    try{
      await request('DELETE','/api/groups/'+encodeURIComponent(state.group.id),{});
      state.group=null;state.me=null;state.members=[];state.inviteLink='';
      await home();
    }catch(e){showError(errorMessage(e));}
    finally{setLoading(false);}
  }

  async function open() {
    injectStyles(); initTelegram();
    if(!root) createRoot();
    setLoading(true);
    try{
      var group=await getMyGroup();
      if(group){
        state.group=group.group||group;
        await showGroup();
        return;
      }
      var token=startParam();
      if(token){await autoJoin(token);return;}
      state.group=null;
      await home();
    }catch(e){await home(errorMessage(e));}
    finally{setLoading(false);}
  }

  function close(){destroyRoot();}

  window.__THArena={open:open,close:close,refresh:open};
  window.TrainHardArena=window.__THArena;
})();
