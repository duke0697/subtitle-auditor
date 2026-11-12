import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import ffmpegPath from 'ffmpeg-static'
import ffprobe from 'ffprobe-static'

const target = join(process.cwd(), 'resources', 'ffmpeg')
mkdirSync(target, { recursive: true })

if (!ffmpegPath || !existsSync(ffmpegPath)) {
  console.error('ffmpeg-static binary not found. Run "npm install" first.')
  process.exit(1)
}
if (!ffprobe?.path || !existsSync(ffprobe.path)) {
  console.error('ffprobe-static binary not found. Run "npm install" first.')
  process.exit(1)
}

copyFileSync(ffmpegPath, join(target, 'ffmpeg.exe'))
copyFileSync(ffprobe.path, join(target, 'ffprobe.exe'))
console.log('[ffmpeg] copied to', target)
