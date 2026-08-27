# Evaluation corpus

Measures whether the app ranks the *right* candidates, not just quickly. The
capacity benchmark (`npm run bench`) already covers speed; this covers quality.

## Where the files go

Drop the generated resumes into `eval/corpus/`. That directory is gitignored,
deliberately: the repo is public, and this is also where real resumes would land
if anyone ever evaluated against genuine applications.

## Filename convention

```
t<tier>_<nn>_<firstname>_<lastname>.docx
```

for example `t1_03_hannah_reid.docx`. The leading tier is the ground truth — how
well that candidate genuinely fits the posting being tested:

| Tier | Expected | Meaning |
|---|---|---|
| t1 | top 3 | Hits nearly every requirement |
| t2 | shortlist | Most requirements, missing one or two |
| t3 | ranked low | Same profession, wrong specialisation or seniority |
| t4 | ranked lowest | Adjacent profession; distractors |

The tier is safe to encode in the filename because **nothing in ranking reads
it**. FTS5 indexes only `raw_text`, and the scorer sees chunk embeddings,
`raw_text`, and extracted skills; `file_name` never reaches
`src/main/search/rank.ts`. It is carried through purely so results can be graded.

The same must be true of the resume text itself: if a document says "ideal
candidate" or otherwise states its own tier, that phrasing feeds the embedding
and the measurement is void.

## The posting

Save the job description the corpus was built against as `eval/posting.txt`,
verbatim, including messy formatting. Cleaning it up would strip exactly the
noise a real posting carries.
