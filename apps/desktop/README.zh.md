# @deepseek-ai/dsh-desktop

[English](README.md) | 中文

DeepSeek Harness 的桌面壳：围绕同一个 `dsh web` 服务器的 Electron 窗口与托盘。
harness 本体绝不内嵌——服务器始终以完全相同的 `dsh web` 进程运行，本应用只负责
监督它并提供窗口/托盘外壳，因此所有插件、profile、工具和会话行为与浏览器中
完全一致。

## 运行（从源码仓库）

```sh
pnpm install
pnpm run dev:desktop
```

外壳会探测 `http://127.0.0.1:3080`：已有服务则直接挂载（且绝不会停止它）；
否则通过仓库自身的源码启动方式拉起服务
（`node --import tsx/esm apps/cli/src/bin.ts web`）。关闭按钮隐藏到托盘；
托盘菜单中的「退出」会退出外壳，并且只停止由本外壳启动的服务。

## 打包

```sh
pnpm run pack:desktop   # unpacked build under apps/desktop/dist/win-unpacked
pnpm run dist:desktop   # portable exe + NSIS installer under apps/desktop/dist
```

打包后的应用需要一个可达的服务：要么已有服务在运行，要么在设置中配置启动命令
（仓库本地自动启动仅在从仓库目录启动时可用）。

## 配置

`settings.json` 位于 Electron 的 userData 目录（`%APPDATA%/<app>`；外壳会在同目录
的 `desktop.log` 中记录这些路径）。未知键会被忽略；类型错误会在启动时弹窗报错。

```json
{
  "server": {
    "url": "http://127.0.0.1:3080",
    "command": null,
    "spawn": true,
    "stopOnQuit": true,
    "readinessTimeoutMs": 60000
  },
  "window": { "width": 1280, "height": 800, "closeToTray": true }
}
```

- `server.url` —— 所服务的 Web UI 地址；强制要求 http 协议与回环主机，
  外壳因此永远不会变成远程执行启动器。
- `server.command` —— 当外壳需要自行启动服务器时使用的 shell 命令行；
  null（默认）时回退到仓库本地启动方式。
- `server.spawn` —— URL 不可达时，外壳是否允许自行启动服务器。
- `server.stopOnQuit` —— 退出时是否停止由本外壳启动的服务器
  （挂载的已有服务永不触碰）。
- `server.readinessTimeoutMs` —— 等待新启动服务器应答的时限。
- `window.closeToTray` —— 关闭按钮隐藏到托盘而非退出。

环境变量覆盖优先于文件：`DSH_DESKTOP_SERVER_URL`、`DSH_DESKTOP_SERVER_COMMAND`、
`DSH_DESKTOP_SPAWN`（`0`/`1`/`false`/`true`）、`DSH_DESKTOP_CLOSE_TO_TRAY`，
以及 `DSH_DESKTOP_USER_DATA`（profile 覆盖，冒烟测试也使用它）。

userData 中的逐安装状态：`desktop.log`（外壳生命周期）、`server.log`
（子进程输出）、`window-state.json`（持久化的窗口边界，显示器消失后会自动移回
屏幕内）。

## 图标

鲸鱼标记取自 [`apps/web/public/favicon.svg`](../web/public/favicon.svg)：
黑鲸透明底统一用于窗口、任务栏、托盘和打包应用图标（electron-builder 会把
`assets/icon-512.png` 转换为多尺寸 `.ico`）。
`assets/` 下的 PNG 已提交入库；favicon 变更后用
`pnpm --filter @deepseek-ai/dsh-desktop run icons` 重新生成。

## 测试

- 单元测试（纯 Node 模块，不依赖 Electron 二进制）：
  `pnpm exec vitest run apps/desktop/tests` —— 配置解析、回环强制、
  服务器探测/所有权、仓库检测、窗口边界。
- Electron 冒烟测试（真实二进制、真实主进程，对接 mock 服务器）：
  `pnpm run test:desktop`。外壳以 `stdio: 'ignore'` 启动，因此该测试同样能在
  禁止管道子进程 stdio 的 harness 沙箱（具名管道边界）内运行；断言读取外壳
  自身的 `desktop.log`。

## 已知限制

- 暂无设置界面：`settings.json` 需要手改；`server.command` 是打包安装下没有
  本地仓库时配置启动方式的逃生门。
- 暂无开机自启；托盘图标为静态（没有未读/忙碌状态）。
- `test:desktop` 未接入默认 CI 套件（Electron 二进制体积较大），按需运行。
