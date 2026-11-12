import { useEffect, useState } from 'react'
import {
  ArrowLeft,
  CheckCircle2,
  Cpu,
  Download,
  HardDrive,
  Languages,
  Loader2,
  Network,
  SlidersHorizontal,
  Sparkles
} from 'lucide-react'
import type { AnalysisOptions } from '@shared/contracts'
import { AUTOMOTIVE_GLOSSARY } from '@shared/glossary'
import { formatBytes, cn } from '../lib/utils'
import { useApp } from '../store/app'
import UpdateCard from '../components/UpdateCard'

function parseGlossary(text: string): string[] {
  return text
    .split(/[\n,，、]/)
    .map((term) => term.trim())
    .filter(Boolean)
}

function SliderRow({
  label,
  hint,
  value,
  min,
  max,
  step,
  format,
  onChange
}: {
  label: string
  hint: string
  value: number
  min: number
  max: number
  step: number
  format: (value: number) => string
  onChange: (value: number) => void
}): React.JSX.Element {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-[11.5px]">
        <span className="text-ink2">{label}</span>
        <span className="font-mono text-accent">{format(value)}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="w-full accent-[var(--color-accent)]"
      />
      <div className="text-[10px] text-muted">{hint}</div>
    </div>
  )
}

export default function SettingsView(): React.JSX.Element {
  const settings = useApp((state) => state.settings)
  const models = useApp((state) => state.models)
  const modelProgress = useApp((state) => state.modelProgress)
  const setSettings = useApp((state) => state.setSettings)
  const downloadModel = useApp((state) => state.downloadModel)
  const installGpu = useApp((state) => state.installGpu)
  const setView = useApp((state) => state.setView)
  const result = useApp((state) => state.result)
  const [mirror, setMirror] = useState(settings.hfMirror)
  const [glossaryText, setGlossaryText] = useState(() => settings.options.glossary.join('\n'))
  const [version, setVersion] = useState('')

  useEffect(() => {
    void window.api.app.version().then(setVersion)
  }, [])

  useEffect(() => {
    setMirror(settings.hfMirror)
  }, [settings.hfMirror])

  const updateOption = (patch: Partial<AnalysisOptions>): void => {
    void setSettings({ options: { ...settings.options, ...patch } })
  }

  const applyAutomotiveGlossary = (): void => {
    const merged = [...new Set([...parseGlossary(glossaryText), ...AUTOMOTIVE_GLOSSARY])]
    setGlossaryText(merged.join('\n'))
    void setSettings({ options: { ...settings.options, glossary: merged } })
  }

  const gpuInstalling = modelProgress?.name === 'gpu'

  return (
    <div className="scroll-area h-full px-6 py-5">
      <div className="mx-auto max-w-[980px]">
        <div className="mb-5 flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2">
              <button className="btn btn-ghost btn-icon" onClick={() => setView(result ? 'results' : 'home')}>
                <ArrowLeft size={15} />
              </button>
              <h1 className="text-[19px] font-semibold tracking-tight">设置</h1>
            </div>
            <p className="ml-9 mt-0.5 text-[11.5px] text-muted">
              模型、设备与检测阈值。修改会立即保存。
            </p>
          </div>
          <span className="timecode">v{version || '0.1.0'}</span>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <section className="panel p-5">
            <div className="mb-3 flex items-center gap-2 text-[12.5px] font-medium">
              <Sparkles size={14} className="text-accent" /> 识别模型
            </div>
            <div className="space-y-2">
              {models.map((model) => {
                const selected = settings.model === model.name
                const downloading = modelProgress?.name === model.name
                return (
                  <button
                    key={model.name}
                    className={cn(
                      'flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors',
                      selected ? 'border-accent/50 bg-accent/[0.06]' : 'border-line bg-panel2 hover:bg-panel3'
                    )}
                    onClick={() => void setSettings({ model: model.name })}
                  >
                    <div
                      className={cn(
                        'flex h-8 w-8 items-center justify-center rounded-lg',
                        selected ? 'bg-accent/15 text-accent' : 'bg-panel3 text-muted'
                      )}
                    >
                      <HardDrive size={14} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 text-[12.5px]">
                        {model.label}
                        {model.downloaded && <CheckCircle2 size={12} className="text-ok" />}
                      </div>
                      <div className="text-[10.5px] text-muted">
                        {formatBytes(model.sizeBytes)} · 推荐 {model.recommendedDevice === 'cuda' ? 'GPU' : 'CPU'}
                      </div>
                      {downloading && (
                        <div className="mt-1.5">
                          <div className="h-1 overflow-hidden rounded-full bg-line">
                            <div
                              className="h-full rounded-full bg-accent"
                              style={{ width: `${Math.round((modelProgress?.progress ?? 0) * 100)}%` }}
                            />
                          </div>
                          <div className="mt-1 truncate text-[9.5px] text-muted">{modelProgress?.message}</div>
                        </div>
                      )}
                    </div>
                    {!model.downloaded && !downloading && (
                      <span className="btn h-7 px-2 text-[10.5px]">
                        <Download size={11} /> 下载
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
            {!models.find((model) => model.name === settings.model)?.downloaded &&
              modelProgress?.name !== settings.model && (
                <button
                  className="btn mt-3 h-8 w-full text-[11.5px]"
                  onClick={() => void downloadModel(settings.model)}
                >
                  <Download size={12} /> 下载当前模型
                </button>
              )}
            {gpuInstalling && (
              <div className="mt-3 rounded-lg border border-accent/25 bg-accent/5 px-3 py-2">
                <div className="h-1 overflow-hidden rounded-full bg-line">
                  <div
                    className="h-full rounded-full bg-accent"
                    style={{ width: `${Math.round((modelProgress?.progress ?? 0) * 100)}%` }}
                  />
                </div>
                <div className="mt-1.5 truncate text-[10px] text-muted">{modelProgress?.message}</div>
              </div>
            )}
          </section>

          <section className="panel p-5">
            <div className="mb-3 flex items-center gap-2 text-[12.5px] font-medium">
              <Cpu size={14} className="text-accent" /> 设备与语言
            </div>
            <label className="mb-1 block text-[11px] text-muted">推理设备</label>
            <select
              className="input mb-3"
              value={settings.device}
              onChange={(event) =>
                void setSettings({ device: event.target.value as 'auto' | 'cpu' | 'cuda' })
              }
            >
              <option value="auto">自动 · 优先 GPU，失败回退 CPU</option>
              <option value="cpu">仅 CPU · 兼容性最好</option>
              <option value="cuda">强制 GPU · 需要 cuBLAS 组件</option>
            </select>

            <label className="mb-1 block text-[11px] text-muted">字幕语言</label>
            <select
              className="input mb-3"
              value={settings.language ?? 'auto'}
              onChange={(event) =>
                void setSettings({
                  language: event.target.value === 'auto' ? null : event.target.value
                })
              }
            >
              <option value="auto">自动检测（中文优先）</option>
              <option value="zh">中文</option>
              <option value="en">英语</option>
              <option value="ja">日语</option>
              <option value="ko">韩语</option>
            </select>

            <div className="mb-1 flex items-center justify-between">
              <label className="block text-[11px] text-muted">专业术语表</label>
              <button
                className="text-[10.5px] text-accent hover:underline"
                onClick={applyAutomotiveGlossary}
              >
                载入汽车术语表
              </button>
            </div>
            <textarea
              className="mb-1 w-full resize-none rounded-lg border border-line bg-canvas px-2.5 py-2 text-[11.5px] leading-relaxed text-ink outline-none focus:border-accent/60"
              style={{ height: 132 }}
              value={glossaryText}
              placeholder={'每行一个术语，例如：\n高压互锁\nCAN通讯\n线束'}
              onChange={(event) => {
                const text = event.target.value
                setGlossaryText(text)
                void setSettings({
                  options: { ...settings.options, glossary: parseGlossary(text) }
                })
              }}
            />
            <p className="mb-3 text-[10.5px] leading-relaxed text-muted">
              每行一个。术语会拼成提示词引导简体输出；ASR 中的同音误识别（如「实讯」）会按术语表自动改写，字幕文件不受影响。提示词：
              <span className="text-ink2">
                {settings.options.glossary.length
                  ? `以下是普通话讲解，涉及${settings.options.glossary.slice(0, 6).join('、')}等术语。`
                  : '以下是普通话的句子。'}
              </span>
            </p>

            <div className="panel-soft p-3">
              <div className="mb-1 flex items-center gap-1.5 text-[11px] text-ink2">
                <Languages size={12} /> GPU 加速组件
              </div>
              <p className="text-[10.5px] leading-relaxed text-muted">
                可选下载 cuBLAS（约 528MB）。不安装也可使用 CPU 完整功能；安装后重启生效。
              </p>
              <button
                className="btn mt-2 h-7 w-full text-[11px]"
                disabled={gpuInstalling}
                onClick={() => void installGpu()}
              >
                {gpuInstalling ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
                {gpuInstalling ? '正在安装…' : '安装 / 修复 GPU 组件'}
              </button>
            </div>
          </section>

          <section className="panel p-5">
            <div className="mb-3 flex items-center gap-2 text-[12.5px] font-medium">
              <SlidersHorizontal size={14} className="text-accent" /> 检测阈值
            </div>
            <div className="space-y-4">
              <SliderRow
                label="词级置信度下限"
                hint="低于此值不判定为错别字；低于 0.65 只标不确定"
                value={settings.options.confidenceThreshold}
                min={0.5}
                max={0.99}
                step={0.01}
                format={(value) => value.toFixed(2)}
                onChange={(value) => updateOption({ confidenceThreshold: value })}
              />
              <SliderRow
                label="拼音相似度下限"
                hint="同音 1.0 / 仅声调差异 0.9 / 受控近音 0.8"
                value={settings.options.pinyinThreshold}
                min={0.5}
                max={1}
                step={0.01}
                format={(value) => value.toFixed(2)}
                onChange={(value) => updateOption({ pinyinThreshold: value })}
              />
              <SliderRow
                label="对齐相似度下限"
                hint="字幕与 ASR 文本的整体相似度要求"
                value={settings.options.alignmentThreshold}
                min={0.6}
                max={0.95}
                step={0.01}
                format={(value) => value.toFixed(2)}
                onChange={(value) => updateOption({ alignmentThreshold: value })}
              />
            </div>
          </section>

          <section className="panel p-5">
            <div className="mb-3 flex items-center gap-2 text-[12.5px] font-medium">
              <Network size={14} className="text-accent" /> 网络与时间轴
            </div>
            <label className="mb-1 block text-[11px] text-muted">模型备用源（可选）</label>
            <input
              className="input mb-1"
              value={mirror}
              onChange={(event) => setMirror(event.target.value)}
              onBlur={() => void setSettings({ hfMirror: mirror })}
              placeholder="留空则自动：ModelScope → Hugging Face"
            />
            <p className="mb-3 text-[10px] text-muted">默认使用 ModelScope，失败后回退到该地址或官方源。</p>

            <div className="space-y-4">
              <SliderRow
                label="单条时间轴允许偏差"
                hint="校正全局偏移后，单条字幕起点或终点与语音的偏差超过该值提示"
                value={settings.options.timingToleranceMs}
                min={100}
                max={2000}
                step={50}
                format={(value) => `${value} ms`}
                onChange={(value) => updateOption({ timingToleranceMs: value })}
              />
              <SliderRow
                label="全局偏移阈值"
                hint="全片字幕整体提前/延后的判定阈值"
                value={settings.options.globalOffsetMs}
                min={200}
                max={3000}
                step={50}
                format={(value) => `${value} ms`}
                onChange={(value) => updateOption({ globalOffsetMs: value })}
              />
            </div>
          </section>
        </div>

        <div className="mt-4">
          <UpdateCard />
        </div>

        <div className="mt-4 rounded-xl border border-line bg-panel px-4 py-3 text-[10.5px] leading-relaxed text-muted">
          ASR 置信度是模型分数，不是校准后的正确率；本工具只提供「疑似」结论与证据，不会自动改写字幕文件。
        </div>
      </div>
    </div>
  )
}
