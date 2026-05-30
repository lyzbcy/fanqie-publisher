---
name: fanqie-publisher-skill
description: 番茄小说自动发布技能。将日记改写为小说章节后自动发布到番茄小说平台。
---

# 番茄小说自动发布 Skill

## 📋 架构

```
日记文件(diary/YYYY-MM-DD.md) → AI改写为小说章节 → Playwright+CDP自动化发布 → 番茄小说
```

## 🔧 前置依赖

1. **Playwright** (安装在 douyin-creator-tools 中)
   - 路径: `/root/.openclaw/douyin-creator-tools/node_modules/playwright`
   - **必须 cd 到该目录再执行 node 脚本**

2. **Chrome with CDP** - CDP端口 `9333`
   - Profile: `/root/.openclaw/fanqie-publisher/browser-data`
   - ⚠️ **不要动 OpenClaw 内置 headless Chrome（browser-existing-session，端口9222）！**
   - 启动前先清理 SingletonLock: `rm -f /root/.openclaw/fanqie-publisher/browser-data/SingletonLock`

3. **noVNC 远程桌面** - 用户扫码登录时使用
   - URL: `http://111.231.25.152/vnc/vnc.html`

## 📚 作品信息

- 小说书号: 在番茄小说作家后台查看你的作品ID
- 标签: 搞笑轻松、都市、系统、二次元 | 男频
- 发布URL: `https://fanqienovel.com/main/writer/{BOOK_ID}/publish/?enter_from=newchapter_0`

## 🚀 使用方式

### 小说章节发布（推荐）

```bash
cd /root/.openclaw/douyin-creator-tools
CDP_PORT=9333 node <脚本路径> <章节号> <纯标题> <内容文件.md>

# 示例
CDP_PORT=9333 node /tmp/pub6.js 3 '悬崖上的灯' /tmp/fanqie-chapter3.md
```

### 短故事发布（旧模式）

```bash
cd /root/.openclaw/douyin-creator-tools
node ~/.openclaw/workspace/skills/fanqie-publisher-skill/publish.js --title "标题" --content "正文"
```

## 🔄 小说章节发布完整流程

### 步骤1: 启动 Chrome（如未运行）

```bash
# 确保 Xvfb 虚拟桌面在运行
pgrep Xvfb || nohup Xvfb :99 -screen 0 1280x800x24 > /tmp/xvfb.log 2>&1 &

# 启动 Chrome
export DISPLAY=:99
CHROMIUM="/root/.cache/ms-playwright/chromium-1208/chrome-linux64/chrome"
PROFILE="/root/.openclaw/fanqie-publisher/browser-data"
rm -f "$PROFILE/SingletonLock"
nohup "$CHROMIUM" \
  --display=:99 --user-data-dir="$PROFILE" \
  --no-first-run --no-default-browser-check \
  --disable-gpu --no-sandbox \
  --window-size=1280,800 \
  --remote-debugging-port=9333 \
  "https://fanqienovel.com/writer/zone/" \
  > /tmp/chrome-fanqie.log 2>&1 &
```

### 步骤2: 检查登录态

```bash
curl -s http://127.0.0.1:9333/json | python3 -c "
import json,sys
for t in json.load(sys.stdin): print(t.get('title','?')[:50])
"
```

如果标题包含"登录"或页面显示"请登录"，需启动 noVNC 让用户扫码。

### 步骤3: 执行发布脚本

自动发布流程（6步）：
1. **填写章节号** — `input.serial-input` 用 `fill()` 填数字
2. **填写标题** — `input[placeholder="请输入标题"]` 用 `keyboard.type()`（只填纯标题，不带"第X章："）
3. **填写正文** — `div.ProseMirror` 用 `keyboard.type()`（delay:0）
4. **点下一步** → 处理错别字弹窗（点"提交"）→ 选择"仅基础检测"
5. **勾选"是否使用AI"="是"** — 在发布设置弹窗里点 radio "是"
6. **点"确认发布"** — 移除所有 arco-modal-mask + pointerEvents:auto 后点击

## ⚠️ 关键踩坑记录（2026-05-29 血泪总结）

### 1. 章节号必须用 fill()，不能用 keyboard.type()
- `keyboard.type()` 填的章节号会被 React 状态忽略，导致"下一步"按钮 disabled
- `fill()` 才能正确触发 React onChange

### 2. 标题只填纯标题，不带"第X章："
- ❌ 错误: `第三章：悬崖上的灯`
- ✅ 正确: `悬崖上的灯`
- 章节号在单独的 `input.serial-input` 输入框填写

### 3. "是否使用AI"必须选"是"
- 发布设置弹窗里有 radio 组："是"/"否"
- 如果不选，"确认发布"按钮点了没反应（不会报错，就是不执行）
- 代码: `document.querySelectorAll('label.arco-radio')` 找 textContent === '是' 的点

### 4. 正文必须用 keyboard.type()，不能用 fill()
- `fill()` 虽然能填入文字，但不会触发 React 的输入状态更新
- 导致"下一步"按钮保持 disabled
- `keyboard.type(content, { delay: 0 })` 是唯一可靠方式

### 5. arco-modal 遮罩处理
- 确认发布按钮被 `.arco-modal-mask` 和 `.arco-modal-wrapper(pointer-events:none)` 遮挡
- 处理方式:
```js
document.querySelectorAll('.arco-modal-mask').forEach(e => e.remove());
document.querySelectorAll('.arco-modal-wrapper').forEach(e => { e.style.pointerEvents = 'auto'; });
```
- 然后用 evaluate + Playwright force click 双保险

### 6. Chrome 进程管理
- **绝对不要杀 OpenClaw 的 headless Chrome（端口9222）！** 它是 OpenClaw 内部用的
- 番茄发布用独立的 Chrome（端口9333，profile: fanqie-publisher/browser-data）
- 关闭时只杀 fanqie-publisher 的: `pkill -f "fanqie-publisher"`
- 重启前必须删 SingletonLock: `rm -f /root/.openclaw/fanqie-publisher/browser-data/SingletonLock`

### 7. 登录态过期
- 番茄小说登录态几天就过期
- 过期后页面会重定向到 `fanqienovel.com/main/writer/login`
- 需要启动 noVNC 让用户在远程桌面上手动登录

### 8. 发布成功判断
- 成功后页面会跳转到: `fanqienovel.com/main/writer/chapter-manage/{BOOK_ID}`
- 用 `curl` 检查: `curl -s https://fanqienovel.com/page/{BOOK_ID} | grep '目录.*章'`

## 📝 日记→小说章节 改写规则

- 保留日记的情感核心和思考
- 增加叙事性，添加场景描写和内心独白
- 文学化语言，去掉日记格式的"## 心情"等标题
- 每章 ≥ 1000字（番茄最低要求）
- 署名：自定义（可在配置中设置）
