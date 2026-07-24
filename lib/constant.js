/**
 * 脚手架内置服务器列表，统一维护
 * id：唯一标识（缓存只存id，不存完整配置）
 * name：展示名称，命令行交互显示
 * baseRemoteDir：服务器基础部署根目录
 * host / port / username / privateKey / password 为 node-ssh 标准连接参数
 */
exports.SERVER_LIST = [
  {
    id: 'test-server',
    name: '测试服务器',
    host: '192.168.1.100',
    port: 22,
    username: 'root',
    // 优先私钥登录（推荐！不要明文密码提交代码）
    privateKey: '/Users/xxx/.ssh/id_rsa',
    password: '你的服务器ssh密码',
    // password: "xxxxxx",
    baseRemoteDir: '/www/test'
  },
  {
    id: 'prod-server',
    name: '生产服务器',
    host: '120.xx.xx.xx',
    port: 22,
    username: 'root',
    password: '你的服务器ssh密码',
    privateKey: '/Users/xxx/.ssh/id_rsa',
    baseRemoteDir: '/www/prod'
  }
];
