import { Workbook } from 'exceljs'
import type { AnalysisResult, IssueKind, Relation, Severity } from '@shared/contracts'

const KIND_LABELS: Record<IssueKind, string> = {
  typo: '错别字',
  content: '内容差异',
  timing: '时间轴',
  uncertain: 'ASR 不确定'
}

const SEVERITY_LABELS: Record<Severity, string> = {
  high: '高',
  review: '需复核',
  info: '提示'
}

const RELATION_LABELS: Record<Relation, string> = {
  homophone: '同音',
  tone: '声调差异',
  confusion: '近音',
  none: '无'
}

const SEVERITY_FILL: Record<Severity, string> = {
  high: 'FFFDE2E1',
  review: 'FFFDF3D9',
  info: 'FFF1F3F5'
}

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

function formatDate(iso: string): string {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString('zh-CN', { hour12: false })
}

function styleHeader(sheet: import('exceljs').Worksheet, columns: number): void {
  const row = sheet.getRow(1)
  row.height = 22
  for (let index = 1; index <= columns; index++) {
    const cell = row.getCell(index)
    cell.font = { bold: true, color: { argb: 'FF201709' } }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF0B45E' } }
    cell.alignment = { vertical: 'middle', horizontal: 'center' }
  }
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

function addOverviewSheet(workbook: Workbook, result: AnalysisResult): void {
  const sheet = workbook.addWorksheet('概览')
  sheet.columns = [{ width: 20 }, { width: 76 }]
  sheet.mergeCells('A1:B1')
  sheet.getCell('A1').value = '字幕审查报告'
  sheet.getCell('A1').font = { size: 16, bold: true }
  sheet.getRow(1).height = 30

  const kv = (label: string, value: string | number, numFmt?: string): void => {
    const row = sheet.addRow([label, value])
    row.getCell(1).font = { bold: true, color: { argb: 'FF6E7681' } }
    row.getCell(2).alignment = { vertical: 'middle', wrapText: true }
    if (numFmt) row.getCell(2).numFmt = numFmt
  }

  const section = (name: string): void => {
    sheet.addRow([])
    sheet.addRow([name]).font = { bold: true, color: { argb: 'FFF0B45E' } }
  }

  section('文件信息')
  kv('视频文件', result.media.path)
  kv('时长', formatTime(result.media.durationMs))
  kv('字幕文件', result.subtitle.path)
  kv('字幕格式', result.subtitle.format)
  kv('ASR 模型', `${result.model.name}（${result.model.device} / ${result.model.computeType}）`)
  kv('审查时间', formatDate(result.createdAt))

  section('审查结果')
  kv('问题总数', result.findings.length)
  for (const severity of ['high', 'review', 'info'] as const) {
    kv(SEVERITY_LABELS[severity], result.findings.filter((item) => item.severity === severity).length)
  }
  kv('字幕条数', result.summary.cueCount)
  kv('匹配条数', result.summary.matchedCueCount)
  kv('文本一致率', result.summary.consistency, '0.0%')
  kv('平均词置信度', result.summary.avgConfidence, '0.0%')
  kv('整体时间偏移', result.summary.globalOffsetMs === null ? '未检测到' : `${result.summary.globalOffsetMs} ms`)
  kv(
    '每分钟漂移',
    result.summary.driftMsPerMinute === null ? '—' : `${result.summary.driftMsPerMinute.toFixed(1)} ms/分钟`
  )

  section('检测参数')
  kv('词级置信度下限', result.options.confidenceThreshold, '0.00')
  kv('不确定阈值', result.options.uncertainThreshold, '0.00')
  kv('拼音相似度下限', result.options.pinyinThreshold, '0.00')
  kv('对齐相似度下限', result.options.alignmentThreshold, '0.00')
  kv('单条时间轴允许偏差', `${result.options.timingToleranceMs} ms`)
  kv('全局偏移阈值', `${result.options.globalOffsetMs} ms`)
}

function addFindingsSheet(workbook: Workbook, result: AnalysisResult): void {
  const sheet = workbook.addWorksheet('问题清单', { views: [{ state: 'frozen', ySplit: 1 }] })
  sheet.columns = [
    { header: '序号', key: 'index', width: 6 },
    { header: '类型', key: 'kind', width: 12 },
    { header: '严重度', key: 'severity', width: 10 },
    { header: '开始时间', key: 'start', width: 14 },
    { header: '结束时间', key: 'end', width: 14 },
    { header: '字幕文本', key: 'subtitle', width: 42 },
    { header: 'ASR 文本', key: 'asr', width: 42 },
    { header: '说明', key: 'message', width: 40 },
    { header: '建议', key: 'suggestion', width: 30 },
    { header: '词级置信度', key: 'confidence', width: 12 },
    { header: '拼音相似度', key: 'similarity', width: 12 },
    { header: '拼音关系', key: 'relation', width: 10 },
    { header: '起点偏差(ms)', key: 'startDrift', width: 13 },
    { header: '终点偏差(ms)', key: 'endDrift', width: 13 }
  ]

  result.findings.forEach((finding, index) => {
    const row = sheet.addRow({
      index: index + 1,
      kind: KIND_LABELS[finding.kind],
      severity: SEVERITY_LABELS[finding.severity],
      start: formatTime(finding.startMs),
      end: formatTime(finding.endMs),
      subtitle: finding.subtitleText,
      asr: finding.asrText,
      message: finding.message,
      suggestion: finding.suggestion ?? '',
      confidence: finding.confidence ?? null,
      similarity: finding.evidence.pinyin?.similarity ?? null,
      relation: finding.evidence.pinyin ? RELATION_LABELS[finding.evidence.pinyin.relation] : '',
      startDrift: finding.evidence.timing?.startDriftMs ?? null,
      endDrift: finding.evidence.timing?.endDriftMs ?? null
    })
    row.getCell(10).numFmt = '0.000'
    row.getCell(11).numFmt = '0.000'
    row.getCell(3).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: SEVERITY_FILL[finding.severity] }
    }
    for (let column = 1; column <= 14; column++) {
      row.getCell(column).alignment = { vertical: 'top', wrapText: column >= 6 && column <= 9 }
    }
  })

  styleHeader(sheet, 14)
  sheet.autoFilter = { from: 'A1', to: 'N1' }
}

function addCueSheet(workbook: Workbook, result: AnalysisResult): void {
  const sheet = workbook.addWorksheet('字幕对照', { views: [{ state: 'frozen', ySplit: 1 }] })
  sheet.columns = [
    { header: '序号', key: 'index', width: 6 },
    { header: '开始时间', key: 'start', width: 14 },
    { header: '结束时间', key: 'end', width: 14 },
    { header: '字幕文本', key: 'subtitle', width: 55 },
    { header: '对应 ASR 文本', key: 'asr', width: 55 }
  ]

  result.cues.forEach((cue, index) => {
    const asr = result.segments
      .filter((segment) => segment.startMs < cue.endMs && segment.endMs > cue.startMs)
      .map((segment) => segment.text.trim())
      .filter(Boolean)
      .join(' ')
    const row = sheet.addRow({
      index: index + 1,
      start: formatTime(cue.startMs),
      end: formatTime(cue.endMs),
      subtitle: cue.text,
      asr
    })
    for (let column = 1; column <= 5; column++) {
      row.getCell(column).alignment = { vertical: 'top', wrapText: column >= 4 }
    }
  })

  styleHeader(sheet, 5)
  sheet.autoFilter = { from: 'A1', to: 'E1' }
}

export async function buildWorkbook(result: AnalysisResult): Promise<Buffer> {
  const workbook = new Workbook()
  workbook.creator = '字幕校对台'
  workbook.created = new Date(result.createdAt)
  addOverviewSheet(workbook, result)
  addFindingsSheet(workbook, result)
  addCueSheet(workbook, result)
  const buffer = await workbook.xlsx.writeBuffer()
  return Buffer.from(buffer)
}
