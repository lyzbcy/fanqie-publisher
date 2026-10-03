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
const { mergeVolumeRows, requireVolume, isSubmissionRejection, manageVolumeSelector, captureThenCommit } = require('./volume-sequence.cjs');

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
const VOLUME_NAME = config.volume_name || null;

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
const manifestPath = path.join(path.dirname(path.resolve(contentFile)), 'manifest.json');
const manifest = fs.existsSync(manifestPath)
  ? JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  : null;
const manifestChapter = manifest?.chapters?.find((item) => item.chapter === chapter);
const manifestPrevious = manifest?.chapters?.find((item) => item.chapter === chapter - 1);

console.log(`第${chapter}章：${chapterTitle}`);
console.log(`非空白字符：${nonWhitespaceCharacters}`);
console.log(`正文 SHA-256：${contentHash}`);

if (nonWhitespaceCharacters < MIN_CHARACTERS) {
  fail(`正文不足预检门槛 ${MIN_CHARACTERS} 字；请先以番茄编辑器实际计数器复核`);
}
if (manifest && (!manifestChapter
  || manifestChapter.title !== chapterTitle
  || manifestChapter.filename !== path.basename(contentFile)
  || manifestChapter.sha256 !== contentHash)) {
  fail(`第${chapter}章与 manifest.json 不一致，拒绝继续`);
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
if (!manifest || !manifestChapter || (chapter > 1 && !manifestPrevious)) {
  fail('联网发布必须使用同目录 manifest.json，并能定位当前章与前一章');
}
for (let expected = 1; expected < chapter; expected += 1) {
  const prior = ledger.chapters[String(expected)];
  const expectedManifest = manifest.chapters.find((item) => item.chapter === expected);
  if (!prior) fail(`本地账本缺少第${expected}章；拒绝跳到第${chapter}章`);
  if (!expectedManifest || prior.title !== expectedManifest.title || prior.sha256 !== expectedManifest.sha256) {
    fail(`本地账本第${expected}章与清单不一致；拒绝继续发布`);
  }
}
const futureLedgerChapter = Object.keys(ledger.chapters)
  .map((value) => Number.parseInt(value, 10))
  .find((value) => Number.isInteger(value) && value > chapter);
if (futureLedgerChapter) fail(`本地账本已存在更后的第${futureLedgerChapter}章；序列异常，拒绝继续`);

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const compactText = (value) => value.replace(/\s/g, '');
const paragraphs = content.split(/\r?\n\s*\r?\n+/).map((item) => item.trim()).filter(Boolean);
const shot = async (page, name) => {
  const target = path.join(os.tmpdir(), `fanqie-${name}.png`);
  await page.bringToFront();
  try {
    await page.screenshot({ path: target, fullPage: false, timeout: 10000 });
  } catch (error) {
    console.log(`截图首次超时，重试当前可见页面：${error.message.split('\n')[0]}`);
    await page.waitForTimeout(1000);
    await page.screenshot({ path: target, fullPage: false, timeout: 10000 });
  }
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
const parseChapterHeading = (value) => {
  const match = /^第\s*(\d+)\s*章\s*(.+)$/s.exec(value.replace(/\s+/g, ' ').trim());
  if (!match) return null;
  return { chapter: Number.parseInt(match[1], 10), title: match[2].trim() };
};
const selectManageVolume = async (page, name) => {
  const selector = await manageVolumeSelector(page);
  if ((await selector.locator('.byte-select-view-value').innerText()).trim() !== name) {
    await selector.click();
    const option = page.locator('.chapter-select-option').filter({ hasText: name });
    if (await option.count() !== 1 || (await option.innerText()).trim() !== name) fail(`无法唯一选择分卷 ${name}`);
    await option.click();
    await wait(1200);
  }
  if ((await selector.locator('.byte-select-view-value').innerText()).trim() !== name) fail('分卷回读不一致');
};
const readCurrentPublishedRows = async (page, volumeName = null) => {
  const result = [];
  const rows = page.locator('tbody tr');
  for (let index = 0; index < await rows.count(); index += 1) {
    const cells = rows.nth(index).locator('td');
    if (await cells.count() < 5) continue;
    const parsed = parseChapterHeading(await cells.nth(0).innerText().catch(() => ''));
    if (!parsed) continue;
    result.push({
      ...parsed,
      volumeName,
      status: (await cells.nth(3).innerText().catch(() => '')).replace(/\s+/g, ' ').trim(),
      rowText: (await rows.nth(index).innerText().catch(() => '')).replace(/\s+/g, ' ').trim(),
      previewHref: await cells.nth(0).locator('a').first().getAttribute('href').catch(() => null),
    });
  }
  return result;
};
const readPublishedRows = async (page) => {
  if (!VOLUME_NAME) return readCurrentPublishedRows(page);
  await (await manageVolumeSelector(page)).click();
  const names = (await page.locator('.chapter-select-option').allInnerTexts()).map(value => value.trim());
  await page.keyboard.press('Escape');
  if (!names.includes(VOLUME_NAME)) fail(`后台不存在目标分卷 ${VOLUME_NAME}`);
  const result = [];
  for (const name of names) {
    await selectManageVolume(page, name);
    result.push(...await readCurrentPublishedRows(page, name));
  }
  await selectManageVolume(page, VOLUME_NAME);
  return mergeVolumeRows(result);
};
const configureVolume = async (page) => {
  if (!VOLUME_NAME) return;
  const header = page.locator('.publish-header-volume-name');
  if (!(await header.isVisible())) fail('编辑器缺少可回读分卷');
  if ((await header.innerText()).trim() !== VOLUME_NAME) {
    await header.click();
    const modal = page.locator('.editor-volume.byte-modal');
    const item = modal.locator('.editor-volume-list-item-normal').filter({ hasText: VOLUME_NAME });
    if (await item.count() !== 1) fail('目标分卷不存在或不唯一');
    await item.locator('span').click();
    if (!(await item.getAttribute('class')).includes('selected')) fail('目标分卷未选中');
    const confirm = modal.locator('button').filter({ hasText: /^确定$/ });
    if (!(await confirm.isEnabled())) fail('分卷确认不可用');
    await confirm.click();
  }
  if ((await header.innerText()).trim() !== VOLUME_NAME) fail('编辑器分卷回读不一致');
  console.log(`分卷回读通过：${VOLUME_NAME}`);
};
const verifyPublishedPreview = async (page, item) => {
  if (!item.previewHref) fail(`第${item.chapter}章缺少后台预览入口，无法核对正文`);
  const preview = await page.context().newPage();
  try {
    await preview.goto(new URL(item.previewHref, page.url()).href, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await wait(2000);
    const previewText = compactText(await preview.locator('body').innerText());
    if (!previewText.includes(compactText(content))) {
      fail(`后台第${item.chapter}章预览正文与本地文件不一致，拒绝补账本或继续下一章`);
    }
  } finally {
    await preview.close().catch(() => {});
  }
};
const findTargetDraftUrl = async (page, manageUrl) => {
  await page.goto(manageUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await wait(2000);
  const draftTab = page.getByText('草稿箱', { exact: true }).first();
  if (!(await draftTab.isVisible().catch(() => false))) return null;
  await draftTab.click();
  await wait(1500);
  const matches = [];
  const rows = page.locator('tbody tr');
  for (let index = 0; index < await rows.count(); index += 1) {
    const row = rows.nth(index);
    const cells = row.locator('td');
    if (await cells.count() !== 4) continue;
    const parsed = parseChapterHeading(await cells.nth(0).innerText().catch(() => ''));
    if (!parsed || parsed.chapter !== chapter) continue;
    const editLink = row.locator(`a[href*="/main/writer/${BOOK_ID}/publish/"]`).first();
    matches.push({ ...parsed, href: await editLink.getAttribute('href').catch(() => null) });
  }
  if (matches.some((item) => item.title !== chapterTitle)) {
    fail(`草稿箱存在第${chapter}章但标题不是“${chapterTitle}”；拒绝覆盖或跳章`);
  }
  if (matches.length > 1) fail(`草稿箱存在多个第${chapter}章草稿；拒绝猜测使用哪一个`);
  if (!matches.length) return null;
  if (!matches[0].href) fail(`第${chapter}章草稿缺少可验证的编辑入口`);
  return new URL(matches[0].href, page.url()).href;
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
    let page = context.pages().find((item) => item.url().includes('fanqienovel.com'));
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

    const publishedRows = await readPublishedRows(page);
    const chapterPattern = new RegExp(`第\\s*${chapter}\\s*章`);
    const existingCurrent = publishedRows.find((item) => item.chapter === chapter);
    if (existingCurrent) {
      requireVolume(existingCurrent, VOLUME_NAME);
      if (publishedRows[0]?.chapter !== chapter || existingCurrent.title !== chapterTitle) {
        await shot(page, `existing-unverified-ch${chapter}`);
        fail(`后台已有第${chapter}章，但标题或最新位置不正确`);
      }
      if (existingCurrent.status !== '已发布') {
        fail(`后台第${chapter}章状态为“${existingCurrent.status}”，尚未真正发布；不能进入第${chapter + 1}章`);
      }
      if (chapter > 1 && publishedRows[1]?.chapter !== chapter - 1) {
        await shot(page, `existing-sequence-broken-ch${chapter}`);
        fail(`后台第${chapter}章之后没有紧接第${chapter - 1}章，拒绝补账本`);
      }
      await verifyPublishedPreview(page, existingCurrent);
      ledger.chapters[ledgerKey] = {
        title: chapterTitle,
        sha256: contentHash,
        publishAt: scheduleAt ? `${scheduleAt}:00+08:00` : null,
        backendStatus: existingCurrent.status,
        volumeName: existingCurrent.volumeName || null,
        verifiedAt: new Date().toISOString(),
        reconciledFromBackend: true,
      };
      await captureThenCommit(() => shot(page, `reconciled-ch${chapter}`), () => {
        const pending = `${ledgerPath}.pending-${process.pid}`;
        fs.writeFileSync(pending, `${JSON.stringify(ledger, null, 2)}\n`, 'utf8');
        fs.renameSync(pending, ledgerPath);
      });
      console.log(`✅ 第${chapter}章已在后台发布且预览全文一致；已安全补写账本，不重复提交。`);
      return;
    }
    if (publishedRows.some((item) => item.title === chapterTitle)) {
      await shot(page, `duplicate-ch${chapter}`);
      fail(`章节管理页其他章号已使用标题“${chapterTitle}”，拒绝继续`);
    }
    if (chapter === 1 && publishedRows.length) {
      fail(`后台已存在第${publishedRows[0].chapter}章；不能把第1章作为新章发布`);
    }
    if (chapter > 1) {
      if (!publishedRows.length) fail(`后台没有已发布章节；拒绝从第${chapter}章开始`);
      const latest = publishedRows[0];
      if (latest.chapter !== chapter - 1) {
        fail(`后台最新已发布为第${latest.chapter}章，目标却是第${chapter}章；拒绝串章`);
      }
      if (latest.title !== manifestPrevious.title || latest.status !== '已发布') {
        fail(`后台前一章核验失败：期望“第${chapter - 1}章 ${manifestPrevious.title} / 已发布”，实际“第${latest.chapter}章 ${latest.title} / ${latest.status}”`);
      }
      for (let index = 1; index < publishedRows.length; index += 1) {
        if (publishedRows[index].chapter !== publishedRows[index - 1].chapter - 1) {
          fail(`后台当前页出现断号：第${publishedRows[index - 1].chapter}章之后是第${publishedRows[index].chapter}章`);
        }
      }
      console.log(`连续性门禁通过：后台最新为第${latest.chapter}章《${latest.title}》，本次只允许发布第${chapter}章。`);
    }

    const publishUrl = `https://fanqienovel.com/main/writer/${BOOK_ID}/publish/?enter_from=newchapter_0`;
    const targetDraftUrl = await findTargetDraftUrl(page, manageUrl);
    if (targetDraftUrl) console.log(`检测到第${chapter}章同名草稿，将从该草稿继续。`);
    await page.goto(targetDraftUrl || publishUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await wait(3000);
    await configureVolume(page);
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
    await editor.focus();
    await page.keyboard.press('Control+A');
    await page.keyboard.press('Backspace');
    // Fanqie's autosave/render pass can move focus back to <body> after the
    // clear operation. Re-focus the ProseMirror surface before inserting CJK.
    await editor.focus();
    for (let index = 0; index < paragraphs.length; index += 1) {
      // keyboard.type() only synthesizes physical key presses and may silently
      // drop CJK text in newer versions of the Fanqie ProseMirror editor.
      // insertText() emits a native text-input event, preserving Chinese text
      // while the explicit Enter below keeps exactly one paragraph break.
      await page.keyboard.insertText(paragraphs[index]);
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

    // Reusing a draft can trigger a delayed autosave after the final editor
    // input. Fanqie temporarily disables the primary next button while that
    // save is pending, so wait for the visible button to become actionable
    // instead of treating the transient state as a permanent validation error.
    let next = await visibleButton(page, '下一步');
    const nextDeadline = Date.now() + 15000;
    while (next && !(await next.isEnabled()) && Date.now() < nextDeadline) {
      await wait(500);
      next = await visibleButton(page, '下一步');
    }
    if (!next || !(await next.isEnabled())) {
      await shot(page, `next-disabled-ch${chapter}`);
      fail('“下一步”不可用，未继续');
    }
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
    // Capture short-lived Arco feedback before navigating away. Fanqie may
    // reject a submission (for example, a daily publishing limit) while
    // keeping the chapter as a draft; those toasts can disappear in seconds.
    await wait(600);
    const feedbackLocator = page.locator([
      '[role="alert"]',
      '.arco-message',
      '.arco-message-wrapper',
      '.arco-notification',
      '.arco-notification-wrapper',
    ].join(','));
    const feedback = [];
    for (let index = 0; index < await feedbackLocator.count(); index += 1) {
      const item = feedbackLocator.nth(index);
      if (!(await item.isVisible().catch(() => false))) continue;
      const value = (await item.innerText().catch(() => '')).trim();
      if (value && !feedback.includes(value)) feedback.push(value);
    }
    if (feedback.length) console.log(`平台提交提示：${feedback.join(' / ')}`);
    const rejection = feedback.find(isSubmissionRejection);
    if (rejection) {
      await shot(page, `rejected-ch${chapter}`);
      fail(`平台拒绝第${chapter}章提交：${rejection}`);
    }
    await wait(7400);

    await page.goto(manageUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await wait(3000);
    const resultText = await page.locator('body').innerText();
    const resultRows = await readPublishedRows(page);
    const publishedChapter = resultRows.find((item) => item.chapter === chapter);
    requireVolume(publishedChapter, VOLUME_NAME);
    if (!publishedChapter || publishedChapter.title !== chapterTitle || resultRows[0]?.chapter !== chapter) {
      await shot(page, `unverified-ch${chapter}`);
      fail(`提交后无法验证第${chapter}章是后台最新章节且标题正确，未记为成功`);
    }
    if (!scheduleAt && publishedChapter.status !== '已发布') {
      await shot(page, `not-published-ch${chapter}`);
      fail(`第${chapter}章后台状态为“${publishedChapter.status}”，尚未真正发布；后续章节停止`);
    }
    if (chapter > 1 && resultRows[1]?.chapter !== chapter - 1) {
      await shot(page, `sequence-broken-ch${chapter}`);
      fail(`发布后序列不是第${chapter}章紧接第${chapter - 1}章；后续章节停止`);
    }
    if (scheduleAt && (!resultText.includes(scheduleDate) || !resultText.includes(scheduleTime))) {
      await shot(page, `schedule-unverified-ch${chapter}`);
      fail(`章节已出现，但无法在章节管理页验证定时发布时间 ${scheduleDate} ${scheduleTime}，未记为成功`);
    }

    await verifyPublishedPreview(page, publishedChapter);

    ledger.chapters[ledgerKey] = {
      title: chapterTitle,
      sha256: contentHash,
      publishAt: scheduleAt ? `${scheduleAt}:00+08:00` : null,
      backendStatus: publishedChapter.status,
      volumeName: publishedChapter.volumeName || null,
      verifiedAt: new Date().toISOString(),
    };
    await captureThenCommit(() => shot(page, `verified-ch${chapter}`), () => {
      const pending = `${ledgerPath}.pending-${process.pid}`;
      fs.writeFileSync(pending, `${JSON.stringify(ledger, null, 2)}\n`, 'utf8');
      fs.renameSync(pending, ledgerPath);
    });
    console.log(`✅ 第${chapter}章已在章节管理页验证，并写入本地账本。`);
  } finally {
    await browser?.close().catch(() => {});
  }
})().catch((error) => fail(error.stack || error.message));
