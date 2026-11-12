# 字幕校对台（Subtitle Auditor）

Windows 桌面端视频字幕审查工具：本地 ASR 词级置信度 + 字幕差异比对，定位疑似错别字、内容不一致与时间轴偏移。视频没有字幕时，可用内置 OCR 从画面提取硬字幕。

## 技术栈

- Electron 45 + React 19 + TypeScript + Tailwind CSS 4
- Python 3.13 sidecar：faster-whisper 1.2.1 / CTranslate2 4.8.5
- RapidOCR 3.10.0（PP-OCRv6）用于画面硬字幕提取
- pysubs2 / pypinyin / RapidFuzz / OpenCC
- PyInstaller onedir + electron-builder NSIS

## 快速使用

1. 安装 `SubtitleAuditor-Setup-0.1.0.exe` 并启动。
2. 拖入视频 + 字幕，或分别选择；同名字幕会自动配对，MKV/MP4 内嵌软字幕可直接提取。
3. 视频没有字幕、只有画面上的硬字幕时，在首页点「从画面提取字幕（OCR）」，生成同名 `.ocr.srt` 并自动选中（5 分钟视频约 1–2 分钟）。
4. 首次使用下载识别模型（默认 medium；有 NVIDIA 显卡可选装 GPU 组件）。
5. 点击「开始审查」，结果页用 `N/P` 切换问题、`Enter` 标记已核对、`I` 忽略、`←/→` 快退快进。
6. 结果页右上角点击「Excel」导出可读报告：概览、问题清单、字幕对照三张工作表，标记为「已忽略」的问题不会导出。

模型与缓存位于 `%LOCALAPPDATA%\SubtitleAuditor`。应用配置位于 `%APPDATA%\SubtitleAuditor\settings.json`。

## 开发环境

```bash
npm install
npm run setup:sidecar     # 创建 sidecar/.venv 并安装依赖
npm run fetch:ffmpeg      # 复制 ffmpeg/ffprobe 到 resources/ffmpeg
npm run dev
```

首次使用需在应用内下载 ASR 模型（默认 medium）。模型默认从 ModelScope 下载，失败后回退到 Hugging Face。GPU 为可选项：设置页可下载 cuBLAS + CUDA Runtime 组件，安装后重启生效；设备选「自动」时会先检测组件与显卡，缺失则直接用 CPU 识别，不会中断审查。

设置页可维护「专业术语表」（每行一个），内置汽车（默认，含新能源三电、智能网联，199 条）与机器人（工业机器人、协作机器人、集成应用，220 条）两个专业术语表，下拉切换会替换当前列表，可再自行增删。术语会拼成 Whisper 提示词（每个 30 秒窗口都生效，优先采用字幕中出现的术语）；ASR 输出中与术语拼音完全一致的同音词（如「实讯」「时讯」）会按术语表自动改写，只作用于识别结果，不改字幕文件。

## 测试

```bash
npm run test:sidecar       # pytest：字幕解析、拼音、对齐、规则、时间轴
node scripts/e2e.mjs 9223  # 需先以测试钩子启动应用（见脚本内说明）
```

生成测试片：`tests/fixtures/tts.ps1` 使用 Windows 中文语音合成，再由 ffmpeg 生成 MP4/MKV 软字幕样片。

## 构建安装包

```bash
npm run dist
# 产物：dist/SubtitleAuditor-Setup-0.1.0.exe
```

## 自动更新

打包版启动约 10 秒后自动检查 GitHub Releases，发现新版本在后台下载，完成后可在设置页「软件更新」重启安装；有分析任务运行时会阻止重启，避免丢失审查结果。开发模式下不检查更新。

默认通过 `https://ghfast.top/` 镜像访问 GitHub，镜像不可用时自动回退直连；设置页可修改镜像前缀，留空则只走直连。

## 发布新版本

```bash
git tag v0.1.1
git push origin v0.1.1
```

GitHub Actions 会重建 sidecar 与 ffmpeg、打包 NSIS 安装包，并发布 Release（含 `latest.yml` 与 `.blockmap`）。本地发布需提供 `GH_TOKEN`：

```bash
GH_TOKEN=<token> npm run release
```

## 目录

- `src/main` Electron 主进程：窗口、IPC、sidecar 生命周期、ffmpeg 预览
- `src/preload` 受限 API 桥
- `src/renderer` React UI
- `src/shared` TS 契约
- `sidecar` Python 计算层：媒体、字幕、ASR、对齐、规则
- `scripts` 环境/构建/图标脚本

## 许可提示

安装包内携带 ffmpeg/ffprobe 静态二进制（ffmpeg-static 的 GPL 构建）与 faster-whisper/CTranslate2（MIT）。对外分发前请根据实际分发范围评估 FFmpeg 许可与模型许可。

## 审查口径

- 错别字仅在 ASR 词级置信度高、对齐良好且拼音同音/近音时提示；
- 阿拉伯数字与中文数字、单位符号与口述写法（`4` / `四`、`120Ω` / `120欧姆`、`80%` / `百分之八十`、`25℃` / `25摄氏度`、`1.5V` / `一点五伏`、`500mA` / `五百毫安`、`2kΩ` / `两千欧`、`1.5mm²` / `一点五平方`）、`CAN-H` / `CAN高` 与 `CAN-L` / `CAN低` 视为等价，不产生差异结论；
- 识别结果仅在字幕基础上多出少量字词（含跨条边界重复出现的词）时只标「语音多识别」，不判定为字幕错误；
- 识别结果在边界处多出或漏掉少量字词时只标「语音边界差异」，且不再据此报告该端点的时间偏差；
- 单条字幕起点或终点与语音的偏差在 500 ms 内不提示，阈值可在设置页「单条时间轴允许偏差」调整；
- 低置信度区域只标「ASR 不确定」，不下结论；
- 不自动改写字幕文件，仅提供建议与证据；
- OCR 只识别画面底部的硬字幕，超短视频/特殊排版可能需要人工校正；
- 批量队列、云端 ASR 不在 v1 范围。
