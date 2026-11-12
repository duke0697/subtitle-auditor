import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import sharp from 'sharp'

const dir = join(process.cwd(), 'resources', 'icons')
mkdirSync(dir, { recursive: true })

const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="112" fill="#0B0C0E"/>
  <rect x="72" y="96" width="368" height="320" rx="40" fill="#121417" stroke="#2A2F36" stroke-width="6"/>
  <rect x="112" y="150" width="288" height="30" rx="15" fill="#F0B45E"/>
  <rect x="112" y="212" width="210" height="22" rx="11" fill="#5BC0EB" opacity="0.9"/>
  <rect x="112" y="256" width="248" height="22" rx="11" fill="#E8EAED" opacity="0.55"/>
  <rect x="112" y="300" width="160" height="22" rx="11" fill="#E8EAED" opacity="0.35"/>
  <path d="M330 300 L390 340 L330 380 Z" fill="#F0B45E"/>
</svg>`

await sharp(Buffer.from(svg)).png().toFile(join(dir, 'icon.png'))
console.log('[icon] written to', join(dir, 'icon.png'))
