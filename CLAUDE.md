# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概览

`deploy-cli`（命令名 `dc`）——前端「构建 → 部署」本地 CLI 脚手架。用户执行 `dc init` 交互式配置后，`dc start` 串行执行构建命令、单条构建成功后并行 SFTP 部署到多台服务器。

## 常用命令

```bash
npm install && npm link   # 安装依赖并全局链接 dc 命令（README 十一节）
node bin/index.js <cmd>   # 开发调试时直接跑入口，效果等同 dc <cmd>
```

package.json 无 scripts 字段（无 test / lint / build 脚本），**一切改动靠手动命令验证**，不引入测试框架（用户明确决策）。

CLI 命令：`init`（交互配置）、`start`/`s`/`-s`（构建+部署流水线）、`zip`（本地压缩）、`unzip`（本地解压）、`deploy`（纯部署，跳过构建）、`info`/`clean`/`list`（缓存查看管理）。

## 架构

```
bin/index.js   CLI 入口：commander 注册命令，action 直接调 lib/*.js，决定退出码
lib/
  cache.js     持久化缓存：~/.deploy-cli.json = { serverList, projectConfigs }
  init.js      dc init 交互逻辑（inquirer 多选脚本/服务器）
  build.js     runBuild（系统 shell + 项目本地 bin）+ checkDistExists
  deploy.js    deployParallel（node-ssh SFTP putDirectory）
  zip.js       compressDir / extractZip（archiver + unzipper）
```

### 配置模型（cache.js）

- 配置文件在**用户家目录** `~/.deploy-cli.json`，不放进业务项目仓库
- `projectConfigs` 以**项目绝对路径（process.cwd()）为 key**，不同目录配置互相隔离
- 每项目配置：`{ buildCommands[], distPath, selectedServerIds[] }`
- 服务器清单存配置文件的 `serverList`，`dc init` 时用户只勾选启用哪些，不能新增
- 内存缓存 `_cache` + 原子写入（tmp 文件 + renameSync）
- `lib/constant.js` 是遗留文件（内置示例服务器列表），**未被任何代码引用**，不要依赖它

### 执行模型

- **dc start**：for 循环串行执行 buildCommands → 每条成功后 `checkDistExists` 校验 → `deployParallel` 并行上传所有选中服务器 → 任一步失败立即 `process.exit(1)` 终止全流程
- **dc deploy**：与 start 相同，但**跳过构建循环**，直接校验产物并上传
- **dc zip/unzip 默认目录**：优先缓存配置 `distPath`，无缓存回退 `./dist`（`resolveDistPath` 辅助函数在 bin/index.js）

### 关键约定（全局一致，改动时遵守）

- **错误处理**：lib 层函数**返回 boolean**（或结果对象），不抛异常、不 process.exit——由 bin/index.js 层打印 chalk 彩色中文提示并决定退出码。例外：`deployParallel` 返回 `{ deployed, allOk }`
- **注释与输出**：中文注释，解释"为什么"而非"是什么"；用户可见输出用 chalk 颜色 + emoji（✅❌⚠️💡🎉）
- **CommonJS**（require），不用 ESM——archiver 必须保持 **v7**（v8 是纯 ESM 包，与项目不兼容，曾踩坑降级）
- **`dc -s` 别名**：commander 不支持把 `-s` 注册为 option 别名，bin/index.js 底部在 `program.parse()` 前手动改写 argv 实现，改动命令注册时不要破坏这段逻辑
- 构建命令用 `execa` 显式调用系统 shell，优先解析项目本地 `node_modules/.bin`，支持 `&&`、引号等复杂语法
- 部署用 `node-ssh` 的 `putDirectory`（SFTP 目录上传，8 并发，连接超时 15s / 传输超时 60s），`Promise.allSettled` 保证单台服务器失败不影响其他
- 提交规范：提交信息不带 AI 共创标记（无 Co-Authored-By）；除非计划明确授权，不自动提交

## 平台

Windows / macOS / Linux 跨平台（init.js 有跨平台打开配置文件 fallback 链：VS Code → notepad/open/xdg-open）。开发环境 Windows + Git Bash。
