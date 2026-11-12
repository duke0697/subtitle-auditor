import { app, BrowserWindow, protocol } from 'electron'
import { createReadStream, statSync } from 'node:fs'
import { extname, join } from 'node:path'
import { Readable } from 'node:stream'
import { FfmpegService } from './ffmpeg'
import { registerIpc } from './ipc'
import { SettingsStore } from './settings'
import { SidecarClient } from './sidecar'
import { createMainWindow } from './window'

let mainWindow: BrowserWindow | null = null

const MEDIA_TYPES: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mov': 'video/quicktime',
  '.mkv': 'video/x-matroska',
  '.webm': 'video/webm',
  '.avi': 'video/x-msvideo',
  '.ts': 'video/mp2t',
  '.flv': 'video/x-flv',
  '.wmv': 'video/x-ms-wmv'
}

// Chromium only allows seeking on media responses that honour Range requests.
function serveMedia(filePath: string, rangeHeader: string | null): Response {
  let size: number
  try {
    size = statSync(filePath).size
  } catch {
    return new Response('not found', { status: 404 })
  }

  let start = 0
  let end = size - 1
  let status = 200
  if (rangeHeader) {
    const match = /bytes=(\d*)-(\d*)/.exec(rangeHeader)
    if (match) {
      if (match[1]) {
        start = Number(match[1])
        if (match[2]) end = Number(match[2])
      } else if (match[2]) {
        start = Math.max(0, size - Number(match[2]))
      }
      end = Math.min(end, size - 1)
      if (start >= size || start > end) {
        return new Response(null, {
          status: 416,
          headers: { 'Content-Range': `bytes */${size}` }
        })
      }
      status = 206
    }
  }

  const headers: Record<string, string> = {
    'Content-Type': MEDIA_TYPES[extname(filePath).toLowerCase()] ?? 'application/octet-stream',
    'Content-Length': String(end - start + 1),
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'no-store'
  }
  if (status === 206) headers['Content-Range'] = `bytes ${start}-${end}/${size}`

  const stream = Readable.toWeb(createReadStream(filePath, { start, end })) as ReadableStream
  return new Response(stream, { status, headers })
}

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app-media',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true }
  }
])

app.setPath(
  'userData',
  join(app.getPath('appData'), app.isPackaged ? 'SubtitleAuditor' : 'SubtitleAuditorDev')
)

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
}

const settings = new SettingsStore()
const sidecar = new SidecarClient()
const ffmpeg = new FfmpegService()

function openWindow(): void {
  mainWindow = createMainWindow(settings.get())
  mainWindow.on('closed', () => {
    mainWindow = null
  })
  mainWindow.on('resize', () => {
    if (!mainWindow || mainWindow.isMaximized()) return
    const [width, height] = mainWindow.getSize()
    settings.set({ window: { ...settings.get().window, width, height } })
  })
}

if (gotLock) {
  app.whenReady().then(() => {
    protocol.handle('app-media', (request) => {
      const filePath = new URL(request.url).searchParams.get('path')
      if (!filePath) return new Response('missing path', { status: 400 })
      return serveMedia(filePath, request.headers.get('Range'))
    })
    registerIpc(() => mainWindow, sidecar, settings, ffmpeg)
    openWindow()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) openWindow()
    })
  })

  app.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  })
}

app.on('window-all-closed', () => {
  void sidecar.stop()
  app.quit()
})

app.on('before-quit', () => {
  void sidecar.stop()
})
