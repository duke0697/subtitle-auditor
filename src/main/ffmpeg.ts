import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { MediaInfo, SubtitleStream } from '@shared/contracts'
import type { PreviewProgress } from '@shared/ipc'
import { appPaths, ffmpegPath, ffprobePath } from './paths'

const EXTRACTABLE = new Set(['subrip', 'ass', 'ssa', 'webvtt', 'mov_text'])
const BITMAP = new Set(['hdmv_pgs_subtitle', 'dvd_subtitle', 'dvb_subtitle', 'xsub'])

interface FfprobeStream {
  index: number
  codec_type?: string
  codec_name?: string
  width?: number
  height?: number
  avg_frame_rate?: string
  tags?: Record<string, string>
}

interface FfprobeResult {
  streams?: FfprobeStream[]
  format?: { duration?: string; size?: string; format_name?: string }
}

function parseFps(value: string | undefined): number {
  if (!value) return 0
  const [num, den] = value.split('/').map(Number)
  if (!den) return Number(num) || 0
  return Math.round((num / den) * 100) / 100
}

function run(command: string, args: string[], onStdout?: (line: string) => void): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, { windowsHide: true })
    let stdout = ''
    let stderr = ''
    proc.stdout.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf8')
      stdout += text
      if (onStdout) {
        for (const line of text.split(/\r?\n/)) if (line) onStdout(line)
      }
    })
    proc.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8')
    })
    proc.on('error', reject)
    proc.on('close', (code) => {
      if (code === 0) resolve(stdout)
      else reject(new Error(stderr.trim() || `${command} exited with code ${code}`))
    })
  })
}

export class FfmpegService {
  private assertAvailable(): void {
    if (!existsSync(ffmpegPath()) || !existsSync(ffprobePath())) {
      throw new Error('FFmpeg not found. Run "npm run fetch:ffmpeg" before starting the app.')
    }
  }

  async probe(path: string): Promise<MediaInfo> {
    this.assertAvailable()
    const raw = await run(ffprobePath(), [
      '-v', 'error',
      '-print_format', 'json',
      '-show_format',
      '-show_streams',
      path
    ])
    const data = JSON.parse(raw) as FfprobeResult
    const streams = data.streams ?? []
    const video = streams.find((s) => s.codec_type === 'video')
    const audio = streams.find((s) => s.codec_type === 'audio')
    const subtitles = streams.filter((s) => s.codec_type === 'subtitle')
    const subtitleStreams: SubtitleStream[] = subtitles.map((s, relativeIndex) => {
      const codec = s.codec_name ?? 'unknown'
      return {
        index: s.index,
        relativeIndex,
        codec,
        language: s.tags?.language ?? '',
        title: s.tags?.title ?? '',
        extractable: EXTRACTABLE.has(codec) && !BITMAP.has(codec)
      }
    })
    return {
      path,
      durationMs: Math.round(Number(data.format?.duration ?? 0) * 1000),
      sizeBytes: Number(data.format?.size ?? statSync(path).size),
      container: data.format?.format_name ?? '',
      videoCodec: video?.codec_name ?? '',
      audioCodec: audio?.codec_name ?? '',
      width: video?.width ?? 0,
      height: video?.height ?? 0,
      fps: parseFps(video?.avg_frame_rate),
      subtitleStreams
    }
  }

  async extractSubtitle(videoPath: string, relativeIndex: number): Promise<string> {
    this.assertAvailable()
    const dir = join(appPaths.cache, 'subtitles')
    mkdirSync(dir, { recursive: true })
    const key = createHash('sha1').update(`${videoPath}:${relativeIndex}`).digest('hex').slice(0, 16)
    const out = join(dir, `${key}.srt`)
    if (!existsSync(out)) {
      await run(ffmpegPath(), [
        '-v', 'error', '-y',
        '-i', videoPath,
        '-map', `0:s:${relativeIndex}`,
        '-c:s', 'srt',
        out
      ])
    }
    return out
  }

  async preparePreview(
    videoPath: string,
    durationMs: number,
    onProgress: (p: PreviewProgress) => void
  ): Promise<string | null> {
    this.assertAvailable()
    const info = await this.probe(videoPath)
    const dir = join(appPaths.cache, 'preview')
    mkdirSync(dir, { recursive: true })
    const key = createHash('sha1')
      .update(`${videoPath}:${statSync(videoPath).size}:${statSync(videoPath).mtimeMs}`)
      .digest('hex')
      .slice(0, 20)
    const out = join(dir, `${key}.mp4`)
    if (existsSync(out)) return out

    const canRemux = info.videoCodec === 'h264' && ['aac', 'mp3'].includes(info.audioCodec)
    const args = canRemux
      ? [
          '-v', 'error', '-y', '-i', videoPath,
          '-map', '0:v:0', '-map', '0:a:0?',
          '-c', 'copy', '-movflags', '+faststart', out
        ]
      : [
          '-v', 'error', '-y', '-i', videoPath,
          '-map', '0:v:0', '-map', '0:a:0?',
          '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '24',
          '-vf', "scale='min(1280,iw)':-2",
          '-c:a', 'aac', '-b:a', '128k',
          '-movflags', '+faststart',
          out
        ]

    if (!canRemux) onProgress({ progress: 0, message: '正在生成预览代理…' })
    const total = Math.max(durationMs, 1)
    await run(ffmpegPath(), ['-progress', 'pipe:1', '-nostats', ...args], (line) => {
      if (line.startsWith('out_time_ms=')) {
        const ms = Number(line.slice('out_time_ms='.length)) / 1000
        onProgress({ progress: Math.min(1, ms / total), message: '正在生成预览代理…' })
      }
    })
    onProgress({ progress: 1, message: '预览已就绪' })
    return out
  }
}
