#!/usr/bin/env python3
import os,re,subprocess
ROOT=os.path.dirname(os.path.abspath(__file__))
SRC=os.path.join(ROOT,'index.html'); OUT_DIR=os.path.join(ROOT,'telegram'); OUT=os.path.join(OUT_DIR,'index.html')
TG_SCRIPT='<script src="https://telegram.org/js/telegram-web-app.js"></script>\n<script id="th-tg-boot">'
SW_RE=re.compile(r'<script id="th-mvp-pwa-register">.*?</script>\n?',re.S)
MANIFEST_RE=re.compile(r'<link[^>]*rel="manifest"[^>]*/?>\s*',re.S)
def read(p):
 with open(p,encoding='utf-8') as f:return f.read()
def main():
 html=read(SRC);boot=read(os.path.join(ROOT,'src/telegram/telegram-boot.js'));mini=read(os.path.join(ROOT,'src/telegram/telegram-miniapp.js'))
 html,n1=SW_RE.subn('',html);html,n2=MANIFEST_RE.subn('',html)
 html=re.sub(r'<script[^>]+src="https://telegram\.org/js/telegram-web-app\.js[^"]*"[^>]*></script>\s*','',html)
 assert n1==1 and n2==1,(n1,n2)
 first_script=html.find('<script>');assert first_script!=-1
 html=html[:first_script]+TG_SCRIPT+boot+'</script>\n'+html[first_script:]
 module='<script id="th-tg-miniapp">\n'+mini+'\n</script>\n';assert html.count('</body>')==1;html=html.replace('</body>',module+'</body>')
 assert 'https://telegram.org/js/telegram-web-app.js' in html and 'th-tg-boot' in html and 'th-tg-miniapp' in html
 os.makedirs(OUT_DIR,exist_ok=True);open(OUT,'w',encoding='utf-8').write(html)
 # syntax check inline scripts
 soup_scripts=re.findall(r'<script[^>]*>([\s\S]*?)</script>',html)
 for i,js in enumerate(soup_scripts):
  if not js.strip():continue
  tmp=f'/tmp/th_tg_{i}.js';open(tmp,'w',encoding='utf-8').write(js);r=subprocess.run(['node','--check',tmp],capture_output=True,text=True)
  if r.returncode:raise SystemExit('syntax fail script '+str(i)+'\n'+r.stderr)
 print('telegram inline scripts OK:',sum(bool(x.strip()) for x in soup_scripts))
 print('Telegram build:',OUT,len(html))
if __name__=='__main__':main()
