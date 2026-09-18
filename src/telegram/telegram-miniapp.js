/* Train Hard — Telegram Mini App integration. */
(function () {
  'use strict';
  function wa() { try { return (window.Telegram && window.Telegram.WebApp) ? window.Telegram.WebApp : null; } catch (e) { return null; } }
  var app = wa(); if (!app) return;
  var inTelegram = false;
  try { inTelegram = typeof app.initData === 'string' && app.initData.length > 0; } catch (e) {}
  if (!inTelegram && !(app.version)) return;
  try { app.ready(); } catch (e) {}
  try { app.expand(); } catch (e) {}
  try { if (app.setHeaderColor) app.setHeaderColor('#0a0a0a'); } catch (e) {}
  try { if (app.setBackgroundColor) app.setBackgroundColor('#0a0a0a'); } catch (e) {}
  try { if (app.disableVerticalSwipes) app.disableVerticalSwipes(); } catch (e) {}
  try { var st=document.createElement('style'); st.textContent='html,body{overscroll-behavior:none!important}body{position:static}'; document.head.appendChild(st); } catch (e) {}
  function haptic(kind){try{var h=app.HapticFeedback;if(!h)return;if(kind==='achievement')h.notificationOccurred('success');else h.impactOccurred('light');}catch(e){}}
  try { var origPlay=window.TrainHardEffects&&window.TrainHardEffects.play;if(origPlay){window.TrainHardEffects.play=function(name){haptic(name==='achievement'?'achievement':'light');try{return origPlay.apply(window.TrainHardEffects,arguments);}catch(e){}};}}catch(e){}
  var back=null;try{back=app.BackButton;}catch(e){}
  function overlayOpen(){try{var ch=document.querySelector('.thch');if(ch&&ch.style.display!=='none')return'challenges';var tm=document.querySelector('.thit');if(tm&&tm.style.display!=='none')return'timer';var ar=document.getElementById('thar-root');if(ar)return'arena';}catch(e){}return null;}
  function syncBack(){if(!back)return;try{overlayOpen()?back.show():back.hide();}catch(e){}}
  if(back){try{back.onClick(function(){var which=overlayOpen();try{if(which==='challenges'&&window.__THChallenges)window.__THChallenges.close();else if(which==='timer'){var x=document.querySelector('.thit-x');if(x)x.click();else if(window.__THTimer)window.__THTimer.close&&window.__THTimer.close();}else if(which==='arena'&&window.__THArena)window.__THArena.close();}catch(e){}setTimeout(syncBack,50);});}catch(e){}setInterval(syncBack,800);}
  try{var origOpen=window.open;window.open=function(url){try{if(typeof url==='string'&&/^https?:/i.test(url)&&app.openLink){app.openLink(url);return null;}}catch(e){}return origOpen.apply(window,arguments);};}catch(e){}
  window.__THTelegram={version:(function(){try{return app.version||'';}catch(e){return'';}})(),userKey:(function(){try{var u=app.initDataUnsafe&&app.initDataUnsafe.user;return u&&u.id?'tg'+u.id:null;}catch(e){return null;}})(),syncBack:syncBack};
})();
