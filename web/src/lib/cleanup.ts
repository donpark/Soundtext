// Delete every Cache Storage entry this origin created: the LiteRT model, the
// label embeddings, and transformers.js's Whisper cache. Not the in-memory
// engine, and not the browser's HTTP cache.
export async function clearAllCaches(): Promise<string[]> {
  if (typeof caches === "undefined") return [];
  const names = await caches.keys();
  await Promise.all(names.map((name) => caches.delete(name)));
  return names;
}
