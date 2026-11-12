import type { AnalysisResult } from '@shared/contracts'

function formatTime(ms: number): string {
  const total = Math.max(0, Math.round(ms))
  const h = Math.floor(total / 3_600_000)
  const m = Math.floor((total % 3_600_000) / 60_000)
  const s = Math.floor((total % 60_000) / 1000)
  const cs = total % 1000
  const hh = String(h).padStart(2, '0')
  const mm = String(m).padStart(2, '0')
  const ss = String(s).padStart(2, '0')
  const mmm = String(cs).padStart(3, '0')
  return `${hh}:${mm}:${ss}.${mmm}`
}

function safeCell(value: string | number | undefined): string {
  const text = value === undefined ? '' : String(value)
  const guarded = /^[=+\-@]/.test(text) ? `'${text}` : text
  return `"${guarded.replace(/"/g, '""')}"`
}

export function buildCsv(result: AnalysisResult): string {
  const header = ['时间码', '类型', '严重度', '字幕文本', 'ASR 文本', '词级置信度', '拼音相似度', '建议', '说明']
  const rows = result.findings.map((finding) => [
    formatTime(finding.startMs),
    finding.kind,
    finding.severity,
    finding.subtitleText,
    finding.asrText,
    finding.confidence === undefined ? '' : finding.confidence.toFixed(3),
    finding.evidence.pinyin?.similarity.toFixed(3) ?? '',
    finding.suggestion ?? '',
    finding.message
  ])
  return '﻿' + [header, ...rows].map((row) => row.map(safeCell).join(',')).join('\r\n')
}
