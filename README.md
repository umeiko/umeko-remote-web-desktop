# Umeko Remote Web Desktop

面向个人电脑的私人远程工作台：出差时通过自己的网站和服务器，连接家中的电脑。电脑端主动建立 WSS 连接，无需家庭公网 IP 或路由器端口映射。

## 功能

- **密钥登录**：Ed25519 挑战签名，登录私钥留在浏览器本地；一次性连接票据和最长 8 小时会话。
- **网页桌面**：通过 Apache Guacamole 与本机 xrdp 连接，支持键鼠、触摸、全屏、双向文字剪贴板和拼音输入法切换。顶栏提供链路指标、自动压缩画质、手动分辨率和断线自动重连。
- **局域网入口**：可在家中电脑上配置独立 HTTPS 入口，使用原有管理员公钥验证，直接连接本机的 RDP 与 SSH。
- **网页 SSH**：xterm.js 交互式终端，支持中文、复制粘贴、窗口缩放及断线后重连。
- **文件管理**：切换目录、显示隐藏文件、新建文件夹、上传和下载；支持中文文件名、上传进度和取消，单文件上传上限 2 GiB，同名文件不覆盖。
- **原生 SSH 隧道**：独立的 Node.js 客户端，可接入 SSH、SFTP 和 VS Code Remote SSH。
- **本地连接器**：Python 桌面控制面板与独立 Node.js 后台服务；支持 systemd 开机自启动、无显示器启动和网络恢复后重连。

## 运行要求

- 云端：Node.js 22.13 或更新版本、Nginx、Apache Guacamole guacd 1.6.0（含 RDP 支持）。
- 家中电脑：Linux、Node.js 22.13+、OpenSSH、xrdp；桌面控制面板需 Python 3 和 Tkinter，自启动需 systemd 用户服务。
- 可选的远程 MATE 会话需要 MATE 与 Fcitx5 拼音组件；脚本位于 `remote/deploy/startwm.sh`。
- 出差设备：支持 Ed25519 Web Crypto 的现代浏览器；原生 SSH 隧道工具需 Node.js 22.13+。

## 安装与配置

```bash
git clone https://github.com/umeiko/umeko-remote-web-desktop.git
cd umeko-remote-web-desktop
npm ci --no-bin-links
```

生成工作台管理员和电脑连接器的密钥，输出到仓库外：

```bash
npm run keys -- /private/path/umeko-remote
```

以 `examples/server.example.json` 为基础，在服务器创建 `/etc/umeko-remote/server.json`，填入生成的公钥与自己的域名。配置、私钥和运行状态均放在仓库外。

```bash
UMEKO_REMOTE_CONFIG=/etc/umeko-remote/server.json npm start
```

服务只监听 `127.0.0.1:3101`，由 Nginx 通过 HTTPS 暴露 `/remote/`。项目直接提供网页资源，无需前端构建。服务账号、guacd、HTTPS、SSH 凭据和主机指纹的配置步骤见 [完整部署与使用说明](docs/guide.md)。

以 `examples/agent.example.json` 为基础，在家中电脑创建 `~/.config/umeko-remote/agent.json`，设置网站地址与设备私钥路径，权限设为 600。启动控制面板：

```bash
python3 remote/desktop.py ~/.config/umeko-remote/agent.json
```

在面板开启“开机自启动”，或直接启用无图形后台服务：

```bash
python3 remote/service.py enable --config ~/.config/umeko-remote/agent.json
```

网页使用 `admin.umeko-key` 登录。网页 SSH 和文件管理需要额外配置专用 SSH 密钥及家中电脑的主机指纹；未配置时，这两个入口禁用，网页桌面与原生 SSH 隧道仍可使用。

## 项目结构

| 路径 | 内容 |
| --- | --- |
| `remote/server.js`、`auth.js`、`keys.js` | 云端入口、工作台认证和密钥生成 |
| `remote/guacamole.js`、`tools.js` | 桌面协议、网页 SSH 和 SFTP |
| `remote/agent.js` | 家中电脑的主动 WSS 连接器 |
| `remote/desktop.py`、`service.py` | 本地控制面板与 systemd 自启动 |
| `remote/client.js` | 出差设备使用的独立 SSH 隧道客户端 |
| `remote/web/` | 工作台、网页桌面、终端与文件管理界面 |
| `remote/deploy/` | Nginx、systemd 和远程 MATE 会话模板 |
| `remote/test/` | Node.js 集成测试与 Python 服务测试 |
| `examples/` | 使用占位值的配置示例 |
| `docs/guide.md` | 使用、部署、访问边界及排障说明 |

## 验证

```bash
npm test
```

包含签名与重放验证、会话撤销、SSH 通道、桌面握手、键鼠事件、中文与二进制文件传输、取消上传清理、自启动、关机或 SSH 断开后在同一登录会话中重连等测试。

电脑需要保持供电、联网且不休眠；本项目不提供从关机状态唤醒电脑的功能。xrdp 可能创建独立桌面会话。远程 MATE 使用软件渲染与独立输入法，不更改本机物理桌面的会话。

## 来源与第三方代码

本项目从 `umeiko/umeko_token_market` 的远程工作台模块独立整理，迁出基线为提交 `418e0d8`，包含关机后网页 SSH 无法重连的修复。

Apache Guacamole 客户端保留在 `remote/vendor/`，附有原始 LICENSE、NOTICE 及来源说明。xterm.js、ssh2 和其他依赖由 npm 安装，各自许可证随依赖提供。
