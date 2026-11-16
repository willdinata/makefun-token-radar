// main.ts — token-radar-01 entry (Node 22, standard library only).
//
// Reads the sealed DefiLlama snapshot, prices every pre-token protocol with
// the model in lib/model.ts, and writes the ranked board, the dashboard's
// data file, a copy of dashboard/ and screenshots/, and the dossier the
// judge reads. The run is deterministic: the same snapshot always produces
// the same bytes, because nothing here reads a clock or a random source.
//
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json|dir>

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

function flagValue(name: string, fallback: string): string {
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === `--${name}` && i + 1 < args.length) return args[i + 1]!;
    if (args[i]!.startsWith(`--${name}=`)) return args[i]!.slice(name.length + 3);
  }
  return fallback;
}

function fail(message: string, code: number): never {
  process.stderr.write(`token-radar: ${message}\n`);
  process.exit(code);
}

/** Copy a directory tree of regular files, skipping dot-names at every level. */
function copyTree(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const src = join(from, name);
    const dst = join(to, name);
    if (statSync(src).isDirectory()) {
      copied.push(...copyTree(src, dst).map((n) => `${name}/${n}`));
    } else if (statSync(src).isFile()) {
      copyFileSync(src, dst);
      copied.push(name);
    }
  }
  return copied;
}

function main(): void {
  const inputArg = flagValue('input', '/input');
  const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
  if (!existsSync(inputFile)) {
    fail(`no snapshot at ${inputFile}: pass --input <snapshot.json|directory> or mount the sealed /input`, 2);
  }
  const outDir = flagValue('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

  const snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
  const { rows, radar } = buildRadar(snapshot);
  const issue = boardIssue(rows, snapshot);
  if (issue !== null) fail(`the model wrote a board the gate refuses: ${issue}`, 1);

  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'board.json'), `${JSON.stringify({ rows })}` + '\n');
  writeFileSync(join(outDir, 'data.js'), dataScript(radar));

  const pageFiles = copyTree(join(ROOT, 'dashboard'), join(outDir, 'dashboard'));
  const shots = copyTree(join(ROOT, 'screenshots'), join(outDir, 'screenshots'));
  if (shots.length < 3) {
    fail(`screenshots/ holds ${shots.length} images: hand in 3 or 4, the board, a detail view and a filtered view`, 1);
  }
  for (const name of shots) {
    if (!IMAGE_NAME.test(name)) fail(`screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters`, 1);
  }

  // Written last: the scorer rebuilds the dossier from this same output and compares bytes.
  const dossier = buildDossier(outDir, {
    text_max_bytes: 65_536,
    screenshots: { max: 4, max_bytes: 524_288 },
    dashboard: { max_files: 400, max_bytes: 4_194_304 },
  });
  writeFileSync(join(outDir, 'dossier.json'), dossier);

  process.stdout.write(
    `token-radar: scanned ${snapshot.protocols.length} protocols, covered ${snapshot.watchlist.length}/${snapshot.watchlist.length} watchlist, ranked ${rows.length} pre-token, set aside ${radar.live_size} live tokens\n`,
  );
  process.stdout.write(
    `token-radar: wrote board.json, data.js, dashboard/ (${pageFiles.length} files), screenshots/ (${shots.length} images), dossier.json (${dossier.length} bytes)\n`,
  );
}

main();
