/**
 * init.js — dc init 交互式初始化逻辑
 *
 * 流程：
 * 1. 校验 package.json → 提取可选的 npm scripts
 * 2. 加载服务器列表 → 空则提示打开配置文件编辑并退出
 * 3. 交互式选择构建命令 / 产物目录 / 目标服务器 → 保存缓存
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const inquirer = require('inquirer');
const chalk = require('chalk');
const { spawn } = require('child_process');
const { getServerList, getProjectConfig, saveProjectConfig } = require('./cache');

const CONFIG_FILE = path.join(os.homedir(), '.deploy-cli.json');

/**
 * 尝试 spawn 子进程，200ms 内无 error 事件视为成功
 *
 * 设计意图：Node.js spawn 的 ENOENT 错误是异步事件，try-catch 抓不到。
 * 用短超时 + error 事件组合判断子进程是否成功启动。
 *
 * @param {string} cmd  - 可执行文件
 * @param {string[]} args - 参数列表
 * @param {object} opts  - spawn 额外选项
 * @returns {Promise<void>} 成功 resolve，失败 reject
 */
function trySpawn(cmd, args, opts) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { detached: true, stdio: 'ignore', ...opts });

    // 200ms 内无 error 事件 → 认为子进程启动成功
    const timer = setTimeout(() => {
      child.unref();
      child.removeListener('error', onError);
      resolve();
    }, 200);

    function onError(err) {
      clearTimeout(timer);
      child.removeListener('error', onError);
      reject(err);
    }
    child.on('error', onError);
  });
}

/**
 * 跨平台打开文件，编辑器优先 VS Code，失败降级到系统默认。
 *
 * Windows: code(via cmd /c) → notepad
 * macOS:   code → open
 * Linux:   code → xdg-open
 *
 * 子进程使用 spawn + detached + unref，确保父进程退出后编辑器仍存活。
 *
 * @param {string} filePath - 要打开的文件绝对路径
 */
async function openFile(filePath) {
  const platform = process.platform;

  // fallback 链条：[cmd, args, opts]
  const chain =
    platform === 'win32'
      ? [
          // 1. VS Code（通过 cmd /c 解析 code.cmd，避免 shell:true 的 deprecation）
          ['cmd', ['/c', 'code', filePath], {}],
          // 2. 降级到记事本
          ['notepad', [filePath], {}]
        ]
      : platform === 'darwin'
        ? [
            ['code', [filePath], {}],
            ['open', [filePath], {}]
          ]
        : [
            ['code', [filePath], {}],
            ['xdg-open', [filePath], {}]
          ];

  for (const [cmd, args, opts] of chain) {
    try {
      await trySpawn(cmd, args, opts);
      return; // 成功，退出
    } catch {
      // 当前命令不可用，继续尝试下一个
    }
  }
}

async function runInit() {
  const pkgPath = path.resolve(process.cwd(), 'package.json');
  if (!fs.existsSync(pkgPath)) {
    console.log(chalk.red('❌ 当前目录未找到 package.json'));
    process.exit(1);
  }
  const pkg = require(pkgPath);
  const scripts = pkg.scripts || {};
  const scriptNames = Object.keys(scripts);

  if (scriptNames.length === 0) {
    console.log(chalk.red('❌ package.json 内无scripts脚本'));
    process.exit(1);
  }

  // 在 loadFullConfig → initConfigFile 之前检测文件是否存在
  // 用于区分"首次生成空配置"和"已有配置但 serverList 仍是空数组"两种场景
  const isNewConfig = !fs.existsSync(CONFIG_FILE);
  const SERVER_LIST = getServerList();

  if (SERVER_LIST.length === 0) {
    if (isNewConfig) {
      console.log(chalk.green(`✅ 已生成配置文件：${CONFIG_FILE}`));
    } else {
      console.log(chalk.red('❌ 可用服务器列表为空，无法执行初始化'));
    }
    console.log(
      chalk.yellow(`
请在 serverList 中添加服务器配置，参考模板：
{
  "id": "test-server",
  "name": "测试服务器",
  "host": "127.0.0.1",
  "port": 22,
  "username": "root",
  "password": "账号密码",
  "baseRemoteDir": "/www/test"
}`)
    );

    const answer = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'openConfig',
        message: '是否打开配置文件进行编辑？',
        default: true
      }
    ]);

    if (answer.openConfig) {
      await openFile(CONFIG_FILE);
      console.log(chalk.green('✅ 已打开配置文件'));
    }
    console.log(chalk.yellow('💡 编辑保存后，重新执行 dc init'));
    process.exit(0);
  }

  console.log(chalk.green(`✅ 已加载 ${SERVER_LIST.length} 台服务器`));

  // 已有缓存配置时提示覆盖
  const existingCfg = getProjectConfig();
  if (existingCfg) {
    console.log(
      chalk.yellow('⚠️ 当前项目已有缓存配置，本次初始化将覆盖旧配置')
    );
  }

  const answers = await inquirer.prompt([
    {
      type: 'checkbox',
      name: 'selectedScripts',
      message: '请选择需要依次执行的构建命令（勾选顺序=执行顺序）',
      choices: scriptNames.map(name => ({
        name: `${name} → ${scripts[name]}`,
        value: scripts[name]
      })),
      validate: ans => ans.length > 0 || '至少选择一条构建命令'
    },
    {
      type: 'input',
      name: 'distPath',
      message: '输入打包产物目录',
      default: './dist'
    },
    {
      type: 'checkbox',
      name: 'selectedServerIds',
      message: '请选择需要部署的目标服务器',
      choices: SERVER_LIST.map(s => ({
        name: `${s.name} (${s.host})`,
        value: s.id
      })),
      validate: ans => ans.length > 0 || '至少选择一台服务器'
    }
  ]);

  saveProjectConfig({
    buildCommands: answers.selectedScripts,
    distPath: answers.distPath,
    selectedServerIds: answers.selectedServerIds
  });

  console.log(chalk.green('\n🎉 初始化完成！执行 dc s 启动构建部署'));
}

module.exports = { runInit };
