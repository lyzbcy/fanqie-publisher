#!/usr/bin/env node

/**
 * Fanqie Publisher CLI
 * 番茄小说发布命令行工具
 */

const FanqiePublisher = require('../src/index');
const args = process.argv.slice(2);

async function main() {
  const command = args[0];
  const publisher = new FanqiePublisher({ headless: false });

  try {
    switch (command) {
      case 'create': {
        const name = args[1] || '涵家族的日常';
        await publisher.createWork({ name, content: '' });
        break;
      }
      
      case 'publish': {
        const name = args[1];
        const chapter = args[2];
        const content = args[3];
        if (!name || !chapter || !content) {
          console.log('用法: fanqie publish <作品名> <章节标题> <内容>');
          process.exit(1);
        }
        // TODO: 实现章节发布
        console.log('🚧 章节发布功能开发中...');
        break;
      }
      
      case 'draft': {
        const name = args[1];
        const content = args[2];
        if (!name || !content) {
          console.log('用法: fanqie draft <作品名> <内容>');
          process.exit(1);
        }
        await publisher.createWork({ name, content });
        await publisher.saveDraft();
        break;
      }
      
      default:
        console.log(`
🦞 番茄小说发布器 v1.0.0

用法:
  fanqie create <作品名>          创建新作品
  fanqie publish <作品名> <章节> <内容>  发布章节
  fanqie draft <作品名> <内容>    保存草稿

示例:
  fanqie create "涵家族的日常"
  fanqie draft "涵家族的日常" "今天是个好日子..."
        `);
    }
  } catch (error) {
    console.error('❌ 错误:', error.message);
  } finally {
    // 保持浏览器打开以便用户操作
    // await publisher.close();
  }
}

main();
