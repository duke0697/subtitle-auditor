import type {
  AnalysisResult,
  AnalyzeRequest,
  AppSettings,
  JobDoneEvent,
  JobErrorEvent,
  JobProgress,
  JobSegmentEvent,
  MediaInfo,
  ModelInfo
} from './contracts'

export interface PreviewProgress {
  progress: number
  message: string
}

export interface ModelProgress {
  name: string
  progress: number
  message: string
}

export interface Waveform {
  peaks: number[]
  durationMs: number
}

export interface OcrProgress {
  progress: number
  message: string
}

export interface OcrResult {
  path: string
  cues: number
}

export interface Api {
  files: {
    pathFor: (file: File) => string
  }
  window: {
    minimize: () => void
    toggleMaximize: () => void
    close: () => void
    isMaximized: () => Promise<boolean>
    onMaximizedChange: (cb: (maximized: boolean) => void) => () => void
  }
  dialog: {
    pickVideo: () => Promise<string | null>
    pickSubtitle: () => Promise<string | null>
  }
  media: {
    probe: (path: string) => Promise<MediaInfo>
    findSubtitle: (videoPath: string) => Promise<string[]>
    extractSubtitle: (videoPath: string, streamIndex: number) => Promise<string>
    preparePreview: (videoPath: string, onProgress: (p: PreviewProgress) => void) => Promise<string | null>
    waveform: (videoPath: string) => Promise<Waveform>
    ocrSubtitles: (videoPath: string) => Promise<OcrResult>
    cancelOcr: () => Promise<void>
    onOcrProgress: (cb: (p: OcrProgress) => void) => () => void
  }
  job: {
    start: (req: AnalyzeRequest) => Promise<void>
    cancel: (jobId: string) => Promise<void>
    onProgress: (cb: (e: JobProgress) => void) => () => void
    onSegment: (cb: (e: JobSegmentEvent) => void) => () => void
    onDone: (cb: (e: JobDoneEvent) => void) => () => void
    onError: (cb: (e: JobErrorEvent) => void) => () => void
  }
  models: {
    list: () => Promise<ModelInfo[]>
    download: (name: string) => Promise<void>
    installGpu: () => Promise<void>
    onProgress: (cb: (p: ModelProgress) => void) => () => void
  }
  settings: {
    get: () => Promise<AppSettings>
    set: (patch: Partial<AppSettings>) => Promise<AppSettings>
  }
  export: {
    csv: (result: AnalysisResult) => Promise<string | null>
    json: (result: AnalysisResult) => Promise<string | null>
  }
  app: {
    openPath: (path: string) => Promise<void>
    version: () => Promise<string>
  }
}

export const IPC = {
  windowMinimize: 'window:minimize',
  windowToggleMaximize: 'window:toggle-maximize',
  windowClose: 'window:close',
  windowIsMaximized: 'window:is-maximized',
  windowMaximized: 'window:maximized',
  dialogPickVideo: 'dialog:pick-video',
  dialogPickSubtitle: 'dialog:pick-subtitle',
  mediaProbe: 'media:probe',
  mediaFindSubtitle: 'media:find-subtitle',
  mediaExtractSubtitle: 'media:extract-subtitle',
  mediaPreparePreview: 'media:prepare-preview',
  mediaPreviewProgress: 'media:preview-progress',
  mediaWaveform: 'media:waveform',
  mediaOcr: 'media:ocr',
  mediaOcrCancel: 'media:ocr-cancel',
  mediaOcrProgress: 'media:ocr-progress',
  jobStart: 'job:start',
  jobCancel: 'job:cancel',
  jobProgress: 'job:progress',
  jobSegment: 'job:segment',
  jobDone: 'job:done',
  jobError: 'job:error',
  modelsList: 'models:list',
  modelsDownload: 'models:download',
  modelsInstallGpu: 'models:install-gpu',
  modelsProgress: 'models:progress',
  settingsGet: 'settings:get',
  settingsSet: 'settings:set',
  exportCsv: 'export:csv',
  exportJson: 'export:json',
  appOpenPath: 'app:open-path',
  appVersion: 'app:version'
} as const
