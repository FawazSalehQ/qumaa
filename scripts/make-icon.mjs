#!/usr/bin/env node
/**
 * Renders the app icon from the official Qumaa mark in `brand/svg/`.
 *
 * The geometry is not redrawn here: `appicon-ink.svg` is the source of truth and
 * is rasterised as-is, so the shipped icon cannot drift from the brand kit. The
 * brand rules forbid recolouring the funnel, which is another reason to render
 * the supplied file rather than reconstruct it.
 *
 * Rasterised with `sharp`, already a dependency via @huggingface/transformers.
 * electron-builder derives .icns and .ico from the single 1024px PNG.
 */
import sharp from 'sharp'
import { mkdir, readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const buildDir = join(root, 'build')

// `ink` is the primary variant: the brand README lists it first and the web
// snippet sets theme-color to the ink hex. `appicon-violet.svg` is the sanctioned
// alternate if the dark tile ever needs to become a light one.
const SOURCE = join(root, 'brand', 'svg', 'appicon-ink.svg')

await mkdir(buildDir, { recursive: true })

const svg = await readFile(SOURCE)
const png = join(buildDir, 'icon.png')

// density high enough that the 100x100 viewBox rasterises cleanly at 1024.
await sharp(svg, { density: 600 }).resize(1024, 1024).png().toFile(png)

const { width, height } = await sharp(png).metadata()
console.log(`build/icon.png  ${width}x${height}  (from brand/svg/appicon-ink.svg)`)
