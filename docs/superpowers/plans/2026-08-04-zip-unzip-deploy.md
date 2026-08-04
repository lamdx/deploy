# dc CLI 新增 zip / unzip / deploy 命令 — 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 dc CLI 新增三个独立命令：`dc zip`（本地压缩）、`dc unzip`（本地解压）、`dc deploy`（纯部署，跳过构建）。

**Architecture:** 新增 `lib/zip.js` 模块封装压缩/解压（archiver + unzipper，返回 `Promise<boolean>`），`bin/index.js` 注册三个 commander 命令。`dc deploy` 完全复用现有 `getProjectConfig` / `checkDistExists` / `deployParallel`，只跳过 `runBuild` 循环。

**Tech Stack:** Node.js (CommonJS)、commander、chalk、inquirer、archiver、unzipper

## Global Constraints

- 项目为 CommonJS（`require`），不使用 ESM
- 不引入测试框架（用户已确认），每个任务用手动命令验证
- 代码风格：中文注释（解释为什么）、chalk 彩色输出、函数返回 boolean 不抛异常（与 `lib/build.js` 的 `runBuild` 一致）
- git 提交由本计划明确授权，提交信息不带任何 AI 共创标记（无 Co-Authored-By）
- 不修改 `lib/build.js` / `lib/deploy.js` / `lib/cache.js` / `lib/init.js` 现有逻辑
- 验证命令在 Git Bash (Windows) 下执行

---

### Task 1: lib/zip.js 压缩/解压模块

**Files:**
- Create: `D:\deploy\lib\zip.js`
- Modify: `D:\deploy\package.json`（新增依赖，由 npm install 完成）

**Interfaces:**
- Produces:
  - `compressDir(srcDir, outputFile)` → `Promise<boolean>` — 把 srcDir 的内容（不含顶层目录本身）压缩为 zip；成功打印大小+耗时
  - `extractZip(archive, destDir)` → `Promise<boolean>` — 解压 zip 到 destDir（自动创建）；成功打印文件数+耗时
  - 两者内部均用 `path.resolve(process.cwd(), ...)` 解析相对路径（与 `checkDistExists` 一致）

- [ ] **Step 1: 安装依赖**

```bash
cd /d/deploy && npm install archiver unzipper
```

Expected: package.json dependencies 新增 archiver、unzipper。

- [ ] **Step 2: 创建 lib/zip.js**

```js
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
```

- [ ] **Step 3: 手动验证压缩 → 解压往返**

在 `D:\deploy` 目录下运行（Node heredoc 脚本，构造临时目录 → 压缩 → 解压 → 比对内容）：

```bash
cd /d/deploy && node - <<'EOF'
const { compressDir, extractZip } = require('./lib/zip');
const fs = require('fs');
const os = require('os');
const path = require('path');
(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dc-zip-test-'));
  const src = path.join(root, 'src');
  fs.mkdirSync(path.join(src, 'nested'), { recursive: true });
  fs.writeFileSync(path.join(src, 'a.txt'), 'hello');
  fs.writeFileSync(path.join(src, 'nested', 'b.txt'), 'world');
  const ok1 = await compressDir(src, path.join(root, 'out.zip'));
  const ok2 = await extractZip(path.join(root, 'out.zip'), path.join(root, 'out'));
  const same =
    fs.readFileSync(path.join(root, 'out', 'a.txt'), 'utf8') === 'hello' &&
    fs.readFileSync(path.join(root, 'out', 'nested', 'b.txt'), 'utf8') === 'world';
  console.log('compress:', ok1, 'extract:', ok2, 'roundtrip:', same);
  fs.rmSync(root, { recursive: true, force: true });
  process.exit(ok1 && ok2 && same ? 0 : 1);
})();
EOF
```

Expected: 三行绿色 ✅ 输出 + `compress: true extract: true roundtrip: true`，退出码 0。

- [ ] **Step 4: 手动验证错误场景**

```bash
cd /d/deploy && node -e "const {compressDir,extractZip}=require('./lib/zip');compressDir('C:/不存在的目录','C:/x.zip').then(r=>{console.log('result:',r);process.exit(r?1:0)})"
cd /d/deploy && node -e "const {extractZip}=require('./lib/zip');extractZip('C:/不存在的包.zip','C:/x').then(r=>{console.log('result:',r);process.exit(r?1:0)})"
```

Expected: 红色 ❌ 提示，`result: false`，退出码 0（函数不抛异常）。

- [ ] **Step 5: 提交**

```bash
cd /d/deploy && git add package.json package-lock.json lib/zip.js && git commit -m "feat: 新增 lib/zip.js 本地压缩/解压模块"
```

---

### Task 2: dc zip / dc unzip 命令

**Files:**
- Modify: `D:\deploy\bin\index.js`

**Interfaces:**
- Consumes: `compressDir(srcDir, outputFile)` / `extractZip(archive, destDir)`（Task 1）、`getProjectConfig()`（现有 cache.js）
- Produces:
  - `dc zip [srcDir] [-o <file>]` — 无参默认压缩缓存 distPath（无缓存回退 `./dist`），默认输出 `./<目录名>.zip`
  - `dc unzip [archive] [-d <dir>]` — 无参默认解压 `./<产物目录名>.zip` 到缓存 distPath（无缓存回退 `./dist`）
  - 内部辅助函数 `resolveDistPath()`：`getProjectConfig()?.distPath || './dist'`

- [ ] **Step 1: 修改 bin/index.js — 补充 import**

在 `bin/index.js` 顶部 import 区（第 10-20 行附近）新增：

```js
const fs = require('fs');
const path = require('path');
const inquirer = require('inquirer');
const { compressDir, extractZip } = require('../lib/zip');
```

`getProjectConfig` 已在现有 import 中（`require('../lib/cache')`），无需重复。

- [ ] **Step 2: 新增 resolveDistPath 辅助函数**

在 `program.name(...)` 定义之后、`dc init` 命令注册之前插入：

```js
// 解析默认产物目录：优先缓存配置 distPath，无配置回退 ./dist
function resolveDistPath() {
  const cfg = getProjectConfig();
  return (cfg && cfg.distPath) || './dist';
}
```

- [ ] **Step 3: 注册 dc zip 命令**

在 `dc start` 命令注册块（第 104-151 行）之后插入：

```js
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
```

- [ ] **Step 4: 注册 dc unzip 命令**

在 dc zip 命令注册块之后插入：

```js
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
```

- [ ] **Step 5: 手动验证默认目录往返（无缓存回退 ./dist 路径）**

```bash
mkdir -p "$TEMP/dc-cli-test/dist/sub" && echo hi > "$TEMP/dc-cli-test/dist/a.txt" && echo there > "$TEMP/dc-cli-test/dist/sub/b.txt" && cp -r "$TEMP/dc-cli-test/dist" "$TEMP/dc-cli-test/dist-orig"
cd "$TEMP/dc-cli-test" && node /d/deploy/bin/index.js zip
```

Expected: 绿色 ✅ 压缩完成 `.../dist.zip`。

```bash
cd "$TEMP/dc-cli-test" && ls dist.zip && rm -rf dist && node /d/deploy/bin/index.js unzip && diff -r dist-orig dist && echo ROUNDTRIP-OK
```

Expected: `ROUNDTRIP-OK`，目录内容一致。

- [ ] **Step 6: 手动验证覆盖确认与显式参数**

```bash
cd "$TEMP/dc-cli-test" && printf 'n\n' | node /d/deploy/bin/index.js zip
```

Expected: 提示"输出文件已存在…是否覆盖？"，输入 n 后黄色"已取消压缩"，不重新写入（对比 dist.zip 时间戳无变化）。

```bash
cd "$TEMP/dc-cli-test" && node /d/deploy/bin/index.js zip dist -o custom.zip && node /d/deploy/bin/index.js unzip custom.zip -d custom-out && diff -r dist-orig custom-out && echo EXPLICIT-OK
```

Expected: `EXPLICIT-OK`。

```bash
cd "$TEMP/dc-cli-test" && node /d/deploy/bin/index.js zip C:/不存在的目录; echo "exit=$?"
```

Expected: 红色 ❌ 源目录不存在提示，`exit=1`。

- [ ] **Step 7: 提交**

```bash
cd /d/deploy && git add bin/index.js && git commit -m "feat: 新增 dc zip / dc unzip 命令"
```

---

### Task 3: dc deploy 纯部署命令

**Files:**
- Modify: `D:\deploy\bin\index.js`

**Interfaces:**
- Consumes: `getProjectConfig()` / `getServerList()`（现有 cache.js）、`checkDistExists` / `deployParallel`（现有 build.js / deploy.js）
- Produces: `dc deploy` — 无参数命令，复用缓存配置跳过构建直接部署

- [ ] **Step 1: 注册 dc deploy 命令**

在 dc unzip 命令注册块之后插入（紧邻 start 命令，便于对照）：

```js
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
```

- [ ] **Step 2: 手动验证无配置错误路径**

```bash
mkdir -p "$TEMP/dc-deploy-test" && cd "$TEMP/dc-deploy-test" && node /d/deploy/bin/index.js deploy; echo "exit=$?"
```

Expected: 黄色 `⚠️ 当前项目无配置，请先执行 dc init`，`exit=1`。

- [ ] **Step 3: 手动验证帮助输出**

```bash
cd /d/deploy && node bin/index.js --help
```

Expected: 帮助列表中包含 `zip`、`unzip`、`deploy` 三个新命令及描述。

> ⚠️ 注意：`dc deploy` 的成功路径（真实上传）会向真实服务器部署产物。不要在本机缓存配置存在且有真实服务器条目的目录下运行此命令验证。成功路径由用户在实际项目中自行验证。

- [ ] **Step 4: 提交**

```bash
cd /d/deploy && git add bin/index.js && git commit -m "feat: 新增 dc deploy 纯部署命令"
```

---

### Task 4: 版本号、帮助说明与 README 文档

**Files:**
- Modify: `D:\deploy\bin\index.js`（version 与 description）
- Modify: `D:\deploy\README.md`（三个命令文档 + 零参数往返示例）

**Interfaces:**
- Consumes: Task 2 / Task 3 的命令定义
- Produces: 发布就绪的 v1.4.0

- [ ] **Step 1: 更新版本号与 program 描述**

`bin/index.js` 中：

```js
.version('1.4.0', '-v, --version')
```

description 模板字符串中追加两条规则（在现有规则 4 之后）：

```
5. dc zip / dc unzip 本地压缩/解压产物目录，默认使用缓存产物目录
6. dc deploy 纯部署：跳过构建，直接上传现有产物
```

- [ ] **Step 2: 更新 README.md**

在 README 的命令清单部分追加以下三个命令说明（跟随 README 现有的标题层级和表格风格，位置放在 `dc start` 相关文档之后）：

```markdown
## dc zip — 本地压缩产物目录

压缩目录为 zip 文件（默认压缩缓存产物目录，无缓存回退 ./dist）

    dc zip                     # 默认压缩缓存产物目录（或 ./dist）→ ./dist.zip
    dc zip ./public -o app.zip # 指定源目录与输出文件

输出文件已存在时交互确认覆盖；成功输出压缩包大小与耗时。

## dc unzip — 本地解压 zip

解压 zip 到目录（默认解压 ./dist.zip 到缓存产物目录，无缓存回退 ./dist）

    dc unzip                    # 默认解压 ./dist.zip → 缓存产物目录（或 ./dist）
    dc unzip app.zip -d ./tmp   # 指定压缩包与目标目录

压缩包损坏时明确报错；目标目录不存在自动创建。

## dc deploy — 纯部署（跳过构建）

复用 dc init 缓存配置，跳过构建命令，直接上传现有产物到选中服务器

    dc deploy

适合"产物已构建好、只想重新上传"的场景；与 dc start 共用部署逻辑。
```

同时在 README 的命令速览表（如有）中补上 `zip` / `unzip` / `deploy` 三行。

- [ ] **Step 3: 验证**

```bash
cd /d/deploy && node bin/index.js -v
cd /d/deploy && node bin/index.js --help
```

Expected: `1.4.0`；帮助描述包含新规则 5、6，命令列表含 zip / unzip / deploy。

- [ ] **Step 4: 最终回归（start 命令不受影响）**

```bash
cd /d/deploy && node bin/index.js --help >/dev/null && echo HELP-OK
cd "$TEMP/dc-cli-test" && node /d/deploy/bin/index.js zip && node /d/deploy/bin/index.js unzip && echo REGRESSION-OK
```

Expected: `HELP-OK` 与 `REGRESSION-OK`。

> 注：`dc start` 的完整回归需真实构建，不在此计划内验证；本次未改动 start 相关代码路径。

- [ ] **Step 5: 提交**

```bash
cd /d/deploy && git add bin/index.js README.md && git commit -m "docs: 更新 README 并发布 v1.4.0（zip/unzip/deploy）"
```

---

## 自审结论

- **Spec 覆盖**：命令接口（§3.1-3.4）→ Task 2/3；模块设计（§4.1-4.3）→ Task 1/2；依赖（§4.3）→ Task 1 Step 1；错误处理（§5）→ 各命令校验分支；配套改动（§6）→ Task 4。非需求边界未越界（无远端解压、无加密、无通配符、不引入测试框架、不修改现有 lib）。
- **类型一致性**：`compressDir(srcDir, outputFile)` / `extractZip(archive, destDir)` 签名在 Task 1 定义、Task 2 消费，一致；`resolveDistPath()` 在 Task 2 定义，Task 2 内部使用。
- **无占位符**：所有代码块为完整可运行内容。
