import { Search, SlidersHorizontal } from 'lucide-react'
import type { IssueKind, Severity } from '@shared/contracts'
import { KIND_META, SEVERITY_META, cn } from '../lib/utils'
import { useApp } from '../store/app'

const KINDS: IssueKind[] = ['typo', 'content', 'timing', 'uncertain']
const SEVERITIES: Severity[] = ['high', 'review', 'info']

export default function FilterBar(): React.JSX.Element {
  const filters = useApp((state) => state.filters)
  const setFilters = useApp((state) => state.setFilters)

  const toggleKind = (kind: IssueKind): void => {
    const kinds = filters.kinds.includes(kind)
      ? filters.kinds.filter((item) => item !== kind)
      : [...filters.kinds, kind]
    setFilters({ kinds })
  }

  const toggleSeverity = (severity: Severity): void => {
    const severities = filters.severities.includes(severity)
      ? filters.severities.filter((item) => item !== severity)
      : [...filters.severities, severity]
    setFilters({ severities })
  }

  return (
    <div className="space-y-2">
      <div className="relative">
        <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
        <input
          className="input h-8 pl-8 text-[11.5px]"
          placeholder="搜索字幕、ASR 或说明（/）"
          value={filters.query}
          onChange={(event) => setFilters({ query: event.target.value })}
        />
      </div>
      <div className="flex flex-wrap gap-1.5">
        {KINDS.map((kind) => (
          <button
            key={kind}
            className="chip"
            data-active={filters.kinds.includes(kind)}
            onClick={() => toggleKind(kind)}
          >
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: KIND_META[kind].color }} />
            {KIND_META[kind].label}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {SEVERITIES.map((severity) => (
          <button
            key={severity}
            className={cn('chip h-[22px] px-2 text-[10.5px]')}
            data-active={filters.severities.includes(severity)}
            onClick={() => toggleSeverity(severity)}
          >
            {SEVERITY_META[severity].label}
          </button>
        ))}
        <button
          className="chip ml-auto h-[22px] px-2 text-[10.5px]"
          data-active={filters.onlyUnreviewed}
          onClick={() => setFilters({ onlyUnreviewed: !filters.onlyUnreviewed })}
        >
          <SlidersHorizontal size={10} /> 仅未核对
        </button>
      </div>
    </div>
  )
}
