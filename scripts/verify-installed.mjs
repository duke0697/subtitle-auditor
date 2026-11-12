import { mkdirSync } from 'node:fs'
import { chromium } from 'playwright-core'

const port = process.argv[2] ?? '9225'
mkdirSync('tests/output', { recursive: true })

const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`)
const context = browser.contexts()[0]
const page = context.pages().find((item) => item.url().includes('app.asar')) ?? context.pages()[0]
page.on('pageerror', (error) => console.log('[pageerror]', error.message))
page.on('console', (message) => {
  if (message.type() === 'error') console.log('[console.error]', message.text())
})

const version = await page.evaluate(() => window.api.app.version())
const probe = await page.evaluate(() =>
  window.api.media.probe('D:/zhxl/code/test/ASR/tests/fixtures/sample.mp4')
)
console.log('version', version, 'probe', probe.videoCodec, probe.durationMs)

await page.evaluate(() => {
  const options = {
    model: 'small',
    device: 'cpu',
    language: null,
    confidenceThreshold: 0.9,
    uncertainThreshold: 0.65,
    pinyinThreshold: 0.8,
    alignmentThreshold: 0.85,
    timingToleranceMs: 500,
    globalOffsetMs: 500,
    t2s: true
  }
  void window.api.job.start({
    jobId: 'installed-e2e',
    videoPath: 'D:/zhxl/code/test/ASR/tests/fixtures/sample.mp4',
    subtitlePath: 'D:/zhxl/code/test/ASR/tests/fixtures/sample-typo.srt',
    options
  })
})

await page.getByText('审查结果').waitFor({ timeout: 240_000 })
await page.waitForTimeout(1200)
await page.screenshot({ path: 'tests/output/installed-results.png' })
const summary = await page.locator('aside').first().innerText()
console.log(summary.slice(0, 900))
process.exit(0)
