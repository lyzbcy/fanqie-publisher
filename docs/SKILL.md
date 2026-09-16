---
name: fanqie-publisher-skill
description: 在 Windows 本机通过已登录的番茄作家后台拆分、预检、填写、定时或立即发布长篇章节，并在提交前后核验正文、声明、发布时间和后台结果。用户要求发布番茄小说、准备章节草稿、排查番茄后台排版或沉淀发布流程时使用；不用于创作正文或自动创建作品。
---

# 番茄小说长篇章节发布

## 安全原则

- 默认只执行 `--dry-run`。只有明确传入 `--publish` 才会点击“确认发布”。
- 不移除网页遮罩，不 force click，不绕过 disabled 状态。
- 发布前回读章号、标题和完整正文；正文非空白字符必须完全一致。
- 按逻辑段逐段输入，每段之间只按一次回车；检测到正文内部空段就停止，防止后台出现大片空白。
- “是否使用AI”只在对应表单内选择“是”，并验证选中状态。
- 定时发布必须回读开关、日期和时间；提交后必须在章节管理页再次看到目标时间。
- 发布前查询章节管理页；发布后回到章节管理页核对章号、标题和发布时间，再写本地账本。
- 先发布第1章，后台人工复核后再灰度第2、3章。不要直接批量发布整本。

## Windows 启动浏览器

在项目根目录启动独立 Edge 配置和 CDP 端口 9333：

```powershell
& 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe' `
  --remote-debugging-port=9333 `
  '--user-data-dir=E:\path\to\fanqie-publisher\browser-data' `
  --no-first-run --no-default-browser-check `
  'https://fanqienovel.com/writer/zone/'
```

登录 Cookie 保存在 `browser-data/`，该目录不得提交到 Git。

## 准备章节

```powershell
node src/prepare-novel.js '完整稿.md' 'publish\chapters'
```

输出独立 TXT 和 `manifest.json`。清单记录源稿哈希、章号、标题、字符数和逐章哈希。

## 配置

把 `config.example.json` 复制为仓库根目录 `config.json`，创建长篇作品后填写 `book_id`：

```json
{
  "cdp_port": 9333,
  "book_id": "1234567890",
  "min_chapter_characters": 1000
}
```

## 预检与发布

```powershell
node src/publish-chapter.js 1 '纯标题' 'publish\chapters\001-纯标题.txt' --dry-run
node src/publish-chapter.js 1 '纯标题' 'publish\chapters\001-纯标题.txt' --prepare-only
node src/publish-chapter.js 1 '纯标题' 'publish\chapters\001-纯标题.txt' --publish
node src/publish-chapter.js 1 '纯标题' 'publish\chapters\001-纯标题.txt' --prepare-only --schedule=2026-09-17T07:05
node src/publish-chapter.js 1 '纯标题' 'publish\chapters\001-纯标题.txt' --publish --schedule=2026-09-17T07:05
```

`--prepare-only` 会连接后台、填写并回读内容、选择 AI 声明，然后停在“确认发布”按钮前并保存截图。

`--schedule` 使用北京时间，格式固定为 `YYYY-MM-DDTHH:mm`，只允许和 `--prepare-only` 或 `--publish` 同时使用。日期或时间无法精确回读时不得提交。

发布证据保存在系统临时目录的 `fanqie-before-publish-ch*.png` 与 `fanqie-verified-ch*.png`。本地断点账本在 `.publish-state/`。

## 建书限制

本仓库尚未自动化长篇建书、分类选择和封面上传。必须先在番茄后台创建长篇作品，选择真实的作品类型与权利声明，上传封面并取得 `book_id`。`src/publish.js` 和 `createWork` 属于旧短故事流程，不能用于长篇建书。

## 页面变更时的处理

只使用可见、语义明确的表单项。若正文编辑器、AI 声明、定时发布开关或确认按钮无法精确定位，保存截图并停止；不要猜控件位置，不要用 `force`，不要删除遮罩，也不要绕过页面禁用状态。修正选择器后先运行 `--prepare-only`，确认回读与截图均正确，再允许 `--publish`。
