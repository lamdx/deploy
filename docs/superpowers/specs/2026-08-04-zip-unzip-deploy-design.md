# dc CLI 新增 zip / unzip / deploy 命令 — 设计文档

日期：2026-08-04
状态：已批准（用户确认）

## 一、背景与需求

现有 `dc`（deploy-cli v1.3.0）脚手架支持：

- `dc init` — 交互式配置（构建命令、产物目录 distPath、目标服务器），缓存到 `~/.deploy-cli.json`，以项目绝对路径为 key
- `dc start`（`dc s` / `dc -s`）— 串行执行构建命令，单条成功后并行 SFTP 部署到所有选中服务器

本次新增三个独立命令：

1. `dc zip` — 本地压缩目录为 zip 文件（纯工具）
2. `dc unzip` — 本地解压 zip 文件到目录（纯工具）
3. `dc deploy` — 纯部署：复用缓存配置，跳过构建，直接上传现有产物

## 二、需求决策（已与用户确认）

| 决策点 | 结论 |
|---|---|
| 功能组织 | 全部独立命令，不修改现有 `dc start` 流程 |
| 解压位置 | 本地解压（纯工具），不做远端解压 |
| 压缩格式 | zip（Windows/macOS 通用，双击可查看） |
| deploy 配置来源 | 复用 `dc init` 缓存（distPath + selectedServerIds），无缓存提示先 init |
| 默认目录 | zip / unzip 均默认使用缓存 distPath；无缓存时回退 `./dist` |
| 测试 | 本次不引入测试框架，保持项目现状 |

## 三、命令接口

### 3.1 `dc zip [srcDir]`

```
dc zip [srcDir] [-o, --output <file>]
```

- `srcDir` 可选：默认 = 缓存配置的 `distPath`（无缓存回退 `./dist`）
- `-o` 可选：默认 `./<srcDir 目录名>.zip`（例如 `./dist` → `./dist.zip`），路径相对于当前工作目录
- 校验：
  - srcDir 必须是存在的目录，否则红色报错退出（exit 1）
  - 输出文件已存在 → 交互式确认覆盖（inquirer confirm），拒绝则退出不写入
- 成功输出：绿色 ✅ + 压缩包大小 + 耗时

### 3.2 `dc unzip [archive]`

```
dc unzip [archive] [-d, --dest <dir>]
```

- `archive` 可选：默认 = 当前目录下 `<distPath 目录名>.zip`（例如 `./dist.zip`），与 `dc zip` 默认输出对应
- `-d` 可选：默认 = 缓存配置的 `distPath`（无缓存回退 `./dist`）
- 校验：
  - archive 必须存在且为 `.zip` 后缀，否则红色报错退出
  - 压缩包损坏 / 解压中途失败 → 红色报错 + 原因，退出 exit 1
  - 目标目录不存在则自动创建（递归创建）
- 成功输出：绿色 ✅ + 解压文件数 + 耗时

### 3.3 零参数往返用法（核心场景）

```
dc zip     # dist → dist.zip（打包产物）
dc unzip   # dist.zip → dist（恢复产物）
```

### 3.4 `dc deploy`

```
dc deploy
```

流程（与 `dc start` 共享全部模块，仅跳过构建）：

```
读缓存配置 → 无配置则黄色提示"请先 dc init"退出(exit 1)
→ checkDistExists(distPath) 校验产物目录
→ deployParallel(targetServers, distPath) 并行 SFTP 上传
→ 打印部署汇总
```

- 产物目录不存在 → 红色报错退出
- 部分服务器失败 → 打印失败明细（与现有 `dc start` 的汇总行为一致）

## 四、模块设计

### 4.1 新增 `lib/zip.js`

跟随现有代码风格（中文注释、chalk 输出、返回值由调用方决定退出码）：

```js
/**
 * 压缩目录为 zip
 * @param {string} srcDir   - 源目录绝对路径
 * @param {string} outputFile - 输出 zip 绝对路径
 * @returns {Promise<boolean>} 成功返回 true
 */
async function compressDir(srcDir, outputFile)

/**
 * 解压 zip 到目录
 * @param {string} archive - 压缩包绝对路径
 * @param {string} destDir - 目标目录绝对路径（不存在则创建）
 * @returns {Promise<boolean>} 成功返回 true
 */
async function extractZip(archive, destDir)
```

- 使用 `archiver` 创建 zip（流式，`finalize` 后 resolve）
- 使用 `unzipper` 解压（流式，`fs.createReadStream().pipe(unzipper.Extract({ path }))`，监听 finish/error）
- 错误处理：catch 后打印红色错误消息，返回 `false`，不抛异常、不 process.exit（与 `build.js` 的 `runBuild` 模式一致，由 bin 层决定退出码）

### 4.2 `bin/index.js` 变更

新增 3 个 commander 命令，default 值解析逻辑（每个命令内部）：

```
resolveDistPath()  // 缓存 distPath || './dist'
```

- `dc zip`：`srcDir = args.srcDir || resolveDistPath()`；`output = args.output || path.join(cwd, path.basename(srcDir) + '.zip')`
- `dc unzip`：`archive = args.archive || path.join(cwd, path.basename(resolveDistPath()) + '.zip')`；`dest = args.dest || resolveDistPath()`
- `dc deploy`：复用 `getProjectConfig` / `checkDistExists` / `deployParallel`，与 `dc start` 相同的服务器筛选与汇总逻辑

命令注册位置：`dc start` 之后。`dc deploy` 无别名（保持简单）。

### 4.3 依赖变更

package.json dependencies 新增：

- `archiver` — 流式创建 zip
- `unzipper` — 流式解压 zip

## 五、错误处理汇总

| 场景 | 行为 |
|---|---|
| zip：srcDir 不存在 / 不是目录 | 红色报错，exit 1 |
| zip：输出文件已存在 | inquirer 确认覆盖，拒绝则不写入退出 |
| zip：压缩过程出错（磁盘满等） | 红色报错 + 原因，exit 1 |
| unzip：archive 不存在 / 非 .zip | 红色报错，exit 1 |
| unzip：压缩包损坏 / 解压失败 | 红色报错 + 原因，exit 1 |
| deploy：无缓存配置 | 黄色提示先 `dc init`，exit 1 |
| deploy：产物目录不存在 | 红色报错，exit 1 |
| deploy：部分服务器失败 | 打印失败明细（与 dc start 一致） |

## 六、配套改动

1. `README.md` — 补充 `dc zip` / `dc unzip` / `dc deploy` 命令文档与零参数往返示例
2. `bin/index.js` — `program.version` 1.3.0 → 1.4.0；`program.description` 补充新命令说明
3. 不修改 `lib/build.js` / `lib/deploy.js` / `lib/cache.js` / `lib/init.js` 现有逻辑（`dc start` 行为完全不变）

## 七、非需求边界

- 不做远端解压（unzip 仅本地）
- 不支持 zip 加密 / 分卷
- 不修改现有 `dc start` 流程
- `dc zip` 不支持通配符 / 排除规则（单目录整体打包）
- 不引入测试框架
- `dc deploy` 不支持命令行参数指定服务器（仅复用缓存配置）
