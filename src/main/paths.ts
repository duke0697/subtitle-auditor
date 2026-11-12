import { app } from 'electron'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'

const isDev = !app.isPackaged

export const appPaths = {
  get userData(): string {
    return app.getPath('userData')
  },
  get cache(): string {
    return join(app.getPath('userData'), 'cache')
  },
  get models(): string {
    return join(app.getPath('userData'), 'models')
  },
  get gpu(): string {
    return join(app.getPath('userData'), 'gpu')
  },
  get settingsFile(): string {
    return join(app.getPath('userData'), 'settings.json')
  }
}

export function resourcePath(...segments: string[]): string {
  if (isDev) return resolve('resources', ...segments)
  return join(process.resourcesPath, ...segments)
}

export function sidecarCommand(): { command: string; args: string[]; cwd: string } {
  if (isDev) {
    const python = join(process.cwd(), 'sidecar', '.venv', 'Scripts', 'python.exe')
    const entry = join(process.cwd(), 'sidecar', 'run.py')
    return { command: python, args: [entry], cwd: process.cwd() }
  }
  const dir = resourcePath('sidecar')
  return { command: join(dir, 'SubtitleAuditor.exe'), args: [], cwd: dir }
}

export function ffmpegPath(): string {
  return resourcePath('ffmpeg', 'ffmpeg.exe')
}

export function ffprobePath(): string {
  return resourcePath('ffmpeg', 'ffprobe.exe')
}

export function ensureDevSidecar(): void {
  if (!isDev) return
  const { command } = sidecarCommand()
  if (!existsSync(command)) {
    throw new Error(
      `Sidecar Python environment not found at ${command}. Run "npm run setup:sidecar" first.`
    )
  }
}
