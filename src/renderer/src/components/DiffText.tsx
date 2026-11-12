import { useMemo } from 'react'
import type { EditOp } from '@shared/contracts'
import { cn } from '../lib/utils'

interface Range {
  start: number
  end: number
  color: string
}

export default function DiffText({
  text,
  edits,
  side
}: {
  text: string
  edits: EditOp[]
  side: 'sub' | 'asr'
}): React.JSX.Element {
  const ranges = useMemo<Range[]>(() => {
    const color = side === 'sub' ? 'var(--color-typo)' : 'var(--color-ok)'
    const list: Range[] = []
    for (const edit of edits) {
      if (side === 'sub' && (edit.op === 'replace' || edit.op === 'delete')) {
        if (edit.subEnd > edit.subStart) list.push({ start: edit.subStart, end: edit.subEnd, color })
      }
      if (side === 'asr' && (edit.op === 'replace' || edit.op === 'insert')) {
        if (edit.asrEnd > edit.asrStart) list.push({ start: edit.asrStart, end: edit.asrEnd, color })
      }
    }
    return list.sort((a, b) => a.start - b.start)
  }, [edits, side])

  if (!text) {
    return <span className="text-muted">（无）</span>
  }

  const nodes: React.ReactNode[] = []
  let cursor = 0
  for (const [index, range] of ranges.entries()) {
    if (range.start > cursor) {
      nodes.push(<span key={`plain-${index}`}>{text.slice(cursor, range.start)}</span>)
    }
    nodes.push(
      <span
        key={`mark-${index}`}
        className={cn('rounded px-0.5', side === 'sub' ? 'bg-typo/15' : 'bg-ok/15')}
        style={{ color: range.color, textDecoration: side === 'sub' && edits.some((e) => e.op === 'delete' && e.subStart === range.start) ? 'line-through' : undefined }}
      >
        {text.slice(range.start, range.end)}
      </span>
    )
    cursor = Math.max(cursor, range.end)
  }
  if (cursor < text.length) nodes.push(<span key="tail">{text.slice(cursor)}</span>)

  return <span>{nodes}</span>
}
