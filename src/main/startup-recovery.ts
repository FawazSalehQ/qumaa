import { app, dialog, shell } from 'electron'
import { translate, type Language } from '@shared/i18n.js'

/** Startup may fail before SQLite can open, so recovery must not read settings. */
export async function showStartupRecovery(): Promise<void> {
  try {
    const language: Language = app.getLocale().toLowerCase().startsWith('ar') ? 'ar' : 'en'
    const dataFolder = app.getPath('userData')
    const { response } = await dialog.showMessageBox({
      type: 'error',
      title: language === 'ar' ? 'قُمع' : 'Qumaa',
      message: translate(language, 'Qumaa could not start.'),
      detail: `${translate(language, 'Your library has not been deleted or reset. You can show its data folder to make a copy for recovery.')}\n\n${dataFolder}`,
      buttons: [translate(language, 'Show data folder and quit'), translate(language, 'Quit قُمع')],
      defaultId: 0,
      cancelId: 1,
      noLink: true
    })
    if (response === 0) shell.showItemInFolder(dataFolder)
  } catch (error) {
    console.error('Could not show startup recovery:', error)
  } finally {
    app.quit()
  }
}
