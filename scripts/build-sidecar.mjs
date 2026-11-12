import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'

const root = process.cwd()
const python = join(root, 'sidecar', '.venv', 'Scripts', 'python.exe')
const dist = join(root, 'sidecar', 'dist', 'SubtitleAuditor')
const target = join(root, 'resources', 'sidecar')

if (!existsSync(python)) {
  console.error('sidecar venv not found. Run "npm run setup:sidecar" first.')
  process.exit(1)
}

const check = spawnSync(python, ['-c', 'import PyInstaller'], { cwd: root })
if (check.status !== 0) {
  console.log('[sidecar] installing PyInstaller …')
  const install = spawnSync(
    'uv',
    ['pip', 'install', '--python', python, '-r', join(root, 'sidecar', 'requirements-build.txt')],
    { stdio: 'inherit', cwd: root }
  )
  if (install.error || install.status !== 0) {
    console.error('Failed to install PyInstaller.')
    process.exit(1)
  }
}

const pyinstaller = spawnSync(
  python,
  ['-m', 'PyInstaller', '--noconfirm', '--clean', 'build.spec'],
  { stdio: 'inherit', cwd: join(root, 'sidecar') }
)
if (pyinstaller.error) throw pyinstaller.error
if (pyinstaller.status !== 0) process.exit(pyinstaller.status ?? 1)

rmSync(target, { recursive: true, force: true })
mkdirSync(target, { recursive: true })
cpSync(dist, target, { recursive: true })
console.log('[sidecar] built →', target)
