# @deepseek-ai/dsh-host-file-browser

[English](README.md) | 中文

**工作区文件浏览器能力缝（seam）**：`LocalFileBrowser` 注册 `ctx.fileBrowser`，提供两种有界列举——根目录下的递归文件+目录列表，以及供树形导航的单层列举——Web GUI 输入框文件引用（`@`-文件菜单与回形针文件选择按钮，客户端包 `ui-file-reference`）的宿主侧数据源。

行为事实：`listFiles` 通过 Node 标准库对根目录做广度优先遍历（无显示、无系统对话框，因此与 browse 目录选择器一样适用于所有部署），返回 `{ name, rel, path, kind }` 行——`kind` 为 `file` 或 `directory`——其中 `rel` 是相对根目录、以正斜杠分隔的拼写，即输入框插入的引用形式；同层行按名称顺序产出，文件与目录交错，因此有界结果优先保留最浅层的行。遍历跳过点开头条目（`skipHidden`，默认 true——与 browse 目录选择器相同的 POSIX 隐藏约定），跳过 `skipDirs`（默认 `node_modules`/`.git`——否则工作区的依赖树会占满整个上限），从不跟随符号链接（无环、无逃逸），在 `maxDepth`（根为深度 0，默认 6）处停止下行，并在 `maxFiles` 个文件行（默认 500）与 `maxDirs` 个目录行（默认 200）处截断且置 `truncated: true`，让客户端可以提示列表不完整。`listLevel` 返回单层目录内容（文件与目录，按名称排序，同一套跳过规则，受 `maxFiles` 约束），供选择器的可展开树使用——调用方逐层驱动导航，而不是每次点击文件夹都重扫整个工作区。显式传入的根若不是完全限定路径——相对形式，以及 Windows 上带根但无盘符的形式（`\foo`、`/foo`）和不完整的 UNC 前缀（`\\`、`\\server`）——或目录缺失/不可读时，抛出类型化的 `FileBrowserError`（线上为 `directory-unreadable`，与目录选择器共用同一错误词表）。每个文件系统 await 都与调用方的 `AbortSignal` 竞速：断连或超时会停止扫描而不是任其越过调用方存活，拒绝原因即中止原因。

缝的形状沿用 directory-picker 能力缝：一个服务定义加上本包内的唯一已交付 provider；消费方是 API 网关（`host.listFiles` 与 `host.listLevel`）及其后的浏览器客户端。目前看不到第二个 provider 的需求——这些交互都是有界的宿主侧读取。

## Model Experience

无：本缝服务于 GUI 宿主的文件列举，没有任何内容到达模型请求。

#### KV Cache 影响

无：本包既不组装也不发送 provider 请求。

## Known Limitations and Deferred Work

- **符号链接的文件与目录一律省略**——遍历从不跟随链接，因此文件大多是符号链接的工作区会将其列为缺失（以环安全换取完整性）。
- **不读取 Windows 隐藏属性**——Node dirent 不暴露 `FILE_ATTRIBUTE_HIDDEN`，因此 `skipHidden` 在所有平台上都指点前缀，直到某个原生探测值得其成本。
- **全文件系统范围**——没有按部署限制列举根。`workspace.create` 接受任意路径，因此这里的根只是 UX 范围，不是安全边界。
