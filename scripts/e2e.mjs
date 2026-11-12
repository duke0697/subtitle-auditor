import { mkdirSync } from 'node:fs'
import { chromium } from 'playwright-core'

const port = process.argv[2] ?? '9223'
mkdirSync('tests/output', { recursive: true })

const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`)
const context = browser.contexts()[0]
const page = context.pages().find((item) => item.url().includes('index.html')) ?? context.pages()[0]

page.on('console', (message) => {
  if (message.type() === 'error') console.log('[console.error]', message.text())
})
page.on('pageerror', (error) => console.log('[pageerror]', error.message))

await page.waitForTimeout(800)
await page.screenshot({ path: 'tests/output/01-home.png' })

await page.getByRole('button', { name: /选择视频/ }).click()
await page.getByText('sample.mp4').first().waitFor({ timeout: 30_000 })
await page.waitForTimeout(600)

await page.getByRole('button', { name: /浏览/ }).click()
await page.getByText('sample-typo.srt').first().waitFor({ timeout: 15_000 })
await page.waitForTimeout(400)

const selects = page.locator('select')
if ((await selects.count()) > 0) {
  await selects.first().selectOption('small').catch(() => undefined)
}

await page.screenshot({ path: 'tests/output/02-ready.png' })

const start = page.getByRole('button', { name: /开始审查/ })
await start.waitFor({ timeout: 15_000 })
console.log('start disabled?', await start.isDisabled())
if (await start.isDisabled()) {
  const text = await page.locator('body').innerText()
  console.log(text.slice(0, 1500))
  process.exit(2)
}
await start.click()

await page.getByText('正在审查').waitFor({ timeout: 20_000 })
await page.screenshot({ path: 'tests/output/03-processing.png' })

await page.getByText('审查结果').waitFor({ timeout: 180_000 })
await page.waitForTimeout(1200)
await page.screenshot({ path: 'tests/output/04-results.png' })

const summary = await page.locator('aside').first().innerText()
console.log('SUMMARY >>>')
console.log(summary.slice(0, 1200))
console.log('<<< SUMMARY')
process.exit(0)
