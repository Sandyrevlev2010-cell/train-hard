/* Train Hard — Arena API client */
(function () {
  'use strict';
  var cfg = window.TRAINHARD_ARENA || {};
  var base = String(cfg.apiBase || 'https://train-hard.onrender.com').replace(/\/+$/, '');
  var TOKEN_KEY = 'trainhard_api_session';
  var token = null, user = null;

  function tg(){try{return window.Telegram&&window.Telegram.WebApp?window.Telegram.WebApp:null}catch(e){return null}}
  function initData(){var a=tg();return a&&typeof a.initData==='string'?a.initData:''}
  function startParam(){var a=tg();try{return a&&a.initDataUnsafe&&typeof a.initDataUnsafe.start_param==='string'?a.initDataUnsafe.start_param:''}catch(e){return''}}
  function load(){try{var r=localStorage.getItem(TOKEN_KEY);if(!r)return;var d=JSON.parse(r);if(d&&typeof d.token==='string'&&d.token&&Number(d.expires_at||0)>Date.now()){token=d.token;user=d.user||null}}catch(e){}}
  function save(){try{localStorage.setItem(TOKEN_KEY,JSON.stringify({token:token,user:user,expires_at:Date.now()+25*86400000}))}catch(e){}}
  function clear(){token=null;user=null;try{localStorage.removeItem(TOKEN_KEY)}catch(e){}}
  function path(p){p=String(p||'');if(p.charAt(0)!=='/')p='/'+p;return p==='/api'||p.indexOf('/api/')===0?p:'/api'+p}
  function fetcher(url,opt){return typeof fetch==='function'?fetch(url,opt):Promise.reject(new Error('fetch unavailable'))}
  load();

  async function authenticate(){
    var data=initData();if(!data)return{ok:false,reason:'telegram-required'};
    var r;
    try{r=await fetcher(base+'/api/auth/telegram',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({initData:data})})}
    catch(e){return{ok:false,reason:'network'}};
    var b=null;try{b=await r.json()}catch(e){}
    if(!r.ok)return{ok:false,status:r.status,reason:'auth-'+r.status,body:b};
    if(!b||typeof b.token!=='string'||!b.token)return{ok:false,reason:'invalid-auth-response',body:b};
    token=b.token;user=b.user||null;save();return{ok:true,user:user}
  }

  async function request(method,p,body){
    if(!token){var a=await authenticate();if(!a.ok)return{ok:false,status:a.status||0,reason:a.reason,body:a.body||null}}
    var url=base+path(p);
    async function call(){var h={Authorization:'Bearer '+token};if(body!==undefined)h['Content-Type']='application/json';return fetcher(url,{method:method,headers:h,body:body!==undefined?JSON.stringify(body):undefined})}
    var r;try{r=await call()}catch(e){return{ok:false,status:0,reason:'network',body:null}}
    if(r.status===401){clear();var re=await authenticate();if(!re.ok)return{ok:false,status:401,reason:re.reason,body:re.body||null};try{r=await call()}catch(e){return{ok:false,status:0,reason:'network',body:null}}}
    var b=null;try{b=await r.json()}catch(e){}
    return{ok:r.ok,status:r.status,body:b}
  }

  window.__THAPI={available:function(){return!!initData()},authenticate:authenticate,request:request,startParam:startParam,user:function(){return user},token:function(){return token},_resetForTests:clear};
  setTimeout(function(){if(!token&&initData())authenticate().catch(function(){})},0);
})();