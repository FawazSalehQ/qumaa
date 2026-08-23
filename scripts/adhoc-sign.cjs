/**
 * electron-builder afterPack hook: properly ad-hoc sign the macOS bundle.
 *
 * Without this the app carries only the linker's ad-hoc signature, which has
 * `Sealed Resources=none` and fails `codesign --verify`. That is fine locally,
 * but once the app is downloaded macOS attaches a quarantine flag, and a
 * quarantined bundle with an invalid signature is reported as "damaged and
 * can't be opened", with no way for the user to override it.
 *
 * A proper ad-hoc signature does not remove the Gatekeeper prompt (only a paid
 * Developer ID plus notarisation does that), but it downgrades the failure to
 * "developer cannot be verified", which the user can click through via
 * right-click > Open, or System Settings > Privacy & Security > Open Anyway.
 */
const { execFileSync } = require('node:child_process')
const { join } = require('node:path')

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return

  const appName = `${context.packager.appInfo.productFilename}.app`
  const appPath = join(context.appOutDir, appName)

  execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], { stdio: 'inherit' })
  // Fail the build rather than ship a bundle that Gatekeeper will call damaged.
  execFileSync('codesign', ['--verify', '--deep', '--strict', appPath], { stdio: 'inherit' })

  console.log(`  • ad-hoc signed and verified  ${appName}`)
}
