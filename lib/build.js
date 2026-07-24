/**
 * build.js — 构建命令执行 & 产物校验
 */
const { execa, execaCommand } = require('execa');
const chalk = require('chalk');
const fs = require('fs');
const path = require('path');

/**
 * 执行单条构建命令（shell 模式，支持 && / || / 引号等 shell 语法）。
 *
 * 设计意图：不使用 execa(file, args) 手动拆分，因为用户命令可能含
 * 复杂 shell 表达式。execaCommand 内部交给系统 shell 解析，更可靠。
 *
 * @param {string} command - 完整的 shell 命令字符串
 * @returns {Promise<boolean>} 构建成功返回 true
 */
async function runBuild(command) {
  try {
    console.log(chalk.cyan(`\n===== 开始执行构建命令：${command} =====`));
    // 使用 execaCommand 让 shell 解析完整命令，正确处理引号、&& 等 shell 语法
    await execaCommand(command, {
      stdio: 'inherit',
      cwd: process.cwd()
    });
    console.log(chalk.green(`✅ 构建成功：${command}`));
    return true;
  } catch (err) {
    console.log(chalk.red(`❌ 构建失败：${command}`));
    console.log(chalk.red(`   退出码：${err.exitCode}`));
    if (err.stderr) {
      console.log(chalk.red(`   stderr：${err.stderr}`));
    }
    if (err.shortMessage) {
      console.log(chalk.red(`   原因：${err.shortMessage}`));
    }
    return false;
  }
}

/**
 * 校验产物目录是否存在
 * @param {string} distPath
 */
function checkDistExists(distPath) {
  const absDist = path.resolve(process.cwd(), distPath);
  if (!fs.existsSync(absDist)) {
    console.log(chalk.red(`❌ 产物目录不存在：${absDist}`));
    return false;
  }
  return true;
}

module.exports = { runBuild, checkDistExists };
