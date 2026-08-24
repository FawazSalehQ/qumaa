/** IPC channel names, shared so main and preload cannot drift apart. */
export const CH = {
  // invoke
  resumesList: 'resumes:list',
  resumesGet: 'resumes:get',
  resumesDelete: 'resumes:delete',
  resumesDeleteMany: 'resumes:deleteMany',
  resumesReveal: 'resumes:reveal',
  resumesOpen: 'resumes:open',

  ingestFiles: 'ingest:files',
  ingestFolder: 'ingest:folder',
  ingestPickFolder: 'ingest:pickFolder',
  ingestPickFiles: 'ingest:pickFiles',
  ingestText: 'ingest:text',

  searchRun: 'search:run',
  searchExport: 'search:export',
  searchRerank: 'search:rerank',

  settingsGet: 'settings:get',
  settingsSetWatchedFolder: 'settings:setWatchedFolder',
  settingsSetTheme: 'settings:setTheme',
  settingsSetApiKey: 'settings:setApiKey',
  settingsSetRerank: 'settings:setRerank',
  settingsStats: 'settings:stats',
  settingsModelStatus: 'settings:modelStatus',

  // events (main -> renderer)
  evIngestProgress: 'ev:ingestProgress',
  evWatchIngest: 'ev:watchIngest',
  evReindexed: 'ev:reindexed',
  evMenuCommand: 'ev:menuCommand'
} as const
