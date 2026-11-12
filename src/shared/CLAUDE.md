# src/shared — TS 契约与术语表

[根目录](../../CLAUDE.md) > [src](../) > **shared**

## 模块职责

主进程、preload、渲染进程共享的唯一类型与常量来源：分析结果契约、IPC 通道、默认设置、专业术语表预设。该目录不依赖 Electron/Node，可被三端同时打包。

## 入口与启动

无运行时启动逻辑。三个公开文件：

- `contracts.ts`：领域模型、`AnalysisOptions`、`AnalysisResult`、`AppSettings`、默认值。
- `ipc.ts`：IPC 通道常量 `IPC`、暴露给渲染进程的 `Api` 接口，以及 `PreviewProgress`、`ModelProgress`、`Waveform`、`OcrResult`、`UpdateState` 等桥接类型。
- `glossary.ts`：`AUTOMOTIVE_GLOSSARY`（199 条，默认）与 `ROBOTICS_GLOSSARY`（220 条）两套预设。

## 对外接口

- `IssueKind`：`typo | content | timing | uncertain`；`Severity`：`high | review | info`。
- `Finding`：`id`、`kind`、`severity`、`cueIds`、时间范围、字幕/ASR 文本、`confidence`、`suggestion`、`evidence`。
- `AnalysisResult.schemaVersion` 固定为 `1`；字段与 `sidecar/app/schema.py` 的 dataclass 一一对应（Python 侧 `jsonable` 转 camelCase）。
- `DEFAULT_OPTIONS`：medium / auto / 置信度 0.9 / 不确定 0.65 / 拼音 0.8 / 对齐 0.85 / 单条时间轴 500ms / 全局偏移 500ms / 繁转简开启。
- `DEFAULT_SETTINGS`：更新镜像默认 `https://ghfast.top/`，窗口 1360×860。
- `IPC`：窗口、对话框、媒体、任务、模型、设置、导出、应用、更新九组通道名。

## 关键依赖与配置

- 仅 `src/shared/glossary.ts` 被 `contracts.ts` 引用以填充默认术语表。
- 路径别名：`@shared/*` → `src/shared/*`（`electron.vite.config.ts` 与两个 tsconfig 同时配置）。

## 数据模型

`AnalysisResult` = 媒体信息 + 字幕信息 + 模型信息 + `Cue[]` + `AsrSegment[]` + `Finding[]` + `Summary` + 实际使用的 `AnalysisOptions`。`Evidence` 可携带编辑操作、词置信度、拼音证据与时间偏差。`JobStage` 为 `probe | subtitle | asr | align | done`。

## 测试与质量

无单元测试；`npm run typecheck` 同时检查 node 与 web 两个 project。修改契约后必须全量 typecheck，并检查 `scripts/**/*.mjs` 中是否有硬编码字段。

## 常见问题 (FAQ)

- **TS 与 Python 字段不一致**：以 `contracts.ts` 为前端契约、`schema.py` 为后端契约；新增字段时两边同时改，并检查 `export.ts` 与结果页。
- **默认术语表被替换**：设置页切换预设会整体替换 `options.glossary`，不是追加。
- **不要在此目录引入 Node/Electron 模块**：会被渲染进程打包，导致构建失败或运行时泄漏。

## 相关文件清单

- `src/shared/contracts.ts`
- `src/shared/ipc.ts`
- `src/shared/glossary.ts`

## 变更记录 (Changelog)

- 2026-11-12T21:44:30 初始化模块文档。
