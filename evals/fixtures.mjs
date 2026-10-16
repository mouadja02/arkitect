// What the eval scaffolds build their fixtures with: the real CLI, from the
// checkout the suite runs against, so a fixture is what Arkitect writes today
// rather than a copy that drifts from it. Each case that needs one keeps a
// fixture.mjs beside its case.yaml. Its scaffold.sh runs it, and
// tests/toolkit.mjs imports it to check the case's graders against the very
// files a run starts from (#415).

import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// `arkitect <args>` from this checkout, in `cwd`; its stdout, or a throw that
// says what failed.
export function arkitect(args, cwd) {
  const r = spawnSync(process.execPath, [join(ROOT, 'bin', 'arkitect.mjs'), ...args],
    { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) {
    throw new Error(`arkitect ${args.join(' ')} exited ${r.status}: ${(r.stderr || r.stdout || '').trim().slice(0, 400)}`);
  }
  return r.stdout;
}

// Builds `spec` to `out`, relative to `cwd`, with the house style (an applied
// style override must not change a fixture), and leaves no spec file behind:
// the only copy is the one the built file carries.
export function buildFixture(engine, spec, out, cwd, extra = []) {
  mkdirSync(join(cwd, dirname(out)), { recursive: true });
  const tmp = join(cwd, dirname(out), `.fixture-${process.pid}.spec.json`);
  writeFileSync(tmp, JSON.stringify(spec, null, 2));
  try {
    arkitect([engine, 'build', tmp, '--out', out, '--defaults', ...extra], cwd);
  } finally {
    rmSync(tmp, { force: true });
  }
}

// Writes `files`, { relative path: text }, under `cwd`.
export function writeFixture(files, cwd) {
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(join(cwd, dirname(rel)), { recursive: true });
    writeFileSync(join(cwd, rel), text);
  }
}

// Runs a fixture module's make() in the working directory when node was given
// that module, which is what a scaffold does.
export function runAsScript(meta, make) {
  if (process.argv[1] && pathToFileURL(process.argv[1]).href === meta.url) make(process.cwd());
}
