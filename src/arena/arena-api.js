/* =============================================================
 * Train Hard — ARENA API client
 *
 * Identity comes only from signed Telegram initData. The client never
 * sends a user_id as an authority. Bearer session is only a cache;
 * the server resolves the actual user from the session.
 * ============================================================= */
(function () {
  'use strict';
  var cfg = window.TRAINHARD_ARENA || {};
  var base = String(cfg.apiBase || '').replace(/\/+$/, '');
  var TOKEN_KEY = 'trainhard_api_session';
  var token = null;
  var user = null;

  function tg() { try { return window.Telegram && window.Telegram.WebApp; } catch (e) { return null; } }
  function initData() { var w=tg(); return (w && typeof w.initData==='string' && w.initData) ? w.initData : ''; }
  function startParam() { var w=tg(); return (w && w.initDataUnsafe && typeof w.initDataUnsafe.start_param==='string') ? w.initDataUnsafe.start_param : ''; }

  function loadCached() {
    try {
      var raw=window.localStorage.getItem(TOKEN_KEY); if(!raw)return;
      var v=JSON.parse(raw);
      if(v&&typeof v.token==='string'&&Number(v.expires_at||0)>Date.now()){token=v.token;user=v.user||null;}
    } catch(e){}
  }
  function saveCached() {
    try { window.localStorage.setItem(TOKEN_KEY,JSON.stringify({token:token,user:user,expires_at:Date.now()+25*86400000})); } catch(e){}
  }
  loadCached();

  function rawFetch(url,opts){ if(typeof window.fetch==='function')return window.fetch(url,opts); return Promise.reject(new Error('no-fetch')); }
  async function authenticate(){
    var id=initData(); if(!id)return {ok:false,reason:'telegram-required'};
    var r; try { r=await rawFetch(base+'/api/auth/telegram',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({initData:id})}); }
    catch(e){return {ok:false,reason:'network'};}
    if(!r.ok)return {ok:false,reason:'auth-'+r.status};
    var j; try{j=await r.json();}catch(e){return {ok:false,reason:'bad-json'};}
    token=j.token;user=j.user||null;saveCached();return {ok:true,user:user};
  }
  async function request(method,path,body){
    if(!token){var a=await authenticate();if(!a.ok)return {ok:false,status:0,reason:a.reason,body:null};}
    var doCall=async function(){var headers={'Authorization':'Bearer '+token};if(body!==undefined)headers['Content-Type']='application/json';return rawFetch(base+path,{method:method,headers:headers,body:body!==undefined?JSON.stringify(body):undefined});};
    var res;try{res=await doCall();}catch(e){return {ok:false,status:0,reason:'network',body:null};}
    if(res.status===401){token=null;user=null;var re=await authenticate();if(!re.ok)return {ok:false,status:0,reason:re.reason,body:null};try{res=await doCall();}catch(e){return {ok:false,status:0,reason:'network',body:null};}}
    var json=null;try{json=await res.json();}catch(e){}
    return {ok:res.ok,status:res.status,body:json};
  }

  window.__THAPI={
    available:function(){return !!initData();},
    authenticate:authenticate,
    request:request,
    startParam:startParam,
    user:function(){return user;},
    token:function(){return token;},
    _resetForTests:function(){token=null;user=null;try{window.localStorage.removeItem(TOKEN_KEY);}catch(e){}}
  };

  setTimeout(function(){try{if(!token&&initData())authenticate().catch(function(){});}catch(e){}},0);
})();
