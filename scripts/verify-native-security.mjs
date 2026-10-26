import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const webRequire = createRequire(new URL('../apps/web/package.json', import.meta.url))
const nextRequire = createRequire(webRequire.resolve('next'))
const { getSharp } = nextRequire('next/dist/server/image-optimizer/transform')
const sharp = getSharp(1, false)
const input = await sharp({
  create: { width: 16, height: 16, channels: 4, background: { r: 20, g: 80, b: 120, alpha: 1 } }
})
  .png()
  .toBuffer()
const output = await sharp(input).resize(8, 8).webp().toBuffer()
const metadata = await sharp(output).metadata()
assert.equal(metadata.format, 'webp')
assert.equal(metadata.width, 8)
assert.equal(metadata.height, 8)
console.log(
  JSON.stringify({
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    next: nextRequire('next/package.json').version,
    sharp: sharp.versions.sharp,
    libvips: sharp.versions.vips,
    inputBytes: input.length,
    outputBytes: output.length,
    width: metadata.width,
    height: metadata.height,
    format: metadata.format
  })
)
