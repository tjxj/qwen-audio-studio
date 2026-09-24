import { chromium } from 'playwright';
import { mkdir,writeFile } from 'node:fs/promises';
const base='http://127.0.0.1:8766';
const output='../docs/screenshots/v2';
await mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true});
const context=await browser.newContext({viewport:{width:1440,height:900},deviceScaleFactor:2,colorScheme:'light'});
const api=async(path,method='GET',data)=>{const session=await(await context.request.get(base+'/api/session')).json();const r=await context.request.fetch(base+path,{method,headers:{'X-Qwen-Studio-CSRF':session.csrf_token},...(data===undefined?{}:{data})});if(!r.ok())throw Error(path+': '+await r.text());return r.status()===204?null:r.json()};
const prompt='【场景】雨夜，窗边的一盏灯。\n\n【角色：讲述者】温和沉静，自然舒缓。\n\n【音效】细雨落在窗沿，轻柔、不盖过人声。\n\n【对白：讲述者】今晚，不必急着给生活一个答案。把未完成的事留给明天，先照顾好此刻的自己。\n\n【音乐】极轻的钢琴，在尾音后慢慢淡出。';
const draft=await api('/api/projects','POST',{name:'雨夜里的慢生活',mode:'podcast',prompt,params:{format:'mp3',sample_rate:48000,channels:2,seed:42}});
const page=await context.newPage(), errors=[],results=[];
page.on('pageerror',e=>errors.push(e.message));
for(const theme of ['light','dark']){
 const settings=await api('/api/settings');await api('/api/settings','PATCH',{expected_revision:settings.revision,theme});
 for(const [width,height] of (theme==='light'?[[1440,900],[1280,720],[768,1024],[390,844]]:[[1440,900]])){
  await page.setViewportSize({width,height});
  for(const [name,url,heading] of [['create','/?project='+draft.id,'播客创作'],['library','/library?status=success','作品库'],['templates','/templates','从一个灵感开始'],['settings','/settings','设置']]){
   await page.goto(base+url);await page.getByRole('heading',{name:heading,exact:true}).waitFor();await page.evaluate(()=>document.fonts.ready);
   if(name==='library')await page.locator('.library-table tbody tr').first().waitFor();
   if(name==='templates')await page.locator('.tpl-card').first().waitFor();
   const layout=await page.evaluate(()=>({width:innerWidth,height:innerHeight,scrollWidth:document.documentElement.scrollWidth,scrollHeight:document.documentElement.scrollHeight,serif:document.fonts.check('16px "Studio Serif"'),overflows:[...document.querySelectorAll('button,input,select,textarea')].filter(e=>e.getBoundingClientRect().width&&getComputedStyle(e).visibility!=='hidden').filter(e=>{const r=e.getBoundingClientRect();return r.right>innerWidth+1||r.left< -1}).map(e=>e.getAttribute('aria-label')||e.textContent)}));
   const keep=width===1440||name==='create'||(width===390&&name==='templates');
   if(keep)await page.screenshot({path:output+'/'+name+'-'+width+'-'+theme+'@2x.png'});
   results.push({name,theme,...layout});
   if(name==='create'&&width===1280){const box=await page.getByRole('button',{name:'生成音频',exact:true}).boundingBox();if(!box||box.y+box.height>height)throw Error('生成按钮被挡住');}
  }
 }
}
const settings=await api('/api/settings');await api('/api/settings','PATCH',{expected_revision:settings.revision,theme:'light'});
await page.setViewportSize({width:1440,height:900});await page.goto(base+'/?project='+draft.id);await page.getByRole('button',{name:/添加参考音色/}).click();await page.getByRole('dialog',{name:'参考音色',exact:true}).waitFor();await page.screenshot({path:output+'/voice-panel-1440-light@2x.png'});
await writeFile(output+'/layout-checks.json',JSON.stringify({syntheticFixtures:true,errors,results},null,2));
console.log(JSON.stringify({errors,results},null,2));
await browser.close();
