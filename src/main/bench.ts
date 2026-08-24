/**
 * Capacity benchmark, run inside Electron via `npm run bench`.
 *
 * Measures the three things that decide how large a library the app can hold:
 * embedding throughput, the per-import near-duplicate scan, and search latency.
 * Uses a throwaway userData directory so it never touches the real library.
 */
import { app } from 'electron'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const scratch = mkdtempSync(join(tmpdir(), 'qumaa-bench-'))
app.setPath('userData', scratch)

const SIZES = [500, 1500, 3000]

/** Varied enough that chunking and skill extraction do realistic work. */
function syntheticResume(i: number): string {
  const roles = ['Backend Engineer', 'Data Engineer', 'Platform Engineer', 'SRE']
  const stacks = [
    'Go, Kubernetes, PostgreSQL, AWS, Terraform',
    'Python, FastAPI, PostgreSQL, Docker, Kafka',
    'Java, Spring, MySQL, Jenkins, Linux',
    'TypeScript, Node.js, MongoDB, Redis, GCP'
  ]
  const r = roles[i % roles.length]
  const s = stacks[i % stacks.length]
  return `Candidate Number ${i}
candidate${i}@example.com
+1 416 555 ${String(1000 + (i % 8999)).padStart(4, '0')}

SUMMARY
${r} with ${4 + (i % 12)} years building production systems at scale.

WORK EXPERIENCE
Company ${i} - Senior ${r}
Jan ${2014 + (i % 8)} - Dec ${2022 + (i % 3)}
Designed and operated distributed services handling ${i * 137} requests per second.
Led the migration of ${10 + (i % 40)} services onto managed infrastructure.
Owned schema design, query performance, and the on-call rotation for the team.
Reduced p99 latency by ${20 + (i % 60)} percent through caching and better sharding.

Built and maintained continuous delivery pipelines running thousands of builds daily.
Mentored engineers through code review and design review, raising the team's bar.
Partnered with product to scope work and to sequence delivery across quarters.
Introduced service level objectives, dashboards, and alerting for critical paths.

Earlier Company ${i} - ${r}
Jun ${2010 + (i % 4)} - Dec ${2013 + (i % 4)}
Built internal tooling and REST APIs used across ${3 + (i % 20)} teams.
Migrated legacy batch jobs onto a scheduled, observable, and retryable platform.
Wrote integration tests and load tests that caught regressions before release.
Handled incident response, wrote postmortems, and drove the follow-up actions.
Worked with data engineers to model events and to keep the warehouse trustworthy.

EDUCATION
BSc Computer Science, ${2008 + (i % 10)}

TECHNICAL SKILLS
${s}`
}

function ms(start: bigint): number {
  return Number(process.hrtime.bigint() - start) / 1e6
}

async function main(): Promise<void> {
  const { getDb, stats } = await import('./db/index.js')
  const { embedder, setEntryDir } = await import('./embed/client.js')
  setEntryDir(__dirname)
  const { ingestText } = await import('./ingest/pipeline.js')
  const { search } = await import('./search/rank.js')
  const { documentVector, findNearDuplicate } = await import('./ingest/duplicates.js')

  getDb()
  await embedder.start()

  const JD = `Senior Backend Engineer

Requirements:
- Five or more years building production backend services
- Strong experience with Go or Python
- Deep familiarity with Kubernetes and containerised deployments
- Experience designing and operating PostgreSQL at scale`

  console.log('\nresumes  ingest/resume   dup-scan   search   chunks')
  console.log('------------------------------------------------------')

  let imported = 0
  for (const target of SIZES) {
    const t0 = process.hrtime.bigint()
    for (; imported < target; imported++) {
      await ingestText({
        text: syntheticResume(imported),
        fileName: `candidate-${imported}.txt`,
        filePath: '',
        fileType: 'pasted'
      })
    }
    const perResume = ms(t0) / (target - (SIZES[SIZES.indexOf(target) - 1] ?? 0))

    // Isolate the near-duplicate scan: it reads every chunk in the library.
    const [probe] = await embedder.embedPassages(['a probe passage for timing'])
    const t1 = process.hrtime.bigint()
    findNearDuplicate(documentVector([probe]))
    const dupMs = ms(t1)

    const t2 = process.hrtime.bigint()
    await search(JD)
    const searchMs = ms(t2)

    const st = stats()
    console.log(
      `${String(target).padStart(7)}  ${perResume.toFixed(0).padStart(9)} ms  ` +
        `${dupMs.toFixed(0).padStart(7)} ms  ${searchMs.toFixed(0).padStart(6)} ms  ` +
        `${String(st.chunkCount).padStart(6)}`
    )
  }

  const st = stats()
  console.log(`\nfinal: ${st.resumeCount} resumes, ${st.chunkCount} chunks, ` +
    `${(st.dbSizeBytes / 1e6).toFixed(1)} MB on disk`)
  console.log(`rss: ${(process.memoryUsage().rss / 1e6).toFixed(0)} MB`)
}

app.whenReady().then(async () => {
  try {
    await main()
  } catch (err) {
    console.error('BENCH FAILED:', err)
  } finally {
    rmSync(scratch, { recursive: true, force: true })
    app.exit(0)
  }
})
