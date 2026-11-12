import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DEFAULT_SETTINGS, type AppSettings } from '@shared/contracts'
import { appPaths } from './paths'

function deepMerge<T extends Record<string, unknown>>(base: T, patch: Partial<T>): T {
  const out = { ...base } as Record<string, unknown>
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const current = out[key]
      out[key] =
        current && typeof current === 'object' && !Array.isArray(current)
          ? deepMerge(current as Record<string, unknown>, value as Record<string, unknown>)
          : value
    } else {
      out[key] = value
    }
  }
  return out as T
}

/** Drop the retired split drift thresholds; timingToleranceMs replaces them. */
function migrate(settings: Record<string, unknown>): Record<string, unknown> {
  const options = settings.options
  if (!options || typeof options !== 'object') return settings
  const record = options as Record<string, unknown>
  delete record.driftStartMs
  delete record.driftEndMinMs
  delete record.driftEndMaxMs
  return settings
}

export class SettingsStore {
  private data: AppSettings

  constructor() {
    this.data = this.load()
  }

  private load(): AppSettings {
    try {
      const raw = readFileSync(appPaths.settingsFile, 'utf8')
      const merged = deepMerge(
        DEFAULT_SETTINGS as unknown as Record<string, unknown>,
        migrate(JSON.parse(raw))
      )
      return merged as unknown as AppSettings
    } catch {
      return structuredClone(DEFAULT_SETTINGS)
    }
  }

  get(): AppSettings {
    return structuredClone(this.data)
  }

  set(patch: Partial<AppSettings>): AppSettings {
    this.data = deepMerge(this.data as unknown as Record<string, unknown>, patch) as unknown as AppSettings
    this.persist()
    return this.get()
  }

  private persist(): void {
    mkdirSync(dirname(appPaths.settingsFile), { recursive: true })
    writeFileSync(appPaths.settingsFile, JSON.stringify(this.data, null, 2), 'utf8')
  }
}
