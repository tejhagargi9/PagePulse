import { AppError } from './errors.js';

export class ConcurrencyLimiter {
  constructor(limit, maxQueueSize) {
    this.limit = limit;
    this.maxQueueSize = maxQueueSize;
    this.active = 0;
    this.queue = [];
  }

  async run(task) {
    if (this.active >= this.limit) {
      if (this.queue.length >= this.maxQueueSize) {
        throw new AppError(503, 'AUDIT_CAPACITY_EXCEEDED', 'Audit capacity is currently exhausted');
      }
      await new Promise(resolve => this.queue.push(resolve));
    }
    this.active++;
    try { return await task(); }
    finally {
      this.active--;
      this.queue.shift()?.();
    }
  }
}

export class RateLimiter {
  constructor({ max, windowMs, now = Date.now }) {
    this.max = max;
    this.windowMs = windowMs;
    this.now = now;
    this.clients = new Map();
  }

  consume(key) {
    const now = this.now();
    let entry = this.clients.get(key);
    if (!entry || entry.resetAt <= now) entry = { count: 0, resetAt: now + this.windowMs };
    entry.count++;
    this.clients.set(key, entry);
    if (this.clients.size > 10_000) {
      for (const [client, value] of this.clients) if (value.resetAt <= now) this.clients.delete(client);
    }
    return { allowed: entry.count <= this.max, remaining: Math.max(0, this.max - entry.count), resetAt: entry.resetAt };
  }
}
