/**
 * Tiny guarded key-value access for the reward modules. Every read and
 * write survives a missing or throwing localStorage (private mode, tests),
 * and the store is injectable so the pure logic is tested with a fake.
 */
export interface KV {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** The page's localStorage, or null where there is none (node tests). */
export function defaultKV(): KV | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/** Parsed JSON at key, or fallback when missing, unreadable or blocked. */
export function readJson<T>(key: string, fallback: T, kv: KV | null = defaultKV()): T {
  try {
    const raw = kv?.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function writeJson(key: string, value: unknown, kv: KV | null = defaultKV()): void {
  try {
    kv?.setItem(key, JSON.stringify(value));
  } catch {
    // storage full or blocked: progress just won't persist
  }
}

/** An in-memory KV (tests, or a fallback when storage is blocked). */
export function memoryKV(seed: Record<string, string> = {}): KV & { data: Record<string, string> } {
  const data = { ...seed };
  return {
    data,
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => {
      data[k] = v;
    },
  };
}
