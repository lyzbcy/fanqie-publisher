#!/usr/bin/env node

/**
 * Fanqie Chapter Publisher - 番茄小说章节自动发布
 *
 * 设计原则：零硬编码CSS选择器，全部通过可见文本定位按钮/元素
 * 这样不管番茄小说怎么改版改CSS，只要按钮文字不变就能用
 *
 * 用法：
 *   node publish-chapter.js <章节号> <标题> <内容文件.md>
 *   CDP_PORT=9333 BOOK_ID=xxx node publish-chapter.js 7 '标题' /tmp/ch7.md
 *
 * @author lyzbcy
 * @license MIT
 */

const { chromium } = require('/root/.openclaw/douyin-creator-tools/node_modules/playwright');
const fs = require('fs');
const path = require('path');

// ─── 配置 ───────────────────────────────────────────
const configPath = path.resolve(__dirname, 'config.json');
const config = fs.existsSync(configPath) ? JSON.parse(fs.readFileSync(configPath, 'utf-8')) : {};
const CDP = process.env.CDP_PORT || String(config.cdp_port || '9333');
const BOOK_ID = process.env.BOOK_ID || config.book_id;

// ─── 参数 ───────────────────────────────────────────
const chapter = parseInt(process.argv[2]);
const chapterTitle = process.argv[3];
const contentFile = process.argv[4];

if (!BOOK_ID) {
  console.error('❌ 未配置 book_id，请在 config.json 中设置或通过 BOOK_ID 环境变量传入');
  process.exit(1);
}
if (!chapter || !chapterTitle || !contentFile) {
  console.error('❌ 用法: node publish-chapter.js <章节号> <标题> <内容文件>');
  process.exit(1);
}

// 清理内容：去掉markdown标题和分隔线
const content = fs.readFileSync(contentFile, 'utf-8')
  .replace(/^#.*$/gm, '')
  .replace(/^---$/gm, '')
  .trim();

const W = (ms) => new Promise(r => setTimeout(r, ms));

// ─── 工具函数 ───────────────────────────────────────

/**
 * 截图保存（调试用）
 */
async function debugScreenshot(page, name) {
  const p = `/tmp/fanqie-debug-${name}.png`;
  await page.screenshot({ path: p }).catch(() => {});
  console.log(`  📸 截图: ${p}`);
}

/**
 * 通过按钮文字点击按钮（遍历所有按钮，找文本完全匹配的可见按钮）
 * 不依赖任何CSS class名，只看按钮上显示的文字
 */
async function clickButtonByText(page, text, { timeout = 5000, force = false } = {}) {
  const buttons = await page.locator('button').all();
  for (const btn of buttons) {
    const btnText = (await btn.textContent().catch(() => '')).trim();
    const visible = await btn.isVisible().catch(() => false);
    if (btnText === text && visible) {
      await btn.click({ force: true, timeout });
      return true;
    }
  }
  // 如果没找到可见的，试试force click隐藏的
  for (const btn of buttons) {
    const btnText = (await btn.textContent().catch(() => '')).trim();
    if (btnText === text) {
      await btn.click({ force: true, timeout });
      return true;
    }
  }
  return false;
}

/**
 * 处理arco-modal遮罩问题
 * 番茄小说用Arco Design的弹窗系统，确认按钮经常被modal-mask遮住
 * 这里不是"硬编码坐标"，而是移除遮挡层让按钮可以点击
 */
async function removeModalOverlays(page) {
  await page.evaluate(() => {
    // 隐藏遮罩层（半透明黑色背景）
    document.querySelectorAll('.arco-modal-mask').forEach(el => {
      el.style.display = 'none';
    });
    // 恢复弹窗容器的点击事件
    document.querySelectorAll('.arco-modal-wrapper').forEach(el => {
      el.style.pointerEvents = 'auto';
      el.style.opacity = '1';
    });
  });
}

/**
 * 强制点击指定文字的按钮（处理一切遮挡问题）
 * 用evaluate在JS层面直接触发click，绕过所有CSS遮挡
 */
async function forceClickButton(page, text) {
  const clicked = await page.evaluate((btnText) => {
    const buttons = document.querySelectorAll('button');
    for (const btn of buttons) {
      if (btn.textContent.trim() === btnText) {
        // 先移除遮挡
        document.querySelectorAll('.arco-modal-mask').forEach(el => el.remove());
        document.querySelectorAll('.arco-modal-wrapper').forEach(el => {
          el.style.pointerEvents = 'auto';
          el.style.opacity = '1';
        });
        // 多种方式确保点击生效
        btn.click();
        btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        return true;
      }
    }
    return false;
  }, text);
  return clicked;
}

/**
 * 等待页面稳定（URL变化或特定文字出现）
 */
async function waitForPageStable(page, { timeout = 10000 } = {}) {
  const url = page.url();
  const start = Date.now();
  while (Date.now() - start < timeout) {
    await W(1000);
    if (page.url() !== url) return true;
  }
  return false;
}

// ─── 主流程 ─────────────────────────────────────────

(async () => {
  console.log(`🍅 番茄小说章节发布器 v2.0`);
  console.log(`   第${chapter}章: ${chapterTitle}`);
  console.log(`   字数: ${content.length}`);
  console.log(`   CDP端口: ${CDP}`);
  console.log(`   作品ID: ${BOOK_ID}`);
  console.log('');

  // ── 连接浏览器 ──
  console.log('[1/8] 连接Chrome...');
  let browser;
  try {
    browser = await chromium.connectOverCDP(`http://localhost:${CDP}`, { timeout: 10000 });
  } catch (e) {
    console.error(`❌ 连接Chrome失败(CDP:${CDP}): ${e.message}`);
    console.error('   请确保Chrome已启动（见SKILL.md步骤1）');
    process.exit(1);
  }
  const ctx = browser.contexts()[0];
  if (!ctx) {
    console.error('❌ 没有找到浏览器上下文');
    process.exit(1);
  }

  // 关闭旧的发布页面
  for (const p of ctx.pages()) {
    if (p.url().includes('/publish/')) await p.close().catch(() => {});
  }

  // 找到或创建页面
  let page = ctx.pages().find(p => p.url().includes('fanqienovel.com'));
  if (!page) page = await ctx.newPage();

  // ── 打开发布页 ──
  console.log('[2/8] 打开发布页...');
  const publishUrl = `https://fanqienovel.com/main/writer/${BOOK_ID}/publish/?enter_from=newchapter_0`;
  await page.goto(publishUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
  await W(5000);

  // 检查登录态
  if (page.url().includes('login')) {
    console.error('❌ 登录已过期，需要通过noVNC重新扫码登录');
    await debugScreenshot(page, 'login-expired');
    process.exit(1);
  }

  // ── 填写章节号 ──
  console.log('[3/8] 填写内容...');

  // 章节号输入框：找placeholder包含"章节"或class包含"serial"的input
  const serialInput = page.locator('input').filter({ hasText: '' }).first();
  let serialFilled = false;

  // 方式1：通过class名尝试（serial-input是番茄特有的）
  try {
    const si = page.locator('input.serial-input').first();
    if (await si.isVisible({ timeout: 2000 }).catch(() => false)) {
      await si.click({ force: true });
      await si.fill(String(chapter));
      serialFilled = true;
      console.log('  ✅ 章节号已填');
    }
  } catch (e) {}

  // 方式2：如果方式1失败，找所有input，看哪个在"下一步"按钮附近
  if (!serialFilled) {
    const inputs = await page.locator('input[type="text"], input:not([type])').all();
    for (const inp of inputs) {
      const ph = await inp.getAttribute('placeholder').catch(() => '');
      const cls = await inp.getAttribute('class').catch(() => '');
      // 章节号输入框通常没有placeholder或placeholder为空
      if (!ph && cls.includes('serial')) {
        await inp.click({ force: true });
        await inp.fill(String(chapter));
        serialFilled = true;
        console.log('  ✅ 章节号已填(fallback)');
        break;
      }
    }
  }

  if (!serialFilled) {
    console.error('❌ 找不到章节号输入框');
    await debugScreenshot(page, 'no-serial-input');
    process.exit(1);
  }

  await W(500);

  // ── 填写标题 ──
  // 标题输入框：找placeholder包含"标题"的input
  const titleInput = page.locator('input[placeholder="请输入标题"]').first();
  if (await titleInput.isVisible({ timeout: 3000 }).catch(() => false)) {
    await titleInput.click({ force: true });
    await titleInput.fill(chapterTitle);
    console.log('  ✅ 标题已填');
  } else {
    // fallback：找placeholder含"标题"的input
    const allInputs = await page.locator('input').all();
    let found = false;
    for (const inp of allInputs) {
      const ph = await inp.getAttribute('placeholder').catch(() => '');
      if (ph && ph.includes('标题')) {
        await inp.click({ force: true });
        await inp.fill(chapterTitle);
        found = true;
        console.log('  ✅ 标题已填(fallback)');
        break;
      }
    }
    if (!found) {
      console.error('❌ 找不到标题输入框');
      await debugScreenshot(page, 'no-title-input');
      process.exit(1);
    }
  }

  await W(500);

  // ── 填写正文 ──
  // 正文编辑器：找可见的ProseMirror div（通用富文本编辑器框架）
  let contentFilled = false;

  // 方式1：ProseMirror
  try {
    const editor = page.locator('div.ProseMirror').first();
    if (await editor.isVisible({ timeout: 3000 }).catch(() => false)) {
      await editor.click({ force: true });
      await W(200);
      await page.keyboard.type(content, { delay: 0 });
      contentFilled = true;
      console.log('  ✅ 正文已填(ProseMirror)');
    }
  } catch (e) {}

  // 方式2：contenteditable div
  if (!contentFilled) {
    try {
      const editor = page.locator('div[contenteditable="true"]').first();
      if (await editor.isVisible({ timeout: 3000 }).catch(() => false)) {
        await editor.click({ force: true });
        await W(200);
        await page.keyboard.type(content, { delay: 0 });
        contentFilled = true;
        console.log('  ✅ 正文已填(contenteditable)');
      }
    } catch (e) {}
  }

  if (!contentFilled) {
    console.error('❌ 找不到正文编辑器');
    await debugScreenshot(page, 'no-editor');
    process.exit(1);
  }

  await W(3000);

  // ── 验证填写 ──
  console.log('[4/8] 验证填写...');
  const serialVal = await page.evaluate(() => {
    const inp = document.querySelector('input.serial-input');
    return inp ? inp.value : '';
  }).catch(() => '');
  const titleVal = await page.evaluate(() => {
    const inp = document.querySelector('input[placeholder="请输入标题"]');
    return inp ? inp.value : '';
  }).catch(() => '');

  if (!serialVal) {
    console.error('❌ 章节号未正确填入');
    await debugScreenshot(page, 'serial-empty');
    process.exit(1);
  }
  console.log(`  章节: ${serialVal}, 标题: ${titleVal || chapterTitle}`);

  // ── 点"下一步" ──
  console.log('[5/8] 点击下一步...');
  await removeModalOverlays(page);
  const nextClicked = await clickButtonByText(page, '下一步', { timeout: 5000 });
  if (!nextClicked) {
    console.error('❌ 找不到"下一步"按钮');
    await debugScreenshot(page, 'no-next-btn');
    process.exit(1);
  }
  await W(12000);

  // ── 处理错别字弹窗 ──
  console.log('[6/8] 处理弹窗...');
  await removeModalOverlays(page);
  await W(1000);

  // 尝试点"提交"按钮（错别字检测弹窗）
  const submitted = await clickButtonByText(page, '提交');
  if (submitted) {
    console.log('  📝 点了"提交"（错别字检测）');
    await W(12000);

    // 处理"仅基础检测"选项
    await removeModalOverlays(page);
    const basicCheck = await page.evaluate(() => {
      // 找文字为"仅基础检测"的可点击元素
      const all = document.querySelectorAll('span, div, a, label, li');
      for (const el of all) {
        if (el.textContent.trim() === '仅基础检测' && el.offsetParent !== null) {
          el.click();
          return true;
        }
      }
      return false;
    });
    if (basicCheck) {
      console.log('  ✅ 选了"仅基础检测"');
      await W(12000);
    }
  } else {
    console.log('  ℹ️ 无错别字弹窗，继续');
  }

  // ── 勾选"是否使用AI" ──
  console.log('[7/8] 发布设置...');
  await removeModalOverlays(page);
  await W(1000);

  // 找radio组里的"是"（"是否使用AI"选项）
  const aiSelected = await page.evaluate(() => {
    // 方法1：找arco-radio组件
    const radios = document.querySelectorAll('label.arco-radio');
    for (const radio of radios) {
      if (radio.textContent.trim() === '是') {
        radio.click();
        return true;
      }
    }
    // 方法2：找所有可点击元素中文字为"是"的
    const all = document.querySelectorAll('span, label, div');
    for (const el of all) {
      if (el.textContent.trim() === '是' && el.offsetParent !== null) {
        // 确保附近有"AI"相关文字
        const parent = el.closest('.arco-form-item, .arco-modal, div[class]');
        if (parent && parent.textContent.includes('AI')) {
          el.click();
          return true;
        }
      }
    }
    return false;
  });

  if (aiSelected) {
    console.log('  ✅ "是否使用AI"已选"是"');
  } else {
    console.log('  ⚠️ 未找到"是否使用AI"选项（可能已默认或无需选择）');
  }

  await W(2000);

  // ── 确认发布 ──
  console.log('[8/8] 确认发布...');
  await removeModalOverlays(page);
  await W(500);

  // 先尝试常规点击
  let confirmClicked = await clickButtonByText(page, '确认发布');
  if (!confirmClicked) {
    // 用force方式（绕过一切遮挡）
    confirmClicked = await forceClickButton(page, '确认发布');
  }

  if (!confirmClicked) {
    console.error('❌ 找不到"确认发布"按钮');
    await debugScreenshot(page, 'no-confirm-btn');
    process.exit(1);
  }

  await W(3000);

  // Playwright层面再补点一次（双保险）
  try {
    const confirmBtn = page.locator('button').filter({ hasText: /^确认发布$/ }).first();
    await confirmBtn.click({ force: true, timeout: 3000 });
  } catch (e) {}

  await W(10000);

  // ── 验证结果 ──
  await debugScreenshot(page, `ch${chapter}-result`);

  const pageText = await page.evaluate(() => document.body?.innerText?.substring(0, 500) || '');
  const currentUrl = page.url();

  console.log('');
  console.log('═══════════════════════════════════════');
  console.log(`   URL: ${currentUrl}`);
  console.log(`   页面文字(前100字): ${pageText.substring(0, 100)}`);

  const success = pageText.includes('发布成功') || pageText.includes('审核') ||
                  pageText.includes('已提交') || currentUrl.includes('chapter-manage');

  if (success) {
    console.log(`   🎉 第${chapter}章「${chapterTitle}」发布成功！`);
  } else {
    console.log(`   ⚠️ 发布状态不确定，请检查截图或远程桌面`);
  }
  console.log('═══════════════════════════════════════');

  process.exit(success ? 0 : 1);

})().catch(e => {
  console.error('❌ 错误:', e.message);
  process.exit(1);
});
