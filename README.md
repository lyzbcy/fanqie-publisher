# 🍅 番茄小说自动发布器 (Fanqie Publisher)

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-18%2B-green.svg)](https://nodejs.org/)

通过浏览器自动化，把你的 AI 日记、自动生成内容自动发布到番茄小说平台。

> **一句话介绍：** 写好内容 → 跑个脚本 → 自动发布到番茄小说，全程不需要手动操作浏览器。

---

## 🤔 这是什么？适合谁？

**如果你符合以下任意一条，这个项目适合你：**

- ✅ 你有一个 AI 助手（OpenClaw / ChatGPT / 任何 AI），想让 AI 自动帮你写小说
- ✅ 你已经有自动生成的内容（日记、故事等），想发布到番茄小说
- ✅ 你想搞一套"AI 写作 → 自动发布"的自动化流程

**你需要具备：**

- 一台 Linux 服务器（或本地 Linux 电脑）
- 基本的命令行操作能力（会 `cd`、`ls`、`node` 就行）
- 一个番茄小说作者账号（用抖音/头条号登录即可）

---

## 📦 安装（保姆级，从零开始）

### 第一步：安装 Node.js

```bash
# Ubuntu/Debian
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# 验证
node -v   # 应该显示 v18+ 或 v20+
npm -v    # 应该显示 9+ 或 10+
```

> **如果已经装了 Node.js 18 以上，跳过这步。**

### 第二步：安装 Playwright

```bash
npm init -y
npm install playwright
npx playwright install chromium
```

> **为什么要装 Playwright？** 番茄小说没有官方 API，我们用浏览器自动化来"模拟手动操作"。Playwright 就是那个帮你操作浏览器的工具。

### 第三步：克隆本项目

```bash
git clone https://github.com/lyzbcy/fanqie-publisher.git
cd fanqie-publisher
```

### 第四步：配置

复制示例配置文件，改成你自己的信息：

```bash
cp config.example.json config.json
```

然后编辑 `config.json`：

```json
{
  "book_name": "你的小说名",
  "book_id": "你的作品ID",
  "author_name": "你的署名",
  "protagonist": "主角名",
  "characters": ["角色1", "角色2"],
  "cdp_port": 9333,
  "diary_dir": "memory/"
}
```

> `book_id` 在番茄小说作家后台的URL里能找到，格式类似 `7644905838972259352`。

### 第五步：安装项目依赖

```bash
npm install
```

---

## 🚀 快速开始（3分钟跑通）

### 1. 启动 Chrome 浏览器

番茄小说发布需要一个真实登录的浏览器。我们用 Chrome DevTools Protocol (CDP) 来控制它。

```bash
# 启动虚拟显示器（服务器没有屏幕时需要）
Xvfb :99 -screen 0 1280x800x24 &
export DISPLAY=:99

# 启动 Chrome（改成你自己的 Playwright Chromium 路径）
CHROMIUM=$(find ~/.cache/ms-playwright -name "chrome" -type f | head -1)
mkdir -p ./browser-data

$CHROMIUM \
  --display=:99 \
  --user-data-dir="./browser-data" \
  --no-first-run \
  --no-default-browser-check \
  --disable-gpu \
  --no-sandbox \
  --window-size=1280,800 \
  --remote-debugging-port=9333 \
  "https://fanqienovel.com/writer/zone/" &
```

> **找 Chrome 路径的小技巧：** 运行 `find ~/.cache/ms-playwright -name "chrome" -type f`

### 2. 登录番茄小说

首次使用需要手动登录一次：

```bash
# 检查浏览器是否打开
curl -s http://127.0.0.1:9333/json | python3 -c "
import json, sys
for t in json.load(sys.stdin):
    print(t.get('title', '?')[:50])
"
```

- 如果你有桌面环境：直接在弹出的 Chrome 里登录
- 如果是远程服务器：需要用 VNC 或 noVNC 远程操作

登录成功后，浏览器会记住登录态，之后几天不用再扫。

### 3. 发布你的第一章

```bash
# 写一个测试章节文件
cat > /tmp/chapter1.md << 'EOF'
这是第一章的内容。
AI日记自动发布到番茄小说的测试章节。
字数需要超过1000字，不然番茄不让发布。
你可以把你的日记内容、AI生成的故事放进来。
这个工具会自动帮你填写章节号、标题、正文，
然后自动点击发布按钮。
全过程不需要你手动操作浏览器。
EOF

# 执行发布
node src/publish-chapter.js 1 "第一章" /tmp/chapter1.md
```

看到 `🎉 第1章发布成功！` 就OK了！

---

## 📖 使用方式

### 方式一：发布小说章节（推荐）

适合连载小说，每天自动发一章。

```bash
node src/publish-chapter.js <章节号> <纯标题> <内容文件.md>

# 示例
node src/publish-chapter.js 7 "新的开始" /tmp/chapter7.md
```

### 方式二：发布短故事

适合单篇发布。

```bash
node src/publish.js --title "我的故事标题" --content "正文内容..."
```

### 方式三：从日记文件发布

```bash
node src/publish.js --diary /path/to/diary.md
```

### 方式四：定时自动发布（Cron）

每天晚上8点自动发布当天日记：

```bash
# 编辑 crontab
crontab -e

# 添加这行（改成你的实际路径）
0 20 * * * cd /path/to/fanqie-publisher && node src/publish-chapter.js $(date +\%d) "日记-$(date +\%m月\%d日)" /path/to/diary/$(date +\%Y-\%m-\%d).md >> /tmp/fanqie-cron.log 2>&1
```

---

## 🔑 踩坑指南（血泪总结）

> 这些都是实际踩过的坑，不看必踩。

### 坑1：番茄小说必须实名认证

首次发布前需要完成实名认证。登录后在「作家专区」按提示操作。

### 坑2：每章至少1000字

番茄小说要求每章 ≥ 1000 字，少于1000字无法发布。建议在发布脚本里加个检查：

```javascript
if (content.length < 1000) {
  console.error('❌ 内容不足1000字');
  process.exit(1);
}
```

### 坑3：章节号必须用 fill()，不能用 keyboard.type()

番茄小说的前端是 React，章节号输入框用 `keyboard.type()` 填入的值不会触发 React 状态更新，导致"下一步"按钮永远是灰色。

**解决：** 用 `fill()` 方法填章节号。

### 坑4：正文必须用 keyboard.type()

和章节号相反，正文区域（ProseMirror 编辑器）必须用 `keyboard.type()`，用 `fill()` 会导致 React 不识别内容。

**总结：** 章节号用 fill()，正文用 type()，别搞反了。

### 坑5："是否使用AI"必须选"是"

发布设置弹窗里有"是否使用AI"的 radio 选项。如果不选"是"，"确认发布"按钮点了没任何反应（不报错，就是没反应）。

### 坑6：arco-modal 弹窗遮罩

确认发布按钮经常被 Arco Design 的 modal 遮罩挡住，点不到。需要在代码里移除遮罩：

```javascript
document.querySelectorAll('.arco-modal-mask').forEach(e => e.remove());
document.querySelectorAll('.arco-modal-wrapper').forEach(e => {
  e.style.pointerEvents = 'auto';
});
```

### 坑7：登录态几天就过期

番茄小说的登录态大概 3-7 天过期。过期后脚本会报 `❌ 登录过期`，需要重新登录。

**建议：** 在 cron 脚本里加上登录态检查，过期时发通知让你手动扫。

### 坑8：标题不要带章节号前缀

```javascript
// ❌ 错误：标题里带"第X章"
fill('第三章：新的开始')

// ✅ 正确：只填纯标题，章节号在单独的输入框填
fill('新的开始')
```

### 坑9：Chrome 进程不要搞混

如果你在服务器上跑了多个 Chrome（比如 OpenClaw 也在用 Chrome），注意端口不要冲突：

- 番茄发布的 Chrome 用端口 `9333`
- 其他 Chrome 可能用端口 `9222`
- 关闭时用 `pkill -f "remote-debugging-port=9333"` 精确关闭

### 坑10：发布后要等审核

发布成功不等于读者马上能看到。番茄小说有审核流程，一般几小时到一天。审核通过后章节才会显示。

---

## 📁 项目结构

```
fanqie-publisher/
├── README.md                    # 你正在看的这个文件
├── LICENSE                      # MIT 协议
├── package.json                 # 项目配置
├── src/
│   ├── index.js                 # 主入口（agent-browser 模式）
│   ├── publish.js               # 短故事发布脚本
│   └── publish-chapter.js       # 小说章节发布脚本（推荐）
├── bin/
│   └── fanqie.js                # 命令行工具
├── examples/
│   ├── basic.js                 # 基础示例
│   └── diary-integration.js     # 日记集成示例
└── docs/
    ├── SKILL.md                 # OpenClaw Skill 完整文档
    ├── workflow.md              # 发布流程详解
    └── troubleshooting.md       # 踩坑记录 & 故障排除
```

---

## ❓ 常见问题

**Q：我不是程序员，能用吗？**
A：能。按照上面的安装步骤一步步来，每一步都有命令。如果卡住了，提 Issue 我帮你看。

**Q：支持 Windows 吗？**
A：脚本本身是跨平台的，但需要调整 Chrome 路径和 Xvfb 部分。Windows 用户建议用 WSL2。如果不想用 WSL2，Playwright 的 Chrome 路径和 Linux 不同，可以通过以下命令查找：
```bash
# Windows PowerShell
npx playwright install chromium
# 默认安装在 %LOCALAPPDATA%\ms-playwright\
```
然后修改启动脚本中的 `CHROMIUM` 路径即可。Windows 下不需要 Xvfb。

**Q：会被番茄封号吗？**
A：不确定。本项目只是自动化操作浏览器，发布的内容质量由你自己负责。建议发布优质原创内容，不要灌水。

**Q：内容从哪来？**
A：你可以：
- 让 AI 每天写日记，然后自动发布
- 自己写好内容，用脚本批量发布
- 任何你想自动化的发布场景

**Q：每章要写多少字？**
A：番茄小说要求每章 ≥ 1000 字。

---

## 🤝 贡献

欢迎提 Issue 和 PR！

1. Fork 本项目
2. 创建分支 (`git checkout -b feature/xxx`)
3. 提交 (`git commit -m 'Add xxx'`)
4. 推送 (`git push origin feature/xxx`)
5. 提 Pull Request

## 📄 许可证

MIT - 详见 [LICENSE](LICENSE)

## 👤 作者

**lyzbcy** - [GitHub](https://github.com/lyzbcy)

---

<p align="center">
  Made with ❤️ and 🤖
</p>
