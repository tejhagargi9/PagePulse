export class TtlLruCache {
  constructor({ ttlMs, maxEntries, now = Date.now }) {
    this.ttlMs = ttlMs;
    this.maxEntries = maxEntries;
    this.now = now;
    this.items = new Map();
  }

  get(key) {
    const entry = this.items.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= this.now()) {
      this.items.delete(key);
      return undefined;
    }
    this.items.delete(key);
    this.items.set(key, entry);
    return entry.value;
  }

  set(key, value) {
    this.items.delete(key);
    this.items.set(key, { value, expiresAt: this.now() + this.ttlMs });
    while (this.items.size > this.maxEntries) this.items.delete(this.items.keys().next().value);
  }

  clear() { this.items.clear(); }
}
