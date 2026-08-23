/**
 * Application menu.
 *
 * Replaces Electron's default menu, which names the app "Electron" and offers
 * "Learn More". Menu items that belong to the UI send a command to the renderer
 * rather than duplicating logic, so they reuse the same code paths as the buttons.
 *
 * The Edit submenu is not optional decoration: without those roles, Cmd/Ctrl+C
 * and +V stop working in the job description box on macOS.
 */
import { app, dialog, Menu, shell, type BrowserWindow, type MenuItemConstructorOptions } from 'electron'
import { CH } from '@shared/channels.js'
import type { MenuCommand } from '@shared/types.js'
import { MODEL_ID } from './embed/protocol.js'
import { stats } from './db/index.js'

const isMac = process.platform === 'darwin'

function aboutDetail(): string {
  const { resumeCount, chunkCount } = stats()
  return [
    `Version ${app.getVersion()}`,
    `Embedding model: ${MODEL_ID} (384 dimensions, runs locally)`,
    `Library: ${resumeCount} resumes, ${chunkCount} indexed passages`,
    '',
    'All processing happens on this machine. No resume text is sent anywhere.'
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
      title: 'About قُمع',
      message: 'قُمع',
      detail: aboutDetail(),
      buttons: ['OK']
    }
    if (win) await dialog.showMessageBox(win, options)
    else await dialog.showMessageBox(options)
  }

  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
            label: 'قُمع',
            submenu: [
              { role: 'about' as const, label: 'About قُمع' },
              { type: 'separator' as const },
              {
                label: 'Settings…',
                accelerator: 'Cmd+,',
                click: send('goto-settings')
              },
              { type: 'separator' as const },
              { role: 'services' as const },
              { type: 'separator' as const },
              { role: 'hide' as const, label: 'Hide قُمع' },
              { role: 'hideOthers' as const },
              { role: 'unhide' as const },
              { type: 'separator' as const },
              { role: 'quit' as const, label: 'Quit قُمع' }
            ]
          } satisfies MenuItemConstructorOptions
        ]
      : []),

    {
      label: '&File',
      submenu: [
        { label: 'New Search', accelerator: 'CmdOrCtrl+N', click: send('new-search') },
        { type: 'separator' },
        { label: 'Import Files…', accelerator: 'CmdOrCtrl+O', click: send('import-files') },
        {
          label: 'Import Folder…',
          accelerator: 'CmdOrCtrl+Shift+O',
          click: send('import-folder')
        },
        { type: 'separator' },
        ...(isMac
          ? [{ role: 'close' as const }]
          : [
              {
                label: 'Settings',
                accelerator: 'Ctrl+,',
                click: send('goto-settings')
              },
              { type: 'separator' as const },
              { role: 'quit' as const, label: 'Exit' }
            ])
      ]
    },

    // Standard roles. Removing these breaks copy and paste in the app.
    {
      label: '&Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        ...(isMac ? [{ role: 'pasteAndMatchStyle' as const }] : []),
        { role: 'delete' },
        { role: 'selectAll' }
      ]
    },

    {
      label: '&View',
      submenu: [
        { label: 'Match', accelerator: 'CmdOrCtrl+1', click: send('goto-match') },
        { label: 'Library', accelerator: 'CmdOrCtrl+2', click: send('goto-library') },
        { label: 'Settings', accelerator: 'CmdOrCtrl+3', click: send('goto-settings') },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        { role: 'toggleDevTools' }
      ]
    },

    {
      label: '&Window',
      submenu: [
        { role: 'minimize' },
        ...(isMac
          ? [{ role: 'zoom' as const }, { type: 'separator' as const }, { role: 'front' as const }]
          : [{ role: 'close' as const }])
      ]
    },

    {
      label: '&Help',
      role: 'help',
      submenu: [
        ...(isMac ? [] : [{ label: 'About قُمع', click: showAbout }]),
        {
          label: 'Show Database Folder',
          click: () => {
            shell.showItemInFolder(stats().dbPath)
          }
        }
      ]
    }
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
