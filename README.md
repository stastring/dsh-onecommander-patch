# dsh-onecommander-patch

**Add One Commander to the DeepSeek Harness "open with" menu on Windows.**

[English](#english) · [简体中文](#zh)

> Unofficial community patch. It rewrites `resources\app.asar` of the installed
> DeepSeek Harness desktop app. Read [Disclaimer](#disclaimer) before running it.

---

<a id="english"></a>
## English

### The problem

DeepSeek Harness's file panel has an open-with split button, but the application
list is a **compile-time whitelist** inside `@deepseek-ai/dsh-host-open-in-app`.
There is no configuration key to extend it — upstream documents this as a known
limitation ("the catalog is fixed at build time; deployment cannot add its own
editor or Git GUI"). On Windows the resolved menu is typically File Explorer
(default) / VS Code / GitHub Desktop / Git Bash, and One Commander never appears
even when it is set as the system default file manager: the `explorer` entry calls
`explorer.exe` directly instead of going through the shell association.

### What this patch does

It rebuilds `resources\app.asar` in place with two surgical edits and copies every
other byte untouched:

| Archive member | Edit |
|---|---|
| `…/dsh-host-open-in-app/lib/index.js` | Adds a `onecommander` entry to the inlined `OPEN_IN_APP_CATALOG`, right after `explorer`, with a `file([...])` locator over the usual One Commander install paths |
| `…/dsh-client-ui-open-in-app/lib/client.js` | Adds `onecommander` to `APP_LABEL_KEY` and its display name to `PRODUCT_NAMES` (both language dictionaries inherit it) |

Both files change size, so the archive header is rebuilt: every member offset is
reassigned and the two edited members get fresh SHA256 / block digests. The
resulting launch command is:

```text
C:\Program Files\OneCommander\OneCommander.exe "<workspace path>"
```

which is One Commander's [documented command-line form](https://onecommander.com/help/3._Full_reference_guide/Starting_from_Command_line.html).

> **Why `lib/index.js` and not `lib/types/catalog.js`?** The host package ships a
> rollup bundle as `main`; it inlines the catalog. `lib/types/catalog.js` is the
> unbundled source and nothing imports it at runtime — patching it changes
> nothing visible.

### Requirements

- Windows 10/11, DeepSeek Harness **desktop** build (the Electron app that ships
  `resources\app.asar`).
- Windows PowerShell 5.1 (bundled with Windows) — the `.cmd` launchers already
  pass `-ExecutionPolicy Bypass`.
- `node.exe` on `PATH`, or the Node runtime bundled with DeepSeek Harness.

### Quick start

1. Quit DeepSeek Harness completely — window **and** tray icon. If Task Manager
   still shows `DeepSeek Harness`, end it: `app.asar` is locked while it runs.
2. Double-click **`apply.cmd`**.
3. Start DeepSeek Harness, open the Files panel on the right, click the open
   button next to the path bar — One Commander is now right after
   *File Explorer (default)*.

### Commands

| Command | What it does |
|---|---|
| `apply.cmd` | Patch the archive. Backs up the stock file to `app.asar.dsh-pristine`, builds and fully verifies the patched archive in `%TEMP%`, then swaps it in and re-verifies. |
| `check.cmd` | Read-only status. `"menuReady": true` means both edits are present. Works without stopping DeepSeek Harness. |
| `undo.cmd` | Copy the pristine backup back over `app.asar`, verify, done. Add `-RemoveBackup` to delete the 174 MB backup afterwards. |

Non-default install location? Pass it through:

```bat
apply.cmd -InstallRoot "D:\Apps\DeepSeek Harness"
```

`scripts\apply.ps1` and `scripts\undo.ps1` accept the same parameter; the `.cmd`
wrappers only add `-ExecutionPolicy Bypass`.

### Safety model

- **Stock backup first.** The untouched archive is preserved as
  `app.asar.dsh-pristine` before anything is written, and every later run patches
  *from that backup*, so re-running is idempotent and can repair a half-applied
  patch.
- **Build and verify off to the side.** The patched archive is assembled in
  `%TEMP%\dsh-onecommander` and every packed member is hashed against the header
  before the install directory is touched.
- **Verify after the swap.** If the copy or the post-install verification fails,
  the backup is restored automatically.
- **Refuse to guess.** If the archive is neither stock nor a known patch state
  (for example after an upstream change), the script aborts without writing.
- **No vendor binaries in this repo.** Only scripts are versioned here; the
  archive and its backup are ignored by `.gitignore`.

### What was verified

On DeepSeek Harness `0.2.1-rc.3` / One Commander `3.108`, Windows 11:

- A no-op rebuild (`node tools/repack-app-asar.mjs --proof`) is **byte-identical**
  to the installed archive, so the repacker itself is trustworthy.
- After patching, all 16,605 packed members match their header SHA256, offsets are
  contiguous, and the 1,583 unpacked members are untouched.
- **Execution-level check:** the patched host bundle, imported with one extra
  `export`, yields `finder → explorer → onecommander → filemanager → …` and the
  first candidate path exists on disk.
- Half-patched state (browser bundle edited, host bundle not) is rebuilt
  correctly from the backup; `undo.cmd` restores a byte-identical stock archive.

Not verified by the author: the menu click itself in a live session (the patch
requires the app to be closed). Click it once after restarting — if the window
does not open, see the entry's argv above and report it in an issue.

### Limitations

- **Overwritten by updates.** The desktop auto-updater replaces `app.asar`
  wholesale; re-run `apply.cmd` after each update.
- **Unsupported.** This is a binary patch, not a supported extension point. It
  relies on the current bundle layout and on Electron not enforcing ASAR
  integrity (it does not here, but that could change); when the layout moves, the
  script stops with an error instead of corrupting the app.
- **Windows only.** The catalog entry is declared for `win32`; macOS/Linux users
  get nothing from this patch.

### The proper fix

Upstream: add the entry to `packages/host/open-in-app/src/catalog.ts`, the label
key to the browser package's `applications.ts`, and the display name to
`locales.ts`, then rebuild. Until that lands, this patch is the shortest path.
(The same snippet is reproduced at the end of the Chinese section.)

### Disclaimer

This project is **not affiliated with, endorsed by, or supported by DeepSeek**.
It modifies files inside an installed application, which can break that
application; use it at your own risk and keep the backup it creates. It ships no
DeepSeek code, binaries, or assets — only the patching scripts in this repository.
"DeepSeek Harness" and "One Commander" are trademarks of their respective owners.
The scripts here are released under the [MIT License](LICENSE).

---

<a id="zh"></a>
## 简体中文

### 问题

DeepSeek Harness 的文件面板有一个「打开方式」分体按钮，但里面的应用列表是
`@deepseek-ai/dsh-host-open-in-app` 里的**编译期白名单**，没有任何配置项可以扩展
（上游把这条写进了已知限制：「目录在构建期固定，部署无法增加自己的编辑器或
Git GUI」）。Windows 上通常只会出现 文件资源管理器（默认）/ VS Code /
GitHub Desktop / Git Bash。把 One Commander 设成 Windows 默认文件管理器也没用：
`explorer` 条目直接调用 `explorer.exe`，不经过 shell 关联。

### 这个补丁做了什么

它就地重打包 `resources\app.asar`，只改两处，其余字节原样复制：

| 归档成员 | 改动 |
|---|---|
| `…/dsh-host-open-in-app/lib/index.js` | 在内联的 `OPEN_IN_APP_CATALOG` 里、`explorer` 之后插入 `onecommander` 条目，用 `file([...])` locator 覆盖 One Commander 的常见安装路径 |
| `…/dsh-client-ui-open-in-app/lib/client.js` | `APP_LABEL_KEY` 加入 `onecommander`，`PRODUCT_NAMES` 加入显示名（中英词典都从它展开） |

两个文件大小都变了，所以归档头会重建：重排每个成员的偏移，重算被改成员的分块
SHA256。拼出来的启动命令是：

```text
C:\Program Files\OneCommander\OneCommander.exe "<工作区路径>"
```

也就是 One Commander [官方文档](https://onecommander.com/help/3._Full_reference_guide/Starting_from_Command_line.html)
里的命令行用法。

> **为什么改 `lib/index.js` 而不是 `lib/types/catalog.js`？** 宿主包把 rollup
> bundle 当作 `main`，目录表被烘进那个 bundle 里；`lib/types/catalog.js` 是未打包
> 的源文件，运行时没有任何代码 import 它——改它界面上不会有任何变化。

### 环境要求

- Windows 10/11，DeepSeek Harness **桌面版**（带 `resources\app.asar` 的 Electron 应用）。
- Windows PowerShell 5.1（系统自带）；`.cmd` 启动器已经带 `-ExecutionPolicy Bypass`。
- `node.exe` 在 `PATH` 里，或使用 DeepSeek Harness 自带的 Node 运行时。

### 快速开始

1. **完全退出** DeepSeek Harness——窗口和托盘都要退；任务管理器里如果还有
   `DeepSeek Harness` 进程，一并结束（运行时 `app.asar` 被占用）。
2. 双击 **`apply.cmd`**。
3. 打开 DeepSeek Harness → 右侧「文件」面板 → 点路径栏旁的打开按钮，
   One Commander 现在排在「文件资源管理器（默认）」之后。

### 命令

| 命令 | 作用 |
|---|---|
| `apply.cmd` | 打补丁。先把原版备份成 `app.asar.dsh-pristine`，在 `%TEMP%` 里构建并完整校验，然后覆盖安装目录并再校验一次。 |
| `check.cmd` | 只读查看状态；`"menuReady": true` 表示两处都改到了。不需要关闭 DeepSeek Harness。 |
| `undo.cmd` | 用原版备份覆盖回来并校验。加 `-RemoveBackup` 可顺手删掉那份 174 MB 备份。 |

安装目录不在默认位置时：

```bat
apply.cmd -InstallRoot "D:\Apps\DeepSeek Harness"
```

`scripts\apply.ps1` 与 `scripts\undo.ps1` 接受同样的参数，`.cmd` 只负责加上
`-ExecutionPolicy Bypass`。

### 安全设计

- **先备份再动手**：未修改的归档先存为 `app.asar.dsh-pristine`；之后每次运行都
  **从这份备份重建**，所以重复运行是幂等的，也能修复上一次留下的半成品。
- **在别处构建与校验**：补丁归档在 `%TEMP%\dsh-onecommander` 里组装，逐个成员
  对头部哈希校验通过后才碰安装目录。
- **覆盖后再校验**：拷贝或安装后校验失败会自动回滚到原版。
- **不认识就不动**：如果归档既不是原版也不是已知的补丁状态（例如上游改了打包
  方式），脚本直接报错退出，不会写坏文件。
- **仓库不含厂商二进制**：这里只放脚本，`app.asar` 与备份都被 `.gitignore` 排除。

### 已经验证过的

环境：DeepSeek Harness `0.2.1-rc.3`、One Commander `3.108`、Windows 11。

- 不打补丁的重建（`node tools/repack-app-asar.mjs --proof`）与原文件
  **逐字节相同**，说明重打包逻辑本身可靠。
- 打补丁后 16,605 个打包成员逐个对上头部 SHA256，偏移连续，1,583 个 unpacked
  成员未动。
- **执行级验证**：把改后的宿主 bundle 抽出来、补一行 `export` 后 import，读到的
  目录顺序是 `finder → explorer → onecommander → filemanager → …`，且第一个候选
  路径在磁盘上真实存在。
- 半成品状态（浏览器 bundle 已改、宿主 bundle 没改）能从备份正确重建；
  `undo.cmd` 还原出的文件与原版 SHA256 完全一致。

作者没验证的：在真实会话里点击菜单项那一下（打补丁必须先关掉应用）。你重启后点
一次即可确认；如果窗口没弹出来，请把上面那条 argv 贴到 issue 里。

### 局限

- **会被自动更新覆盖**：桌面版更新会整包替换 `app.asar`，更新后重跑 `apply.cmd`。
- **不受支持**：这是二进制补丁，不是官方扩展点。它依赖当前 bundle 布局，并依赖
  Electron 未启用 ASAR 完整性强制校验（目前确实没启用，但将来可能变）。布局一变，
  脚本会报错停下，而不是把程序写坏。
- **仅 Windows**：目录项只声明了 `win32`，macOS/Linux 上没有效果。

### 更该走的路（上游修法）

在 `packages/host/open-in-app/src/catalog.ts` 的 `OPEN_IN_APP_CATALOG` 里、
`explorer` 条目之后加入：

```ts
{
    id: 'onecommander',
    platforms: {
        win32: spec(file([
            '${ProgramFiles}/OneCommander/OneCommander.exe',
            '${ProgramFiles(x86)}/OneCommander/OneCommander.exe',
            '${LOCALAPPDATA}/Programs/OneCommander/OneCommander.exe',
        ])),
    },
},
```

在浏览器包的 `applications.ts` 里加 `onecommander: 'app.onecommander',`，在
`locales.ts` 的 `PRODUCT_NAMES` 里加 `"app.onecommander": "One Commander",`，
然后重新构建客户端。这个补丁只是等上游合并前的过渡方案。

### 免责声明

本项目**与 DeepSeek 无关联、未获其背书或支持**。它会修改已安装应用内部的文件，
可能导致该应用无法正常启动；请自行承担风险，并保留它生成的备份。本仓库不包含
任何 DeepSeek 的代码、二进制或素材，只有打补丁的脚本。
「DeepSeek Harness」「One Commander」分别为其各自所有者的商标。
本仓库脚本以 [MIT License](LICENSE) 发布。

---

## Repository layout / 目录结构

```text
dsh-onecommander-patch/
├─ apply.cmd             # patch the installed archive / 打补丁
├─ check.cmd             # read-only status / 只读状态
├─ undo.cmd              # restore the stock archive / 还原
├─ scripts/
│  ├─ apply.ps1          #   the actual apply logic / 打补丁逻辑
│  └─ undo.ps1           #   restore logic / 还原逻辑
├─ tools/
│  ├─ repack-app-asar.mjs  # --status | --proof | --out
│  └─ verify-asar.mjs      # header + per-member SHA256 verification
├─ README.md
├─ LICENSE
└─ .gitignore
```

`node tools/repack-app-asar.mjs --status --asar "<path to app.asar>"` reports
whether an archive is stock, patched, or unrecognised — handy when debugging.
