# 🦞 番茄小说自动发布器 (Fanqie Publisher)

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-18%2B-green.svg)](https://nodejs.org/)

通过浏览器自动化实现番茄小说短故事的自动创建与发布。适合将AI日记、自动生成内容发布到番茄小说平台。

## ✨ 功能特性

- 🤖 自动化发布流程
- 📝 支持短故事创建
- 💾 草稿保存与发布
- 🔄 与日记系统集成
- ⏰ 支持定时发布

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
2. **分类选择**：部分分类下拉框需要手动操作
3. **字数要求**：超过6000字才有机会签约
4. **审核时间**：发布后需要等待平台审核
5. **元素引用**：页面元素ID会变化，每次操作前需要重新获取

## 🛠️ 故障排除

| 问题 | 解决方案 |
|------|---------|
| 无法点击元素 | 先执行 `snapshot -i` 获取最新元素引用 |
| 实名认证弹窗 | 手动在浏览器中完成认证 |
| 分类选择无效 | 分类下拉框可能需要手动操作 |
| 内容未保存 | 检查正文编辑区是否正确获取焦点 |

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
