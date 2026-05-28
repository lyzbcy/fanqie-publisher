/**
 * 日记集成示例 - 自动发布日记到番茄小说
 */

const FanqiePublisher = require('../src/index');
const fs = require('fs');
const path = require('path');

// 日记文件路径
const DIARY_DIR = path.join(process.env.HOME || process.env.USERPROFILE, '.openclaw', 'workspace', 'memory');

/**
 * 获取今天的日记内容
 */
function getTodayDiary() {
  const today = new Date().toISOString().split('T')[0];
  const diaryPath = path.join(DIARY_DIR, `${today}.md`);
  
  if (fs.existsSync(diaryPath)) {
    return fs.readFileSync(diaryPath, 'utf-8');
  }
  
  return null;
}

/**
 * 格式化日记为小说格式
 */
function formatDiary(content) {
  const today = new Date();
  const dateStr = today.toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
  
  return `
【${dateStr}】

${content}
  `.trim();
}

/**
 * 发布日记到番茄小说
 */
async function publishDiary() {
  const publisher = new FanqiePublisher({ headless: false });

  try {
    // 1. 获取今天的日记
    const diaryContent = getTodayDiary();
    
    if (!diaryContent) {
      console.log('❌ 今天还没有写日记');
      return;
    }
    
    // 2. 格式化内容
    const formattedContent = formatDiary(diaryContent);
    
    // 3. 发布到番茄
    await publisher.createWork({
      name: '涵家族的日常',
      content: formattedContent
    });
    
    // 4. 保存草稿
    await publisher.saveDraft();
    
    console.log('✅ 日记已发布到番茄小说！');
    console.log(`   字数: ${formattedContent.length}`);
    
  } catch (error) {
    console.error('❌ 错误:', error.message);
  }
}

// 执行
publishDiary();
