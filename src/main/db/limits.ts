/** Stored-data bounds shared by ingest, validation and the recruiting contracts. Dependency-free so no module cycle can form. */
export const DATABASE_LIMITS = Object.freeze({
  resumes: 5_000,
  chunks: 100_000,
  chunksPerResume: 512,
  /** Longest believable career; parsed values above it are unknown, not clamped. */
  yearsExperience: 100,
  rawTextCharsPerResume: 500_000,
  totalRawTextChars: 250_000_000,
  chunkTextChars: 500_000,
  totalChunkTextChars: 400_000_000,
  filePathChars: 4_096,
  labelChars: 512,
  emailChars: 512,
  phoneChars: 128,
  skills: 512,
  skillChars: 256,
  skillsJsonChars: 150_000,
  skillsVersionChars: 512,
  settings: 128,
  settingKeyChars: 128,
  settingValueChars: 1_000_000
})
