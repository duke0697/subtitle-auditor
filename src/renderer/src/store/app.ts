import { create } from 'zustand'
import {
  DEFAULT_SETTINGS,
  type AnalysisResult,
  type AppSettings,
  type AsrSegment,
  type Finding,
  type IssueKind,
  type JobProgress,
  type MediaInfo,
  type ModelInfo,
  type Severity
} from '@shared/contracts'
import type { ModelProgress, UpdateState } from '@shared/ipc'

export type View = 'home' | 'processing' | 'results' | 'settings' | 'ocr'
export type ReviewState = 'reviewed' | 'ignored'

export interface Filters {
  kinds: IssueKind[]
  severities: Severity[]
  query: string
  onlyUnreviewed: boolean
}

interface AppState {
  view: View
  settings: AppSettings
  models: ModelInfo[]
  modelProgress: ModelProgress | null
  videoPath: string | null
  subtitlePath: string | null
  media: MediaInfo | null
  subtitleCandidates: string[]
  jobId: string | null
  progress: JobProgress | null
  liveSegments: AsrSegment[]
  result: AnalysisResult | null
  error: string | null
  filters: Filters
  selectedIssueId: string | null
  reviewState: Record<string, ReviewState>
  playerTimeMs: number
  seekTo: number | null
  seekVersion: number
  previewPath: string | null
  previewProgress: number
  waveform: number[] | null
  ocrProgress: { progress: number; message: string } | null
  toast: string | null
  update: UpdateState | null

  boot: () => Promise<void>
  initUpdate: () => Promise<void>
  checkUpdate: (manual: boolean) => Promise<void>
  restartUpdate: () => Promise<void>
  onUpdateState: (state: UpdateState) => void
  setView: (view: View) => void
  setSettings: (patch: Partial<AppSettings>) => Promise<void>
  chooseVideo: (path: string) => Promise<void>
  chooseSubtitle: (path: string) => void
  extractTrack: (streamIndex: number) => Promise<void>
  generateSubtitles: () => Promise<void>
  cancelOcr: () => Promise<void>
  onOcrProgress: (progress: { progress: number; message: string }) => void
  refreshModels: () => Promise<void>
  downloadModel: (name: string) => Promise<void>
  installGpu: () => Promise<void>
  start: () => Promise<void>
  cancel: () => Promise<void>
  onProgress: (progress: JobProgress) => void
  onSegment: (segment: AsrSegment) => void
  onDone: (result: AnalysisResult) => void
  onError: (message: string) => void
  onModelProgress: (progress: ModelProgress) => void
  selectIssue: (id: string | null) => void
  stepIssue: (delta: number) => void
  markReview: (id: string, state: ReviewState | null) => void
  setFilters: (patch: Partial<Filters>) => void
  setPlayerTime: (ms: number) => void
  setSeekTo: (ms: number | null) => void
  preparePreview: () => Promise<void>
  loadWaveform: () => Promise<void>
  exportCsv: () => Promise<void>
  exportJson: () => Promise<void>
  exportExcel: () => Promise<void>
  setToast: (message: string | null) => void
  resetSession: () => void
}

export function filteredFindings(state: AppState): Finding[] {
  if (!state.result) return []
  const query = state.filters.query.trim().toLowerCase()
  return state.result.findings.filter((finding) => {
    if (state.filters.kinds.length && !state.filters.kinds.includes(finding.kind)) return false
    if (state.filters.severities.length && !state.filters.severities.includes(finding.severity)) return false
    if (state.filters.onlyUnreviewed && state.reviewState[finding.id]) return false
    if (query) {
      const haystack =
        `${finding.subtitleText} ${finding.asrText} ${finding.message} ${finding.suggestion ?? ''}`.toLowerCase()
      if (!haystack.includes(query)) return false
    }
    return true
  })
}

export function reviewProgress(state: AppState): { done: number; total: number } {
  const total = state.result?.findings.length ?? 0
  return { done: Object.keys(state.reviewState).length, total }
}

/** Export payload without ignored findings; kind counts follow the kept rows. */
function exportResult(state: AppState): AnalysisResult | null {
  if (!state.result) return null
  const findings = state.result.findings.filter((finding) => state.reviewState[finding.id] !== 'ignored')
  const counts: Record<IssueKind, number> = { typo: 0, content: 0, timing: 0, uncertain: 0 }
  for (const finding of findings) counts[finding.kind]++
  return { ...state.result, findings, summary: { ...state.result.summary, counts } }
}

const emptyFilters: Filters = {
  kinds: [],
  severities: [],
  query: '',
  onlyUnreviewed: false
}

function uid(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

export const useApp = create<AppState>((set, get) => ({
  view: 'home',
  settings: DEFAULT_SETTINGS,
  models: [],
  modelProgress: null,
  videoPath: null,
  subtitlePath: null,
  media: null,
  subtitleCandidates: [],
  jobId: null,
  progress: null,
  liveSegments: [],
  result: null,
  error: null,
  filters: emptyFilters,
  selectedIssueId: null,
  reviewState: {},
  playerTimeMs: 0,
  seekTo: null,
  seekVersion: 0,
  previewPath: null,
  previewProgress: 0,
  waveform: null,
  ocrProgress: null,
  toast: null,
  update: null,

  boot: async () => {
    try {
      const [settings, models] = await Promise.all([
        window.api.settings.get(),
        window.api.models.list()
      ])
      set({ settings, models })
    } catch (error) {
      set({ error: (error as Error).message })
    }
  },

  setView: (view) => set({ view }),

  initUpdate: async () => {
    try {
      set({ update: await window.api.update.get() })
    } catch {
      // updater state stays unknown; the settings card falls back to disabled
    }
  },

  checkUpdate: async (manual) => {
    try {
      set({ update: await window.api.update.check(manual) })
    } catch (error) {
      set({ toast: (error as Error).message })
    }
  },

  restartUpdate: async () => {
    try {
      const result = await window.api.update.install()
      if (result.started) return
      set({
        toast:
          result.reason === 'busy'
            ? '分析任务运行中，完成后才能重启安装'
            : result.reason === 'disabled'
              ? '开发模式下不支持自动更新'
              : '更新尚未就绪'
      })
    } catch (error) {
      set({ toast: (error as Error).message })
    }
  },

  onUpdateState: (state) => set({ update: state }),

  setSettings: async (patch) => {
    const settings = await window.api.settings.set(patch)
    set({ settings })
  },

  chooseVideo: async (path) => {
    set({ error: null, videoPath: path, subtitlePath: null, result: null })
    try {
      const [media, candidates] = await Promise.all([
        window.api.media.probe(path),
        window.api.media.findSubtitle(path)
      ])
      set({
        media,
        subtitleCandidates: candidates,
        subtitlePath: candidates[0] ?? null
      })
    } catch (error) {
      set({ error: (error as Error).message })
    }
  },

  chooseSubtitle: (path) => set({ subtitlePath: path }),

  extractTrack: async (streamIndex) => {
    const { videoPath } = get()
    if (!videoPath) return
    try {
      const path = await window.api.media.extractSubtitle(videoPath, streamIndex)
      set({ subtitlePath: path, toast: '已从视频中提取字幕轨' })
    } catch (error) {
      set({ error: (error as Error).message })
    }
  },

  generateSubtitles: async () => {
    const { videoPath } = get()
    if (!videoPath) return
    set({ view: 'ocr', ocrProgress: { progress: 0, message: '准备提取画面字幕' }, error: null })
    try {
      const result = await window.api.media.ocrSubtitles(videoPath)
      const name = result.path.split(/[\\/]/).pop() ?? result.path
      set((state) => ({
        subtitlePath: result.path,
        subtitleCandidates: [result.path, ...state.subtitleCandidates.filter((item) => item !== result.path)],
        result: null,
        view: 'home',
        ocrProgress: null,
        toast: `已提取 ${result.cues} 条字幕：${name}`
      }))
    } catch (error) {
      const message = (error as Error).message
      if (message.includes('取消')) {
        set({ view: 'home', ocrProgress: null })
        return
      }
      set({ view: 'home', ocrProgress: null, error: message })
    }
  },

  cancelOcr: async () => {
    set((state) => ({ ocrProgress: state.ocrProgress && { ...state.ocrProgress, message: '正在取消…' } }))
    try {
      await window.api.media.cancelOcr()
    } catch {
      set({ view: 'home', ocrProgress: null })
    }
  },

  onOcrProgress: (progress) => set({ ocrProgress: progress }),

  refreshModels: async () => {
    const models = await window.api.models.list()
    set({ models, modelProgress: null })
  },

  downloadModel: async (name) => {
    try {
      await window.api.models.download(name)
      await get().refreshModels()
      set({ toast: '模型下载完成' })
    } catch (error) {
      set({ modelProgress: null, error: (error as Error).message })
    }
  },

  installGpu: async () => {
    try {
      await window.api.models.installGpu()
      set({ modelProgress: null, toast: 'GPU 组件安装完成，重启应用后生效' })
    } catch (error) {
      set({ modelProgress: null, error: (error as Error).message })
    }
  },

  start: async () => {
    const { videoPath, subtitlePath, settings } = get()
    if (!videoPath || !subtitlePath) return
    const jobId = uid()
    set({
      jobId,
      view: 'processing',
      progress: null,
      liveSegments: [],
      result: null,
      error: null,
      reviewState: {},
      selectedIssueId: null
    })
    try {
      await window.api.job.start({
        jobId,
        videoPath,
        subtitlePath,
        options: { ...settings.options, model: settings.model, device: settings.device, language: settings.language }
      })
    } catch (error) {
      set({ error: (error as Error).message, view: 'home', jobId: null, progress: null })
    }
  },

  cancel: async () => {
    const { jobId } = get()
    if (!jobId) return
    await window.api.job.cancel(jobId)
    set({ view: 'home', progress: null, jobId: null })
  },

  onProgress: (progress) => {
    if (progress.jobId !== get().jobId) return
    set({ progress })
  },

  onSegment: (segment) => {
    set((state) => ({ liveSegments: [...state.liveSegments.slice(-200), segment] }))
  },

  onDone: (result) => {
    const first = [...result.findings].sort((a, b) => {
      const rank = { high: 0, review: 1, info: 2 }
      return rank[a.severity] - rank[b.severity]
    })[0]
    set({
      result,
      view: 'results',
      selectedIssueId: first?.id ?? null,
      seekTo: first?.startMs ?? null,
      jobId: null,
      progress: null
    })
  },

  onError: (message) => {
    if (message === '任务已取消') {
      set({ view: 'home', jobId: null, progress: null })
      return
    }
    set({ error: message, view: 'home', jobId: null, progress: null })
  },

  onModelProgress: (progress) => set({ modelProgress: progress }),

  selectIssue: (id) => {
    const state = get()
    const finding = state.result?.findings.find((item) => item.id === id)
    set({ selectedIssueId: id, seekTo: finding?.startMs ?? state.seekTo })
  },

  stepIssue: (delta) => {
    const state = get()
    const list = filteredFindings(state)
    if (!list.length) return
    const current = list.findIndex((item) => item.id === state.selectedIssueId)
    const nextIndex = Math.max(0, Math.min(list.length - 1, current + delta))
    get().selectIssue(list[nextIndex].id)
  },

  markReview: (id, value) => {
    set((state) => {
      const reviewState = { ...state.reviewState }
      if (value) reviewState[id] = value
      else delete reviewState[id]
      return { reviewState }
    })
  },

  setFilters: (patch) => set((state) => ({ filters: { ...state.filters, ...patch } })),

  setPlayerTime: (ms) => set({ playerTimeMs: ms }),
  setSeekTo: (ms) => set((state) => ({ seekTo: ms, seekVersion: state.seekVersion + 1 })),

  preparePreview: async () => {
    const { videoPath, previewPath } = get()
    if (!videoPath || previewPath) return
    set({ previewProgress: 0 })
    try {
      const path = await window.api.media.preparePreview(videoPath, (progress) =>
        set({ previewProgress: progress.progress })
      )
      set({ previewPath: path, previewProgress: 1 })
    } catch (error) {
      set({ previewProgress: 0, toast: `预览生成失败：${(error as Error).message}` })
    }
  },

  loadWaveform: async () => {
    const { videoPath, waveform } = get()
    if (!videoPath || waveform) return
    try {
      const result = await window.api.media.waveform(videoPath)
      set({ waveform: result.peaks })
    } catch {
      set({ waveform: [] })
    }
  },

  exportCsv: async () => {
    const payload = exportResult(get())
    if (!payload) return
    const path = await window.api.export.csv(payload)
    if (path) set({ toast: `已导出：${path}` })
  },

  exportJson: async () => {
    const payload = exportResult(get())
    if (!payload) return
    const path = await window.api.export.json(payload)
    if (path) set({ toast: `已导出：${path}` })
  },

  exportExcel: async () => {
    const payload = exportResult(get())
    if (!payload) return
    const path = await window.api.export.excel(payload)
    if (path) set({ toast: `已导出：${path}` })
  },

  setToast: (message) => set({ toast: message }),

  resetSession: () =>
    set({
      videoPath: null,
      subtitlePath: null,
      media: null,
      subtitleCandidates: [],
      result: null,
      jobId: null,
      progress: null,
      liveSegments: [],
      selectedIssueId: null,
      reviewState: {},
      previewPath: null,
      previewProgress: 0,
      waveform: null,
      ocrProgress: null,
      error: null,
      view: 'home'
    })
}))
