#!/usr/bin/env node

/**
 * 番茄小说章节发布器（安全版）
 * 默认只做本地预检；只有显式传入 --publish 才会点击“确认发布”。
 */

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright');

const args = process.argv.slice(2);
const chapter = Number.parseInt(args[0], 10);
const chapterTitle = args[1];
const contentFile = args[2];
const publish = args.includes('--publish');
const prepareOnly = args.includes('--prepare-only');
const dryRun = args.includes('--dry-run') || (!publish && !prepareOnly);
const scheduleArg = args.find((arg) => arg.startsWith('--schedule='));
const scheduleAt = scheduleArg ? scheduleArg.slice('--schedule='.length) : null;

const configCandidates = [path.resolve(process.cwd(), 'config.json'), path.resolve(__dirname, 'config.json')];
const configPath = configCandidates.find((candidate) => fs.existsSync(candidate));
const config = configPath ? JSON.parse(fs.readFileSync(configPath, 'utf8')) : {};
const CDP = process.env.CDP_PORT || String(config.cdp_port || '9333');
const BOOK_ID = process.env.BOOK_ID || config.book_id;
const MIN_CHARACTERS = Number(process.env.MIN_CHAPTER_CHARACTERS || config.min_chapter_characters || 1000);

function fail(message) {
  console.error(`❌ ${message}`);
  process.exit(1);
}

if (!Number.isInteger(chapter) || chapter < 1 || !chapterTitle || !contentFile) {
  fail('用法: node src/publish-chapter.js <章节号> <标题> <正文文件> [--dry-run|--prepare-only|--publish] [--schedule=YYYY-MM-DDTHH:mm]');
}
if (publish && prepareOnly) fail('--prepare-only 与 --publish 不能同时使用');
if (scheduleAt && dryRun) fail('--schedule 只能与 --prepare-only 或 --publish 一起使用');
if (!fs.existsSync(contentFile)) fail(`正文文件不存在: ${contentFile}`);

let scheduleDate = null;
let scheduleTime = null;
if (scheduleAt) {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})$/.exec(scheduleAt);
  if (!match) fail('--schedule 格式必须是 YYYY-MM-DDTHH:mm，例如 2026-09-17T07:05');
  [, scheduleDate, scheduleTime] = match;
  const candidate = new Date(`${scheduleAt}:00+08:00`);
  if (Number.isNaN(candidate.getTime())) fail(`无效的定时发布时间：${scheduleAt}`);
  const roundTrip = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(candidate).replace(' ', 'T');
  if (roundTrip !== scheduleAt) fail(`无效的定时发布时间：${scheduleAt}`);
}

const content = fs.readFileSync(contentFile, 'utf8')
  .replace(/^\uFEFF/, '')
  .replace(/^#{1,6}.*$/gm, '')
  .replace(/^\s*---\s*$/gm, '')
  .trim();
const nonWhitespaceCharacters = [...content.replace(/\s/g, '')].length;
const contentHash = crypto.createHash('sha256').update(content, 'utf8').digest('hex');

console.log(`第${chapter}章：${chapterTitle}`);
console.log(`非空白字符：${nonWhitespaceCharacters}`);
console.log(`正文 SHA-256：${contentHash}`);

if (nonWhitespaceCharacters < MIN_CHARACTERS) {
  fail(`正文不足预检门槛 ${MIN_CHARACTERS} 字；请先以番茄编辑器实际计数器复核`);
}
if (dryRun) {
  console.log('✅ 本地预检通过；未连接浏览器，未创建草稿，未发布。');
  process.exit(0);
}
if (!BOOK_ID) fail('未配置 book_id；请在仓库根 config.json 设置或传入 BOOK_ID');

const stateDir = path.resolve(process.cwd(), '.publish-state');
const ledgerPath = path.join(stateDir, `${BOOK_ID}.json`);
fs.mkdirSync(stateDir, { recursive: true });
const ledger = fs.existsSync(ledgerPath)
  ? JSON.parse(fs.readFileSync(ledgerPath, 'utf8'))
  : { bookId: String(BOOK_ID), chapters: {} };
const ledgerKey = String(chapter);
if (ledger.chapters[ledgerKey]?.sha256 === contentHash) fail(`账本显示第${chapter}章同一正文已发布，拒绝重复提交`);
if (ledger.chapters[ledgerKey]) fail(`账本已有第${chapter}章但正文哈希不同，需人工处理修订，拒绝覆盖`);

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const compactText = (value) => value.replace(/\s/g, '');
const paragraphs = content.split(/\r?\n\s*\r?\n+/).map((item) => item.trim()).filter(Boolean);
const shot = async (page, name) => {
  const target = path.join(os.tmpdir(), `fanqie-${name}.png`);
  await page.screenshot({ path: target, fullPage: true }).catch(() => {});
  console.log(`截图：${target}`);
};
const visibleButton = async (page, text) => {
  const candidates = page.getByRole('button', { name: text, exact: true });
  for (let index = 0; index < await candidates.count(); index += 1) {
    const candidate = candidates.nth(index);
    if (await candidate.isVisible().catch(() => false)) return candidate;
  }
  return null;
};
const visibleInputMatching = async (scope, pattern) => {
  const inputs = scope.locator('input');
  for (let index = 0; index < await inputs.count(); index += 1) {
    const input = inputs.nth(index);
    if (!(await input.isVisible().catch(() => false))) continue;
    const descriptor = [
      await input.getAttribute('placeholder').catch(() => ''),
      await input.getAttribute('aria-label').catch(() => ''),
      await input.getAttribute('type').catch(() => ''),
    ].join(' ');
    if (pattern.test(descriptor)) return input;
  }
  return null;
};

const configureSchedule = async (page) => {
  if (!scheduleAt) return;
  const scheduleLabel = page.getByText('定时发布', { exact: true }).first();
  if (!(await scheduleLabel.isVisible().catch(() => false))) fail('未找到“定时发布”设置');
  const scheduleForm = scheduleLabel.locator('xpath=ancestor::div[contains(concat(" ", normalize-space(@class), " "), " card-content-line ")][1]');
  if (!(await scheduleForm.count())) fail('无法定位“定时发布”表单容器');
  const settingsModal = scheduleLabel.locator('xpath=ancestor::div[contains(concat(" ", normalize-space(@class), " "), " arco-modal-content ")][1]');
  if (!(await settingsModal.count())) fail('无法定位定时发布所属的发布设置弹窗');
  const scheduleSwitch = scheduleForm.locator('[role="switch"], button.arco-switch, .arco-switch').first();
  if (!(await scheduleSwitch.isVisible().catch(() => false))) fail('未找到可见的定时发布开关');
  const isChecked = async () => {
    const aria = await scheduleSwitch.getAttribute('aria-checked').catch(() => null);
    const className = await scheduleSwitch.getAttribute('class').catch(() => '');
    return aria === 'true' || /checked/i.test(className || '');
  };
  if (!(await isChecked())) await scheduleSwitch.click();
  await wait(500);
  if (!(await isChecked())) fail('无法验证定时发布开关已开启');

  const dateInput = (await visibleInputMatching(scheduleForm, /日期|date/i))
    || (await visibleInputMatching(settingsModal, /日期|date/i));
  const timeInput = (await visibleInputMatching(scheduleForm, /时间|time/i))
    || (await visibleInputMatching(settingsModal, /时间|time/i));
  const resolvedDateInput = dateInput;
  const resolvedTimeInput = timeInput;
  if (!resolvedDateInput || !resolvedTimeInput) fail('定时发布表单没有可见的日期和时间输入框');
  await resolvedDateInput.fill(scheduleDate);
  await resolvedTimeInput.fill(scheduleTime);
  await page.keyboard.press('Escape').catch(() => {});
  const actualDate = await resolvedDateInput.inputValue();
  const actualTime = await resolvedTimeInput.inputValue();
  if (actualDate !== scheduleDate || actualTime !== scheduleTime) {
    fail(`定时发布时间回读失败：期望 ${scheduleDate} ${scheduleTime}，实际 ${actualDate} ${actualTime}`);
  }
  console.log(`定时发布回读通过：${actualDate} ${actualTime}`);
};

(async () => {
  let browser;
  try {
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${CDP}`, { timeout: 10000 });
    const context = browser.contexts()[0];
    if (!context) fail('CDP 浏览器没有可用上下文');
    const draftPage = context.pages().find((item) => item.url().includes(`/main/writer/${BOOK_ID}/publish/`));
    let page = draftPage ? await context.newPage() : context.pages().find((item) => item.url().includes('fanqienovel.com'));
    if (!page) page = await context.newPage();

    await page.goto('https://fanqienovel.com/main/writer/book-manage', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await wait(2000);
    const manageLink = page.locator(`a[href*="/chapter-manage/${BOOK_ID}"]`).first();
    if (!(await manageLink.count())) fail(`作品列表中找不到 book_id=${BOOK_ID} 的章节管理入口`);
    const manageHref = await manageLink.getAttribute('href');
    const manageUrl = new URL(manageHref, page.url()).href;
    await page.goto(manageUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await wait(3000);
    if (page.url().includes('login') || (await page.getByText('扫码登录', { exact: false }).count())) {
      fail('番茄登录已失效，请先在该 CDP 浏览器完成登录');
    }

    const existingText = await page.locator('body').innerText();
    const chapterPattern = new RegExp(`第\\s*${chapter}\\s*章`);
    if (chapterPattern.test(existingText) || existingText.includes(chapterTitle)) {
      await shot(page, `duplicate-ch${chapter}`);
      fail(`章节管理页已出现第${chapter}章或同名标题“${chapterTitle}”，拒绝重复发布`);
    }

    const publishUrl = `https://fanqienovel.com/main/writer/${BOOK_ID}/publish/?enter_from=newchapter_0`;
    if (draftPage) {
      await page.close();
      page = draftPage;
      await page.bringToFront();
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
    } else {
      await page.goto(publishUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    }
    await wait(3000);
    const serial = page.locator('input.serial-input').first();
    const title = page.locator('input[placeholder*="标题"]').first();
    const editor = page.locator('.serial-editor-content .syl-editor .ProseMirror[contenteditable="true"]').first();
    if (!(await serial.isVisible()) || !(await title.isVisible()) || !(await editor.isVisible())) {
      await shot(page, `form-missing-ch${chapter}`);
      fail('发布表单结构与预期不符，已停止；不会强制点击隐藏控件');
    }
    await serial.fill(String(chapter));
    await title.fill(chapterTitle);
    await editor.click({ position: { x: 120, y: 120 } });
    await page.keyboard.press('Control+A');
    await page.keyboard.press('Backspace');
    for (let index = 0; index < paragraphs.length; index += 1) {
      await page.keyboard.type(paragraphs[index], { delay: 0 });
      if (index + 1 < paragraphs.length) await page.keyboard.press('Enter');
    }

    const serialReadback = await serial.inputValue();
    const titleReadback = await title.inputValue();
    const contentReadback = await editor.innerText();
    if (serialReadback !== String(chapter)) fail(`章节号回读失败：期望 ${chapter}，实际 ${serialReadback}`);
    if (titleReadback !== chapterTitle) fail(`标题回读失败：期望“${chapterTitle}”，实际“${titleReadback}”`);
    if (compactText(contentReadback) !== compactText(content)) {
      await shot(page, `content-mismatch-ch${chapter}`);
      fail(`正文回读不一致：期望 ${compactText(content).length} 字，实际 ${compactText(contentReadback).length} 字`);
    }
    const renderedParagraphs = await editor.locator(':scope > *').allInnerTexts();
    const internalBlankParagraph = renderedParagraphs.slice(0, -1).some((value) => !value.trim());
    if (internalBlankParagraph) {
      await shot(page, `blank-paragraph-ch${chapter}`);
      fail('正文中检测到多余空段；请保持每个逻辑段落之间仅一次回车');
    }
    console.log(`发布前回读通过：第${serialReadback}章 / ${titleReadback} / ${compactText(contentReadback).length}字`);

    const next = await visibleButton(page, '下一步');
    if (!next || !(await next.isEnabled())) fail('“下一步”不可用，未继续');
    await next.click();
    await wait(3000);
    const submit = await visibleButton(page, '提交');
    if (submit && (await submit.isEnabled())) {
      await submit.click();
      await wait(3000);
    }

    const aiLabel = page.getByText('是否使用AI', { exact: false }).first();
    if (!(await aiLabel.isVisible().catch(() => false))) fail('未找到“是否使用AI”表单，拒绝猜测默认值');
    const aiForm = aiLabel.locator('xpath=ancestor::div[contains(concat(" ", normalize-space(@class), " "), " card-content-line ")][1]');
    if (!(await aiForm.count())) fail('无法定位“是否使用AI”表单容器');
    const aiYes = aiForm.locator('label.arco-radio').filter({ hasText: /^是$/ }).first();
    if (!(await aiYes.isVisible().catch(() => false))) fail('“是否使用AI”表单中没有可见的“是”选项');
    await aiYes.click();
    const checkedRadio = aiForm.locator('input[type="radio"]:checked');
    const checkedLabel = aiYes.locator('xpath=ancestor::label[1]');
    const checkedByClass = (await checkedLabel.getAttribute('class').catch(() => ''))?.includes('checked');
    const checkedByAria = (await aiYes.getAttribute('aria-checked').catch(() => null)) === 'true';
    if (!(await checkedRadio.count()) && !checkedByClass && !checkedByAria) {
      await shot(page, `ai-not-selected-ch${chapter}`);
      fail('无法验证“是否使用AI=是”已选中');
    }
    console.log('AI 声明回读通过：是');

    await configureSchedule(page);

    const confirm = await visibleButton(page, '确认发布');
    if (!confirm || !(await confirm.isEnabled())) {
      await shot(page, `confirm-disabled-ch${chapter}`);
      fail('“确认发布”不存在或不可用，未绕过页面校验');
    }
    await shot(page, `before-publish-ch${chapter}`);
    if (prepareOnly) {
      console.log(`✅ 第${chapter}章已填写并通过回读，停在“确认发布”前；未点击发布。`);
      process.exit(0);
    }
    await confirm.click();
    await wait(8000);

    await page.goto(manageUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await wait(3000);
    const resultText = await page.locator('body').innerText();
    if (!chapterPattern.test(resultText) && !resultText.includes(chapterTitle)) {
      await shot(page, `unverified-ch${chapter}`);
      fail('提交后无法在章节管理页验证章号/标题，未记为成功');
    }
    if (scheduleAt && (!resultText.includes(scheduleDate) || !resultText.includes(scheduleTime))) {
      await shot(page, `schedule-unverified-ch${chapter}`);
      fail(`章节已出现，但无法在章节管理页验证定时发布时间 ${scheduleDate} ${scheduleTime}，未记为成功`);
    }

    ledger.chapters[ledgerKey] = {
      title: chapterTitle,
      sha256: contentHash,
      publishAt: scheduleAt ? `${scheduleAt}:00+08:00` : null,
      verifiedAt: new Date().toISOString(),
    };
    fs.writeFileSync(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`, 'utf8');
    await shot(page, `verified-ch${chapter}`);
    console.log(`✅ 第${chapter}章已在章节管理页验证，并写入本地账本。`);
  } finally {
    await browser?.close().catch(() => {});
  }
})().catch((error) => fail(error.stack || error.message));
