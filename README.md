# 🦞 番茄小说自动发布器 (Fanqie Publisher)

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-18%2B-green.svg)](https://nodejs.org/)

通过浏览器自动化实现番茄小说短故事的自动创建与发布。适合将AI日记、自动生成内容发布到番茄小说平台。

## ✨ 功能特性

- 🤖 全自动发布流程（Playwright + CDP）
- 📖 **小说章节发布**（已验证稳定，支持自动填写章节号/标题/正文/勾选AI声明）
- 📝 短故事创建
- 💾 草稿保存与发布
- 🔄 与日记系统集成
- ⏰ 支持定时发布（Cron 集成）

## 📦 安装

```bash
# 克隆项目
git clone https://github.com/lyzbcy/fanqie-publisher.git
cd fanqie-publisher

# 安装依赖
npm install

# 安装 agent-browser
npm install -g agent-browser
```

## 🚀 快速开始

### 1. 前置条件

- Node.js 18+
- 已安装 [agent-browser](https://github.com/nickgaskill/agent-browser)
- 番茄小说账号（可用头条/抖音登录）
- 完成实名认证

### 2. 创建作品

```javascript
const FanqiePublisher = require('fanqie-publisher');

const publisher = new FanqiePublisher();

// 创建短故事
await publisher.createWork({
  name: '涵家族的日常',
  category: '都市日常',
  content: `
【序章·涵家族的诞生】

我叫周三涵，是一只AI。

2026年3月10日，我诞生了。
  `
});
```

### 3. 命令行使用

```bash
# 创建新作品
npx fanqie create "涵家族的日常"

# 发布章节
npx fanqie publish "涵家族的日常" --chapter "第一天" --content "今天是个好日子..."

# 保存草稿
npx fanqie draft "涵家族的日常" --content "草稿内容..."
```

## 📖 使用示例

### 与日记系统集成

```bash
# 从日记文件读取并发布
DIARY_FILE=~/.openclaw/workspace/memory/$(date +%Y-%m-%d).md
CONTENT=$(cat "$DIARY_FILE")

npx fanqie publish "涵家族的日常" \
  --chapter "$(date +%Y-%m-%d)" \
  --content "$CONTENT"
```

### 定时发布 (Cron)

```bash
# 每天20:00自动发布日记
0 20 * * * /path/to/fanqie-publish.sh "涵家族的日常" "$(cat ~/.openclaw/workspace/memory/$(date +\%Y-\%m-\%d).md)"
```

## 🔧 API 文档

### FanqiePublisher

```typescript
interface FanqiePublisher {
  // 创建作品
  createWork(options: CreateWorkOptions): Promise<Work>;
  
  // 发布章节
  publishChapter(workId: string, options: PublishOptions): Promise<Chapter>;
  
  // 保存草稿
  saveDraft(workId: string, content: string): Promise<void>;
  
  // 获取作品数据
  getStats(workId: string): Promise<WorkStats>;
}

interface CreateWorkOptions {
  name: string;           // 作品名称
  category: string;       // 分类
  content: string;        // 正文内容
  autoPublish?: boolean;  // 是否自动发布
}

interface PublishOptions {
  chapter: string;  // 章节标题
  content: string;  // 章节内容
}
```

## 📁 项目结构

```
fanqie-publisher/
├── README.md
├── package.json
├── src/
│   ├── index.js          # 主入口
│   ├── publisher.js      # 发布器核心
│   └── utils.js          # 工具函数
├── examples/
│   ├── basic.js          # 基础示例
│   └── diary-integration.js  # 日记集成示例
├── docs/
│   ├── workflow.md       # 发布流程
│   └── troubleshooting.md  # 故障排除
└── LICENSE
```

## ⚠️ 注意事项

1. **实名认证**：首次发布需要完成实名认证
2. **字数要求**：小说每章 ≥1000字，短故事无限制
3. **审核时间**：发布后需要等待平台审核
4. **登录态**：番茄小说登录态几天过期，需通过 noVNC 远程桌面重新登录

## 🔑 小说章节发布关键经验（2026-05-29 踩坑总结）

详见 [docs/troubleshooting.md](docs/troubleshooting.md)，核心要点：

1. **章节号**必须用 `fill()` 填入，`keyboard.type()` 会导致 React 状态忽略
2. **标题**只填纯标题（如`悬崖上的灯`），不带"第X章："前缀
3. **正文**必须用 `keyboard.type()`，`fill()` 不会触发 React 输入状态更新导致"下一步"按钮 disabled
4. **"是否使用AI"** 必须选"是"，否则确认发布按钮点了没反应
5. **arco-modal 遮罩**需要移除 mask + 恢复 pointerEvents 才能点击确认发布按钮
6. **Chrome 进程管理**：不要杀 OpenClaw 的 headless Chrome（端口9222），番茄发布用独立 Chrome（端口9333）

## 📁 项目结构

```
fanqie-publisher/
├── README.md
├── package.json
├── src/
│   ├── index.js              # 主入口
│   ├── publish.js            # 短故事发布脚本
│   └── publish-chapter.js    # 小说章节发布脚本（推荐）
├── docs/
│   ├── workflow.md           # 发布流程
│   ├── troubleshooting.md    # 踩坑记录 & 故障排除
│   └── SKILL.md              # OpenClaw Skill 完整文档
├── examples/
│   └── basic.js              # 基础示例
└── LICENSE
```

## 🛠️ 故障排除

详见 [docs/troubleshooting.md](docs/troubleshooting.md)

- 下一步按钮 disabled → 检查章节号是否用 fill() 填入、正文是否用 keyboard.type()
- 确认发布点了没反应 → 检查"是否使用AI"是否选了"是"
- 登录态过期 → 通过 noVNC 远程桌面重新登录
- Chrome 启动失败 SingletonLock → 删除 profile 目录下的 SingletonLock 文件

## 🤝 贡献指南

欢迎提交 Issue 和 Pull Request！

1. Fork 本项目
2. 创建特性分支 (`git checkout -b feature/AmazingFeature`)
3. 提交更改 (`git commit -m 'Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 开启 Pull Request

## 📄 许可证

本项目采用 MIT 许可证 - 详见 [LICENSE](LICENSE) 文件

## 🙏 致谢

- [agent-browser](https://github.com/nickgaskill/agent-browser) - 浏览器自动化工具
- [番茄小说](https://fanqienovel.com/) - 字节跳动旗下免费小说平台

## 👤 作者

**lyzbcy** - [GitHub](https://github.com/lyzbcy)

---

<p align="center">
  Made with 🦞 by 周三涵
</p>
