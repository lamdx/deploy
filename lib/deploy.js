/**
 * deploy.js — SFTP 并行部署
 *
 * 传输方式：SFTP over SSH（不依赖 rsync，服务器零前置依赖）
 * 策略：所有目标服务器并行上传，单台失败不影响其他机器
 */
const chalk = require('chalk');
const { NodeSSH } = require('node-ssh');
const path = require('path');

// 超时配置：15s 足够大部分公网 SSH 握手，60s 覆盖典型前端 dist 目录上传
const SSH_CONNECT_TIMEOUT = 15000;
const TRANSFER_TIMEOUT = 60000;
// 并发上传线程数：8 是 node-ssh putDirectory 的推荐默认值，平衡带宽与连接数
const SFTP_CONCURRENCY = 8;

/**
 * 部署到单台服务器
 *
 * 设计意图：不抛异常，返回 { server, success, error? }。
 * 让调用方（deployParallel）自行汇总，而非一台失败中断全流程。
 *
 * @param {object} server  - 服务器配置（id, name, host, port, username, password, baseRemoteDir）
 * @param {string} localDist - 本地产物相对路径
 * @returns {Promise<{server: string, success: boolean, error?: string}>}
 */
async function deploySingleServer(server, localDist) {
  const ssh = new NodeSSH();
  // 移除项目文件夹名
  // const projectFolder = path.basename(process.cwd());
  // const remotePath = `${server.baseRemoteDir}/${projectFolder}`;
  const remotePath = server.baseRemoteDir;
  const absLocal = path.resolve(process.cwd(), localDist);

  console.log(
    chalk.blue(`[${server.name}] 开始部署 ${absLocal} => ${remotePath}`)
  );

  try {
    // 只传 SSH 连接需要的字段
    const { id, name, baseRemoteDir, ...sshConfig } = server;
    await ssh.connect({
      ...sshConfig,
      timeout: SSH_CONNECT_TIMEOUT
    });

    await ssh.putDirectory(absLocal, remotePath, {
      recursive: true,
      concurrency: SFTP_CONCURRENCY,
      timeout: TRANSFER_TIMEOUT
    });

    console.log(chalk.green(`✅ ${server.name} 部署完成`));
    return { server: server.name, success: true };
  } catch (err) {
    console.log(chalk.red(`❌ ${server.name} 部署失败: ${err.message}`));
    return { server: server.name, success: false, error: err.message };
  } finally {
    ssh.dispose();
  }
}

/**
 * 并行部署到多台服务器，全部尝试后再汇总，互不影响
 *
 * @param {object[]} servers - 服务器配置数组
 * @param {string} localDist  - 本地产物相对路径
 * @returns {Promise<{deployed: Array, allOk: boolean}>} 汇总结果
 */
async function deployParallel(servers, localDist) {
  const results = await Promise.allSettled(
    servers.map(server => deploySingleServer(server, localDist))
  );

  // allSettled 不会 reject，提取每个结果
  const deployed = results.map(r => {
    // deploySingleServer 本身不抛异常，结果在 value 中
    if (r.status === 'fulfilled') return r.value;
    // 极端情况：deploySingleServer 自身抛了未捕获异常
    return { server: 'unknown', success: false, error: r.reason?.message || String(r.reason) };
  });

  const failed = deployed.filter(r => !r.success);
  const succeeded = deployed.filter(r => r.success);

  console.log('');
  console.log(chalk.cyan('==================== 部署汇总 ===================='));
  console.log(chalk.green(`成功：${succeeded.length} 台`));
  if (failed.length > 0) {
    console.log(chalk.red(`失败：${failed.length} 台`));
    failed.forEach(f => console.log(chalk.red(`  - ${f.server}: ${f.error}`)));
  }

  return { deployed, allOk: failed.length === 0 };
}

module.exports = { deployParallel };
