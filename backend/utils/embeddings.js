let pipeline;

// Dynamic import for transformers since xenova might have ESM exports
async function getPipeline() {
  if (!pipeline) {
    const { pipeline: transformerPipeline, env } = await import('@xenova/transformers');
    // For local Hackathon use, we can allow fetching from huggingface, but disable local cache to avoid write errors if needed
    env.allowLocalModels = false;
    pipeline = await transformerPipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', { quantized: true });
  }
  return pipeline;
}

async function getEmbedding(text) {
  const extractor = await getPipeline();
  // Output format: Tensor [1, num_tokens, 384]; we mean pool it or just use the pooled output
  const output = await extractor(text, { pooling: 'mean', normalize: true });
  return Array.from(output.data);
}

function cosineSimilarity(vecA, vecB) {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

module.exports = { getEmbedding, cosineSimilarity };
