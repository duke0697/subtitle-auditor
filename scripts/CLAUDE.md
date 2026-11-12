# scripts — 构建、环境与 E2E 脚本

[根目录](../CLAUDE.md) > **scripts**

## 模块职责

开发环境准备、sidecar 打包、ffmpeg 获取、图标生成与基于 Playwright CDP 的端到端验证。脚本均为 Node ESM（`.mjs`），由 `package.json` 的 npm scripts 调用。

## 入口与启动

| 脚本 | npm 命令 | 行为 |
|------|----------|------|
| `setup-sidecar.mjs` | `npm run setup:sidecar` | `uv venv --python 3.13 sidecar/.venv`；`uv pip install -r sidecar/requirements.txt`；uv 不可用时回退 `py -3.13 -m venv` + `pip` |
| `build-sidecar.mjs` | `npm run build:sidecar` | 检查/安装 PyInstaller（`requirements-build.txt`），在 `sidecar/` 执行 `build.spec`，清空并复制 `sidecar/dist/SubtitleAuditor` → `resources/sidecar` |
| `fetch-ffmpeg.mjs` | `npm run fetch:ffmpeg` | 复制 `ffmpeg-static` / `ffprobe-static` 到 `resources/ffmpeg/{ffmpeg,ffprobe}.exe` |
| `make-icon.mjs` | `npm run make:icon`（`prebuild` 自动执行） | 用 sharp 将内联 SVG 渲染为 `resources/icons/icon.png`（512×512） |
| `e2e.mjs` | 手动 | 连接 CDP，选择样片、开始审查、等待结果并截图到 `tests/output/` |
| `actions.mjs` | 手动 | 连接已出结果的应用，验证 `Enter` / `I` 复核快捷键 |
| `screenshot.mjs` | 手动 | 连接 CDP 截取当前界面 |
| `verify-installed.mjs` | 手动 | 针对安装包实例（端口 9225）调用 `window.api` 探测并跑一次审查 |

## 对外接口

- E2E 脚本参数：`node scripts/<name>.mjs [port] [output]`，默认端口 `9223`，安装包验证默认 `9225`。
- 依赖应用已以远程调试端口启动；脚本本身不负责拉起 Electron。
- 依赖测试钩子：未打包时 `SUB_AUDITOR_TEST_VIDEO` / `SUB_AUDITOR_TEST_SUBTITLE` 可绕过文件对话框。

## 关键依赖与配置

- `ffmpeg-static`、`ffprobe-static`、`sharp`、`playwright-core` 均为 devDependencies。
- `sidecar/build.spec` 决定 PyInstaller 收集范围；新增 Python 依赖时通常需同步 `requirements.txt`、`requirements-build.txt` 与 spec 的 `collect_all`。
- 打包输出目录固定为 `dist/`（electron-builder 配置），不要创建平行输出目录。

## 数据模型

无持久数据。E2E 产物写入 `tests/output/`（已 gitignore），包括截图、ASR JSON、提取字幕与日志。

## 测试与质量

脚本不是测试框架；`e2e.mjs` 失败时以退出码 2 表示“开始审查按钮不可用”，其余异常直接抛出。`.mjs` 仅通过实际运行验证。

## 常见问题 (FAQ)

- **setup 失败**：确认 `uv` 或 Python 3.13 可用；网络问题会导致 pip 安装失败。
- **build:sidecar 找不到 PyInstaller**：脚本会尝试用 `uv pip install -r sidecar/requirements-build.txt`；uv 不可用时需手动在 venv 内安装。
- **E2E 连不上**：应用必须以 `--remote-debugging-port=<port>` 启动；当前仓库未封装该命令。
- **打包后仍是旧 sidecar**：`build:sidecar` 会先删除 `resources/sidecar` 再复制；若跳过该步，安装包携带旧产物。
- **打包失败/文件被占用**：先关闭正在运行的应用实例，再执行 `npm run dist`。
- **`scripts/tmp_*.py`**：本地临时探测脚本，已被 `.gitignore` 忽略，不属于交付代码。

## 相关文件清单

- `scripts/setup-sidecar.mjs`
- `scripts/build-sidecar.mjs`
- `scripts/fetch-ffmpeg.mjs`
- `scripts/make-icon.mjs`
- `scripts/e2e.mjs`
- `scripts/actions.mjs`
- `scripts/screenshot.mjs`
- `scripts/verify-installed.mjs`

## 变更记录 (Changelog)

- 2026-11-12T21:44:30 初始化模块文档。
