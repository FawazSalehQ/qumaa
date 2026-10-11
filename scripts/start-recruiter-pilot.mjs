#!/usr/bin/env node
// A fresh, persistent pilot library for each launch; never open the normal library.
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const options = new Set(process.argv.slice(2))
const resumeOptions = [...options].filter((option) => option.startsWith('--resume='))
const resumeName = resumeOptions[0]?.slice('--resume='.length)
const supported = new Set(['--check', '--source', '--help'])
if (resumeOptions.length > 1 || (resumeName !== undefined && !/^drilling-[a-zA-Z0-9]{6}$/.test(resumeName)) ||
    [...options].some((option) => !supported.has(option) && !resumeOptions.includes(option))) {
  console.error('Usage: node scripts/start-recruiter-pilot.mjs [--check] [--source] [--resume=drilling-XXXXXX]')
  process.exit(1)
}
if (options.has('--help')) {
  console.log(`Usage: node scripts/start-recruiter-pilot.mjs [--check] [--source] [--resume=drilling-XXXXXX]

Launch the packaged Qumaa app with a new, empty pilot library.
--check   Check launch files without creating a session or opening the app.
--source  Use the checkout's built app instead (run npm run build first).
--resume=drilling-XXXXXX  Reopen a session created by this launcher, using its original target.

Close other Qumaa windows before starting. Without --resume, each launch creates a
fresh session under .local/pilot/sessions; previous sessions remain there.
Use only the fictional pilot files. Optional AI stays off in a fresh library.
See pilot/README.md for the session and blind relevance review.`)
  process.exit(0)
}

const sessions = join(root, '.local/pilot/sessions')
let resumed
if (resumeName) {
  const directory = join(sessions, resumeName)
  try {
    if (dirname(realpathSync(directory)) !== realpathSync(sessions) ||
        dirname(realpathSync(join(directory, 'library'))) !== realpathSync(directory)) {
      throw new Error('Session must stay inside the pilot sessions directory.')
    }
    resumed = JSON.parse(readFileSync(join(directory, 'session.json'), 'utf8'))
    if (resumed.userData !== join(directory, 'library') || typeof resumed.source !== 'boolean') {
      throw new Error('Session metadata does not describe an isolated pilot library.')
    }
  } catch (error) {
    console.error(`Cannot resume pilot session: ${error.message}`)
    process.exit(1)
  }
}
const source = resumed ? resumed.source : options.has('--source')
const mac = process.platform === 'darwin'
const win = process.platform === 'win32'
if (!mac && !win) {
  console.error('The recruiter pilot supports the macOS and Windows release targets.')
  process.exit(1)
}
const executable = source
  ? join(root, 'node_modules/electron/dist', mac ? 'Electron.app/Contents/MacOS/Electron' : 'electron.exe')
  : join(root, 'release', mac ? 'mac-arm64/قُمع.app/Contents/MacOS/قُمع' : 'win-unpacked/قُمع.exe')
const required = source ? [executable, join(root, 'out/main/index.js')] : [executable]
const missing = required.filter((path) => !existsSync(path))
if (missing.length) {
  console.error(`Missing pilot launch files:\n${missing.join('\n')}`)
  console.error(source
    ? 'Install dependencies and run npm run build first.'
    : 'Use the unpacked release build, or run npm run build and launch with --source.')
  process.exit(1)
}
console.log(`Pilot target: ${source ? 'built checkout' : 'packaged beta'}\n${executable}`)
if (options.has('--check')) process.exit(0)

mkdirSync(sessions, { recursive: true })
const session = resumeName ? join(sessions, resumeName) : mkdtempSync(join(sessions, 'drilling-'))
const userData = join(session, 'library')
if (!resumed) {
  mkdirSync(userData)
  writeFileSync(join(session, 'session.json'), JSON.stringify({
  startedAt: new Date().toISOString(),
  executable,
  source,
  userData,
  fixtureDirectory: join(root, 'eval/pilots/drilling-engineer/corpus'),
  status: 'Created; participant observations must be recorded separately.'
  }, null, 2) + '\n')
}
console.log(`\n${resumed ? 'Resuming' : 'Fresh'} pilot session: ${session}`)
if (!resumed) console.log('Verify Library 0 and no saved jobs before importing the fictional corpus.')
console.log(`To reopen this session: node scripts/start-recruiter-pilot.mjs --resume=${session.split(/[\\/]/).pop()}`)
console.log('Close Qumaa when finished. Session files are retained locally and gitignored.')
const env = { ...process.env, QUMAA_E2E_USER_DATA: userData }
delete env.ELECTRON_RUN_AS_NODE
const child = spawn(executable, source ? [root] : [], { cwd: root, env, stdio: 'inherit' })
child.on('error', (error) => {
  console.error(`Could not launch pilot: ${error.message}`)
  process.exitCode = 1
})
child.on('exit', (code, signal) => {
  if (signal) console.error(`Pilot app exited with signal ${signal}.`)
  process.exitCode = code ?? 1
})
