import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
import type { IssueKind, Severity } from '@shared/contracts'

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}

export const KIND_META: Record<IssueKind, { label: string; color: string; bg: string }> = {
  typo: { label: '疑似错别字', color: 'var(--color-typo)', bg: 'rgba(245,166,35,0.12)' },
  content: { label: '内容不一致', color: 'var(--color-content)', bg: 'rgba(239,106,106,0.12)' },
  timing: { label: '时间轴', color: 'var(--color-timing)', bg: 'rgba(124,156,255,0.12)' },
  uncertain: { label: 'ASR 不确定', color: 'var(--color-uncertain)', bg: 'rgba(139,148,158,0.12)' }
}

export const SEVERITY_META: Record<Severity, { label: string; color: string }> = {
  high: { label: '高', color: 'var(--color-content)' },
  review: { label: '需核对', color: 'var(--color-typo)' },
  info: { label: '提示', color: 'var(--color-uncertain)' }
}

export function toMediaUrl(path: string): string {
  return `app-media://file?path=${encodeURIComponent(path)}`
}

export function formatBytes(bytes: number): string {
  if (!bytes) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
  return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`
}
