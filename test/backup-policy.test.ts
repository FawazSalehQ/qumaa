import { describe, expect, it } from 'vitest'
import { isPortableSetting, PORTABLE_SETTING_KEYS } from '../src/main/db/backup-policy.js'

describe('portable backup policy', () => {
  it('keeps only cross-machine non-secret settings', () => {
    expect(PORTABLE_SETTING_KEYS).toEqual(['theme', 'language'])
    expect(isPortableSetting('theme')).toBe(true)
    expect(isPortableSetting('language')).toBe(true)
  })

  it.each([
    'anthropicApiKey',
    'openaiApiKey',
    'credentialCleanupPending',
    'embeddingModel',
    'watchedFolder',
    'windowState',
    'rerankEnabled',
    'rerankProvider',
    'rerankModel:anthropic',
    'rerankModel:openai',
    'rerankConsent:anthropic:claude-sonnet-5',
    'rerankConsent:openai:gpt-4o-mini',
    'claudeRerankConsent',
    'futureSetting'
  ])(
    'excludes %s',
    (key) => {
      expect(isPortableSetting(key)).toBe(false)
    }
  )
})
