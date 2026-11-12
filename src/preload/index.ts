import { contextBridge, ipcRenderer, webUtils } from 'electron'
import {
  IPC,
  type Api,
  type ModelProgress,
  type OcrProgress,
  type OcrResult,
  type PreviewProgress,
  type UpdateInstallResult,
  type UpdateState,
  type Waveform
} from '../shared/ipc'
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
} from '../shared/contracts'

function subscribe<T>(channel: string, cb: (payload: T) => void): () => void {
  const listener = (_event: Electron.IpcRendererEvent, payload: T): void => cb(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api: Api = {
  files: {
    pathFor: (file: File) => webUtils.getPathForFile(file)
  },
  window: {
    minimize: () => ipcRenderer.send(IPC.windowMinimize),
    toggleMaximize: () => ipcRenderer.send(IPC.windowToggleMaximize),
    close: () => ipcRenderer.send(IPC.windowClose),
    isMaximized: () => ipcRenderer.invoke(IPC.windowIsMaximized) as Promise<boolean>,
    onMaximizedChange: (cb) => subscribe<boolean>(IPC.windowMaximized, cb)
  },
  dialog: {
    pickVideo: () => ipcRenderer.invoke(IPC.dialogPickVideo) as Promise<string | null>,
    pickSubtitle: () => ipcRenderer.invoke(IPC.dialogPickSubtitle) as Promise<string | null>
  },
  media: {
    probe: (path) => ipcRenderer.invoke(IPC.mediaProbe, path) as Promise<MediaInfo>,
    findSubtitle: (videoPath) =>
      ipcRenderer.invoke(IPC.mediaFindSubtitle, videoPath) as Promise<string[]>,
    extractSubtitle: (videoPath, index) =>
      ipcRenderer.invoke(IPC.mediaExtractSubtitle, videoPath, index) as Promise<string>,
    preparePreview: (videoPath, onProgress) => {
      const off = subscribe<PreviewProgress>(IPC.mediaPreviewProgress, onProgress)
      return (ipcRenderer.invoke(IPC.mediaPreparePreview, videoPath) as Promise<string | null>).finally(off)
    },
    waveform: (videoPath) => ipcRenderer.invoke(IPC.mediaWaveform, videoPath) as Promise<Waveform>,
    ocrSubtitles: (videoPath) => ipcRenderer.invoke(IPC.mediaOcr, videoPath) as Promise<OcrResult>,
    cancelOcr: () => ipcRenderer.invoke(IPC.mediaOcrCancel) as Promise<void>,
    onOcrProgress: (cb) => subscribe<OcrProgress>(IPC.mediaOcrProgress, cb)
  },
  job: {
    start: (req: AnalyzeRequest) => ipcRenderer.invoke(IPC.jobStart, req) as Promise<void>,
    cancel: (jobId) => ipcRenderer.invoke(IPC.jobCancel, jobId) as Promise<void>,
    onProgress: (cb) => subscribe<JobProgress>(IPC.jobProgress, cb),
    onSegment: (cb) => subscribe<JobSegmentEvent>(IPC.jobSegment, cb),
    onDone: (cb) => subscribe<JobDoneEvent>(IPC.jobDone, cb),
    onError: (cb) => subscribe<JobErrorEvent>(IPC.jobError, cb)
  },
  models: {
    list: () => ipcRenderer.invoke(IPC.modelsList) as Promise<ModelInfo[]>,
    download: (name) => ipcRenderer.invoke(IPC.modelsDownload, name) as Promise<void>,
    installGpu: () => ipcRenderer.invoke(IPC.modelsInstallGpu) as Promise<void>,
    onProgress: (cb) => subscribe<ModelProgress>(IPC.modelsProgress, cb)
  },
  settings: {
    get: () => ipcRenderer.invoke(IPC.settingsGet) as Promise<AppSettings>,
    set: (patch) => ipcRenderer.invoke(IPC.settingsSet, patch) as Promise<AppSettings>
  },
  export: {
    csv: (result: AnalysisResult) => ipcRenderer.invoke(IPC.exportCsv, result) as Promise<string | null>,
    json: (result: AnalysisResult) => ipcRenderer.invoke(IPC.exportJson, result) as Promise<string | null>,
    excel: (result: AnalysisResult) => ipcRenderer.invoke(IPC.exportExcel, result) as Promise<string | null>
  },
  app: {
    openPath: (path) => ipcRenderer.invoke(IPC.appOpenPath, path) as Promise<void>,
    version: () => ipcRenderer.invoke(IPC.appVersion) as Promise<string>
  },
  update: {
    get: () => ipcRenderer.invoke(IPC.updateGet) as Promise<UpdateState>,
    check: (manual) => ipcRenderer.invoke(IPC.updateCheck, manual) as Promise<UpdateState>,
    install: () => ipcRenderer.invoke(IPC.updateInstall) as Promise<UpdateInstallResult>,
    onState: (cb) => subscribe<UpdateState>(IPC.updateState, cb)
  }
}

contextBridge.exposeInMainWorld('api', api)
