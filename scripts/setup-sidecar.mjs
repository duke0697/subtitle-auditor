import { existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'

const root = process.cwd()
const venv = join(root, 'sidecar', '.venv')
const python = join(venv, 'Scripts', 'python.exe')

function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit', cwd: root, shell: false })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${command} exited with ${result.status}`)
}

if (!existsSync(python)) {
  console.log('[setup] creating venv with uv …')
  const uv = spawnSync('uv', ['venv', '--python', '3.13', venv], { stdio: 'inherit', cwd: root })
  if (uv.error || uv.status !== 0) {
    console.log('[setup] uv unavailable, falling back to py -3.13 …')
    run('py', ['-3.13', '-m', 'venv', venv])
  }
}

console.log('[setup] installing sidecar dependencies …')
const uvInstall = spawnSync(
  'uv',
  ['pip', 'install', '--python', python, '-r', join(root, 'sidecar', 'requirements.txt')],
  { stdio: 'inherit', cwd: root }
)
if (uvInstall.error || uvInstall.status !== 0) {
  run(python, ['-m', 'pip', 'install', '--upgrade', 'pip'])
  run(python, ['-m', 'pip', 'install', '-r', join(root, 'sidecar', 'requirements.txt')])
}

console.log('[setup] done. Python:', python)
