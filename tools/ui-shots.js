// Снимки экранов на 390x844 с заглушкой Supabase: node tools/ui-shots.js seed.json папка
// seed.json — состояние как у get_state (без поля me); реальные данные в git не класть.
const http=require('http'),fs=require('fs'),path=require('path');
const root=require('path').join(__dirname,'..');const {stubSource}=require(root+'/tests/ui/stub');
const {chromium}=require('playwright');
const seed=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const PUB=root+'/public',T={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json','.png':'image/png'};
const srv=http.createServer((q,r)=>{const u=q.url.split('?')[0];
 if(u==='/config.js'){r.setHeader('content-type',T['.js']);return r.end('window.APP_CONFIG={SUPABASE_URL:"https://stub.invalid",SUPABASE_ANON_KEY:"stub"};')}
 if(u==='/vendor/supabase.js'){r.setHeader('content-type',T['.js']);return r.end(stubSource(seed))}
 const f=path.join(PUB,u==='/'?'index.html':u);if(!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.statusCode=404;return r.end()}
 r.setHeader('content-type',T[path.extname(f)]||'application/octet-stream');r.end(fs.readFileSync(f))});
srv.listen(0,'127.0.0.1',async()=>{
 const base='http://127.0.0.1:'+srv.address().port,out=process.argv[3];
 const b=await chromium.launch();const ctx=await b.newContext({viewport:{width:390,height:844},deviceScaleFactor:2});const p=await ctx.newPage();
 const shot=async n=>{await p.waitForTimeout(350);await p.screenshot({path:out+'/'+n+'.png'})};
 await p.goto(base+'/');await p.waitForSelector('.auth');await shot('01-login');
 await p.fill('input[type=email]','mama@example.com');await p.fill('input[type=password]','password1');await p.click('.auth .btn.primary');
 await p.waitForSelector('nav .tab');await shot('02-week');
 await p.screenshot({path:out+'/02b-week-full.png',fullPage:true});
 for(const t of ['stock','dishes','matrix','prices']){await p.click(`nav .tab[data-t=${t}]`);await shot('03-'+t);await p.screenshot({path:out+`/03b-${t}-full.png`,fullPage:true});}
 await p.click('nav .tab[data-t=week]');
 await p.click('#btnNotify');await shot('04-settings');await p.keyboard.press('Escape');
 await p.click('nav .tab[data-t=dishes]');
try{ const add=p.locator('button:has-text("Новое блюдо"), button:has-text("Добавить блюдо")').first();if(await add.count()){await add.click({timeout:3000});await shot('05-dish-form');await p.keyboard.press('Escape');}
 }catch(e){console.log('пропущено:',e.message.split('\n')[0])}
 await b.close();srv.close();});
