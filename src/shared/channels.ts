/** IPC channel names, shared so main and preload cannot drift apart. */
export const CH = {
  // invoke
  resumesList: 'resumes:list',
  resumesGet: 'resumes:get',
  resumesDelete: 'resumes:delete',
  resumesReveal: 'resumes:reveal',
  resumesOpen: 'resumes:open',

  ingestFiles: 'ingest:files',
  ingestFolder: 'ingest:folder',
  ingestPickFolder: 'ingest:pickFolder',
  ingestPickFiles: 'ingest:pickFiles',
  ingestText: 'ingest:text',

  searchRun: 'search:run',

  settingsGet: 'settings:get',
  settingsSetWatchedFolder: 'settings:setWatchedFolder',
  settingsStats: 'settings:stats',
  settingsModelStatus: 'settings:modelStatus',

  // events (main -> renderer)
  evIngestProgress: 'ev:ingestProgress',
  evWatchIngest: 'ev:watchIngest',
  evMenuCommand: 'ev:menuCommand'
} as const
