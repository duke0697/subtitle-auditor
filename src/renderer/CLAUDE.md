# src/renderer — React UI

[根目录](../../CLAUDE.md) > [src](../) > **renderer**

## 模块职责

单页五视图桌面 UI：首页选择素材与模型、OCR 提取进度、审查进度、结果复核（播放器 + 时间轴 + 问题列表/详情）、设置。所有系统能力经 `window.api` 调用，业务状态集中在 Zustand store。

## 入口与启动

- `index.html` → `src/main.tsx` → `App.tsx`。
- `App.tsx` 在挂载时 `boot()`（读取设置与模型列表）与 `initUpdate()`，并统一订阅 job/模型/OCR/更新事件。
- CSP 限制脚本与样式为 `'self'`（允许 inline），媒体源放行 `app-media:`、`file:`、`blob:`。

## 对外接口

视图（`src/views`）：

| 视图 | 职责 |
|------|------|
| `HomeView` | 拖拽/选择视频与字幕、同名字幕候选、内嵌轨提取、OCR 入口、模型下载、开始审查 |
| `OcrView` | 硬字幕提取进度与取消 |
| `ProcessingView` | 阶段进度（probe/subtitle/asr/align/done）与实时 ASR 片段 |
| `ResultsView` | 过滤、问题列表、证据详情、播放器、时间轴、导出、复核快捷键 |
| `SettingsView` | 模型与 GPU、推理设备/语言、术语表预设与编辑、阈值滑杆、镜像、软件更新 |

组件（`src/components`）：`TitleBar`、`Player`、`Timeline`、`IssueList`、`IssueDetail`、`DiffText`、`FilterBar`、`SummaryBar`、`Toast`、`UpdateBadge`、`UpdateCard`。

结果页快捷键（输入框聚焦时禁用）：`N/P` 切换问题，`Enter` 标记已核对并前进，`I` 忽略/取消忽略，`←/→` 前后 5 秒。

## 关键依赖与配置

- React 19、Zustand 5、Tailwind CSS 4（`@theme` 定义颜色与字体变量）、Radix UI、lucide-react、`@tanstack/react-virtual`。
- `lib/utils.ts`：`cn`、`KIND_META`、`SEVERITY_META`、`toMediaUrl`（`app-media://file?path=`）、`formatBytes`。
- `lib/time.ts`：`formatTime` / `formatDuration` / `formatDelta`；`lib/clipboard.ts` 封装复制。
- 媒体播放优先使用主进程生成的预览代理，源文件经 `app-media:` 协议流式读取。

## 数据模型

`useApp`（`src/store/app.ts`）持有：当前视图、设置、模型列表、视频/字幕路径、媒体信息、任务进度与实时片段、分析结果、过滤器、选中问题、`reviewState`（`reviewed` / `ignored`，仅内存）、播放时间、预览与波形、OCR 进度、Toast、更新状态。

导出前 `exportResult` 会剔除 `ignored` 的问题并重算 `summary.counts`；`reviewState` 不持久化，`resetSession` 会清空。

## 测试与质量

- 无组件单测；靠 `npm run typecheck` 与 Playwright CDP E2E（`scripts/e2e.mjs`、`actions.mjs`、`screenshot.mjs`）。
- E2E 通过中文按钮名与文本定位（如“选择视频”“开始审查”“审查结果”），改动文案会影响脚本。
- 截图输出在 `tests/output/`（已忽略）。

## 常见问题 (FAQ)

- **新增视图**：在 `store/app.ts` 的 `View` 联合类型加值，`App.tsx` 增加条件渲染，并确保 `resetSession` 回到 `home`。
- **播放器无法 seek**：确认预览代理存在或 `app-media` 协议支持 Range；`Player` 会在 metadata 未就绪时暂存 seek。
- **导出包含已忽略项**：检查是否绕过 `exportResult`；CSV/JSON/Excel 三个入口都必须使用它。
- **快捷键失效**：`ResultsView` 的全局 keydown 会跳过 `INPUT`/`TEXTAREA`/`SELECT` 与可编辑元素。
- **Tailwind 颜色不生效**：颜色变量定义在 `styles/global.css` 的 `@theme`，不要写死十六进制。

## 相关文件清单

- `src/renderer/index.html`、`src/renderer/src/main.tsx`、`src/renderer/src/App.tsx`
- `src/renderer/src/store/app.ts`
- `src/renderer/src/views/{Home,Ocr,Processing,Results,Settings}View.tsx`
- `src/renderer/src/components/*.tsx`
- `src/renderer/src/lib/{time,utils,clipboard}.ts`
- `src/renderer/src/styles/global.css`

## 变更记录 (Changelog)

- 2026-11-12T21:44:30 初始化模块文档。
