#!/usr/bin/env node
const { chromium } = require('/root/.openclaw/douyin-creator-tools/node_modules/playwright');
const fs = require('fs');
const CDP = process.env.CDP_PORT || '9333';
const BOOK_ID = '7644905838972259352';
const chapter = parseInt(process.argv[2]);
const chapterTitle = process.argv[3];
const contentFile = process.argv[4];
if (!chapter || !chapterTitle || !contentFile) process.exit(1);
const content = fs.readFileSync(contentFile, 'utf-8').replace(/^#.*$/gm, '').replace(/^---$/gm, '').trim();
const W = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await chromium.connectOverCDP(`http://localhost:${CDP}`);
  const ctx = browser.contexts()[0];
  for (const p of ctx.pages()) { if (p.url().includes('/publish/')) await p.close().catch(() => {}); }
  let page = ctx.pages().find(p => p.url().includes('fanqienovel.com'));
  if (!page) page = await ctx.newPage();

  console.log(`[1] 第${chapter}章: ${chapterTitle} (${content.length}字)`);
  await page.goto(`https://fanqienovel.com/main/writer/${BOOK_ID}/publish/?enter_from=newchapter_0`, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
  await W(5000);
  if (page.url().includes('login')) { console.error('❌ 登录过期'); await browser.close(); process.exit(1); }

  console.log('[2] 填写...');
  const si = page.locator('input.serial-input').first();
  await si.click({ force: true });
  await si.fill(String(chapter));
  await W(500);
  await page.locator('input[placeholder="请输入标题"]').first().click({ force: true });
  await page.keyboard.press('Control+a');
  await page.keyboard.type(chapterTitle, { delay: 10 });
  await W(500);
  await page.locator('div.ProseMirror').first().click({ force: true });
  await W(200);
  await page.keyboard.type(content, { delay: 0 });
  await W(3000);

  const check = await page.evaluate(() => ({
    serial: document.querySelector('input.serial-input')?.value,
    title: document.querySelector('input[placeholder="请输入标题"]')?.value,
    disabled: Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === '下一步')?.classList.contains('arco-btn-disabled')
  }));
  console.log('  状态:', JSON.stringify(check));
  if (check.disabled || !check.serial) { console.error('❌ 填写异常'); await browser.close(); process.exit(1); }

  console.log('[3] 下一步...');
  await page.evaluate(() => Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === '下一步')?.click());
  await W(12000);

  console.log('[4] 提交...');
  await page.evaluate(() => {
    document.querySelectorAll('.arco-modal-mask').forEach(e => e.style.display = 'none');
    document.querySelectorAll('.arco-modal-wrapper').forEach(e => e.style.pointerEvents = 'auto');
    Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === '提交')?.click();
  });
  await W(12000);

  console.log('[5] 仅基础检测...');
  await page.evaluate(() => {
    document.querySelectorAll('.arco-modal-mask').forEach(e => e.style.display = 'none');
    document.querySelectorAll('.arco-modal-wrapper').forEach(e => e.style.pointerEvents = 'auto');
    for (const el of document.querySelectorAll('*')) {
      if (el.childNodes.length === 1 && el.textContent.trim() === '仅基础检测') { el.click(); break; }
    }
  });
  await W(12000);

  // 关键！勾选"是否使用AI" -> 点"是"
  console.log('[6] 勾选"是否使用AI"=是...');
  await page.evaluate(() => {
    document.querySelectorAll('.arco-modal-mask').forEach(e => e.style.display = 'none');
    document.querySelectorAll('.arco-modal-wrapper').forEach(e => e.style.pointerEvents = 'auto');
    // 找到"是否使用AI"那组 radio 里的"是"
    const labels = document.querySelectorAll('label.arco-radio');
    for (const label of labels) {
      if (label.textContent.trim() === '是') {
        label.click();
        console.log('点了"是"');
        break;
      }
    }
  });
  await W(2000);

  // 确认发布
  console.log('[7] 确认发布...');
  await page.evaluate(() => {
    document.querySelectorAll('.arco-modal-mask').forEach(e => e.remove());
    document.querySelectorAll('.arco-modal-wrapper').forEach(e => { e.style.pointerEvents = 'auto'; e.style.opacity = '1'; });
    const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === '确认发布');
    if (btn) { btn.click(); btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); }
  });
  await W(3000);
  try { await page.locator('button').filter({ hasText: /^确认发布$/ }).first().click({ force: true, timeout: 5000 }); } catch(e) {}
  await W(10000);

  await page.screenshot({ path: `/tmp/fanqie-ch${chapter}-final.png` });
  const text = await page.evaluate(() => document.body?.innerText?.substring(0, 300));
  console.log('URL:', page.url());
  console.log('预览:', text?.substring(0, 120));
  const ok = text?.includes('发布成功') || text?.includes('审核') || text?.includes('已提交');
  console.log(ok ? `🎉 第${chapter}章发布成功！` : `⚠️ 请检查远程桌面`);
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
