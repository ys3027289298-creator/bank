/**
 * 稳定哈希：同一 configId + userId 永远得到相同的 0-99 桶号。
 * 使用 FNV-1a，保证跨刷新、跨窗口结果一致。
 */
export function bucketOf(configId: string, userId: string): number {
  const input = `${configId}::${userId}`;
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) % 100;
}
