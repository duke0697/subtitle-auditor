import { Loader2, ScanText, Square } from 'lucide-react'
import { useApp } from '../store/app'

export default function OcrView(): React.JSX.Element {
  const progress = useApp((state) => state.ocrProgress)
  const videoPath = useApp((state) => state.videoPath)
  const cancelOcr = useApp((state) => state.cancelOcr)
  const percent = Math.round((progress?.progress ?? 0) * 100)

  return (
    <div className="scroll-area h-full">
      <div className="mx-auto max-w-[900px] px-6 py-8">
        <div className="mb-6">
          <div className="mb-1.5 flex items-center gap-2 text-[11.5px] text-muted">
            <span className="h-1.5 w-1.5 rounded-full bg-accent pulse-dot" />
            本地识别 · 不会上传任何媒体
          </div>
          <h1 className="text-[22px] font-semibold tracking-tight">正在提取画面字幕</h1>
          <p className="mt-1 truncate text-[12px] text-ink2">{videoPath?.split(/[\\/]/).pop()}</p>
        </div>

        <section className="panel p-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-[12.5px] text-ink2">
              <Loader2 size={14} className="animate-spin text-accent" />
              {progress?.message ?? '准备中…'}
            </div>
            <span className="timecode text-ink">{percent}%</span>
          </div>
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-line">
            <div
              className="h-full rounded-full bg-gradient-to-r from-accent to-[#f6c273] transition-[width] duration-300"
              style={{ width: `${Math.max(2, percent)}%` }}
            />
          </div>

          <div className="mt-5 flex items-start gap-3 rounded-xl border border-line bg-panel2 p-3 text-[11.5px] leading-relaxed text-muted">
            <ScanText size={15} className="mt-0.5 shrink-0 text-play" />
            <span>
              识别画面底部的烧录字幕，按画面变化抽帧并合并成句。识别完成后会生成与视频同名的
              <span className="text-ink2"> .ocr.srt </span>
              文件并自动选中，可直接开始审查。5 分钟视频约需 1–2 分钟。
            </span>
          </div>
        </section>

        <div className="mt-4 flex justify-center">
          <button className="btn h-9 px-4 text-[12.5px]" onClick={() => void cancelOcr()}>
            <Square size={13} /> 取消
          </button>
        </div>
      </div>
    </div>
  )
}
