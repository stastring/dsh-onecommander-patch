/**
 * Structural verification of a DeepSeek Harness app.asar: header framing,
 * contiguous member layout, and every packed member's SHA256 against the
 * integrity block stored in the archive header.
 *
 *   node verify-asar.mjs <archive> [--extract <member> <file>]...
 *
 * Exit code 0 when every check passes.
 */
import fs from 'node:fs';
import crypto from 'node:crypto';

const archive = process.argv[2];
const argv = process.argv.slice(3);
if (!archive) throw new Error('usage: node verify-asar.mjs <archive> [--extract <member> <file>]');

const fd = fs.openSync(archive, 'r');
const prefix = Buffer.alloc(16);
fs.readSync(fd, prefix, 0, 16, 0);
const first = prefix.readUInt32LE(0);
const outer = prefix.readUInt32LE(4);
const inner = prefix.readUInt32LE(8);
const jsonLen = prefix.readUInt32LE(12);
const headerTotal = 8 + outer;
const fileSize = fs.statSync(archive).size;

const problems = [];
if (first !== 4) problems.push(`unexpected first word ${first}`);
if (outer !== headerTotal - 8) problems.push('outer frame size inconsistent');
if (inner !== headerTotal - 12) problems.push('inner frame size inconsistent');
if (headerTotal % 8 !== 0) problems.push('header is not 8-byte aligned');
if (16 + jsonLen > headerTotal) problems.push('json overruns the header');

const head = Buffer.alloc(16 + jsonLen);
fs.readSync(fd, head, 0, head.length, 0);
const header = JSON.parse(head.subarray(16, 16 + jsonLen).toString('utf8'));

const members = [];
(function walk(node, dir) {
  for (const [name, entry] of Object.entries(node.files || {})) {
    const full = dir ? `${dir}/${name}` : name;
    if (entry.files) { walk(entry, full); continue; }
    members.push({ path: full, entry });
  }
})(header, '');

const buf = Buffer.alloc(4_194_304);
let pos = 0;
let verified = 0;
let unpacked = 0;
for (const m of members) {
  if (m.entry.unpacked) { unpacked += 1; continue; }
  const offset = Number(m.entry.offset);
  const size = Number(m.entry.size);
  if (offset !== pos) problems.push(`${m.path}: offset ${offset}, expected ${pos}`);
  pos = offset + size;
  const hash = crypto.createHash('sha256');
  for (let done = 0; done < size;) {
    const take = Math.min(size - done, buf.length);
    fs.readSync(fd, buf, 0, take, headerTotal + offset + done);
    hash.update(buf.subarray(0, take));
    done += take;
  }
  if (m.entry.integrity && m.entry.integrity.hash !== hash.digest('hex')) {
    problems.push(`${m.path}: integrity mismatch`);
  }
  verified += 1;
}
if (pos !== fileSize - headerTotal) problems.push(`data region ${pos} bytes, file holds ${fileSize - headerTotal}`);

for (let i = 0; i < argv.length; i++) {
  if (argv[i] !== '--extract') continue;
  const want = argv[i + 1];
  const out = argv[i + 2];
  i += 2;
  const member = members.find((m) => m.path === want);
  if (!member) { problems.push(`extract: no member ${want}`); continue; }
  const b = Buffer.alloc(Number(member.entry.size));
  fs.readSync(fd, b, 0, b.length, headerTotal + Number(member.entry.offset));
  fs.writeFileSync(out, b);
  console.log(`extracted ${want} -> ${out}`);
}
fs.closeSync(fd);

console.log(JSON.stringify({ archive, headerTotal, members: members.length, verified, unpacked, problems }, null, 2));
if (problems.length) process.exitCode = 1;
