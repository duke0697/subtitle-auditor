import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { createInterface, type Interface } from 'node:readline'
import { ensureDevSidecar, sidecarCommand } from './paths'

interface Pending {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timer: NodeJS.Timeout | null
}

interface RpcMessage {
  jsonrpc?: string
  id?: number
  result?: unknown
  error?: { code: number; message: string; data?: unknown }
  method?: string
  params?: unknown
}

export class SidecarClient extends EventEmitter {
  private proc: ChildProcessWithoutNullStreams | null = null
  private reader: Interface | null = null
  private pending = new Map<number, Pending>()
  private nextId = 1
  private starting: Promise<void> | null = null
  private stopping = false

  get running(): boolean {
    return this.proc !== null
  }

  async ensureStarted(): Promise<void> {
    if (this.proc) return
    if (this.starting) return this.starting
    ensureDevSidecar()
    this.starting = new Promise((resolve, reject) => {
      const { command, args, cwd } = sidecarCommand()
      const proc = spawn(command, args, {
        cwd,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' }
      })
      proc.once('spawn', () => {
        this.proc = proc
        this.stopping = false
        this.reader = createInterface({ input: proc.stdout })
        this.reader.on('line', (line) => this.onLine(line))
        proc.stderr.on('data', (chunk: Buffer) => {
          this.emit('log', chunk.toString('utf8').trimEnd())
        })
        proc.on('exit', (code, signal) => this.onExit(code, signal))
        resolve()
      })
      proc.once('error', (error) => {
        this.starting = null
        reject(error)
      })
    })
    try {
      await this.starting
      await this.request('system.info', {}, 15_000)
    } finally {
      this.starting = null
    }
  }

  private onLine(line: string): void {
    if (!line.trim()) return
    let message: RpcMessage
    try {
      message = JSON.parse(line) as RpcMessage
    } catch {
      this.emit('log', `invalid rpc line: ${line.slice(0, 200)}`)
      return
    }
    if (typeof message.id === 'number') {
      const pending = this.pending.get(message.id)
      if (!pending) return
      this.pending.delete(message.id)
      if (pending.timer) clearTimeout(pending.timer)
      if (message.error) {
        pending.reject(new Error(message.error.message))
      } else {
        pending.resolve(message.result)
      }
      return
    }
    if (message.method) {
      this.emit(message.method.replace('.', '-'), message.params)
    }
  }

  private onExit(code: number | null, signal: string | null): void {
    this.proc = null
    this.reader?.close()
    this.reader = null
    const error = new Error(`Sidecar exited (code=${code ?? 'null'}, signal=${signal ?? 'null'})`)
    for (const pending of this.pending.values()) {
      if (pending.timer) clearTimeout(pending.timer)
      pending.reject(error)
    }
    this.pending.clear()
    if (!this.stopping) this.emit('crash', error)
  }

  request<T>(method: string, params: unknown, timeoutMs = 60_000): Promise<T> {
    if (!this.proc) {
      return Promise.reject(new Error('Sidecar is not running'))
    }
    const id = this.nextId++
    const payload = JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'
    return new Promise<T>((resolve, reject) => {
      const timer =
        timeoutMs > 0
          ? setTimeout(() => {
              this.pending.delete(id)
              reject(new Error(`Sidecar request timed out: ${method}`))
            }, timeoutMs)
          : null
      this.pending.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
        timer
      })
      this.proc?.stdin.write(payload, 'utf8')
    })
  }

  async stop(): Promise<void> {
    this.stopping = true
    const proc = this.proc
    this.proc = null
    if (!proc) return
    try {
      proc.stdin.end()
      proc.kill()
    } catch {
      // ignore shutdown errors
    }
  }
}
