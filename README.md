# fanqie-publisher

通过本机 Playwright + CDP 为番茄小说长篇章节做拆分、预检、确认前准备和灰度发布。

## 当前边界

多作品日更支持先覆盖再加更：`src/plan-daily.js --date=YYYY-MM-DD --registry=... --snapshot=...`只生成轮转计划；登记启用`dailyPolicy.coverageFirst`后，单章发布器实查其他在更作品，未达基本目标就阻止当前作品加更。计划按账号作品槽位和每书日/月剩余字数分别核验，不假定所有额度共用。

- 支持：合订稿拆章、逐章哈希清单、最低字数预检、后台查重、确认前暂停、定时或立即单章发布、发布账本与结果截图；指定分卷并跨卷核对连续章号。
- 不支持：自动创建长篇作品、自动选择分类、自动上传封面。
- `src/publish.js` 与 `src/index.js` 中的 `createWork` 是旧短故事流程，不能用于长篇建书。

## 安装

```powershell
git clone https://github.com/lyzbcy/fanqie-publisher.git
cd fanqie-publisher
npm install
```

要求 Node.js 20 或更高版本。Playwright 是项目依赖，不需要外部绝对路径。

## 1. 启动独立浏览器

```powershell
& 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe' `
  --remote-debugging-port=9333 `
  '--user-data-dir=E:\path\to\fanqie-publisher\browser-data' `
  --no-first-run --no-default-browser-check `
  'https://fanqienovel.com/writer/zone/'
```

在打开的窗口中完成扫码登录。`browser-data/` 含登录 Cookie，已加入 `.gitignore`。

## 2. 创建长篇作品

已有作品的新卷先在后台创建分卷，再在该作品`config.json`设置`"volume_name": "第二卷：卷名"`。编辑器和发布后列表均核验真实归属，章号沿用全书连续编号。未设置该字段沿用单卷流程。

在番茄后台如实填写作品名、签约模式、频道、衍生 / 同人分类、标签、主角、简介和封面。创建后从后台 URL 取得 `book_id`。

```powershell
Copy-Item config.example.json config.json
```

```json
{
  "cdp_port": 9333,
  "book_id": "1234567890",
  "min_chapter_characters": 1000
}
```

## 3. 拆章并生成清单

```powershell
node src/prepare-novel.js '完整稿.md' 'publish\chapters'
```

输出每章 TXT 和 `manifest.json`，包含源稿 SHA-256、章号、标题、字符数与逐章 SHA-256。

## 4. 三档执行模式

```powershell
# 本地预检；不连接浏览器
node src/publish-chapter.js 1 '纯标题' 'publish\chapters\001-纯标题.txt' --dry-run

# 填写后台并回读，停在“确认发布”前
node src/publish-chapter.js 1 '纯标题' 'publish\chapters\001-纯标题.txt' --prepare-only

# 明确执行最终发布
node src/publish-chapter.js 1 '纯标题' 'publish\chapters\001-纯标题.txt' --publish

# 填写定时发布时间并停在确认前（北京时间）
node src/publish-chapter.js 1 '纯标题' 'publish\chapters\001-纯标题.txt' --prepare-only --schedule=2026-09-17T07:05

# 定时发布，并在章节管理页回读发布时间
node src/publish-chapter.js 1 '纯标题' 'publish\chapters\001-纯标题.txt' --publish --schedule=2026-09-17T07:05
```

省略模式参数时等同 `--dry-run`。`--prepare-only` 与 `--publish` 不能同时使用。`--schedule` 只允许与这两个联网模式之一同时使用。

## 发布门禁

脚本会在以下任一情况停止：

- 正文不足配置的最低字符数；
- 本地账本已有同章号；
- 后台章节页已有同章号或同标题；
- 登录失效或页面结构变化；
- 章号、标题或正文回读不一致；
- 正文 DOM 中出现位于段落之间的空段；
- 无法验证“是否使用AI=是”；
- 定时发布的开关、日期或时间无法精确回读；
- “下一步”或“确认发布”不可用；
- 提交后无法在章节管理页找到对应章节，或找不到目标定时时间。

脚本不会移除网页遮罩、强制点击或绕过 disabled 状态。调试截图写入系统临时目录，本地发布账本写入 `.publish-state/`。

## 推荐灰度顺序

1. 本次待发布章节全部通过 `--dry-run`。
2. 第1章执行 `--prepare-only`，人工核对确认页。
3. 第1章发布并在章节管理页复核。
4. 第2、3章重复同一流程。
5. 三章均无重复、截断或错书后，再继续后续章节。

详细说明见 [docs/SKILL.md](docs/SKILL.md)、[docs/workflow.md](docs/workflow.md) 和 [docs/troubleshooting.md](docs/troubleshooting.md)。

## 日更 skill 与自更新

完整标准见[日更流程](docs/references/daily-update.md)：实时查进度、按作者授权自主续写与校对、构稿、逐章等待审核和全文核验、留证与交接。每本书单独传`--book-dir`，不混用配置和账本。

运行`npm run skill:install`安装可被发现的skill。每日首次使用静默运行自更新入口；断网或更新失败仍使用旧版。[更新机制与限制](docs/references/self-update.md)包含版本比较、快进更新、本地修改保护及失败恢复。

```powershell
node src/publish-remaining.js --book-dir='E:\path\to\novel' --from=8 --to=11 --publish --wait-for-review
npm run skill:update
```

## 测试

```powershell
npm test
npm ls --depth=0
```

## License

MIT

## Skill Release包

[最新可安装ZIP](https://github.com/lyzbcy/fanqie-publisher/releases/latest/download/fanqie-publisher-skill.zip)可由捞鱼软件中心一键安装到用户目录 .agents/skills/fanqie-publisher-skill。完整包包含SKILL.md、引用资料和必要的配套代码，安装不自动运行任务。

示例：请用fanqie-publisher-skill先检查我的小说稿和后台章号，整理下一章并做发布预检，先不要发布。
