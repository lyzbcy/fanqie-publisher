# 故障排除指南

## 常见问题

### 1. 无法点击元素

**症状**：
```
✗ Element not found. Verify the selector is correct and the element exists in the DOM.
```

**原因**：元素引用（@e1, @e2等）已过期

**解决方案**：
```bash
# 重新获取页面快照
npx agent-browser snapshot -i

# 使用新的元素引用
npx agent-browser click "@e新的引用"
```

### 2. 实名认证弹窗

**症状**：页面弹出实名认证窗口

**解决方案**：
1. 在浏览器中手动完成实名认证
2. 认证完成后继续自动化流程

### 3. 分类选择无效

**症状**：点击分类后没有反应

**解决方案**：
- 分类下拉框可能使用特殊组件，需要手动操作
- 或尝试通过DOM操作：
```bash
npx agent-browser eval "document.querySelector('.category-dropdown').click()"
```

### 4. 内容未保存

**症状**：正文内容未正确填写

**解决方案**：
```bash
# 确保编辑器获取焦点
npx agent-browser click "[contenteditable=true]"

# 重新注入内容
npx agent-browser eval "document.querySelector('[contenteditable=true]').innerHTML='内容'"
```

### 5. 浏览器未打开

**症状**：
```
✗ Command failed: npx agent-browser ...
```

**解决方案**：
```bash
# 检查 agent-browser 是否安装
npx agent-browser --version

# 如果未安装
npm install -g agent-browser
```

### 6. 页面加载超时

**症状**：
```
✗ Timeout waiting for page load
```

**解决方案**：
```bash
# 增加等待时间
npx agent-browser wait --load networkidle --timeout 60000

# 或等待特定元素
npx agent-browser wait "@元素引用"
```

### 7. 登录状态丢失

**症状**：每次都需要重新登录

**解决方案**：
```bash
# 保存会话状态
npx agent-browser state save fanqie-session.json

# 下次使用保存的状态
npx agent-browser state load fanqie-session.json
```

## 调试技巧

### 1. 查看当前页面

```bash
# 截图
npx agent-browser screenshot

# 获取页面HTML
npx agent-browser eval "document.body.innerHTML"
```

### 2. 查看元素属性

```bash
# 获取元素文本
npx agent-browser get text "@e1"

# 获取元素属性
npx agent-browser eval "document.querySelector('.class').getAttribute('data-id')"
```

### 3. 慢动作调试

```bash
# 使用可视化浏览器
npx agent-browser --headed open "https://fanqienovel.com/"

# 高亮元素
npx agent-browser highlight "@e1"
```

## 日志级别

```bash
# 启用详细日志
DEBUG=agent-browser npx agent-browser ...
```

---
*Fanqie Publisher Docs - Troubleshooting*
