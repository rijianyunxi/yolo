import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';

export class ImageDownloader {
  /**
   * @param {Object} options 配置项
   * @param {string} options.outputDir 下载文件保存路径
   * @param {number} [options.concurrency=5] 最大并发下载数
   */
  constructor({ outputDir = './downloads', concurrency = 5 } = {}) {
    this.outputDir = outputDir;
    this.concurrency = concurrency;
    
    this.queue = [];       // 等待下载的任务队列 [{ url, filename }, ...]
    this.activeCount = 0;   // 当前正在执行的下载数
    this.downloadedCount = 0; // 已完成计数（用于默认文件名编号）

    // 确保输出目录存在
    if (!fs.existsSync(this.outputDir)) {
      fs.mkdirSync(this.outputDir, { recursive: true });
    }
  }

  /**
   * 添加单个下载任务
   * @param {string} url 图片地址
   * @param {string} [customFilename] 可选：自定义保存文件名（如 "avatar.jpg"）
   */
  add(url, customFilename = null) {
    this.queue.push({ url, customFilename });
    this._processNext();
  }

  /**
   * 批量添加下载任务
   * @param {string[]} urls 图片地址数组
   */
  addMany(urls = []) {
    for (const url of urls) {
      this.add(url);
    }
  }

  /**
   * 私有方法：调度与执行队列中的下一个任务
   */
  async _processNext() {
    // 如果当前并发已满，或队列为空，直接中断
    if (this.activeCount >= this.concurrency || this.queue.length === 0) {
      return;
    }

    this.activeCount++;
    const task = this.queue.shift();

    try {
      await this._downloadFile(task);
    } catch (err) {
      console.error(`[✗] 下载失败 [${task.url}]: ${err.message}`);
    } finally {
      this.activeCount--;
      // 任务完成后继续尝试处理下一条
      this._processNext();
    }
  }

  /**
   * 私有方法：底层下载逻辑
   */
  async _downloadFile({ url, customFilename }) {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP Error: ${response.status}`);
    }

    // 计算文件名
    this.downloadedCount++;
    let filename = customFilename;
    if (!filename) {
      const ext = path.extname(new URL(url).pathname) || '.jpg';
      filename = `image_${this.downloadedCount}${ext}`;
    }

    const filePath = path.join(this.outputDir, filename);
    const fileStream = fs.createWriteStream(filePath);

    // Node 18+ 原生 Web Stream 转 Node Stream 并写入磁盘
    await pipeline(Readable.fromWeb(response.body), fileStream);
    console.log(`[✓] 下载成功: ${filename}`);
  }
}