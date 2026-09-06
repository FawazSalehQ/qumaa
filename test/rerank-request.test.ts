import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MatchResult } from '../src/shared/types.js'

const mocks = vi.hoisted(() => ({
  constructorOptions: undefined as unknown,
  parse: vi.fn()
}))

vi.mock('@anthropic-ai/sdk', () => ({
  default: class AnthropicMock {
    messages = { parse: mocks.parse }

    constructor(options: unknown) {
      mocks.constructorOptions = options
    }
  }
}))

import { rerank } from '../src/main/search/rerank.js'
import { buildRerankPreview } from '../src/main/search/rerankPrivacy.js'

function candidate(id: number, name: string): MatchResult {
  return {
    resume: {
      id,
      recordKey: id.toString(16).padStart(64, '0'),
      fileName: `${name}.pdf`,
      filePath: `/Users/private/${name}.pdf`,
      importedAt: id,
      name,
      email: `${name.toLowerCase()}@example.com`,
      phone: '+1 415 555 0123',
      location: 'San Francisco, CA',
      yearsExperience: id,
      educationLevel: 'bachelors',
      skills: ['TypeScript']
    },
    score: 1 - id / 100,
    breakdown: { semantic: 0.8, lexical: 0.6, skills: 1 },
    matchedSkills: ['TypeScript'],
    missingSkills: [],
    evidence: [
      {
        section: 'experience',
        similarity: 0.9,
        text: `${name} (${name.toLowerCase()}@example.com) led the migration in San Francisco, CA.`
      }
    ]
  }
}

beforeEach(() => {
  mocks.constructorOptions = undefined
  mocks.parse.mockReset()
})

describe('Claude rerank request', () => {
  it('sends exactly the previewed body and maps opaque ids back to local ordering', async () => {
    const results = [candidate(1, 'Alice Private'), candidate(2, 'Bob Private')]
    const preview = buildRerankPreview('Platform engineer', results)
    mocks.parse.mockResolvedValue({
      parsed_output: {
        ranking: [
          { id: 'candidate-02', rank: 1, reason: 'Led the more relevant migration.' },
          { id: 'candidate-01', rank: 2, reason: 'Relevant TypeScript experience.' }
        ]
      }
    })

    const ordered = await rerank({
      apiKey: 'sk-ant-api03-test-only',
      jobDescription: 'Platform engineer',
      results
    })

    expect(mocks.constructorOptions).toEqual({
      apiKey: 'sk-ant-api03-test-only',
      baseURL: 'https://api.anthropic.com',
      logLevel: 'off',
      fetchOptions: { redirect: 'error' }
    })
    const capturedBody = JSON.parse(JSON.stringify(mocks.parse.mock.calls[0][0]))
    expect(capturedBody).toEqual(preview.requestBody)
    expect(JSON.parse(capturedBody.messages[0].content).jobPosting).toBe('Platform engineer')
    const serialized = JSON.stringify(capturedBody)
    expect(serialized).not.toContain('Alice Private')
    expect(serialized).not.toContain('Bob Private')
    expect(serialized).not.toContain('alice private@example.com')
    expect(serialized).not.toContain('/Users/private')
    expect(serialized).not.toContain('sk-ant-api03-test-only')
    expect(ordered.map((result) => result.resume.id)).toEqual([2, 1])
    expect(ordered[0].llmReason).toBe('Led the more relevant migration.')
  })

  it('ignores environment endpoint and logging overrides', async () => {
    vi.stubEnv('ANTHROPIC_BASE_URL', 'https://attacker.invalid')
    vi.stubEnv('ANTHROPIC_LOG', 'debug')
    const results = [candidate(1, 'Alice'), candidate(2, 'Bob')]
    mocks.parse.mockResolvedValue({
      parsed_output: {
        ranking: [
          { id: 'candidate-01', rank: 1, reason: 'Relevant.' },
          { id: 'candidate-02', rank: 2, reason: 'Relevant.' }
        ]
      }
    })

    await rerank({ apiKey: 'test', jobDescription: 'Engineer', results })

    expect(mocks.constructorOptions).toMatchObject({
      baseURL: 'https://api.anthropic.com',
      logLevel: 'off',
      fetchOptions: { redirect: 'error' }
    })
    vi.unstubAllEnvs()
  })

  it('ignores invented opaque ids and preserves omitted candidates locally', async () => {
    const results = [candidate(1, 'Alice'), candidate(2, 'Bob'), candidate(3, 'Carol')]
    mocks.parse.mockResolvedValue({
      parsed_output: {
        ranking: [
          { id: 'candidate-03', rank: 1, reason: 'Most relevant.' },
          { id: 'candidate-99', rank: 2, reason: 'Invented.' }
        ]
      }
    })

    const ordered = await rerank({ apiKey: 'test', jobDescription: 'Engineer', results })
    expect(ordered.map((result) => result.resume.id)).toEqual([3, 1, 2])
  })

  it('does not contact Anthropic for fewer than two candidates', async () => {
    const results = [candidate(1, 'Alice')]
    await expect(rerank({ apiKey: 'test', jobDescription: 'Engineer', results })).resolves.toBe(
      results
    )
    expect(mocks.parse).not.toHaveBeenCalled()
  })
})
