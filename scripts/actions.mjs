import { chromium } from 'playwright-core'

const port = process.argv[2] ?? '9223'
const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`)
const context = browser.contexts()[0]
const page = context.pages().find((item) => item.url().includes('index.html')) ?? context.pages()[0]

await page.getByText('审查结果').waitFor({ timeout: 30_000 })
await page.getByText('今天天气很号，我们出去走走吧').first().click()
await page.waitForTimeout(300)
await page.keyboard.press('Enter')
await page.waitForTimeout(400)
let text = await page.locator('body').innerText()
console.log('after Enter:', /已处理\s*1\s*\/\s*2/.test(text) ? '1/2 OK' : '1/2 MISSING')

await page.keyboard.press('i')
await page.waitForTimeout(400)
text = await page.locator('body').innerText()
console.log('after I:', /已处理\s*2\s*\/\s*2/.test(text) ? '2/2 OK' : '2/2 MISSING')
await page.screenshot({ path: 'tests/output/05-reviewed.png' })
process.exit(0)
