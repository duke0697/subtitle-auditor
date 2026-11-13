# sidecar/app — Python 计算层

[根目录](../../CLAUDE.md) > [sidecar](../) > **app**

## 模块职责

本地计算与审查引擎：探测媒体、解析字幕、faster-whisper 词级识别、字幕与语音对齐、拼音同音判定、错别字/内容/时间轴规则、硬字幕 OCR、模型与 GPU 组件下载。通过 stdio JSON-RPC 与 Electron 主进程通信。

## 入口与启动

- `sidecar/run.py` → `app.main:main()`。
- `main.py` 启动时强制 UTF-8 重配置 stdin/stdout/stderr，`ensure_dirs()`、`setup_dll_paths()`，随后 `RpcServer.serve_forever()`。
- `dispatch` 是唯一方法路由；异步方法返回 `ASYNC`，在后台线程中通过 `Responder` 回包并发送通知。
- 任务取消：`jobs` 字典保存 `threading.Event`，`cancel` 方法置位；ASR、OCR、模型下载循环定期检查。

## 对外接口

RPC 方法：

| 方法 | 参数 | 返回/行为 |
|------|------|-----------|
| `system.info` | 无 | 版本、Python、schema、模型列表、GPU 状态 |
| `media.probe` | `path` | `MediaInfo`（时长、编码、分辨率、fps、字幕轨） |
| `media.waveform` | `path`, `buckets` | 峰值数组与时长 |
| `media.extractSubtitle` | `videoPath`, `streamIndex`, `outPath` | 提取的内嵌字幕路径 |
| `models.list` | 无 | 模型下载状态与体积 |
| `models.download` | `name`, `mirror` | 异步；`model.progress` 通知 |
| `models.installGpu` | 无 | 异步；下载 cuBLAS/CUDA Runtime DLL |
| `ocr.extract` | `videoPath`, `outPath` | 异步；写入 `.ocr.srt`，`ocr.progress` 通知 |
| `analyze` | `jobId`, `videoPath`, `subtitlePath`, `options` | 先回 `{jobId}`，再流式通知 |
| `cancel` | `jobId`（OCR 用 `"ocr"`） | `{cancelled}` |

通知：`progress`（jobId/stage/progress/message）、`asr.segment`、`job.done`、`job.error`、`model.progress`、`ocr.progress`、`log`。`stdout` 只输出单行 JSON。

## 关键依赖与配置

- 固定版本见 `sidecar/requirements.txt`：faster-whisper 1.2.1、ctranslate2 4.8.5、av 19.0.2、pysubs2 1.9.1、pypinyin 0.55.0、opencc-python-reimplemented 0.1.7、charset-normalizer 3.5.2、rapidfuzz 3.14.6、rapidocr 3.10.0、numpy 2.5.4。
- `config.py`：模型列表（small/medium/large-v3）、默认选项、`%LOCALAPPDATA%\SubtitleAuditor\{models,gpu,cache}`、资源与 ffmpeg 路径、DLL 目录注入。
- 打包：`sidecar/build.spec` 使用 PyInstaller onedir，`collect_all` 收集 ctranslate2、av、onnxruntime、rapidocr、cv2、shapely 等，排除 torch/tensorflow 等。
- `compat.py`：在 faster-whisper 导入前移除 PyAV 19 不支持的 `av.open(metadata_errors=...)`。

## 数据模型

`schema.py` 的 dataclass 是 Python 侧 wire contract：`Cue`、`AsrWord`、`AsrSegment`、`EditOp`、`PinyinEvidence`、`TimingEvidence`、`Evidence`、`Finding`、`Summary`、`AnalysisResult`。`jsonable()` 递归转 camelCase 并输出到主进程；`SCHEMA_VERSION = 1`。

分析流程（`main._run_analysis`）：

1. `media.probe` 取时长；
2. `subtitles.load` 解析字幕与编码，空字幕直接报错；
3. `asr.transcribe` 识别，逐段回调 `asr.segment`；
4. `align.align` 对齐；
5. `rules.build_findings` + `timing.build_timing_findings`；
6. `rules.build_summary`；
7. 组装 `AnalysisResult`，发送 `job.done`。

### 文本归一化（`align.py`）

- 繁转简仅在字符数不变时采用；全半角折叠；数字映射（含“两”）。
- 单位按口述形式重写并保留原字符偏移：`%`→百分之、`Ω/欧姆`→欧、`℃/°C`→摄氏度、`V/mV/kV/A/mA/W/kW/kWh`、`kΩ/MΩ/μF/nF/mH`、`mm²`→平方、`rpm`→转每分钟、`N·m`→牛米等。
- 中文数字与单位、百分比、小数点、数字范围、`CAN-H/CAN-L`（→CAN高/CAN低，允许 `、，,` 等分隔符）、端子正负号（`B+`/`BPP-` → `B正`/`BPP负`，字母或数字之间的连字符不转换）、`±`、圈号、全角标点均归一化。
- `normalize()` 返回 `(规范化文本, 原字符索引映射)`；任何新增改写必须保持映射长度一致，否则拼音证据会错位。

### 对齐（`align.py`）

- 单个字幕最多与相邻 3 条合并（相邻间隔 ≤1200ms），合并需相似度 ≥60 且比单条高 8。
- 候选词窗口容忍 600ms / 3000ms；评分 `0.85*ratio + 15*overlap - 8*outside + 0.05*len`；ratio 用 rapidfuzz 并按较长文本长度惩罚。
- 全局偏移：每条字幕取最佳锚点（ratio ≥70），至少 10 个锚点取 drift 中位数；绝对值超过 `globalOffsetMs` 才报告，MAD 用于提示波动。
- 渐进漂移：至少 10 个锚点且时间跨度 ≥60 秒，对 drift 做线性回归。
- 对齐游标 `minimum` 使用 ASR 时间轴（`group[-1].end_ms - effective_offset`），防止偏移导致吞词。
- 差异用 `difflib.SequenceMatcher` 生成 `EditOp`，保留字幕与 ASR 两侧原始偏移。

### 拼音（`pinyin.py`）

`pypinyin` TONE3 多音字；单字对评分：完全相同 1.0（homophone）、仅声调不同 0.9（tone）、声母或韵母混淆 0.8、两者都混淆 0.75（confusion）。声母混淆集含 zh/z、ch/c、sh/s、n/l、f/h、r/l；韵母含 an/ang、en/eng、in/ing 等。句级相似度为逐字平均，关系取最弱字对，与字符顺序无关。

### 规则（`rules.py`）

- ASR 只多出 1–3 个音节且字幕音节是其子序列 → `uncertain`「语音多识别」，不判字幕错误。
- 中英/数字与汉字混排差异 → `uncertain`「术语识别差异」，不计内容不一致；但单个连续簇内的纯字母/数字替换（如 `CAN-L` / `CAND`）→ `content`「字母写法不一致」（review），因为讲解可能真的读错。被拆成多个相邻 diff 的乱码缩写仍归术语识别。
- 错别字需同时满足：CJK 替换且长度差 ≤1、拼音关系为同音或仅声调差异（`homophone`/`tone`）、对齐达标（ratio ≥`alignmentThreshold`×100，或 ratio ≥60 且编辑 ≤2 字，或字幕全文在其他位置使用识别写法 ≥2 处）、词级最小置信度 ≥`confidenceThreshold`、语音段 `avg_logprob ≥ -1.0`。
- 字幕写错用户术语表中的词条（归一化后 ≥3 字）时不做同音降级，直接按错别字报告；该判定要求语音侧完整命中词条且字幕仅在差异处偏离词条。
- 声母/韵母混淆（`confusion`，如 yin/ying）是 ASR 常见误识，只降级为 `uncertain`「近音差异（疑似 ASR 误识）」，不判错别字；任何同音/近音差异都不会落入 `content`。
- 字幕语料一致性按“差异字+相邻字”的短语统计（单字会把「插头」算成「差分」的旁证）：字幕短语 ≥2 次且多于识别短语 → `uncertain`「同音差异（疑似 ASR 误识）」；识别短语在字幕中有旁证才为 `high`，否则 `review`。词级置信度对同音字没有区分力，不作为 `high` 的依据。
- 同一对齐组内重复出现的同一编辑合并为一条 Finding；只有删除且落在相邻字幕断句处（换行拆词）时降级为 `uncertain`「字幕断句差异」。
- 置信度不足 → `uncertain`「ASR 置信度不足」；边界处少量增删 → `uncertain`「语音边界差异」；其余 → `content`，字符数 ≥8 为 `high`，低置信度或对齐差降为 `info`。
- 无对齐词 → `uncertain`「未检测到对应语音」；语音段 `avg_logprob < -1.0` 且与字幕重叠 → `uncertain`「ASR 置信度较低」（`no_speech_prob` 单独不判定）。
- 汇总：一致率 `1 - 编辑字符/字幕字符`，匹配条数为 ratio ≥50，平均置信度为词概率均值。

### 时间轴（`timing.py`）

- 全局偏移 ≥`globalOffsetMs` 报告，≥2000ms 为 `high`。
- 渐进漂移 >100ms/分钟且累计 >500ms 报告。
- 单条偏差超过 `timingToleranceMs`；首/尾被截断（opcodes 边界 delete/insert）时对应端点偏差置 0；OCR 来源容差至少 1500ms。
- 相邻字幕重叠 >100ms（最多 30 条）、长语音段无字幕（≥1.5s、与字幕重叠 <200ms、最多 50 条）。

### OCR（`subtitle_ocr.py`）

- 只取画面高度 86%–99.5% 的字幕带，缩放到 640px 宽。
- 每 0.25s 采样；画面签名变化 ≥6.0 或距上次 OCR ≥2s 才识别。
- 只保留居中（中心偏差 ≤25%）、非贴边、宽度 ≥8% 的文本行；按底部锚点与行高合并多行，行高不足锚点 70% 的小字号模块标签不并入字幕。
- 同一行被检测器拆成多个水平重叠框时按左到右拼接，重叠边缘的重复字符只保留一份。
- 置信度 <0.6 丢弃；文本变化需下一采样确认才切分，空样本结束当前 cue。
- 输出 SRT，并返回条数与时长。

### 模型（`models.py`）

- 优先 ModelScope API 下载，失败后回退用户镜像与 Hugging Face；`.part` 断点续传、大小与 SHA-256 校验、写 `manifest.json`。
- GPU 组件从 PyPI 下载 `nvidia-cublas-cu12` / `nvidia-cuda-runtime-cu12` 的 win_amd64 wheel，仅解压 DLL 到 `gpu/`。
- `cuda_status()` 先按绝对路径加载 cuBLAS，再询问 CTranslate2 设备数与计算类型；失败原因会传给 UI。
- 设备策略：`cpu` 强制 CPU；`auto` GPU 不可用静默回退；`cuda` 强制失败时报错。CUDA 推理期失败会缓存失败原因并回退 CPU，仅 `auto` 模式返回 warning。

## 测试与质量

pytest 覆盖（`tests/sidecar`）：`test_align.py`（归一化/偏移/合并）、`test_rules.py`（错别字/内容/汇总）、`test_timing.py`、`test_pinyin.py`、`test_glossary_normalize.py`、`test_subtitles.py`（编码/格式）、`test_subtitle_ocr.py`（选行与合并）、`test_rpc_encoding.py`、`test_asr_device.py`（设备与提示词）。运行：`npm run test:sidecar`。

## 常见问题 (FAQ)

- **PyAV 报 `metadata_errors` 未知参数**：确认 `asr.py` 在导入 faster-whisper 前已 `import compat`。
- **GPU 选自动却走 CPU**：查看 `system.info.gpu.warning`；常见原因是未安装 GPU 组件或 cuBLAS 无法加载。
- **模型下载卡住/失败**：先 ModelScope，再镜像，再官方 HF；检查磁盘空间、SHA-256 与 `model.bin` 是否存在。
- **字幕全被判“未检测到语音”**：优先检查编码解析与全局偏移；对齐依赖词级时间戳，VAD 过滤过长静音也会影响。
- **OCR 提取到画面标签**：调整 `subtitle_ocr.py` 的 `BAND_*`、`CENTER_TOLERANCE`、`MIN_LINE_RATIO` 前先补 `test_subtitle_ocr.py`。
- **改术语表后识别结果没变**：术语热词只影响解码提示；同音改写只作用于 ASR 输出，且要求拼音完全一致与词边界安全。

## 相关文件清单

- `sidecar/run.py`、`sidecar/requirements.txt`、`sidecar/requirements-build.txt`、`sidecar/build.spec`
- `sidecar/app/main.py` 入口与 RPC 路由
- `sidecar/app/rpc.py` 单行 JSON-RPC 服务
- `sidecar/app/schema.py` dataclass 契约
- `sidecar/app/config.py` 路径、模型与默认选项
- `sidecar/app/media.py` 探测/波形/字幕轨
- `sidecar/app/subtitles.py` 编码探测与解析
- `sidecar/app/asr.py` faster-whisper 识别与设备回退
- `sidecar/app/align.py` 归一化与对齐
- `sidecar/app/pinyin.py` 拼音相似度
- `sidecar/app/glossary.py` 术语热词与同音改写
- `sidecar/app/rules.py` 错别字/内容规则与汇总
- `sidecar/app/timing.py` 时间轴规则
- `sidecar/app/subtitle_ocr.py` 硬字幕提取
- `sidecar/app/models.py` 模型/GPU 下载
- `sidecar/app/compat.py` PyAV 兼容垫片

## 变更记录 (Changelog)

- 2026-11-12T21:44:30 初始化模块文档。
