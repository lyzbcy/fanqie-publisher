# 发布流程详解

## 完整发布流程

### 1. 打开番茄小说官网

```bash
npx agent-browser --headed open "https://fanqienovel.com/"
npx agent-browser wait --load networkidle
```

### 2. 进入作家专区

```bash
# 获取页面快照，找到作家专区链接
npx agent-browser snapshot -i

# 点击作家专区（元素引用会变化）
npx agent-browser click "@e12"
npx agent-browser wait --load networkidle
```

### 3. 进入工作台

```bash
# 获取页面快照
npx agent-browser snapshot -i

# 点击工作台按钮
npx agent-browser click "@e15"
npx agent-browser wait --load networkidle
```

### 4. 创建短故事

```bash
# 点击短故事选项卡
npx agent-browser click "@e46"
npx agent-browser wait --load networkidle

# 点击新建短故事
npx agent-browser click "@e44"
npx agent-browser wait --load networkidle
```

### 5. 填写作品信息

```bash
# 填写作品名称
npx agent-browser fill "@e26" "涵家族的日常"

# 填写正文（通过JS注入）
npx agent-browser eval "document.querySelector('[contenteditable=true]').innerHTML='<p>正文内容</p>'"
```

### 6. 选择分类

```bash
# 点击分类选择区域
npx agent-browser click "@e17"

# 等待分类弹窗
npx agent-browser wait 1000

# 选择分类（需要手动或通过DOM操作）
```

### 7. 保存或发布

```bash
# 保存草稿
npx agent-browser click "@e4"

# 或点击下一步
npx agent-browser click "@e5"
```

## 自动化脚本示例

```bash
#!/bin/bash
# fanqie-auto-publish.sh

WORK_NAME="${1:-涵家族的日常}"
CONTENT="${2:-今天是个好日子...}"

echo "🦞 开始发布《${WORK_NAME}》..."

# 1. 打开浏览器
npx agent-browser --headed open "https://fanqienovel.com/"
npx agent-browser wait --load networkidle

# 2. 获取页面元素
SNAPSHOT=$(npx agent-browser snapshot -i)

# 3. 提取作家专区链接并点击
AUTHOR_ZONE=$(echo "$SNAPSHOT" | grep -oP '\[ref=e\d+\].*作家专区' | head -1)
REF=$(echo "$AUTHOR_ZONE" | grep -oP 'e\d+')
npx agent-browser click "@$REF"
npx agent-browser wait --load networkidle

# 4. 继续后续步骤...
# （完整流程见上方）

echo "✅ 发布完成！"
```

## 注意事项

1. **元素引用变化**：每次页面刷新后，元素引用（@e1, @e2等）都会变化，需要重新 `snapshot -i`
2. **等待加载**：每次页面跳转后都要 `wait --load networkidle`
3. **实名认证**：首次发布会弹出认证窗口，需要手动完成
4. **分类选择**：部分下拉框需要手动操作

---
*Fanqie Publisher Docs*
