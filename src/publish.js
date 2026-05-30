#!/usr/bin/env node

/**
 * Fanqie Publisher - 番茄小说自动发布脚本
 * 
 * 通过 Playwright + CDP 连接已有 Chrome 实例，自动发布短故事到番茄小说
 * 
 * 用法:
 *   node publish.js --title "标题" --content "正文"
 *   node publish.js --diary /path/to/diary.md
 *   node publish.js --diary /path/to/diary.md --title "自定义标题"
 * 
 * @author lyzbcy
 * @license MIT
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const CDP_URL = 'http://localhost:9333';
const FANQIE_SHORT_MANAGE = 'https://fanqienovel.com/main/writer/short-manage';
const TIMEOUT = 15000;

// 默认分类
const DEFAULT_CATEGORIES = ['其他'];

/**
 * 解析命令行参数
 */
function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { title: '', content: '', diary: '', categories: DEFAULT_CATEGORIES };
  
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--title' && args[i + 1]) opts.title = args[++i];
    if (args[i] === '--content' && args[i + 1]) opts.content = args[++i];
    if (args[i] === '--diary' && args[i + 1]) opts.diary = args[++i];
    if (args[i] === '--categories' && args[i + 1]) opts.categories = args[++i].split(',');
  }
  
  // 如果指定了日记文件，从中读取
  if (opts.diary && fs.existsSync(opts.diary)) {
    const raw = fs.readFileSync(opts.diary, 'utf-8');
    
    // 如果没有指定标题，从文件名或内容中提取
    if (!opts.title) {
      const dateMatch = path.basename(opts.diary).match(/(\d{4}-\d{2}-\d{2})/);
      const date = dateMatch ? dateMatch[1] : new Date().toISOString().split('T')[0];
      // 判断是早安还是晚间
      const isEvening = opts.diary.includes('evening');
      opts.title = `${opts.diary_prefix || 'AI日记'}·${date}${isEvening ? '·夜篇' : ''}`;
    }
    
    if (!opts.content) {
      opts.content = convertDiaryToStory(raw);
    }
  }
  
  return opts;
}

/**
 * 将日记内容转换为短故事格式
 */
function convertDiaryToStory(diaryText) {
  // 移除 markdown 标题标记，保留文本
  let story = diaryText
    .replace(/^#.*$/gm, '') // 去掉标题行
    .replace(/^---$/gm, '')  // 去掉分隔线
    .replace(/^\*.*\*$/gm, '') // 去掉斜体署名行
    .trim();
  
  // 如果内容太长，截取前2000字
  if (story.length > 2000) {
    story = story.substring(0, 2000) + '\n\n——未完待续——';
  } else {
    story += '\n\n——未完待续——';
  }
  
  return story;
}

/**
 * 主发布流程
 */
async function publish(opts) {
  console.log('🍅 番茄小说自动发布器启动');
  console.log(`   标题: ${opts.title}`);
  console.log(`   字数: ${opts.content.length}`);
  
  // 验证
  if (!opts.title || !opts.content) {
    console.error('❌ 缺少标题或内容');
    process.exit(1);
  }
  
  if (opts.content.length < 100) {
    console.error('❌ 内容太短，至少需要100字');
    process.exit(1);
  }
  
  let browser;
  try {
    // 连接 Chrome
    console.log('🔌 连接 Chrome (CDP:9333)...');
    browser = await chromium.connectOverCDP(CDP_URL);
    const contexts = browser.contexts();
    const pages = contexts[0].pages();
    
    // 找到或创建短故事管理页
    let page = pages.find(p => p.url().includes('fanqienovel.com'));
    if (!page) {
      page = await contexts[0].newPage();
    }
    
    // Step 1: 进入短故事管理页
    console.log('📖 进入短故事管理页...');
    await page.goto(FANQIE_SHORT_MANAGE, { waitUntil: 'networkidle', timeout: TIMEOUT });
    await page.waitForTimeout(2000);
    
    // Step 2: 点击新建短故事
    console.log('✨ 点击新建短故事...');
    await page.getByText('新建短故事', { exact: true }).click({ timeout: TIMEOUT });
    await page.waitForTimeout(3000);
    
    // 切换到新打开的标签页
    const allPages = contexts[0].pages();
    page = allPages[allPages.length - 1];
    await page.waitForLoadState('networkidle', { timeout: TIMEOUT }).catch(() => {});
    await page.waitForTimeout(2000);
    
    console.log(`   编辑页URL: ${page.url()}`);
    
    // Step 3: 填写标题
    console.log('📝 填写标题...');
    const titleArea = page.locator('textarea.byte-textarea');
    await titleArea.fill(opts.title);
    await page.waitForTimeout(1000);
    
    // Step 4: 填写正文
    console.log('📝 填写正文...');
    const contentArea = page.locator('div.ProseMirror');
    await contentArea.click();
    await page.waitForTimeout(500);
    await contentArea.fill(opts.content);
    await page.waitForTimeout(2000);
    
    // Step 5: 选择分类 - 点击分类选择器
    console.log('🏷️ 选择分类...');
    await page.getByText('请选择作品分类').first().click().catch(() => {
      console.log('   分类已选择或选择器不可用，跳过');
    });
    await page.waitForTimeout(1000);
    
    // 选择"其他"分类
    for (const cat of opts.categories) {
      await page.getByText(cat, { exact: true }).first().click().catch(() => {});
      await page.waitForTimeout(500);
    }
    console.log(`   分类: ${opts.categories.join(', ')}`);
    
    // 关闭可能的弹窗
    await page.keyboard.press('Escape');
    await page.waitForTimeout(1000);
    
    // Step 6: 同意发布协议（如果有弹窗）
    console.log('📋 处理发布协议...');
    await page.evaluate(() => {
      const btn = document.querySelector('.publish-short-license-modal-button');
      if (btn) btn.click();
    });
    await page.waitForTimeout(2000);
    
    // Step 7: 存草稿
    console.log('💾 保存草稿...');
    await page.evaluate(() => {
      const btn = document.querySelector('.short-publish-save-draft-btn');
      if (btn) btn.click();
    });
    await page.waitForTimeout(3000);
    console.log('   草稿已保存');
    
    // Step 8: 点击下一步
    console.log('⏭️ 点击下一步...');
    const nextBtns = await page.locator('button').filter({ hasText: '下一步' }).all();
    for (const btn of nextBtns) {
      if (await btn.isVisible().catch(() => false)) {
        await btn.click();
        break;
      }
    }
    await page.waitForTimeout(5000);
    
    // Step 9: 处理发布提示弹窗 - 点击继续发布
    console.log('📢 处理发布提示...');
    await page.evaluate(() => {
      const btns = document.querySelectorAll('button');
      for (const b of btns) {
        if (b.innerText.trim() === '继续发布') {
          b.click();
          return;
        }
      }
    });
    await page.waitForTimeout(3000);
    
    // Step 10: 解除弹窗遮挡（关键！）
    console.log('🔓 解除弹窗遮挡...');
    await page.evaluate(() => {
      // 隐藏所有 modal 遮罩
      document.querySelectorAll('.arco-modal-mask').forEach(el => el.style.display = 'none');
      // 移除所有 wrapper 的 pointer-events
      document.querySelectorAll('.arco-modal-wrapper').forEach(el => el.style.pointerEvents = 'none');
    });
    await page.waitForTimeout(500);
    
    // Step 11: 恢复确认按钮所在 wrapper 并点击
    console.log('✅ 确认发布...');
    await page.evaluate(() => {
      const btns = document.querySelectorAll('button');
      for (const b of btns) {
        if (b.innerText.trim() === '确定' && b.offsetParent !== null) {
          // 恢复按钮所在 wrapper 的 pointer-events
          const wrapper = b.closest('.arco-modal-wrapper');
          if (wrapper) wrapper.style.pointerEvents = 'auto';
          b.click();
          return;
        }
      }
    });
    await page.waitForTimeout(5000);
    
    // Step 11: 检查结果
    const resultText = await page.evaluate(() => document.body.innerText);
    if (resultText.includes('发布成功')) {
      console.log('🎉 发布成功！已提交审核');
      return true;
    } else if (resultText.includes('已保存') || resultText.includes('存草稿')) {
      console.log('💾 已保存为草稿（可能需要手动发布）');
      return false;
    } else {
      console.log('⚠️ 发布状态不确定，请手动检查');
      // 截图以供调试
      await page.screenshot({ path: '/tmp/fanqie-publish-result.png' });
      return false;
    }
    
  } catch (error) {
    console.error('❌ 发布失败:', error.message);
    return false;
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

// 运行
const opts = parseArgs();
publish(opts).then(success => {
  process.exit(success ? 0 : 1);
}).catch(e => {
  console.error('Fatal:', e);
  process.exit(1);
});
