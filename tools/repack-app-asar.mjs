/**
 * Repack DeepSeek Harness's resources/app.asar with a One Commander entry in
 * the "open with" menu.
 *
 * Two members are edited and every other byte is copied through untouched:
 *
 *   1. dsh-host-open-in-app/lib/index.js — the rollup bundle that the host
 *      actually runs (package.json "main"). It inlines the app catalog, so the
 *      entry goes into its `OPEN_IN_APP_CATALOG` array. The package's
 *      lib/types/catalog.js is the unbundled source, never executed at runtime.
 *   2. dsh-client-ui-open-in-app/lib/client.js — the browser bundle the client
 *      loader serves. It drops any app id missing from `APP_LABEL_KEY`, so the
 *      id and its display name must land here too.
 *
 * Both members grow a few hundred bytes, so every member offset and per-file
 * SHA256 in the archive header is rebuilt.
 *
 *   node repack-app-asar.mjs --status [--asar <path>]
 *   node repack-app-asar.mjs --proof  [--asar <path>]
 *   node repack-app-asar.mjs --out <file> [--asar <path>]
 *
 * --status  report per-member state, plus `pristine` / `menuReady`
 * --proof   rebuild with no edits and require a byte-identical archive
 * --out     write the patched archive to <file>
 *
 * Exit code 0 on success; throws (non-zero) on any expectation mismatch.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const DEFAULT_ASAR = path.join(
  process.env.LOCALAPPDATA ?? 'C:\\Users\\Default\\AppData\\Local',
  'Programs',
  'DeepSeek Harness',
  'resources',
  'app.asar',
);
const BLOCK = 4_194_304;

// The host package ships a rollup bundle (lib/index.js, package.json "main")
// that INLINES the catalog — lib/types/catalog.js is the unbundled source and
// never executes. Patching only the latter is a no-op: that was the first
// attempt's bug. The live member is index.js.
const HOST_BUNDLE = 'dsh/node_modules/@deepseek-ai/dsh-host-open-in-app/lib/index.js';
const CLIENT_BUNDLE = 'dsh/node_modules/@deepseek-ai/dsh-client-ui-open-in-app/lib/client.js';

/** Explorer's entry in the bundled (tab-indented, double-quoted) catalog. */
const hostAnchor = [
  '\t{',
  '\t\tid: "explorer",',
  '\t\tplatforms: { win32: spec({',
  '\t\t\tkind: "fixed",',
  '\t\t\tlaunch: { kind: "shell-open" },',
  '\t\t\ticonPath: "${SystemRoot}/explorer.exe"',
  '\t\t}) }',
  '\t},',
  '',
].join('\n');

const hostAddition = `${hostAnchor}\t{
\t\tid: "onecommander",
\t\tplatforms: { win32: spec(file(["${'${'}ProgramFiles}/OneCommander/OneCommander.exe", "${'${'}ProgramFiles(x86)}/OneCommander/OneCommander.exe", "${'${'}LOCALAPPDATA}/Programs/OneCommander/OneCommander.exe"])) }
\t},
`;

const PATCHES = [
  { file: HOST_BUNDLE, marker: 'id: "onecommander"', edits: [{ find: hostAnchor, replace: hostAddition }] },
  {
    file: CLIENT_BUNDLE,
    marker: 'onecommander: "app.onecommander"',
    edits: [
      {
        find: '\t\t\texplorer: "app.explorer",\n',
        replace: '\t\t\texplorer: "app.explorer",\n\t\t\tonecommander: "app.onecommander",\n',
      },
      {
        find: '\t\t\t"app.zed": "Zed",\n',
        replace: '\t\t\t"app.zed": "Zed",\n\t\t\t"app.onecommander": "One Commander",\n',
      },
    ],
  },
];

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

function integrity(buf) {
  const blocks = [];
  for (let off = 0; off < buf.length; off += BLOCK) {
    blocks.push(sha256(buf.subarray(off, Math.min(off + BLOCK, buf.length))));
  }
  return { algorithm: 'SHA256', hash: sha256(buf), blockSize: BLOCK, blocks };
}

function openArchive(asar) {
  const fd = fs.openSync(asar, 'r');
  const prefix = Buffer.alloc(16);
  fs.readSync(fd, prefix, 0, 16, 0);
  const outer = prefix.readUInt32LE(4);
  const jsonLen = prefix.readUInt32LE(12);
  const headerTotal = 8 + outer;
  const head = Buffer.alloc(headerTotal);
  fs.readSync(fd, head, 0, head.length, 0);
  const header = JSON.parse(head.subarray(16, 16 + jsonLen).toString('utf8'));

  const members = [];
  (function walk(node, dir) {
    for (const [name, entry] of Object.entries(node.files || {})) {
      const full = dir ? `${dir}/${name}` : name;
      if (entry.files) { walk(entry, full); continue; }
      members.push({
        path: full,
        entry,
        unpacked: entry.unpacked === true,
        origOffset: entry.offset === undefined ? null : Number(entry.offset),
        origSize: Number(entry.size),
      });
    }
  })(header, '');

  return { fd, header, members, headerTotal };
}

function readMember(handle, member) {
  const buf = Buffer.alloc(member.origSize);
  fs.readSync(handle.fd, buf, 0, buf.length, handle.headerTotal + member.origOffset);
  return buf;
}

function main() {
  const argv = process.argv.slice(2);
  const mode = argv.find((a) => a === '--status' || a === '--proof' || a === '--out');
  const asarAt = argv.indexOf('--asar');
  const asar = asarAt === -1 ? DEFAULT_ASAR : argv[asarAt + 1];
  if (!mode) throw new Error('pass --status, --proof, or --out <file>');
  if (!fs.existsSync(asar)) throw new Error(`no archive at ${asar}`);

  const handle = openArchive(asar);
  try {
    if (mode === '--status') {
      const report = { asar, bytes: fs.statSync(asar).size, members: handle.members.length, files: {} };
      for (const patch of PATCHES) {
        const member = handle.members.find((m) => m.path === patch.file);
        if (!member) { report.files[patch.file] = 'missing'; continue; }
        const text = readMember(handle, member).toString('utf8');
        const anchors = patch.edits.map((e) => text.split(e.find).length - 1);
        report.files[patch.file] = {
          patched: text.includes(patch.marker),
          anchorHits: anchors,
          state: text.includes(patch.marker) ? 'patched' : anchors.every((n) => n === 1) ? 'pristine' : 'unrecognised',
        };
      }
      report.menuReady = PATCHES.every((p) => report.files[p.file] && report.files[p.file].patched);
      report.pristine = PATCHES.every((p) => report.files[p.file] && report.files[p.file].state === 'pristine');
      console.log(JSON.stringify(report, null, 2));
      return;
    }

    const proof = mode === '--proof';
    const out = mode === '--out' ? argv[argv.indexOf('--out') + 1] : null;
    if (!proof && !out) throw new Error('--out needs a target path');

    const replaced = new Map();
    if (!proof) {
      for (const patch of PATCHES) {
        const member = handle.members.find((m) => m.path === patch.file);
        if (!member) throw new Error(`missing archive member: ${patch.file}`);
        let text = readMember(handle, member).toString('utf8');
        for (const edit of patch.edits) {
          const hits = text.split(edit.find).length - 1;
          if (hits !== 1) throw new Error(`${patch.file}: anchor matched ${hits} times (already patched?)`);
          text = text.replace(edit.find, () => edit.replace);
        }
        replaced.set(patch.file, Buffer.from(text, 'utf8'));
        console.log(`patched ${patch.file}: ${member.origSize} -> ${replaced.get(patch.file).length} bytes`);
      }
    }

    // Header rebuild: same member order, new sizes/offsets, new integrity.
    let dataSize = 0;
    for (const m of handle.members) {
      if (m.unpacked) { delete m.entry.offset; continue; }
      const over = replaced.get(m.path);
      if (over) {
        m.entry.size = over.length;
        m.entry.integrity = integrity(over);
      }
      m.entry.offset = String(dataSize);
      dataSize += Number(m.entry.size);
    }

    // Archive framing measured from the installed file: a nested Chromium
    // Pickle header padded to 8 bytes —
    //   u32 4 | u32 (total - 8) | u32 (total - 12) | u32 jsonLen | json | pad
    const jsonBytes = Buffer.from(JSON.stringify(handle.header), 'utf8');
    const total = Math.ceil((16 + jsonBytes.length) / 8) * 8;
    const frame = Buffer.alloc(total);
    frame.writeUInt32LE(4, 0);
    frame.writeUInt32LE(total - 8, 4);
    frame.writeUInt32LE(total - 12, 8);
    frame.writeUInt32LE(jsonBytes.length, 12);
    jsonBytes.copy(frame, 16);

    const target = out ?? path.join(process.env.TEMP ?? '.', 'app.asar.rebuilt');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const wfd = fs.openSync(target, 'w');
    fs.writeSync(wfd, frame, 0, frame.length, 0);

    let writePos = total;
    const reader = Buffer.alloc(BLOCK);
    for (const m of handle.members) {
      if (m.unpacked) continue;
      const over = replaced.get(m.path);
      if (over) {
        fs.writeSync(wfd, over, 0, over.length, writePos);
        writePos += over.length;
        continue;
      }
      let remaining = m.origSize;
      let from = handle.headerTotal + m.origOffset;
      while (remaining > 0) {
        const take = Math.min(remaining, reader.length);
        fs.readSync(handle.fd, reader, 0, take, from);
        fs.writeSync(wfd, reader, 0, take, writePos);
        writePos += take;
        from += take;
        remaining -= take;
      }
    }
    fs.closeSync(wfd);
    if (writePos !== dataSize + total) throw new Error('internal: written size mismatch');

    const identical = proof ? sha256(fs.readFileSync(target)) === sha256(fs.readFileSync(asar)) : null;
    console.log(JSON.stringify({ target, originalSize: fs.statSync(asar).size, rebuiltSize: writePos, identical }, null, 2));
    if (proof && !identical) throw new Error('proof failed: the rebuilt archive differs from the original');
  } finally {
    fs.closeSync(handle.fd);
  }
}

main();
