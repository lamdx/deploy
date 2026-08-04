#!/usr/bin/env node
/**
 * dc — 前端构建部署脚手架 CLI 入口
 *
 * 核心流程：dc init 配置项目 → dc start 串行构建 + 并行部署
 * 配置文件统一存放在用户家目录 .deploy-cli.json，不污染业务代码
 *
 * 命令注册全部由 commander 管理，各命令的 action 直接调用 lib/ 模块
 */
const { program } = require('commander');
const chalk = require('chalk');
const fs = require('fs');
const path = require('path');
const inquirer = require('inquirer');
const { runInit } = require('../lib/init');
const { runBuild, checkDistExists } = require('../lib/build');
const { deployParallel } = require('../lib/deploy');
const { compressDir, extractZip } = require('../lib/zip');
const {
  getProjectConfig,
  removeProjectConfig,
  getAllCachedProjects,
  getServerList
} = require('../lib/cache');

program
  .name('dc')
  .description(
    `
前端构建部署脚手架
配置文件：用户家目录/.deploy-cli.json
规则：
1. dc init 交互式初始化项目配置，以当前目录路径作为key缓存
2. dc start / dc s / dc -s 串行执行多条构建命令，单条构建成功后并行部署所有选中服务器
3. 任意构建失败，流程立即终止
4. 重复 dc init 覆盖当前项目已有配置
5. dc zip / dc unzip 本地压缩/解压产物目录，默认使用缓存产物目录
6. dc deploy 纯部署：跳过构建，直接上传现有产物
`
  )
  .version('1.4.0', '-v, --version');

// 解析默认产物目录：优先缓存配置 distPath，无配置回退 ./dist
function resolveDistPath() {
  const cfg = getProjectConfig();
  return (cfg && cfg.distPath) || './dist';
}

// init
program
  .command('init')
  .description('交互式初始化当前项目部署配置（覆盖已有缓存）')
  .action(runInit);

// info
program
  .command('info')
  .description('查看当前项目已缓存的部署配置')
  .action(() => {
    const cfg = getProjectConfig();
    if (!cfg) {
      console.log(chalk.yellow('⚠️ 当前项目暂无配置，请先执行 dc init'));
      return;
    }
    const SERVER_LIST = getServerList();
    const targetServers = SERVER_LIST.filter(item =>
      cfg.selectedServerIds.includes(item.id)
    );
    console.log(chalk.cyan('================ 当前项目配置 ================'));
    console.log('构建命令序列：');
    cfg.buildCommands.forEach((cmd, idx) =>
      console.log(`  ${idx + 1}. ${cmd}`)
    );
    console.log('产物目录：', cfg.distPath);
    console.log('目标服务器：');
    targetServers.forEach(s =>
      console.log(`  - ${s.name} ${s.host} 远端目录:${s.baseRemoteDir}`)
    );
  });

// clean
program
  .command('clean')
  .description('删除当前项目缓存的部署配置')
  .action(() => {
    const ok = removeProjectConfig();
    if (ok) {
      console.log(chalk.green('✅ 当前项目配置已清除'));
    } else {
      console.log(chalk.yellow('⚠️ 当前项目不存在缓存配置'));
    }
  });

// list
program
  .command('list')
  .description('列出本机所有已缓存配置的项目绝对路径')
  .action(() => {
    const allCache = getAllCachedProjects();
    const keys = Object.keys(allCache);
    if (keys.length === 0) {
      console.log(chalk.yellow('暂无任何缓存项目'));
      return;
    }
    console.log(
      chalk.cyan(
        `================ 全部缓存项目（共${keys.length}个）================`
      )
    );
    keys.forEach((pathStr, index) => {
      console.log(`${index + 1}. ${pathStr}`);
    });
  });

// start 主命令 + 别名 s
program
  .command('start')
  .alias('s')
  .description('启动完整流水线：串行构建 → 并行部署服务器')
  .action(async () => {
    const projectCfg = getProjectConfig();
    if (!projectCfg) {
      console.log(chalk.yellow('⚠️ 当前项目无配置，请先执行 dc init'));
      process.exit(1);
    }

    const { buildCommands, distPath, selectedServerIds } = projectCfg;
    const SERVER_LIST = getServerList();
    const targetServers = SERVER_LIST.filter(item =>
      selectedServerIds.includes(item.id)
    );

    console.log(
      chalk.cyan('==================== 任务开始 ====================')
    );
    console.log('构建命令序列：', buildCommands);
    console.log('产物目录：', distPath);
    console.log(
      '目标服务器：',
      targetServers.map(s => `${s.name} -> ${s.baseRemoteDir}`)
    );

    // 逐条串行构建，单条成功后立即部署到全部服务器
    // 设计意图：支持增量构建场景（如先构建基础包 → 部署 → 再构建业务包 → 部署）
    for (const buildCmd of buildCommands) {
      const buildOk = await runBuild(buildCmd);
      if (!buildOk) {
        console.log(chalk.red(`\n❌【${buildCmd}】构建失败，终止全部任务`));
        process.exit(1);
      }
      // 每次部署前校验产物目录，防止构建静默失败（产物未生成但退出码为 0）
      if (!checkDistExists(distPath)) {
        process.exit(1);
      }
      const deployResult = await deployParallel(targetServers, distPath);
      if (!deployResult.allOk) {
        console.log(chalk.red('\n❌ 部分服务器部署失败，终止后续任务'));
        process.exit(1);
      }
    }

    console.log(chalk.green.bold('\n🎉 所有构建与部署任务全部完成！'));
  });

// zip — 本地压缩目录
program
  .command('zip')
  .description('压缩目录为 zip（默认压缩缓存产物目录，无缓存回退 ./dist）')
  .argument('[srcDir]', '源目录（默认：缓存产物目录或 ./dist）')
  .option('-o, --output <file>', '输出文件（默认：./<目录名>.zip）')
  .action(async (srcDir, options) => {
    const target = srcDir || resolveDistPath();
    const absTarget = path.resolve(process.cwd(), target);
    if (!fs.existsSync(absTarget) || !fs.statSync(absTarget).isDirectory()) {
      console.log(chalk.red(`❌ 源目录不存在或不是目录：${absTarget}`));
      console.log(chalk.yellow('💡 可指定源目录：dc zip <目录>，或先执行 dc init 配置产物目录'));
      process.exit(1);
    }
    const output = options.output || path.join(process.cwd(), path.basename(absTarget) + '.zip');
    // 输出已存在 → 交互确认覆盖，避免误覆盖历史压缩包
    if (fs.existsSync(output)) {
      const { overwrite } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'overwrite',
          message: `输出文件已存在：${output}，是否覆盖？`,
          default: false
        }
      ]);
      if (!overwrite) {
        console.log(chalk.yellow('已取消压缩'));
        process.exit(0);
      }
    }
    const ok = await compressDir(absTarget, output);
    if (!ok) process.exit(1);
  });

// unzip — 本地解压 zip
program
  .command('unzip')
  .description('解压 zip 到目录（默认解压 ./<产物目录名>.zip 到缓存产物目录，无缓存回退 ./dist）')
  .argument('[archive]', '压缩包（默认：./<产物目录名>.zip）')
  .option('-d, --dest <dir>', '目标目录（默认：缓存产物目录或 ./dist）')
  .action(async (archive, options) => {
    const distPath = resolveDistPath();
    const absDist = path.resolve(process.cwd(), distPath);
    const file = archive || path.join(process.cwd(), path.basename(absDist) + '.zip');
    const dest = options.dest || distPath;
    const ok = await extractZip(file, dest);
    if (!ok) process.exit(1);
  });

// deploy — 纯部署：跳过构建，直接上传现有产物
program
  .command('deploy')
  .description('纯部署：跳过构建，直接上传缓存产物目录到选中服务器')
  .action(async () => {
    const projectCfg = getProjectConfig();
    if (!projectCfg) {
      console.log(chalk.yellow('⚠️ 当前项目无配置，请先执行 dc init'));
      process.exit(1);
    }

    const { distPath, selectedServerIds } = projectCfg;
    const SERVER_LIST = getServerList();
    const targetServers = SERVER_LIST.filter(item =>
      selectedServerIds.includes(item.id)
    );

    console.log(
      chalk.cyan('==================== 纯部署开始 ====================')
    );
    console.log('产物目录：', distPath);
    console.log(
      '目标服务器：',
      targetServers.map(s => `${s.name} -> ${s.baseRemoteDir}`)
    );

    // 与 dc start 相同的部署前产物校验，防止产物缺失时上传空目录
    if (!checkDistExists(distPath)) {
      process.exit(1);
    }
    const deployResult = await deployParallel(targetServers, distPath);
    if (!deployResult.allOk) {
      console.log(chalk.red('\n❌ 部分服务器部署失败，纯部署终止'));
      process.exit(1);
    }

    console.log(chalk.green.bold('\n🎉 纯部署完成！'));
  });

// commander 不支持将 -s 注册为 option 别名（会与 start 子命令冲突），
// 因此在 parse 之前手动将 -s 改写为 start，实现 dc -s ≡ dc start
const argv = process.argv;
if (argv.includes('-s') && !argv.includes('start') && !argv.includes('s')) {
  const idx = argv.indexOf('-s');
  argv.splice(idx, 1);
  argv.push('start');
}

// 捕获无效命令：commander 默认不报错，仅静默忽略。手动挂载兜底处理
program.on('command:*', function (unknownCmd) {
  console.error(chalk.red(`❌ 无效命令：${unknownCmd.join(' ')}`));
  console.log('\n');
  program.outputHelp();
  process.exit(1);
});

program.parse();
