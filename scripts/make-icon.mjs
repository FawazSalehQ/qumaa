#!/usr/bin/env node
/**
 * Generates the app icon from a single SVG source.
 *
 * The mark is a funnel fed by two bars: many resumes go in, a shortlist comes
 * out. An earlier version put a dot below the funnel stem, which read as an
 * exclamation mark at large sizes, and three feed bars instead of two, which
 * blurred into a smudge at 16px. Two bold bars survive every downscale.
 *
 * Rasterised with `sharp`, already a dependency via @huggingface/transformers,
 * so this adds nothing to the install. electron-builder derives .icns and .ico
 * from the single 1024px PNG.
 */
import sharp from 'sharp'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const buildDir = join(root, 'build')

const PURPLE_LIGHT = '#a97cd6'
const PURPLE_DARK = '#7a4cb0'

/** The funnel glyph alone, as fractions of a box, so it scales cleanly. */
function glyph(p, box, fill) {
  const cx = p + box / 2
  const bars = [
    [0.56, 0.205],
    [0.38, 0.31]
  ]
    .map(
      ([w, y]) =>
        `<rect x="${cx - (box * w) / 2}" y="${p + box * y}" width="${box * w}" ` +
        `height="${box * 0.058}" rx="${box * 0.029}" fill="${fill}"/>`
    )
    .join('')

  const top = p + box * 0.435
  const halfW = box * 0.315
  const neck = box * 0.063
  const shoulder = p + box * 0.7
  const stem = p + box * 0.815

  return (
    bars +
    `<path d="M ${cx - halfW} ${top} L ${cx + halfW} ${top} L ${cx + neck} ${shoulder} ` +
    `L ${cx + neck} ${stem} L ${cx - neck} ${stem} L ${cx - neck} ${shoulder} Z" fill="${fill}"/>`
  )
}

/** Full icon: gradient squircle plus the glyph. `padding` is the macOS inset. */
function iconSvg(size = 1024) {
  const p = size * 0.094
  const box = size - p * 2
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${PURPLE_LIGHT}"/>
      <stop offset="1" stop-color="${PURPLE_DARK}"/>
    </linearGradient>
  </defs>
  <rect x="${p}" y="${p}" width="${box}" height="${box}" rx="${box * 0.225}" fill="url(#g)"/>
  ${glyph(p, box, '#ffffff')}
</svg>`
}

/** Bare glyph on transparent ground, for the in-window brand mark. */
function markSvg(size = 24, fill = 'currentColor') {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${glyph(0, size, fill)}</svg>`
}

await mkdir(buildDir, { recursive: true })

const png = join(buildDir, 'icon.png')
await sharp(Buffer.from(iconSvg(1024))).png().toFile(png)
await writeFile(join(buildDir, 'icon.svg'), iconSvg(1024), 'utf8')

const { width, height } = await sharp(png).metadata()
console.log(`build/icon.png  ${width}x${height}`)
console.log('build/icon.svg  (source)')

export { markSvg }
