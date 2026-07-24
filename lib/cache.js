/**
 * cache.js — 本地持久化缓存管理
 *
 * 配置文件：~/.deploy-cli.json，结构为 { serverList, projectConfigs }
 * - serverList：全局服务器清单，所有项目共享
 * - projectConfigs：以项目绝对路径为 key，存储每个项目的构建/部署配置
 *
 * 内存缓存策略：同一进程内 loadFullConfig() 只读一次磁盘，后续返回 _cache 引用。
 * 写操作直接更新 _cache + 原子写入磁盘，保证内存与磁盘一致。
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const chalk = require('chalk');

const CONFIG_FILE = path.join(os.homedir(), '.deploy-cli.json');
const CONFIG_TMP = CONFIG_FILE + '.tmp';

// 内存缓存，避免同一进程内反复 readFileSync + JSON.parse
// 设计意图：dc 命令生命周期短，无需考虑多进程缓存一致性问题
let _cache = null;

// 初始化空模板（静默创建，不打印也不退出 — 由调用方决定后续流程）
function initConfigFile() {
  const template = { serverList: [], projectConfigs: {} };
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(template, null, 2), 'utf8');
  _cache = template;
}

// 加载完整配置（优先内存缓存，减少磁盘 IO）
function loadFullConfig() {
  if (_cache) return _cache;

  if (!fs.existsSync(CONFIG_FILE)) {
    initConfigFile();
    return _cache;
  }

  try {
    const content = fs.readFileSync(CONFIG_FILE, 'utf8');
    const cfg = JSON.parse(content);
    // 结构兜底
    if (!Array.isArray(cfg.serverList)) cfg.serverList = [];
    if (typeof cfg.projectConfigs !== 'object') cfg.projectConfigs = {};
    _cache = cfg;
    return _cache;
  } catch (err) {
    console.log(chalk.red(`❌ 解析 .deploy-cli.json 失败: ${err.message}`));
    process.exit(1);
  }
}

// 原子写入：先写临时文件，再 rename，防止写入中途崩溃损坏配置
function saveFullConfig(cfg) {
  fs.writeFileSync(CONFIG_TMP, JSON.stringify(cfg, null, 2), 'utf8');
  fs.renameSync(CONFIG_TMP, CONFIG_FILE);
  _cache = cfg;
}

// 以当前工作目录的绝对路径作为项目唯一标识
// 设计意图：用户在不同终端 cd 到同一项目执行 dc 命令，key 始终一致
function getProjectKey() {
  return process.cwd();
}

// 获取服务器清单
function getServerList() {
  const cfg = loadFullConfig();
  return cfg.serverList;
}

// 获取当前项目配置
function getProjectConfig() {
  const cfg = loadFullConfig();
  const key = getProjectKey();
  return cfg.projectConfigs[key] || null;
}

// 保存当前项目配置
function saveProjectConfig(projectCfg) {
  const cfg = loadFullConfig();
  const key = getProjectKey();
  cfg.projectConfigs[key] = projectCfg;
  saveFullConfig(cfg);
  console.log(chalk.green(`✅ 当前项目配置已缓存`));
}

// 删除当前项目配置
function removeProjectConfig() {
  const cfg = loadFullConfig();
  const key = getProjectKey();
  if (cfg.projectConfigs[key]) {
    delete cfg.projectConfigs[key];
    saveFullConfig(cfg);
    return true;
  }
  return false;
}

// 获取全部缓存项目
function getAllCachedProjects() {
  const cfg = loadFullConfig();
  return cfg.projectConfigs;
}

module.exports = {
  getServerList,
  getProjectConfig,
  saveProjectConfig,
  removeProjectConfig,
  getAllCachedProjects
};
