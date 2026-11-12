import { useEffect } from 'react'
import TitleBar from './components/TitleBar'
import Toast from './components/Toast'
import HomeView from './views/HomeView'
import OcrView from './views/OcrView'
import ProcessingView from './views/ProcessingView'
import ResultsView from './views/ResultsView'
import SettingsView from './views/SettingsView'
import { useApp } from './store/app'

export default function App(): React.JSX.Element {
  const view = useApp((state) => state.view)
  const boot = useApp((state) => state.boot)
  const initUpdate = useApp((state) => state.initUpdate)

  useEffect(() => {
    void boot()
    void initUpdate()
  }, [boot, initUpdate])

  useEffect(() => {
    const offs = [
      window.api.job.onProgress((event) => useApp.getState().onProgress(event)),
      window.api.job.onSegment((event) => useApp.getState().onSegment(event.segment)),
      window.api.job.onDone((event) => useApp.getState().onDone(event.result)),
      window.api.job.onError((event) => useApp.getState().onError(event.message)),
      window.api.models.onProgress((event) => useApp.getState().onModelProgress(event)),
      window.api.media.onOcrProgress((event) => useApp.getState().onOcrProgress(event)),
      window.api.update.onState((event) => useApp.getState().onUpdateState(event))
    ]
    return () => offs.forEach((off) => off())
  }, [])

  return (
    <div className="flex h-full flex-col bg-canvas text-ink">
      <TitleBar />
      <main className="min-h-0 flex-1">
        {view === 'home' && <HomeView />}
        {view === 'ocr' && <OcrView />}
        {view === 'processing' && <ProcessingView />}
        {view === 'results' && <ResultsView />}
        {view === 'settings' && <SettingsView />}
      </main>
      <Toast />
    </div>
  )
}
