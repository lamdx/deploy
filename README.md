DC 前端自动构建部署脚手架 规格文档

一、项目概述
一款 Node.js 本地 CLI 脚手架，实现流程：
dc init 交互式配置 → dc start 串行执行多条构建命令，单条构建成功后并行多服务器 SFTP 部署

- 无项目侧配置文件，所有配置缓存至本机用户目录；
- 服务器列表存储在用户家目录配置文件，业务项目仅可勾选已配置的服务器；
- 传输协议：SFTP over SSH，不依赖 rsync；
- 构建失败立即终止全流程，不继续执行后续任务。

二、整体流程图

```
dc init
├── 校验 package.json 是否存在
│   └── 无 → ❌ 退出
├── 提取 npm scripts 列表
│   └── 空 → ❌ 退出
├── 加载 ~/.deploy-cli.json
│   ├── 文件不存在 → 自动生成空模板 → 打印示例 → [打开编辑?] → 退出
│   └── serverList 为空 → 打印示例 → [打开编辑?] → 退出
│   └── serverList 有数据 → ✅ 继续
├── 已有项目缓存? → ⚠️ 提示覆盖
├── 交互式问答
│   ├── 勾选构建命令（顺序=执行顺序）
│   ├── 输入产物目录（默认 ./dist）
│   └── 勾选目标服务器
└── 保存到 projectConfigs[cwd]

dc start / dc s / dc -s
├── 读取当前项目缓存
│   └── 无 → ⚠️ 提示 dc init
├── 匹配服务器列表 → 过滤选中服务器
└── for each 构建命令（串行）
    ├── execaCommand(cmd)  ← shell 模式解析
    │   └── 失败 → ❌ 终止全流程（含 exitCode / stderr）
    ├── checkDistExists()
    │   └── 不存在 → ❌ 终止
    └── deployParallel(servers, dist)  ← Promise.allSettled
        └── 打印汇总（成功 N 台 / 失败 M 台）
        └── 有失败 → ❌ 终止

dc info
├── 读取当前项目缓存 → 打印构建命令 / dist / 目标服务器
└── 无缓存 → ⚠️ 提示

dc clean  →  删除当前项目缓存
dc list   →  列出所有缓存项目路径

dc zip [srcDir] [-o 输出]
├── 源目录 = 参数 || 缓存 distPath || ./dist
│   └── 不存在 → ❌ 退出
├── 输出文件 = 参数 || ./<目录名>.zip
│   └── 已存在 → 交互确认覆盖（拒绝 → 退出）
└── compressDir()  ← archiver 流式压缩
    └── 成功 → ✅ 输出大小 + 耗时

dc unzip [archive] [-d 目标]
├── 压缩包 = 参数 || ./<产物目录名>.zip
│   └── 不存在 / 非 .zip → ❌ 退出
├── 目标目录 = 参数 || 缓存 distPath || ./dist（不存在自动创建）
└── extractZip()  ← unzipper 流式解压
    └── 损坏 → ❌ 退出；成功 → ✅ 输出文件数 + 耗时

dc deploy
├── 读取当前项目缓存
│   └── 无 → ⚠️ 提示 dc init
├── checkDistExists()
│   └── 不存在 → ❌ 退出
└── deployParallel(servers, dist)  ← 与 dc start 相同，跳过构建
    └── 打印汇总（成功 N 台 / 失败 M 台）
```

三、目录结构

```plaintext
deploy-cli/
├── bin/
│   └── index.js           # CLI入口、命令解析、参数转发、异常兜底
├── lib/
│   ├── cache.js           # 本地持久化缓存管理（JSON文件）
│   ├── init.js            # dc init 交互式初始化逻辑（含配置文件自动打开）
│   ├── build.js           # 执行构建命令、dist目录校验
│   ├── deploy.js          # SFTP并行部署、ssh超时控制
│   └── zip.js             # 本地压缩/解压工具（archiver + unzipper）
├── package.json
```

四、package.json 基础配置

使用 commander 做命令行、execa 执行构建、node-ssh 实现服务器部署。

```json
{
  "name": "deploy-cli",
  "version": "1.4.0",
  "bin": {
    "dc": "./bin/index.js"
  },
  "dependencies": {
    "archiver": "^7.0.0",
    "chalk": "^4.1.2",
    "commander": "^11.1.0",
    "execa": "^8.0.1",
    "inquirer": "^8.2.6",
    "node-ssh": "^13.1.0",
    "unzipper": "^0.12.5"
  }
}
```

五、缓存机制规范
存储位置：`用户家目录/.deploy-cli.json`
Windows：`C:\Users\用户名\.deploy-cli.json`
Mac/Linux：`~/.deploy-cli.json`

首次运行 dc 时自动生成配置文件模板，内含 `serverList`（服务器清单）和 `projectConfigs`（各项目缓存）。

完整配置文件结构

```json
{
  "serverList": [
    {
      "id": "test-server",
      "name": "测试服务器",
      "host": "127.0.0.1",
      "port": 22,
      "username": "root",
      "password": "ssh密码",
      "baseRemoteDir": "/www/test"
    }
  ],
  "projectConfigs": {
    "D:/code/project-admin": {
      "buildCommands": ["vue-tsc -b && vite build"],
      "distPath": "./dist",
      "selectedServerIds": ["test-server"]
    }
  }
}
```

缓存 Key：当前项目绝对路径，不同目录配置互相隔离。
服务器不再内置在源码中，统一存放在此配置文件。

实现细节
- 内存缓存：同一进程内 loadFullConfig() 只读一次磁盘，后续返回缓存引用；
- 原子写入：先写 .tmp 临时文件，再 renameSync 覆盖原文件，防止写入中途崩溃损坏配置；
- 结构兜底：解析时自动修复缺失字段（serverList 非数组 → []，projectConfigs 非对象 → {}）。

六、服务器配置规范
服务器列表储存在用户家目录 `.deploy-cli.json` 配置文件中的 `serverList` 数组。

字段说明

| 字段           | 说明                                                    |
| -------------- | ------------------------------------------------------- |
| id             | 唯一标识，缓存仅存储 id                                  |
| name           | 展示名称                                                |
| host           | 服务器 IP 或域名                                        |
| port           | SSH 端口，默认 22                                       |
| username       | SSH 用户名                                              |
| password       | SSH 密码（密码模式）                                     |
| privateKey     | 本地私钥绝对路径，与 password 二选一                     |
| baseRemoteDir  | 远端部署目录，不自动追加项目文件夹名                     |

dc init 时若 serverList 为空，会提示并尝试自动打开配置文件供编辑（详见第十三节）。

七、全部命令清单 & 等价规则

| 命令              | 功能说明                                                                                                            |
| ----------------- | ------------------------------------------------------------------------------------------------------------------- |
| dc init           | 交互式初始化；读取 package.json scripts，多选构建命令、填写 dist 目录、勾选服务器；覆盖已有缓存。serverList 为空时自动提示打开配置文件 |
| dc info           | 查看当前目录已缓存的部署配置                                                                                        |
| dc clean          | 删除当前项目缓存配置                                                                                                |
| dc list           | 列出本机所有缓存项目绝对路径                                                                                        |
| dc start          | 启动完整流水线：构建 + 并行部署                                                                                     |
| dc s              | start 子命令别名，等价 dc start                                                                                     |
| dc -s             | 参数转发，等价 dc start                                                                                             |
| dc zip            | 本地压缩目录为 zip（默认压缩缓存产物目录，无缓存回退 ./dist）                                                        |
| dc unzip          | 本地解压 zip 到目录（默认解压 ./<产物目录名>.zip 到缓存产物目录，无缓存回退 ./dist）                                |
| dc deploy         | 纯部署：跳过构建，直接上传现有产物到选中服务器                                                                      |
| dc -v / --version | 输出版本号，commander 原生支持                                                                                      |
| dc -h / --help    | 输出帮助文档，commander 原生支持                                                                                    |

非法命令行为
输入不存在命令（如 dc inff）：
打印红色错误提示，自动输出完整帮助文档，进程退出。

八、流水线执行逻辑（dc start / dc -s）

1. 读取当前目录缓存配置，无配置直接提示执行 dc init 并退出；
2. 循环遍历 buildCommands（勾选顺序 = 执行顺序，串行执行）

- 执行构建命令（execaCommand shell 模式，支持 && / || / 引号等复杂语法）
- 构建失败 → 输出 exitCode + stderr → 立即终止全部任务
- 构建成功 → 校验本地 dist 目录是否存在（防止构建静默失败）；不存在直接退出
- dist 校验通过 → 并行部署所有选中服务器（Promise.allSettled，互不影响）
- 部署完成打印汇总（成功 N 台 / 失败 M 台），有任意失败则终止后续

3. 所有构建 + 部署全部完成，输出成功提示。

九、构建执行规则（lib/build.js）

1. 使用 execaCommand 执行，内部交给系统 shell 解析完整命令；
2. stdio 继承终端，构建日志实时输出；
3. 命令退出码非 0 → 判定失败，输出 exitCode、stderr、shortMessage 辅助排查。

十、部署规则（lib/deploy.js）

1. 传输方式：SFTP over SSH（移除 rsync，消除服务器前置依赖）
2. 超时配置
   SSH 连接超时：15000ms（覆盖大部分公网握手）
   文件上传超时：60000ms（覆盖典型前端 dist 目录）
   SFTP 并发线程：8（node-ssh putDirectory 推荐默认值）
3. 多服务器：Promise.allSettled 并行上传，单台失败不影响其他机器
4. SSH 连接仅传入必要字段（host/port/username/password），过滤 id/name/baseRemoteDir
5. 远端路径：直接使用 server.baseRemoteDir，不再追加项目文件夹名称
6. 注意：SFTP 上传仅覆盖同名文件，不会自动删除服务器残留旧文件

十一、环境与安装使用规范

1. 本地安装链接

```bash
cd deploy-cli
npm install
npm link
```

2. 标准使用流程

```bash
# 1.进入前端项目目录
cd D:/code/project-admin
# 2.初始化配置
dc init
# 3.核对配置
dc info
# 4.启动流水线
dc start
# 查看本机所有缓存项目
dc list
# 清除当前项目配置
dc clean
```

十二、风险与注意事项

1. 服务器密码明文存储在用户家目录配置文件，建议使用 SSH 私钥登录替代密码；
2. Windows 全局命令注意系统 PATH 环境差异；复杂全局命令建议使用绝对路径；
3. 若服务器限制 root 密码登录，必须切换为私钥登录方式；
4. 缓存文件无需纳入项目 git，存在用户家目录，不污染业务代码；
5. 服务器列表直接编辑 `~/.deploy-cli.json` 的 `serverList` 字段，保存后立即生效，无需重新 link。

十三、配置文件自动打开机制

dc init 检测到 serverList 为空时，会提示用户是否打开配置文件进行编辑。
打开逻辑采用跨平台 fallback 链策略：

| 平台    | 优先级 1      | 降级方案  |
| ------- | ------------- | --------- |
| Windows | VS Code (cmd) | 记事本    |
| macOS   | VS Code       | 系统默认  |
| Linux   | VS Code       | xdg-open  |

实现细节
- 使用 `spawn` + `detached: true` + `unref()`，子进程脱离父进程独立运行；
- 200ms 超时检测 spawn `error` 事件，失败自动降级到下一个方案；
- 父进程 `process.exit` 不影响已脱离的子进程，确保编辑器正常打开。

十四、已知可扩展点（后续迭代）

1. 增加远端目录前置清空脚本，解决旧文件残留；
2. 增加部署前后自定义钩子脚本；
3. 增加日志持久化输出；
4. 支持环境变量注入服务器密码，避免源码明文。

十五、压缩 / 解压与纯部署（dc zip / dc unzip / dc deploy）

dc zip — 本地压缩产物目录

压缩目录为 zip 文件（默认压缩缓存产物目录，无缓存回退 ./dist）

    dc zip                     # 默认压缩缓存产物目录（或 ./dist）→ ./dist.zip
    dc zip ./public -o app.zip # 指定源目录与输出文件

输出文件已存在时交互确认覆盖；成功输出压缩包大小与耗时。

dc unzip — 本地解压 zip

解压 zip 到目录（默认解压 ./dist.zip 到缓存产物目录，无缓存回退 ./dist）

    dc unzip                    # 默认解压 ./dist.zip → 缓存产物目录（或 ./dist）
    dc unzip app.zip -d ./tmp   # 指定压缩包与目标目录

压缩包损坏时明确报错；目标目录不存在自动创建。

dc deploy — 纯部署（跳过构建）

复用 dc init 缓存配置，跳过构建命令，直接上传现有产物到选中服务器

    dc deploy

适合"产物已构建好、只想重新上传"的场景；与 dc start 共用部署逻辑。
