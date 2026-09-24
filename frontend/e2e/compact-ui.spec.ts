import {test,expect} from '@playwright/test';
test('创作台一屏、顶栏明暗持久化、Finder入口与高级参数键盘操作',async({page,request})=>{
 const session=await(await request.get('/api/session')).json();
 const headers={'X-Qwen-Studio-CSRF':session.csrf_token};
 const settings=await(await request.get('/api/settings')).json();
 await request.patch('/api/settings',{headers,data:{expected_revision:settings.revision,theme:'light'}});
 const project=await(await request.post('/api/projects',{headers,data:{name:'一屏布局验收',mode:'audiobook',prompt:'【对白：旁白】一段值得被听见的故事。'}})).json();
 await page.setViewportSize({width:1280,height:720});await page.goto('/?project='+project.id);
 await expect(page.getByLabel('场景提示词')).toBeVisible();
 await expect(page.locator('.mode-context')).toHaveCount(0);
 await expect(page.getByText('新建项目',{exact:true})).toHaveCount(0);
 const sizes=await page.evaluate(()=>({page:document.documentElement.scrollHeight,height:innerHeight,panel:document.querySelector('.workbench-inspector')!.clientHeight,content:document.querySelector('.workbench-inspector')!.scrollHeight}));
 expect(sizes.page).toBe(sizes.height);expect(sizes.content).toBeLessThanOrEqual(sizes.panel+1);
 for(const name of ['高级设置','生成音频']){const b=await page.getByRole('button',{name,exact:true}).boundingBox();expect(b!.y+b!.height).toBeLessThanOrEqual(720)}
 await page.getByRole('button',{name:'切换为深色模式'}).click();await expect(page.locator('html')).toHaveAttribute('data-theme','dark');await page.reload();await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
 await page.getByRole('button',{name:'切换为浅色模式'}).click();await expect(page.locator('html')).toHaveAttribute('data-theme','light');
 let revealed=false;await page.route('**/api/directories/*/reveal',async route=>{revealed=route.request().method()==='POST';await route.fulfill({status:204})});
 await page.getByRole('button',{name:'在Finder中打开输出文件夹'}).click();await expect.poll(()=>revealed).toBe(true);
 const advanced=page.getByRole('button',{name:'高级设置',exact:true});await advanced.click();const dialog=page.getByRole('dialog',{name:'高级输出设置'});await dialog.getByLabel('输出格式').selectOption('mp3');
 const box=await dialog.locator('.modal-body').evaluate(e=>({visible:e.clientHeight,total:e.scrollHeight}));expect(box.total).toBeLessThanOrEqual(box.visible+1);
 for(let i=0;i<18;i++){await page.keyboard.press('Tab');expect(await dialog.evaluate(e=>e.contains(document.activeElement))).toBe(true)}
 await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);await expect(advanced).toBeFocused();
});
