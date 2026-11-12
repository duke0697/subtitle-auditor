import { app, net } from 'electron'
import { autoUpdater } from 'electron-updater'
import type { UpdateInstallResult, UpdateProgress, UpdateState } from '@shared/ipc'
import type { SettingsStore } from './settings'

const DIRECT_FEED = 'https://github.com/duke0697/subtitle-auditor/releases/latest/download/'
const PREFLIGHT_TIMEOUT_MS = 15_000
const AUTO_CHECK_DELAY_MS = 10_000

interface Feed {
  kind: 'mirror' | 'github'
  url: string
}

export class UpdateService {
  private state: UpdateState = {
    status: app.isPackaged ? 'idle' : 'disabled',
    currentVersion: app.getVersion(),
    latestVersion: null,
    progress: null,
    error: null,
    feed: null,
    manual: false,
    checkedAt: null
  }
  private listener: ((state: UpdateState) => void) | null = null
  private feeds: Feed[] = []
  private feedIndex = -1
  private checking = false
  private downloading = false
  private installing = false
  private lastPercent = -1

  constructor(
    private readonly settings: SettingsStore,
    private readonly isBusy: () => boolean,
    private readonly prepareForInstall: () => Promise<void>
  ) {
    autoUpdater.autoDownload = false
    autoUpdater.autoInstallOnAppQuit = false
    autoUpdater.allowDowngrade = false
    autoUpdater.disableWebInstaller = true

    autoUpdater.on('checking-for-update', () => this.patch({ status: 'checking', error: null }))
    autoUpdater.on('update-available', (info) => {
      this.patch({ status: 'available', latestVersion: info.version, error: null })
      void this.download()
    })
    autoUpdater.on('update-not-available', () => {
      this.patch({
        status: 'up-to-date',
        latestVersion: null,
        progress: null,
        checkedAt: new Date().toISOString()
      })
    })
    autoUpdater.on('download-progress', (info) => this.onProgress(info))
    autoUpdater.on('update-downloaded', (info) => {
      this.patch({
        status: 'downloaded',
        latestVersion: info.version,
        progress: { percent: 100, transferred: 0, total: 0, bytesPerSecond: 0 },
        checkedAt: new Date().toISOString()
      })
    })
    // Request failures are handled by the check/download promises; surface the
    // ones emitted while installing (quitAndInstall does not return a promise).
    autoUpdater.on('error', (error) => {
      if (this.installing) this.fail(error)
    })
  }

  onState(listener: (state: UpdateState) => void): void {
    this.listener = listener
  }

  getState(): UpdateState {
    return structuredClone(this.state)
  }

  scheduleAutoCheck(): void {
    if (!app.isPackaged) return
    setTimeout(() => void this.check(false), AUTO_CHECK_DELAY_MS)
  }

  async check(manual: boolean): Promise<UpdateState> {
    if (!app.isPackaged || this.checking || this.downloading) return this.getState()
    this.checking = true
    this.lastPercent = -1
    this.patch({ status: 'checking', manual, error: null, progress: null, latestVersion: null })

    let lastError: unknown = null
    try {
      this.feeds = this.resolveFeeds()
      this.feedIndex = -1
      for (let index = 0; index < this.feeds.length; index++) {
        const feed = this.feeds[index]
        if (!(await this.preflight(feed.url))) {
          lastError = new Error(`${feed.kind === 'mirror' ? '镜像' : 'GitHub'} 更新源不可达`)
          continue
        }
        this.feedIndex = index
        this.useFeed(feed)
        try {
          await autoUpdater.checkForUpdates()
          return this.getState()
        } catch (error) {
          lastError = error
        }
      }
      this.fail(lastError ?? new Error('无法连接更新服务器'))
    } catch (error) {
      this.fail(error)
    } finally {
      this.checking = false
    }
    return this.getState()
  }

  async install(): Promise<UpdateInstallResult> {
    if (!app.isPackaged) return { started: false, reason: 'disabled' }
    if (this.state.status !== 'downloaded') return { started: false, reason: 'not-ready' }
    if (this.isBusy()) return { started: false, reason: 'busy' }
    await this.prepareForInstall()
    this.installing = true
    autoUpdater.quitAndInstall(true, true)
    return { started: true }
  }

  private async download(): Promise<void> {
    if (this.downloading || !this.feeds.length) return
    this.downloading = true
    this.lastPercent = -1
    const feed = this.feeds[this.feedIndex]
    try {
      await autoUpdater.downloadUpdate()
    } catch (error) {
      this.downloading = false
      if (feed?.kind === 'mirror' && this.feedIndex + 1 < this.feeds.length) {
        await this.switchToNextFeed(error)
        return
      }
      this.fail(error)
      return
    }
    this.downloading = false
  }

  private async switchToNextFeed(previousError: unknown): Promise<void> {
    this.feedIndex++
    const feed = this.feeds[this.feedIndex]
    if (!feed) {
      this.fail(previousError)
      return
    }
    this.checking = true
    this.patch({ status: 'checking', error: null, progress: null, latestVersion: null })
    this.lastPercent = -1
    this.useFeed(feed)
    try {
      await autoUpdater.checkForUpdates()
    } catch (error) {
      this.fail(error)
    } finally {
      this.checking = false
    }
  }

  private resolveFeeds(): Feed[] {
    const feeds: Feed[] = []
    const mirror = String(this.settings.get().updateMirror ?? '').trim()
    if (/^https:\/\//i.test(mirror)) {
      const prefix = mirror.endsWith('/') ? mirror : `${mirror}/`
      feeds.push({ kind: 'mirror', url: `${prefix}${DIRECT_FEED}` })
    }
    feeds.push({ kind: 'github', url: DIRECT_FEED })
    return feeds
  }

  private useFeed(feed: Feed): void {
    autoUpdater.setFeedURL({ provider: 'generic', url: feed.url })
    autoUpdater.previousBlockmapBaseUrlOverride = feed.url.replace(
      '/latest/download/',
      `/download/v${app.getVersion()}/`
    )
    this.patch({ feed: feed.kind })
  }

  private async preflight(url: string): Promise<boolean> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), PREFLIGHT_TIMEOUT_MS)
    try {
      const response = await net.fetch(`${url}latest.yml`, {
        cache: 'no-store',
        signal: controller.signal
      })
      if (!response.ok) return false
      return (await response.text()).includes('version:')
    } catch {
      return false
    } finally {
      clearTimeout(timer)
    }
  }

  private onProgress(info: UpdateProgress): void {
    const percent = Math.floor(info.percent)
    if (percent === this.lastPercent && percent < 100) return
    this.lastPercent = percent
    this.patch({
      status: 'downloading',
      progress: {
        percent,
        transferred: info.transferred,
        total: info.total,
        bytesPerSecond: info.bytesPerSecond
      }
    })
  }

  private fail(error: unknown): void {
    this.patch({
      status: 'error',
      error: error instanceof Error ? error.message : String(error),
      progress: null,
      checkedAt: new Date().toISOString()
    })
  }

  private patch(patch: Partial<UpdateState>): void {
    this.state = { ...this.state, ...patch }
    this.listener?.(structuredClone(this.state))
  }
}
