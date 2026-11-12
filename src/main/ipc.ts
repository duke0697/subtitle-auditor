import { app, dialog, ipcMain, shell, type BrowserWindow } from 'electron'
import { existsSync, readdirSync } from 'node:fs'
import { basename, dirname, extname, join } from 'node:path'
import { writeFile } from 'node:fs/promises'
import type { AnalyzeRequest, AppSettings } from '@shared/contracts'
import { IPC } from '@shared/ipc'
import { buildCsv, buildWorkbook } from './export'
import type { FfmpegService } from './ffmpeg'
import type { JobTracker } from './jobs'
import type { SettingsStore } from './settings'
import type { SidecarClient } from './sidecar'
import type { UpdateService } from './updater'

const VIDEO_FILTER = {
  name: '视频文件',
  extensions: ['mp4', 'mkv', 'mov', 'avi', 'ts', 'flv', 'webm', 'm4v', 'wmv']
}
const SUBTITLE_FILTER = {
  name: '字幕文件',
  extensions: ['srt', 'ass', 'ssa', 'vtt']
}

export function registerIpc(
  getWindow: () => BrowserWindow | null,
  sidecar: SidecarClient,
  settings: SettingsStore,
  ffmpeg: FfmpegService,
  jobs: JobTracker,
  updater: UpdateService
): void {
  const send = (channel: string, payload: unknown): void => {
    const win = getWindow()
    if (!win || win.isDestroyed() || win.webContents.isDestroyed()) return
    try {
      win.webContents.send(channel, payload)
    } catch {
      // renderer went away between the checks and the send
    }
  }

  const dialogStartDir = (): string => {
    const last = settings.get().lastDir
    if (last && existsSync(last)) return last
    try {
      return app.getPath('videos')
    } catch {
      return app.getPath('home')
    }
  }

  const rememberDir = (filePath: string): void => {
    settings.set({ lastDir: dirname(filePath) })
  }

  sidecar.on('job-done', (payload: { jobId: string }) => jobs.finish(payload.jobId))
  sidecar.on('job-error', (payload: { jobId: string }) => jobs.finish(payload.jobId))
  for (const [event, channel] of [
    ['progress', IPC.jobProgress],
    ['asr-segment', IPC.jobSegment],
    ['job-done', IPC.jobDone],
    ['job-error', IPC.jobError],
    ['model-progress', IPC.modelsProgress],
    ['ocr-progress', IPC.mediaOcrProgress]
  ] as const) {
    sidecar.on(event, (payload) => send(channel, payload))
  }
  sidecar.on('crash', (error: Error) => {
    jobs.clear()
    send(IPC.jobError, { jobId: '', message: '分析进程已退出', detail: error.message })
  })
  updater.onState((state) => send(IPC.updateState, state))

  ipcMain.on(IPC.windowMinimize, () => getWindow()?.minimize())
  ipcMain.on(IPC.windowToggleMaximize, () => {
    const win = getWindow()
    if (!win) return
    if (win.isMaximized()) win.unmaximize()
    else win.maximize()
  })
  ipcMain.on(IPC.windowClose, () => getWindow()?.close())
  ipcMain.handle(IPC.windowIsMaximized, () => getWindow()?.isMaximized() ?? false)

  ipcMain.handle(IPC.dialogPickVideo, async () => {
    if (!app.isPackaged && process.env.SUB_AUDITOR_TEST_VIDEO) {
      return process.env.SUB_AUDITOR_TEST_VIDEO
    }
    const win = getWindow()
    if (!win) return null
    const result = await dialog.showOpenDialog(win, {
      title: '选择视频文件',
      defaultPath: dialogStartDir(),
      properties: ['openFile'],
      filters: [VIDEO_FILTER]
    })
    if (result.canceled) return null
    rememberDir(result.filePaths[0])
    return result.filePaths[0]
  })

  ipcMain.handle(IPC.dialogPickSubtitle, async () => {
    if (!app.isPackaged && process.env.SUB_AUDITOR_TEST_SUBTITLE) {
      return process.env.SUB_AUDITOR_TEST_SUBTITLE
    }
    const win = getWindow()
    if (!win) return null
    const result = await dialog.showOpenDialog(win, {
      title: '选择字幕文件',
      defaultPath: dialogStartDir(),
      properties: ['openFile'],
      filters: [SUBTITLE_FILTER]
    })
    if (result.canceled) return null
    rememberDir(result.filePaths[0])
    return result.filePaths[0]
  })

  ipcMain.handle(IPC.mediaProbe, async (_event, path: string) => {
    rememberDir(path)
    return ffmpeg.probe(path)
  })
  ipcMain.handle(IPC.mediaFindSubtitle, async (_event, videoPath: string) => {
    const directory = dirname(videoPath)
    const stem = basename(videoPath, extname(videoPath)).toLowerCase()
    const extensions = new Set(['.srt', '.ass', '.ssa', '.vtt'])
    const candidates: Array<{ path: string; score: number }> = []
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (!entry.isFile()) continue
      const extension = extname(entry.name).toLowerCase()
      if (!extensions.has(extension)) continue
      const name = basename(entry.name, extname(entry.name)).toLowerCase()
      if (name === stem) candidates.push({ path: join(directory, entry.name), score: 100 })
      else if (name.startsWith(stem)) candidates.push({ path: join(directory, entry.name), score: 80 })
      else if (stem.startsWith(name)) candidates.push({ path: join(directory, entry.name), score: 60 })
    }
    return candidates.sort((a, b) => b.score - a.score).map((item) => item.path).slice(0, 8)
  })
  ipcMain.handle(IPC.mediaExtractSubtitle, async (_event, videoPath: string, index: number) =>
    ffmpeg.extractSubtitle(videoPath, index)
  )
  ipcMain.handle(IPC.mediaPreparePreview, async (event, videoPath: string) => {
    const info = await ffmpeg.probe(videoPath)
    return ffmpeg.preparePreview(videoPath, info.durationMs, (progress) => {
      event.sender.send(IPC.mediaPreviewProgress, progress)
    })
  })
  ipcMain.handle(IPC.mediaWaveform, async (_event, videoPath: string) => {
    await sidecar.ensureStarted()
    return sidecar.request('media.waveform', { path: videoPath, buckets: 1600 }, 120_000)
  })
  let ocrSeq = 0
  ipcMain.handle(IPC.mediaOcr, async (_event, videoPath: string) => {
    const jobKey = `ocr:${++ocrSeq}`
    jobs.begin(jobKey)
    try {
      await sidecar.ensureStarted()
      const outPath = join(dirname(videoPath), `${basename(videoPath, extname(videoPath))}.ocr.srt`)
      rememberDir(videoPath)
      return await sidecar.request('ocr.extract', { videoPath, outPath }, 0)
    } finally {
      jobs.finish(jobKey)
    }
  })
  ipcMain.handle(IPC.mediaOcrCancel, async () => {
    await sidecar.request('cancel', { jobId: 'ocr' }, 10_000)
  })

  ipcMain.handle(IPC.jobStart, async (_event, req: AnalyzeRequest) => {
    jobs.begin(req.jobId)
    try {
      await sidecar.ensureStarted()
      await sidecar.request('analyze', req, 30_000)
    } catch (error) {
      // A timeout keeps the request queued in the sidecar; keep the guard until
      // the matching job event arrives, and cancel so it cannot start later.
      if (sidecar.running) {
        void sidecar.request('cancel', { jobId: req.jobId }, 5_000).catch(() => undefined)
      } else {
        jobs.finish(req.jobId)
      }
      throw error
    }
  })
  ipcMain.handle(IPC.jobCancel, async (_event, jobId: string) => {
    await sidecar.request('cancel', { jobId }, 10_000)
    jobs.finish(jobId)
  })

  ipcMain.handle(IPC.modelsList, async () => {
    await sidecar.ensureStarted()
    return sidecar.request('models.list', {}, 30_000)
  })
  ipcMain.handle(IPC.modelsDownload, async (_event, name: string) => {
    jobs.begin('models')
    try {
      await sidecar.ensureStarted()
      return await sidecar.request('models.download', { name, mirror: settings.get().hfMirror }, 0)
    } finally {
      jobs.finish('models')
    }
  })
  ipcMain.handle(IPC.modelsInstallGpu, async () => {
    jobs.begin('gpu')
    try {
      await sidecar.ensureStarted()
      return await sidecar.request('models.installGpu', {}, 0)
    } finally {
      jobs.finish('gpu')
    }
  })

  ipcMain.handle(IPC.settingsGet, () => settings.get())
  ipcMain.handle(IPC.settingsSet, (_event, patch: Partial<AppSettings>) => settings.set(patch))

  ipcMain.handle(IPC.exportCsv, async (_event, result) => {
    const win = getWindow()
    if (!win) return null
    const save = await dialog.showSaveDialog(win, {
      title: '导出 CSV 报告',
      defaultPath: `字幕审查报告-${Date.now()}.csv`,
      filters: [{ name: 'CSV', extensions: ['csv'] }]
    })
    if (save.canceled || !save.filePath) return null
    await writeFile(save.filePath, buildCsv(result), 'utf8')
    return save.filePath
  })

  ipcMain.handle(IPC.exportJson, async (_event, result) => {
    const win = getWindow()
    if (!win) return null
    const save = await dialog.showSaveDialog(win, {
      title: '导出 JSON 报告',
      defaultPath: `字幕审查报告-${Date.now()}.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }]
    })
    if (save.canceled || !save.filePath) return null
    await writeFile(save.filePath, JSON.stringify(result, null, 2), 'utf8')
    return save.filePath
  })

  ipcMain.handle(IPC.exportExcel, async (_event, result) => {
    const win = getWindow()
    if (!win) return null
    const save = await dialog.showSaveDialog(win, {
      title: '导出 Excel 报告',
      defaultPath: `字幕审查报告-${Date.now()}.xlsx`,
      filters: [{ name: 'Excel 工作簿', extensions: ['xlsx'] }]
    })
    if (save.canceled || !save.filePath) return null
    await writeFile(save.filePath, await buildWorkbook(result))
    return save.filePath
  })

  ipcMain.handle(IPC.appOpenPath, async (_event, path: string) => {
    await shell.openPath(path)
  })
  ipcMain.handle(IPC.appVersion, () => app.getVersion())

  ipcMain.handle(IPC.updateGet, () => updater.getState())
  ipcMain.handle(IPC.updateCheck, (_event, manual: boolean) => updater.check(Boolean(manual)))
  ipcMain.handle(IPC.updateInstall, () => updater.install())
}
