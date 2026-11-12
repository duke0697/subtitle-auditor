import { AUTOMOTIVE_GLOSSARY } from './glossary'

export type IssueKind = 'typo' | 'content' | 'timing' | 'uncertain'
export type Severity = 'high' | 'review' | 'info'
export type Relation = 'homophone' | 'tone' | 'confusion' | 'none'
export type DeviceMode = 'auto' | 'cpu' | 'cuda'

export interface SubtitleStream {
  index: number
  relativeIndex: number
  codec: string
  language: string
  title: string
  extractable: boolean
}

export interface MediaInfo {
  path: string
  durationMs: number
  sizeBytes: number
  container: string
  videoCodec: string
  audioCodec: string
  width: number
  height: number
  fps: number
  subtitleStreams: SubtitleStream[]
}

export interface SubtitleInfo {
  path: string
  format: string
  encoding: string
  trackIndex: number | null
}

export interface Cue {
  id: string
  index: number
  startMs: number
  endMs: number
  text: string
}

export interface AsrWord {
  id: string
  text: string
  startMs: number
  endMs: number
  probability: number
  segmentId: string
}

export interface AsrSegment {
  id: string
  startMs: number
  endMs: number
  text: string
  avgLogprob: number
  noSpeechProb: number
  words: AsrWord[]
}

export interface EditOp {
  op: 'equal' | 'replace' | 'insert' | 'delete'
  subStart: number
  subEnd: number
  asrStart: number
  asrEnd: number
  subText: string
  asrText: string
}

export interface Evidence {
  edits: EditOp[]
  words: Array<{ id: string; text: string; probability: number }>
  pinyin?: {
    sub: string[]
    asr: string[]
    similarity: number
    relation: Relation
  }
  timing?: {
    startDriftMs: number
    endDriftMs: number
    globalOffsetMs: number | null
  }
  note?: string
}

export interface Finding {
  id: string
  kind: IssueKind
  severity: Severity
  cueIds: string[]
  startMs: number
  endMs: number
  title: string
  message: string
  subtitleText: string
  asrText: string
  confidence?: number
  suggestion?: string
  evidence: Evidence
}

export interface AnalysisSummary {
  durationMs: number
  cueCount: number
  matchedCueCount: number
  consistency: number
  avgConfidence: number
  counts: Record<IssueKind, number>
  globalOffsetMs: number | null
  driftMsPerMinute: number | null
}

export interface AnalysisOptions {
  model: string
  device: DeviceMode
  language: string | null
  glossary: string[]
  confidenceThreshold: number
  uncertainThreshold: number
  pinyinThreshold: number
  alignmentThreshold: number
  timingToleranceMs: number
  globalOffsetMs: number
  t2s: boolean
}

export interface ModelInfo {
  name: string
  label: string
  sizeBytes: number
  downloaded: boolean
  path: string
  recommendedDevice: DeviceMode
}

export interface AnalysisResult {
  schemaVersion: 1
  createdAt: string
  media: MediaInfo
  subtitle: SubtitleInfo
  model: { name: string; device: string; computeType: string; language: string | null }
  cues: Cue[]
  segments: AsrSegment[]
  findings: Finding[]
  summary: AnalysisSummary
  options: AnalysisOptions
}

export type JobStage = 'probe' | 'subtitle' | 'asr' | 'align' | 'done'
export type JobStatus = 'running' | 'done' | 'error' | 'cancelled'

export interface JobProgress {
  jobId: string
  stage: JobStage
  progress: number
  message: string
}

export interface JobSegmentEvent {
  jobId: string
  segment: AsrSegment
}

export interface JobDoneEvent {
  jobId: string
  result: AnalysisResult
}

export interface JobErrorEvent {
  jobId: string
  message: string
  detail?: string
}

export interface AnalyzeRequest {
  jobId: string
  videoPath: string
  subtitlePath: string
  options: Partial<AnalysisOptions>
}

export interface AppSettings {
  model: string
  device: DeviceMode
  language: string | null
  hfMirror: string
  updateMirror: string
  lastDir: string | null
  options: AnalysisOptions
  window: { width: number; height: number; x?: number; y?: number }
}

export const DEFAULT_OPTIONS: AnalysisOptions = {
  model: 'medium',
  device: 'auto',
  language: null,
  glossary: [...AUTOMOTIVE_GLOSSARY],
  confidenceThreshold: 0.9,
  uncertainThreshold: 0.65,
  pinyinThreshold: 0.8,
  alignmentThreshold: 0.85,
  timingToleranceMs: 500,
  globalOffsetMs: 500,
  t2s: true
}

export const DEFAULT_SETTINGS: AppSettings = {
  model: 'medium',
  device: 'auto',
  language: null,
  hfMirror: '',
  updateMirror: 'https://ghfast.top/',
  lastDir: null,
  options: DEFAULT_OPTIONS,
  window: { width: 1360, height: 860 }
}

export interface RpcResponse<T> {
  jsonrpc: '2.0'
  id: number
  result?: T
  error?: { code: number; message: string; data?: unknown }
}
