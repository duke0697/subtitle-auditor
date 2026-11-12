# src/preload — 受限 API 桥

[根目录](../../CLAUDE.md) > [src](../) > **preload**

## 模块职责

在 `contextIsolation` 下把主进程能力收敛为一个类型化对象 `window.api`。不暴露 `ipcRenderer` 本身，渲染进程只能调用白名单方法。

## 入口与启动

- `contextBridge.exposeInMainWorld('api', api)`，`api` 的类型来自 `src/shared/ipc.ts` 的 `Api`。
- 全局类型声明在 `src/preload/index.d.ts`。

## 对外接口

- `files.pathFor(file)`：`webUtils.getPathForFile`，用于拖拽文件取真实路径。
- `window` / `dialog` / `media` / `job` / `models` / `settings` / `export` / `app` / `update` 九组方法，逐项对应 `IPC` 通道。
- 事件订阅统一经 `subscribe<T>(channel, cb)`，返回取消订阅函数；`preparePreview` 在 Promise 结束时自动解绑进度监听。

## 关键依赖与配置

- 仅依赖 `electron` 的 `contextBridge`、`ipcRenderer`、`webUtils`。
- 通道字符串必须复用 `src/shared/ipc.ts` 的 `IPC` 常量，禁止手写字符串。

## 数据模型

不持有状态；参数与返回值类型全部来自 `src/shared/contracts.ts` 与 `src/shared/ipc.ts`。

## 测试与质量

无独立测试。`npm run typecheck` 的 web project 包含 `src/preload/index.d.ts`，node project 包含 `src/preload/index.ts`。

## 常见问题 (FAQ)

- **新增 IPC 只改了一处**：必须同时更新 `IPC` 常量、`Api` 接口、本文件的 `api` 实现、主进程 `ipcMain` 处理器，否则类型或运行时会对不上。
- **事件监听泄漏**：使用返回的取消函数；React 侧在 `useEffect` 清理阶段调用。
- **不要暴露 Node API**：渲染进程无 `nodeIntegration`，任何文件系统操作都应走主进程。

## 相关文件清单

- `src/preload/index.ts`
- `src/preload/index.d.ts`

## 变更记录 (Changelog)

- 2026-11-12T21:44:30 初始化模块文档。
