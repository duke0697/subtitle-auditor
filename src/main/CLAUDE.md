# src/main — Electron 主进程

[根目录](../../CLAUDE.md) > [src](../) > **main**

## 模块职责

应用生命周期与系统能力边界：创建无边框窗口、注册 IPC、管理 Python sidecar 子进程、调用 ffmpeg/ffprobe、持久化设置、导出报告、自动更新，以及为渲染进程提供支持 Range 的本地媒体协议。

## 入口与启动

- `src/main/index.ts` 是唯一入口（`package.json` 的 `main` 指向 `out/main/index.js`）。
- 启动顺序：`protocol.registerSchemesAsPrivileged(['app-media'])` → 单实例锁 → `app.setPath('userData', …)` → 构造 `SettingsStore` / `SidecarClient` / `FfmpegService` / `JobTracker` / `UpdateService` → `app.whenReady()` 内注册协议与 IPC、开窗、安排更新检查。
- 开发与打包的用户数据目录分离：`SubtitleAuditorDev` / `SubtitleAuditor`。
- `window.ts`：1360×860，最小 1120×700，无边框，`contextIsolation: true`、`nodeIntegration: false`、`sandbox: false`；窗口外链交给系统浏览器。
- `app-media://file?path=...` 由主进程读文件并返回 `Response`，必须正确处理 `Range`（Chromium 只有支持 Range 才允许拖动进度条），非法范围返回 416。

## 对外接口

IPC 通道常量与 `Api` 类型在 `src/shared/ipc.ts`，处理器集中在 `src/main/ipc.ts`：

| 分组 | 通道（节选） | 说明 |
|------|--------------|------|
| window | `window:minimize` / `toggle-maximize` / `close` / `is-maximized` / `maximized` | 无边框标题栏控制 |
| dialog | `dialog:pick-video` / `pick-subtitle` | 未打包时受 `SUB_AUDITOR_TEST_*` 环境变量短路 |
| media | `media:probe` / `find-subtitle` / `extract-subtitle` / `prepare-preview` / `preview-progress` / `waveform` / `ocr` / `ocr-cancel` / `ocr-progress` | 探测、同名字幕匹配、内嵌轨提取、预览代理、波形、硬字幕 OCR |
| job | `job:start` / `cancel` / `progress` / `segment` / `done` / `error` | 审查任务与流式事件 |
| models | `models:list` / `download` / `install-gpu` / `progress` | 模型与 GPU 组件 |
| settings | `settings:get` / `set` | 深合并后落盘 |
| export | `export:csv` / `export:json` / `export:excel` | 保存对话框 + 写文件 |
| update | `update:get` / `check` / `install` / `state` | 自动更新 |

与 sidecar 的 RPC 调用（`SidecarClient`）：`system.info`、`media.waveform`、`ocr.extract`、`analyze`、`cancel`、`models.list`、`models.download`、`models.installGpu`。事件名中的点被替换为连字符后转发到 IPC（如 `asr.segment` → `job:segment`）。

## 关键依赖与配置

- `electron`、`electron-updater`、`exceljs`；`ffmpeg-static` / `ffprobe-static` 仅在构建前复制为 `resources/ffmpeg/*.exe`。
- `paths.ts` 集中解析开发/打包路径；开发 sidecar 缺失时抛出带 `npm run setup:sidecar` 提示的错误。
- `settings.ts` 负责深合并默认值，并迁移已废弃的 `driftStartMs` / `driftEndMinMs` / `driftEndMaxMs`。
- `updater.ts`：启动 10 秒后检查，此后每 10 分钟一次；镜像优先、GitHub 直连回退；先探测 `latest.yml`；下载失败切换下一个 feed；任务运行中拒绝重启安装。
- 导出：`export.ts` 生成“概览 / 问题清单 / 字幕对照”三张工作表，CSV 单元格做公式注入防护。

## 数据模型

- `AppSettings`（`src/shared/contracts.ts`）：模型、设备、语言、HF 镜像、更新镜像、最近目录、分析选项、窗口尺寸。
- `JobTracker`：仅维护活动 job id 集合，`busy` 用于阻止更新安装。
- 缓存：`cache/subtitles/<sha1>.srt` 为内嵌字幕轨提取结果；`cache/preview/<sha1>.mp4` 为预览代理（同源 h264+aac/mp3 直接 remux，否则转码 1280px）。
- `AnalysisResult` 由 sidecar 产出，主进程只透传与导出，不重算规则。

## 测试与质量

- 无 TS 单元测试；`npm run typecheck` 覆盖 `src/main`、`preload`、`shared` 与脚本。
- E2E 通过 `scripts/e2e.mjs`、`verify-installed.mjs` 从渲染进程驱动；主进程行为（对话框、更新、媒体协议）主要靠安装包实测。

## 常见问题 (FAQ)

- **开发启动报 sidecar 不存在**：先 `npm run setup:sidecar`；路径固定为 `sidecar/.venv/Scripts/python.exe`。
- **报 FFmpeg not found**：先 `npm run fetch:ffmpeg`。
- **更新一直不可用**：开发模式预期为 `disabled`；打包版需能访问镜像或 GitHub 的 `latest.yml`。
- **安装更新被拒绝**：分析、OCR、模型下载等任一 job 活动时 `busy=true`，完成后重试。
- **视频无法拖动**：检查 `app-media` 响应是否带 `Accept-Ranges` 与 206/`Content-Range`。
- **第二实例直接退出**：单实例锁会把已有窗口恢复并聚焦。

## 相关文件清单

- `src/main/index.ts` 应用入口与媒体协议
- `src/main/window.ts` 窗口创建
- `src/main/ipc.ts` 全部 IPC 处理器与 sidecar 事件转发
- `src/main/sidecar.ts` JSON-RPC 客户端、超时、崩溃处理
- `src/main/paths.ts` 开发/打包路径
- `src/main/ffmpeg.ts` 探测、字幕轨提取、预览代理
- `src/main/settings.ts` 设置读写与迁移
- `src/main/jobs.ts` 活动任务计数
- `src/main/export.ts` CSV/Excel 工作簿
- `src/main/updater.ts` 自动更新状态机

## 变更记录 (Changelog)

- 2026-11-12T21:44:30 初始化模块文档。
