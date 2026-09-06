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
  ingestPickFiles: 'ingest:pickFiles',
  ingestText: 'ingest:text',

  searchRun: 'search:run',
  searchExport: 'search:export',
  searchRerankPreview: 'search:rerankPreview',
  searchRerank: 'search:rerank',

  recruitingListJobs: 'recruiting:listJobs',
  recruitingSaveJob: 'recruiting:saveJob',
  recruitingGetJob: 'recruiting:getJob',
  recruitingSearchJob: 'recruiting:searchJob',
  recruitingGetEvidence: 'recruiting:getEvidence',
  recruitingReorderShortlist: 'recruiting:reorderShortlist',
  recruitingSaveReview: 'recruiting:saveReview',
  recruitingListProfiles: 'recruiting:listProfiles',
  recruitingSaveProfile: 'recruiting:saveProfile',
  recruitingLinkVersions: 'recruiting:linkVersions',
  recruitingUnlinkVersion: 'recruiting:unlinkVersion',
  recruitingExportShortlist: 'recruiting:exportShortlist',

  settingsGet: 'settings:get',
  settingsSetWatchedFolder: 'settings:setWatchedFolder',
  settingsChooseWatchedFolder: 'settings:chooseWatchedFolder',
  settingsSetTheme: 'settings:setTheme',
  settingsSetLanguage: 'settings:setLanguage',
  settingsSetApiKey: 'settings:setApiKey',
  settingsProtectLegacyApiKey: 'settings:protectLegacyApiKey',
  settingsSetRerank: 'settings:setRerank',
  settingsResetRerankConsent: 'settings:resetRerankConsent',
  settingsStats: 'settings:stats',
  settingsModelStatus: 'settings:modelStatus',
  settingsRevealData: 'settings:revealData',
  settingsBackup: 'settings:backup',
  settingsRestore: 'settings:restore',
  settingsDeleteAll: 'settings:deleteAll',
  settingsOpenLinkedIn: 'settings:openLinkedIn',

  // events (main -> renderer)
  evIngestProgress: 'ev:ingestProgress',
  evWatchIngest: 'ev:watchIngest',
  evReindexed: 'ev:reindexed',
  evMenuCommand: 'ev:menuCommand'
} as const
