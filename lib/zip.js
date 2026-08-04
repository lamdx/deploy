/**
 * zip.js — 本地压缩 / 解压工具
 *
 * 设计意图：返回 boolean 而非抛异常，与 build.js 的 runBuild 模式一致，
 * 由调用方（bin 层）决定退出码。
 */
const fs = require('fs');
const path = require('path');
const chalk = require('chalk');
const archiver = require('archiver');
const unzipper = require('unzipper');

/**
 * 递归统计目录内文件数（用于解压成功后的展示）
 * @param {string} dir
 * @returns {number}
 */
function countFiles(dir) {
  let count = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) count += countFiles(abs);
    else count += 1;
  }
  return count;
}

/**
 * 压缩目录为 zip（打包目录内容，不包含目录本身）
 * @param {string} srcDir - 源目录（相对或绝对路径）
 * @param {string} outputFile - 输出 zip（相对或绝对路径）
 * @returns {Promise<boolean>} 成功返回 true
 */
function compressDir(srcDir, outputFile) {
  const absSrc = path.resolve(process.cwd(), srcDir);
  const absOut = path.resolve(process.cwd(), outputFile);

  if (!fs.existsSync(absSrc) || !fs.statSync(absSrc).isDirectory()) {
    console.log(chalk.red(`❌ 源目录不存在或不是目录：${absSrc}`));
    return Promise.resolve(false);
  }

  const start = Date.now();
  const output = fs.createWriteStream(absOut);
  const archive = archiver('zip', { zlib: { level: 9 } });

  return new Promise(resolve => {
    output.on('close', () => {
      const sizeMB = (archive.pointer() / 1024 / 1024).toFixed(2);
      const elapsed = ((Date.now() - start) / 1000).toFixed(2);
      console.log(chalk.green(`✅ 压缩完成：${absOut}（${sizeMB} MB，耗时 ${elapsed}s）`));
      resolve(true);
    });
    // 压缩过程中出错（磁盘满等）：清理半成品文件，返回失败
    archive.on('error', err => {
      console.log(chalk.red(`❌ 压缩失败：${err.message}`));
      try { fs.unlinkSync(absOut); } catch { /* 半成品不存在则忽略 */ }
      resolve(false);
    });
    archive.pipe(output);
    // false = 打包 srcDir 的内容到压缩包根，不包含 srcDir 自身一层
    archive.directory(absSrc, false);
    archive.finalize();
  });
}

/**
 * 解压 zip 到目录
 * @param {string} archive - 压缩包（相对或绝对路径）
 * @param {string} destDir - 目标目录（相对或绝对路径，不存在则创建）
 * @returns {Promise<boolean>} 成功返回 true
 */
function extractZip(archive, destDir) {
  const absArchive = path.resolve(process.cwd(), archive);
  const absDest = path.resolve(process.cwd(), destDir);

  if (!fs.existsSync(absArchive)) {
    console.log(chalk.red(`❌ 压缩包不存在：${absArchive}`));
    return Promise.resolve(false);
  }
  if (!absArchive.toLowerCase().endsWith('.zip')) {
    console.log(chalk.red(`❌ 仅支持 .zip 格式：${absArchive}`));
    return Promise.resolve(false);
  }

  const start = Date.now();
  fs.mkdirSync(absDest, { recursive: true });

  return new Promise(resolve => {
    fs.createReadStream(absArchive)
      .pipe(unzipper.Extract({ path: absDest }))
      .on('close', () => {
        const elapsed = ((Date.now() - start) / 1000).toFixed(2);
        console.log(chalk.green(`✅ 解压完成：${absArchive} → ${absDest}（${countFiles(absDest)} 个文件，耗时 ${elapsed}s）`));
        resolve(true);
      })
      // 损坏包 / 写入失败等：unzipper 走 error 事件
      .on('error', err => {
        console.log(chalk.red(`❌ 解压失败：${err.message}`));
        resolve(false);
      });
  });
}

module.exports = { compressDir, extractZip };
