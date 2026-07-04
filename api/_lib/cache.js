// cache.js — 内存缓存（Vercel Serverless 适配）
//
// ⚠ 重要：Vercel Serverless Functions 是无状态的，每次冷启动会重置内存。
// 同一函数实例在热状态下会复用此缓存（短时间内多次请求有效），
// 但不能依赖它做持久化存储。
//
// 生产环境建议替换为：
//   - Vercel KV (Redis):  https://vercel.com/docs/storage/vercel-kv
//   - Upstash Redis:      免费层够用，全球边缘
//
// 替换示例（Vercel KV）:
//   import { kv } from '@vercel/kv';
//   get: async (k) => await kv.get(k)
//   set: async (k, v, ttl) => await kv.set(k, v, { ex: ttl })

const store = new Map();

const cache = {
  get(key) {
    const entry = store.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiry) { store.delete(key); return null; }
    return entry.value;
  },
  set(key, value, ttlSeconds = 3600) {
    store.set(key, { value, expiry: Date.now() + ttlSeconds * 1000 });
  },
  delete(key) { store.delete(key); },
  clear() { store.clear(); },
  stats() {
    let valid = 0, expired = 0; const now = Date.now();
    for (const [, v] of store) { if (now > v.expiry) expired++; else valid++; }
    return { valid, expired, total: store.size };
  },
};

module.exports = { cache };
