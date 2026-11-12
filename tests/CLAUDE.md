# tests — 测试与样片

[根目录](../CLAUDE.md) > **tests**

## 模块职责

Python sidecar 的 pytest 用例、媒体样片与 E2E 输出目录。测试直接导入 `sidecar/app`，不启动 Electron，也不加载真实 Whisper 模型。

## 入口与启动

- `tests/sidecar/conftest.py` 将仓库根的 `sidecar/` 加入 `sys.path`，使 `from app...` 可用。
- 运行：`npm run test:sidecar`，等价 `sidecar/.venv/Scripts/python.exe -m pytest tests/sidecar -q`。
- E2E 由 `scripts/e2e.mjs` 等驱动，不属于 pytest。

## 对外接口

| 测试文件 | 覆盖点 |
|----------|--------|
| `test_align.py` | 精确匹配、全局偏移、合并字幕、编辑操作、数字/单位/符号/CAN 归一化、边界截断恢复 |
| `test_rules.py` | 高置信度错别字、多音字、低置信度降级、内容差异、ASR 插入/边界词抑制、混排术语、字幕拼写一致性降级、汇总计数 |
| `test_timing.py` | 全局偏移、局部漂移、容差可配置、边缘截断抑制、大波动仍报告全局偏移 |
| `test_pinyin.py` | 同音、声调、声母混淆、无关、句级相似度 |
| `test_glossary_normalize.py` | 跨词/词内同音改写、最长优先、正确词保留、ASCII 边界、术语改写 |
| `test_subtitles.py` | UTF-8、GBK、ASS 解析与 pysubs2 加载 |
| `test_subtitle_ocr.py` | 贴边/侧边标签丢弃、双行顺序、变化确认、切分与合并、空样本、单样本 |
| `test_rpc_encoding.py` | stdin UTF-8 解码 |
| `test_asr_device.py` | CPU/auto/强制 GPU 策略、术语提示词构建与预算 |

## 关键依赖与配置

- pytest 9.x（本地 venv）；`conftest.py` 无额外 fixture 注入。
- 样片在 `tests/fixtures/`：`sample.mp4`、`sample.mkv`、`sample-embedded.mp4`、`sample.srt`、`sample-typo.srt`、`speech.wav`、`s1.wav`、`s2.wav`、`tts.ps1`。
- `tests/output/` 存放 E2E 截图、ASR JSON、提取字幕与日志，已 gitignore。

## 数据模型

测试使用 `sidecar/app/schema.py` 的 dataclass 构造夹具（`Cue`、`AsrWord`、`AsrSegment`），断言 `Finding` 的 `kind`、`severity`、`title` 与证据字段。

## 测试与质量

- 规则/对齐测试是修改 `rules.py`、`align.py`、`timing.py` 的强制门禁。
- 没有 TypeScript 单元测试；前端只能靠 `npm run typecheck` 与 E2E。
- 没有 OCR 引擎集成测试；`test_subtitle_ocr.py` 只测选行与合并的纯逻辑。
- 发布工作流未执行 pytest，属 CI 缺口。

## 常见问题 (FAQ)

- **导入 `app` 失败**：必须从仓库根运行 pytest，或保留 `conftest.py` 的 `sys.path` 注入。
- **中文样片乱码**：样片含 GBK 编码用例，不要统一转 UTF-8，否则会丢失编码覆盖。
- **E2E 输出被提交**：`tests/output/` 已在 `.gitignore`，若被跟踪需手动移除缓存。
- **新增规则没有测试**：先在对应测试文件构造最小 `Cue`/`AsrSegment`，断言标题与严重度，再改规则。

## 相关文件清单

- `tests/sidecar/conftest.py`
- `tests/sidecar/test_*.py`
- `tests/fixtures/*`
- `tests/output/*`（忽略）

## 变更记录 (Changelog)

- 2026-11-12T21:44:30 初始化模块文档。
