/**
 * Fanqie Publisher - 番茄小说自动发布器
 * 
 * 通过浏览器自动化实现番茄小说短故事的创建与发布
 * 
 * @author lyzbcy
 * @license MIT
 */

const { execSync, exec } = require('child_process');
const path = require('path');

class FanqiePublisher {
  constructor(options = {}) {
    this.headless = options.headless ?? false;
    this.timeout = options.timeout ?? 30000;
    this.baseUrl = 'https://fanqienovel.com/';
  }

  /**
   * 执行 agent-browser 命令
   * @param {string} command - 命令
   * @returns {Promise<string>} - 输出结果
   */
  async execBrowser(command) {
    return new Promise((resolve, reject) => {
      exec(`npx agent-browser ${command}`, { timeout: this.timeout }, (error, stdout, stderr) => {
        if (error) reject(error);
        else resolve(stdout);
      });
    });
  }

  /**
   * 打开浏览器
   */
  async open() {
    const headed = this.headless ? '' : '--headed';
    await this.execBrowser(`${headed} open "${this.baseUrl}"`);
    await this.execBrowser('wait --load networkidle');
  }

  /**
   * 获取页面快照
   * @returns {Promise<string>} - 快照结果
   */
  async snapshot() {
    return await this.execBrowser('snapshot -i');
  }

  /**
   * 进入作家专区
   */
  async goToAuthorZone() {
    const snapshot = await this.snapshot();
    // 从快照中找到作家专区链接
    const match = snapshot.match(/\[ref=e(\d+)\].*作家专区/);
    if (match) {
      await this.execBrowser(`click @e${match[1]}`);
      await this.execBrowser('wait --load networkidle');
    } else {
      throw new Error('未找到作家专区入口');
    }
  }

  /**
   * 进入工作台
   */
  async goToWorkbench() {
    const snapshot = await this.snapshot();
    // 从快照中找到工作台按钮
    const match = snapshot.match(/\[ref=e(\d+)\].*工作台/);
    if (match) {
      await this.execBrowser(`click @e${match[1]}`);
      await this.execBrowser('wait --load networkidle');
    } else {
      throw new Error('未找到工作台入口');
    }
  }

  /**
   * 创建短故事
   * @param {Object} options - 创建选项
   * @param {string} options.name - 作品名称
   * @param {string} options.content - 正文内容
   * @param {string} options.category - 分类（可选）
   */
  async createWork(options) {
    const { name, content, category } = options;

    // 1. 打开浏览器
    await this.open();

    // 2. 进入作家专区
    await this.goToAuthorZone();

    // 3. 进入工作台
    await this.goToWorkbench();

    // 4. 点击短故事
    let snapshot = await this.snapshot();
    let match = snapshot.match(/\[ref=e(\d+)\].*短故事/);
    if (match) {
      await this.execBrowser(`click @e${match[1]}`);
      await this.execBrowser('wait --load networkidle');
    }

    // 5. 点击新建短故事
    snapshot = await this.snapshot();
    match = snapshot.match(/\[ref=e(\d+)\].*新建短故事/);
    if (match) {
      await this.execBrowser(`click @e${match[1]}`);
      await this.execBrowser('wait --load networkidle');
    }

    // 6. 填写作品名称
    snapshot = await this.snapshot();
    match = snapshot.match(/textbox.*\[ref=e(\d+)\]/);
    if (match) {
      await this.execBrowser(`fill @e${match[1]} "${name}"`);
    }

    // 7. 填写正文
    const formattedContent = content.replace(/\n/g, '</p><p>');
    await this.execBrowser(`eval "document.querySelector('[contenteditable=true]').innerHTML='<p>${formattedContent}</p>'"`);

    // 8. 提示用户选择分类
    console.log('✅ 作品已创建，请在浏览器中选择分类并发布');
    console.log(`   作品名称: ${name}`);
    console.log(`   字数: ${content.length}`);
  }

  /**
   * 保存草稿
   */
  async saveDraft() {
    const snapshot = await this.snapshot();
    const match = snapshot.match(/\[ref=e(\d+)\].*存草稿/);
    if (match) {
      await this.execBrowser(`click @e${match[1]}`);
      console.log('✅ 草稿已保存');
    }
  }

  /**
   * 关闭浏览器
   */
  async close() {
    await this.execBrowser('close');
  }
}

module.exports = FanqiePublisher;
