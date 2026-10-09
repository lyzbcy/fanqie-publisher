---
name: fanqie-publisher-skill
description: 为番茄长篇小说执行日更：核对实时进度，在作者已授权自主创作时续写校对，再拆章、顺序发布、等待审核并留存凭据。用户说“更新今天的”“帮我发布”或要求维护番茄发布流程时使用。
metadata:
  version: "1.3.0"
  source: https://github.com/lyzbcy/fanqie-publisher
---

# 番茄小说长篇章节发布

## 每日首次使用：静默检查更新

在写作、浏览器启动和发布前运行 `node <本skill目录>/scripts/self-update.cjs`。仓库直接使用则运行 `node <仓库>/scripts/self-update.cjs`。同一天只检查一次；失败继续旧版，不索要确认、不终止日更。成功更新后重读本文件和本次需要的引用。原理、保护边界及日志见 [references/self-update.md](references/self-update.md)。这不是每天自动唤醒或自动发布的定时任务。

已安装副本的 `.runtime.json` 记录真实仓库位置，不能把别人的 E 盘路径当成所有用户的固定路径。安装方式：在仓库运行 `npm run skill:install`。

## “今天更新”默认工作流

按 [references/daily-update.md](references/daily-update.md) 完成进度核对、按已有授权续写、校对、构稿、逐章发布和交接。用户已明确授权“自己做、自己发布”的作品，不再让用户逐章确认；缺稿时按该作品既定设定续写，不只回复“没有稿”。若没有创作授权，不能自行补写或开启新书。

先确定作品目录、书名、book_id与当前后台进度。每本书自己的 `config.json`、manifest和`.publish-state/`必须一起使用；不覆盖另一本书配置。规划章目不是正文，第一季完结也不代表可以凭空新增下一季。

若工作区存在作者确认的`小说日更登记.json`，按其中启用作品逐本日更；当天已经完成的作品核验后跳过，不重复发布。用户明确授权的新卷可以续写，章号跨卷连续。指定分卷时在该书`config.json`设置`volume_name`为后台完整分卷名；先在后台创建分卷，发布器会遍历分卷读取连续章号、选择编辑器分卷并核验发布后归属。错误分卷或跨卷重号立即停止，不得只靠正文标题声称已入第二卷。

**多作品先覆盖、后加更**：用户要求每本在更作品每天都有更新时，先读[多作品日更与额度](references/multi-book-daily.md)，实查每本进度、作者等级、当日可更新作品数与每本日/月剩余字数。先轮流提交每书一章并确认发布，再继续轮转至各书明确的基本字数目标；全部达标后才分配加更。未知目标默认每书一完整章，不把这当作已满足4000字的推荐/福利条件。启用登记中的`dailyPolicy.coverageFirst`后，单章发布器会实时阻止在其他作品未完成基本更新时继续给同一本加更。规划入口`src/plan-daily.js`在额度不足或缺稿时拒绝生成可执行计划，不自行丢弃另一书。

字数额度按**单作品**计算，更新作品数按**账号**限制，两者独立。当前官方Lv.0/Lv.1每日只能更新1本，不能通过每本少发几个字实现同日两更；先核实账号最新额度，无法覆盖时如实报告，寻求官方额度/等级解决方案或作者明确的临时安排，不擅自用轮更冒充每书日更，也不删除或改旧章规避书数额度。

批量调用支持书目隔离：

```powershell
node <仓库>/src/publish-remaining.js --book-dir='<作品目录>' --from=8 --to=11 --publish --wait-for-review
```

省略 `--from` 时从连续账本的下一章起；仍须先实查后台。清单默认位于作品目录 `publish/fanqie/chapters/manifest.json`。默认无`--publish`只做预检。不要只依赖账本或上一次聊天结论。

## 安全原则

- 默认只执行 `--dry-run`。只有明确传入 `--publish` 才会点击“确认发布”。
- 不移除网页遮罩，不 force click，不绕过 disabled 状态。
- 发布前回读章号、标题和完整正文；正文非空白字符必须完全一致。
- 按逻辑段逐段输入，每段之间只按一次回车；检测到正文内部空段就停止，防止后台出现大片空白。
- “是否使用AI”只在对应表单内选择“是”，并验证选中状态。
- 定时发布必须回读开关、日期和时间；提交后必须在章节管理页再次看到目标时间。
- 发布前查询章节管理页；发布后回到章节管理页核对章号、标题和发布时间，再写本地账本。
- **绝不串章**：发布第 N 章前，本地账本必须完整包含 1—N-1，后台最新一章必须恰好是第 N-1 章、标题与清单一致且状态为“已发布”；任一断号、错标题、审核中或后台/账本不一致都立即停止。不能仅凭草稿、上次操作结果或记忆推断上一章已经上线。
- 发布第 N 章后，后台最新两行必须依次为 N、N-1，且第 N 章标题正确；立即发布时还必须看到“已发布”，否则不写账本、不发布第 N+1 章。
- 点击确认后立即读取短暂的平台提示；遇到“提交字数超出每日上限”等拒绝信息时保留草稿并停止后续章节。
- 新书先核对第1章确认页截图及后台预览，再灰度第2、3章；既有授权由Agent完成截图复核，不把每章复核变成反复向作者要许可。前三章稳定后可顺序批量更新。

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

`publish-remaining.js` 只能从本地账本计算出的下一章开始，并逐章调用上述单章门禁；一章失败，后续全部停止。检测到同章草稿时，只复用章号和标题均一致的唯一草稿，不会任取一个已打开的编辑页。

连续发布可加 `--wait-for-review`：仅当当前章状态明确为“审核中”时，每20秒复查同一章，最长30分钟；后台预览全文一致并变成“已发布”后才进入下一章。字数上限、错章、正文不一致等其他错误不会自动重试。

`--schedule` 使用北京时间，格式固定为 `YYYY-MM-DDTHH:mm`，只允许和 `--prepare-only` 或 `--publish` 同时使用。日期或时间无法精确回读时不得提交。

发布证据保存在系统临时目录的 `fanqie-before-publish-ch*.png` 与 `fanqie-verified-ch*.png`。本地断点账本在 `.publish-state/`。

## 建书限制

本仓库尚未自动化长篇建书、分类选择和封面上传。必须先在番茄后台创建长篇作品，选择真实的作品类型与权利声明，上传封面并取得 `book_id`。`src/publish.js` 和 `createWork` 属于旧短故事流程，不能用于长篇建书。

## 页面变更时的处理

只使用可见、语义明确的表单项。若正文编辑器、AI 声明、定时发布开关或确认按钮无法精确定位，保存截图并停止；不要猜控件位置，不要用 `force`，不要删除遮罩，也不要绕过页面禁用状态。修正选择器后先运行 `--prepare-only`，确认回读与截图均正确，再允许 `--publish`。
