import { mkdirSync } from 'node:fs'
import { chromium } from 'playwright-core'

const port = process.argv[2] ?? '9223'
const output = process.argv[3] ?? 'tests/output/ui.png'

mkdirSync('tests/output', { recursive: true })
const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`)
const context = browser.contexts()[0]
const page = context.pages().find((item) => item.url().includes('index.html')) ?? context.pages()[0]
await page.waitForTimeout(1200)
await page.screenshot({ path: output })
console.log(JSON.stringify({ title: await page.title(), url: page.url(), output }))
process.exit(0)
