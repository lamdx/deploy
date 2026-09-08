/**
 * build.js — 构建命令执行 & 产物校验
 */
const { execa } = require('execa');
const chalk = require('chalk');
const fs = require('fs');
const path = require('path');

/**
 * 执行单条构建命令（shell 模式，支持 && / || / 引号等 shell 语法）。
 *
 * 设计意图：构建命令可能含复杂 shell 表达式，因此显式交给系统 shell；
 * 同时把当前项目及其父目录的 node_modules/.bin 加入 PATH，行为与 npm scripts 一致。
 *
 * @param {string} command - 完整的 shell 命令字符串
 * @returns {Promise<boolean>} 构建成功返回 true
 */
async function runBuild(command) {
  try {
    console.log(chalk.cyan(`\n===== 开始执行构建命令：${command} =====`));
    const cwd = process.cwd();
    const env = createBuildEnv(cwd);
    const shell = process.platform === 'win32'
      ? process.env.ComSpec || 'cmd.exe'
      : '/bin/sh';
    const shellArgs = process.platform === 'win32'
      ? ['/d', '/s', '/c', command]
      : ['-c', command];

    await execa(shell, shellArgs, {
      stdio: 'inherit',
      cwd,
      env,
      extendEnv: false
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
 * 构造与 npm scripts 类似的 PATH，使全局安装的 dc 可以调用项目本地命令。
 * Windows 环境变量名不区分大小写，但 Node 进程中可能同时存在 Path/PATH；
 * 合并并归一化后再传给子进程，避免 cmd.exe 读取到未注入本地 bin 的那一份。
 *
 * @param {string} cwd
 * @returns {NodeJS.ProcessEnv}
 */
function createBuildEnv(cwd) {
  const env = { ...process.env };
  const pathKeys = Object.keys(env).filter(key => key.toLowerCase() === 'path');
  const inheritedPaths = pathKeys.flatMap(key =>
    (env[key] || '').split(path.delimiter).filter(Boolean)
  );
  const localBinPaths = [];
  let currentDir = path.resolve(cwd);

  while (true) {
    localBinPaths.push(path.join(currentDir, 'node_modules', '.bin'));
    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) break;
    currentDir = parentDir;
  }

  const seen = new Set();
  const normalizedPaths = [
    ...localBinPaths,
    path.dirname(process.execPath),
    ...inheritedPaths
  ].filter(item => {
    const key = process.platform === 'win32' ? item.toLowerCase() : item;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  pathKeys.forEach(key => delete env[key]);
  env[process.platform === 'win32' ? 'Path' : 'PATH'] =
    normalizedPaths.join(path.delimiter);
  return env;
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
