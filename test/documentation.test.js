import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const deliverables = [
  'docs/architecture.md',
  'docs/technology-decisions.md',
  'docs/failure-modes.md',
  'docs/observability-rollback.md'
];

test('scale-design deliverables contain required decisions and plans', () => {
  for (const file of deliverables) assert.equal(existsSync(path.join(root, file)), true, `${file} must exist`);

  const architecture = readFileSync(path.join(root, deliverables[0]), 'utf8');
  assert.match(architecture, /```mermaid[\s\S]+```/);
  assert.match(architecture, /## Queueing, capacity, and backpressure/);
  assert.match(architecture, /## Where state lives/);
  assert.match(architecture, /p95 under 300 ms/);

  const decisions = readFileSync(path.join(root, deliverables[1]), 'utf8');
  assert.match(decisions, /## ADR-001/);
  assert.match(decisions, /Rejected alternative/g);

  const failures = readFileSync(path.join(root, deliverables[2]), 'utf8');
  assert.equal((failures.match(/^## \d\./gm) || []).length, 3, 'exactly three primary failure modes are required');

  const operations = readFileSync(path.join(root, deliverables[3]), 'utf8');
  assert.match(operations, /## Alerts/);
  assert.match(operations, /## Rollback runbook/);
});

test('relative Markdown links resolve to repository files', () => {
  for (const relativeFile of ['README.md', ...deliverables]) {
    const absoluteFile = path.join(root, relativeFile);
    const markdown = readFileSync(absoluteFile, 'utf8');
    for (const match of markdown.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
      const target = match[1].split('#')[0];
      if (!target || /^(?:https?:|mailto:)/.test(target)) continue;
      const resolved = path.resolve(path.dirname(absoluteFile), decodeURIComponent(target));
      assert.equal(existsSync(resolved), true, `${relativeFile} links to missing ${target}`);
    }
  }
});
