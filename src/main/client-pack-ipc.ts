import { randomUUID } from 'node:crypto'
import { dialog, ipcMain, type BrowserWindow } from 'electron'
import { z } from 'zod'
import type { ClientPackConfig, ClientPackDocument } from '@shared/client-pack.js'
import { maintenance } from './maintenance.js'
import { parseIpc } from './ipc-validation.js'
import { getJob } from './recruiting/index.js'
import { overview } from './recruiting/talent.js'
import { currentLanguage, nativeText as t } from './language.js'
import { clientPackConfigSchema, clientPackFingerprint, clientPackHtml, clientPackSourceFromRecords, projectClientPack } from './export/client-pack.js'
import { writeShortlistPdf } from './export/shortlist.js'

const sourceSchema = z.strictObject({ jobId: z.string().uuid(), personIds: z.array(z.string().uuid()).max(10).optional() })
const exportSchema = z.strictObject({ config: clientPackConfigSchema, previewToken: z.string().uuid() })
const PREVIEW_TTL = 10 * 60_000
interface RetainedPreview { config: ClientPackConfig; document: ClientPackDocument; fingerprint: string; expiresAt: number; senderId: number }

function source(jobId: string, personIds?: string[]) {
  const talent = overview()
  return clientPackSourceFromRecords(getJob(jobId), talent, personIds)
}

export function registerClientPackHandlers(getWindow: () => BrowserWindow): void {
  const previews = new Map<string, RetainedPreview>()
  const assertFresh = (retained: RetainedPreview): void => {
    const updated = projectClientPack(source(retained.config.jobId, retained.config.candidates.map((person) => person.personId)), retained.config, retained.document.language, retained.document.generatedAt)
    if (currentLanguage() !== retained.document.language || clientPackFingerprint(updated) !== retained.fingerprint) {
      throw new Error('The client presentation changed. Review a fresh preview before exporting.')
    }
  }

  ipcMain.handle('clientPack:source', (_event, input: unknown) => maintenance.runOperation(() => {
    const args = parseIpc(sourceSchema, input, 'client presentation source')
    return source(args.jobId, args.personIds)
  }))
  ipcMain.handle('clientPack:preview', (event, input: unknown) => maintenance.runOperation(() => {
    const config = parseIpc(clientPackConfigSchema, input, 'client presentation')
    const document = projectClientPack(source(config.jobId, config.candidates.map((person) => person.personId)), config, currentLanguage(), Date.now())
    for (const [token, retained] of previews) if (retained.expiresAt < Date.now() || retained.senderId === event.sender.id) previews.delete(token)
    while (previews.size >= 10) previews.delete(previews.keys().next().value!)
    const previewToken = randomUUID()
    previews.set(previewToken, { config, document, fingerprint: clientPackFingerprint(document), expiresAt: Date.now() + PREVIEW_TTL, senderId: event.sender.id })
    return { previewToken, document }
  }))
  ipcMain.handle('clientPack:export', async (event, input: unknown) => {
    const args = parseIpc(exportSchema, input, 'client presentation export')
    const retained = await maintenance.runOperation(() => {
      const value = previews.get(args.previewToken)
      previews.delete(args.previewToken)
      if (!value || value.senderId !== event.sender.id || value.expiresAt < Date.now() || JSON.stringify(value.config) !== JSON.stringify(args.config)) {
        throw new Error('The client presentation preview expired. Preview it again before exporting.')
      }
      assertFresh(value)
      return value
    })
    const title = retained.document.jobTitle.replace(/[^\p{L}\p{N} _-]/gu, '').trim().slice(0, 120) || t('Client presentation')
    const { canceled, filePath } = await dialog.showSaveDialog(getWindow(), {
      title: t('Export client presentation'), defaultPath: `${title} ${t('client presentation')}.pdf`,
      filters: [{ name: 'PDF', extensions: ['pdf'] }]
    })
    if (canceled || !filePath) return null
    await maintenance.runOperation(async () => {
      assertFresh(retained)
      await writeShortlistPdf(clientPackHtml(retained.document), filePath)
    })
    return filePath
  })
}
