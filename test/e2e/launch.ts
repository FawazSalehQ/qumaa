import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { isAbsolute, resolve } from 'node:path'

export const ROOT = resolve(__dirname, '../..')

/**
 * Starts Qumaa against a throwaway library: the build in out/ by default, or the
 * packaged binary named by QUMAA_E2E_EXECUTABLE.
 */
export async function launchQumaa(scratch: string): Promise<{ application: ElectronApplication; page: Page }> {
  const executable = process.env.QUMAA_E2E_EXECUTABLE
  const env: NodeJS.ProcessEnv = { ...process.env, QUMAA_E2E_USER_DATA: scratch, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' }
  // An inherited ELECTRON_RUN_AS_NODE would turn the launch into a bare Node process.
  delete env.ELECTRON_RUN_AS_NODE
  const application = await electron.launch({
    ...(executable ? { executablePath: isAbsolute(executable) ? executable : resolve(ROOT, executable) } : { args: [ROOT] }),
    cwd: ROOT,
    env
  })
  const page = await application.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  return { application, page }
}
