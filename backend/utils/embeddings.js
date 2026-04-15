let pipeline;

// ----------------------------------------------------------------
// Pipeline singleton — dynamic import for ESM compat
// ----------------------------------------------------------------
async function getPipeline() {
  if (!pipeline) {
    const { pipeline: transformerPipeline, env } = await import('@xenova/transformers');
    env.allowLocalModels = false;
    pipeline = await transformerPipeline(
      'feature-extraction',
      'Xenova/all-MiniLM-L6-v2',
      { quantized: true }
    );
  }
  return pipeline;
}

/**
 * Warm up the embedding model on startup so the first real request
 * doesn't pay the cold-start penalty (~3-5s).
 */
async function warmup() {
  console.log('Warming up embedding model...');
  try {
    await getPipeline();
    // Run a dummy inference to load ONNX weights fully
    await getEmbedding('warmup');
    console.log('✅  Embedding model ready.');
  } catch (err) {
    console.error('❌  Embedding warmup failed:', err.message);
    throw err;
  }
}

/**
 * Embed a single piece of text → 384-dim float array.
 */
async function getEmbedding(text) {
  try {
    const extractor = await getPipeline();
    const output = await extractor(text, { pooling: 'mean', normalize: true });
    return Array.from(output.data);
  } catch (err) {
    console.error('getEmbedding error:', err.message);
    throw err;
  }
}

/**
 * Split text into sentences and embed each one.
 * Returns an array of 384-dim vectors — one per chunk.
 * Used for the improved skill-match scoring.
 */
async function getChunkEmbeddings(text) {
  try {
    // Split on sentence boundaries; filter very short fragments
    const chunks = text
      .split(/(?<=[.!?\n])\s+/)
      .map(c => c.trim())
      .filter(c => c.length > 15);

    // Fall back to the whole text if we get nothing meaningful
    if (chunks.length === 0) return [await getEmbedding(text)];

    const embeddings = [];
    for (const chunk of chunks) {
      embeddings.push(await getEmbedding(chunk));
    }
    return embeddings;
  } catch (err) {
    console.error('getChunkEmbeddings error:', err.message);
    throw err;
  }
}

/**
 * Cosine similarity between two equal-length float arrays.
 */
function cosineSimilarity(vecA, vecB) {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < vecA.length; i++) {
    dot   += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Score a resume (represented as an array of chunk embeddings) against
 * an ordered list of job skill embeddings.
 *
 * For each required skill we find the best-matching resume chunk and
 * apply a graduated match score:
 *   ≥ 0.92  → 1.0  (exact / very close)
 *   ≥ 0.75  → 0.8  (similar skill)
 *   ≥ 0.60  → 0.4  (loosely related)
 *   < 0.60  → 0.0  (no match)
 *
 * Returns a normalized [0, 1] score.
 */
function scoreSkillMatch(resumeChunkEmbeddings, jobSkillEmbeddings) {
  if (!jobSkillEmbeddings || jobSkillEmbeddings.length === 0) return 0;

  let total = 0;
  for (const skillVec of jobSkillEmbeddings) {
    const maxSim = Math.max(
      ...resumeChunkEmbeddings.map(chunk => cosineSimilarity(chunk, skillVec))
    );
    if      (maxSim >= 0.92) total += 1.0;
    else if (maxSim >= 0.75) total += 0.8;
    else if (maxSim >= 0.60) total += 0.4;
    // else 0
  }
  return total / jobSkillEmbeddings.length;
}

module.exports = { warmup, getEmbedding, getChunkEmbeddings, cosineSimilarity, scoreSkillMatch };
