/**
 * Application menu.
 *
 * Replaces Electron's default menu, which names the app "Electron" and offers
 * "Learn More". Menu items that belong to the UI send a command to the renderer
 * rather than duplicating logic, so they reuse the same code paths as the buttons.
 *
 * The Edit submenu is not optional decoration: without those roles, Cmd/Ctrl+C
 * and +V stop working in the job-posting fields on macOS.
 */
import { app, dialog, Menu, shell, type BrowserWindow, type MenuItemConstructorOptions } from 'electron'
import { CH } from '@shared/channels.js'
import type { MenuCommand } from '@shared/types.js'
import { stats } from './db/index.js'
import { nativeText as t } from './language.js'

const isMac = process.platform === 'darwin'

function aboutDetail(): string {
  const { resumeCount, chunkCount } = stats()
  return [
    t('Version {version}', { version: app.getVersion() }),
    t('Library: {count} resumes, {passages} indexed passages', { count: resumeCount, passages: chunkCount }),
    '',
    t('This application runs locally.')
  ].join('\n')
}

export function buildMenu(getWindow: () => BrowserWindow | null): void {
  const send = (command: MenuCommand) => () => {
    const win = getWindow()
    if (win && !win.isDestroyed()) win.webContents.send(CH.evMenuCommand, command)
  }

  // macOS shows this in the standard About panel; Windows has no equivalent, so
  // the Help menu opens a dialog with the same information.
  app.setAboutPanelOptions({
    applicationName: 'قُمع',
    applicationVersion: app.getVersion(),
    version: '',
    credits: aboutDetail()
  })

  const showAbout = async (): Promise<void> => {
    const win = getWindow()
    const options = {
      type: 'info' as const,
      title: t('About قُمع'),
      message: 'قُمع',
      detail: aboutDetail(),
      buttons: [t('OK')]
    }
    if (win) await dialog.showMessageBox(win, options)
    else await dialog.showMessageBox(options)
  }

  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
            label: t('قُمع'),
            submenu: [
              { role: 'about' as const, label: t('About قُمع') },
              { type: 'separator' as const },
              {
                label: t('Settings…'),
                accelerator: 'Cmd+,',
                click: send('goto-settings')
              },
              { type: 'separator' as const },
              { role: 'services' as const, label: t('Services') },
              { type: 'separator' as const },
              { role: 'hide' as const, label: t('Hide قُمع') },
              { role: 'hideOthers' as const, label: t('Hide Others') },
              { role: 'unhide' as const, label: t('Show All') },
              { type: 'separator' as const },
              { role: 'quit' as const, label: t('Quit قُمع') }
            ]
          } satisfies MenuItemConstructorOptions
        ]
      : []),

    {
      label: t('&File'),
      submenu: [
        { label: t('New Job'), accelerator: 'CmdOrCtrl+N', click: send('new-job') },
        { type: 'separator' },
        { label: t('Import Files…'), accelerator: 'CmdOrCtrl+O', click: send('import-files') },
        {
          label: t('Import Folder…'),
          accelerator: 'CmdOrCtrl+Shift+O',
          click: send('import-folder')
        },
        { type: 'separator' },
        ...(isMac
          ? [{ role: 'close' as const, label: t('Close Window') }]
          : [
              {
                label: t('Settings'),
                accelerator: 'Ctrl+,',
                click: send('goto-settings')
              },
              { type: 'separator' as const },
              { role: 'quit' as const, label: t('Exit') }
            ])
      ]
    },

    // Standard roles. Removing these breaks copy and paste in the app.
    {
      label: t('&Edit'),
      submenu: [
        { role: 'undo', label: t('Undo') },
        { role: 'redo', label: t('Redo') },
        { type: 'separator' },
        { role: 'cut', label: t('Cut') },
        { role: 'copy', label: t('Copy') },
        { role: 'paste', label: t('Paste') },
        ...(isMac ? [{ role: 'pasteAndMatchStyle' as const, label: t('Paste and Match Style') }] : []),
        { role: 'delete', label: t('Delete') },
        { role: 'selectAll', label: t('Select All') }
      ]
    },

    {
      label: t('&View'),
      submenu: [
        { label: t('Jobs'), accelerator: 'CmdOrCtrl+1', click: send('goto-jobs') },
        { label: t('Library'), accelerator: 'CmdOrCtrl+2', click: send('goto-library') },
        { label: t('Settings'), accelerator: 'CmdOrCtrl+3', click: send('goto-settings') },
        { type: 'separator' },
        { role: 'resetZoom', label: t('Actual Size') },
        { role: 'zoomIn', label: t('Zoom In') },
        { role: 'zoomOut', label: t('Zoom Out') },
        { type: 'separator' },
        { role: 'togglefullscreen', label: t('Toggle Full Screen') },
        { role: 'toggleDevTools', label: t('Developer Tools') }
      ]
    },

    {
      label: t('&Window'),
      submenu: [
        { role: 'minimize', label: t('Minimize') },
        ...(isMac
          ? [{ role: 'zoom' as const, label: t('Zoom') }, { type: 'separator' as const }, { role: 'front' as const, label: t('Bring All to Front') }]
          : [{ role: 'close' as const, label: t('Close Window') }])
      ]
    },

    {
      label: t('&Help'),
      role: 'help',
      submenu: [
        ...(isMac ? [] : [{ label: t('About قُمع'), click: showAbout }]),
        {
          label: t('Show Database Folder'),
          click: () => {
            shell.showItemInFolder(stats().dbPath)
          }
        }
      ]
    }
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
