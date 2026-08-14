# Agent Note: Electron 桌面壳作为旁车监督器

Status: implemented

[English](2026-08-14-desktop-electron-shell.md) | 中文

## Problem

Web GUI 是本地服务地址（`dsh web`，默认 `http://127.0.0.1:3080`）上的一个
浏览器标签页。桌面用户想要一个双击入口：应用窗口、任务栏存在感和托盘，并且
服务器永远不需要手工启动。把 harness 打包进桌面应用时，绝不能分叉它的运行时，
也不能削弱它的插件可扩展性。

## Decision

新增 workspace 应用 [`apps/desktop`](../../../../apps/desktop/README.md)
（`@deepseek-ai/dsh-desktop`），定位为**纯外壳**：Electron 监督同一个 `dsh web`
服务器进程并提供窗口/托盘外壳。harness 绝不 require 进 Electron 运行时，因此
插件加载、ESM 布局、profile、工具、会话和模型 provider 与浏览器部署逐字节一致。

### 服务器监督：挂载或拥有，绝不二者兼有

`ServerSupervisor.ensure` 先探测所配置的 URL。已有应答的服务器被**挂载**：外壳
永不停止它。不可达的服务器被**拥有**：外壳将其拉起、等待就绪（HTTP 探测轮询，
默认 60 秒时限），并在退出时停止它——默认 `stopOnQuit: true`。所有权是唯一的
停止权限：被挂载的服务器在任何外壳生命周期中都存活。

### 启动方式解析顺序

1. 设置中的 `server.command`（shell 命令行——打包安装下的配置逃生门）。
2. 从仓库启动时的仓库本地源码启动（`node --import tsx/esm apps/cli/src/bin.ts web`，
   cwd 为检测到的仓库根目录）。
3. 否则大声失败：弹窗指明日志文件——绝不留下静默半开的外壳。

### 仅回环表面

`server.url` 必须是回环主机（`127.0.0.1` / `localhost` / `::1`）上的 http，
解析时即校验，环境变量覆盖同样校验。外壳只能触达本机的 harness，因此不会变成
远程执行启动器。

### 窗口、托盘与身份

单实例锁，重复启动时聚焦已有窗口；`AppUserModelId`
`com.deepseekai.dsh.desktop`（与 electron-builder appId 一致）用于任务栏分组。
窗口边界持久化到 `window-state.json`，持久化的位置完全移出屏幕时会被重新钳制到
当前显示器工作区内。关闭按钮默认隐藏到托盘（close-to-tray）；托盘菜单「退出」
退出外壳并执行所拥有服务器的关闭流程。外部链接与跨源导航一律交给系统浏览器。
逐安装日志：userData 下的 `desktop.log`（外壳生命周期，含 `page loaded` 标记）与
`server.log`（所拥有子进程的输出）。

### 鲸鱼标记图标管线

共享标记 `apps/web/public/favicon.svg` 由 `scripts/generate-icons.ts`（sharp，
SVG 密度精确）光栅化为已提交的 PNG：黑鲸透明底用于窗口/任务栏，以及
`assets/icon-512.png`（electron-builder 将其转换为嵌入 exe 的多尺寸 `.ico`）；
反相为白色用于托盘（Windows 任务栏是深色的）。测试固定已提交 PNG 的尺寸与
黑白差异。

### 可配置性

userData 下的 `settings.json`（schema 与默认值见
[`src/config.ts`](../../../../apps/desktop/src/config.ts)）：server url /
command / spawn / stopOnQuit / readinessTimeoutMs 与 window width / height /
closeToTray。未知键忽略；类型错误在启动时大声失败。环境变量覆盖
（`DSH_DESKTOP_SERVER_URL`、`DSH_DESKTOP_SERVER_COMMAND`、`DSH_DESKTOP_SPAWN`、
`DSH_DESKTOP_CLOSE_TO_TRAY`、`DSH_DESKTOP_USER_DATA`）优先于文件。

### 测试拆分

纯 Node 逻辑（配置、探测、仓库检测、窗口边界、监督器决策）位于无 Electron
依赖的模块中，配 vitest 单元套件。Electron 冒烟
（[`tests/desktop.e2e.ts`](../../../../apps/desktop/tests/desktop.e2e.ts)）
以 `stdio: 'ignore'` 拉起真实二进制对接进程内 mock 服务器，并通过外壳自身的
`desktop.log`（挂载 + 页面加载）断言，而不使用 playwright 的 `_electron` 启动器：
`stdio: 'ignore'` 让该测试同样能在禁止管道子进程 stdio 的 harness 沙箱（具名管道
边界）内运行，且日志是外壳的权威生命周期记录。

## Alternatives considered

**把 harness 嵌入 Electron 主进程。** 进程数最少，但会把插件加载、ESM 布局和
agent 运行时耦合到 Electron 的 Node 构建上；每次 Electron 升级都变成 harness
运行时变更，Web/CLI 部署也不再跑同一份模块图。拒绝：旁车方案保留单一运行时和
单一部署契约。

**Tauri（或 Pake 式）Rust 外壳。** 二进制小得多，但为了同样的旁车监督引入第二
工具链和构建链，而且 Node 服务器仍需要旁车进程。暂拒绝：对 Node 优先的仓库，
Electron 是零工具链选项。

**仅依赖现有 PWA manifest。** 前端已随包发布 `manifest.webmanifest`
（`display: fullscreen`），浏览器可以安装独立窗口——但没有任何东西监督服务器
进程。桌面壳恰好补上这块监督；PWA 安装对偏好它的用户仍是另一个更轻的选项。

**通用 URL 包装器（nativefier、Edge `--app` 模式）。** 单机上手快，但没有服务器
生命周期所有权、没有仓库集成、没有打包门禁。保留为用户侧替代方案，不作为产品
路径。

## Consequences

**换来**：带服务器生命周期所有权的双击桌面入口；harness 运行时零改动，可扩展性
（cordis profile、插件、工具）不受影响；一条提交入库的图标管线同时供给窗口、
任务栏、托盘和安装包；跨平台 electron-builder 目标（Windows 便携版 + NSIS，
Linux AppImage，macOS 配置就绪）。

**付出**：Electron 的二进制体积（安装依赖与打包后的 exe 都如此）；打包应用假设
服务器可达或已配置 `server.command`（有意不捆绑服务器——此处不重新打包
harness）；设置需手改、暂无界面；暂无开机自启；`test:desktop` 按需运行而非进入
默认 CI 套件。
