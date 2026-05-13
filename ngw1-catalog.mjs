import { SerialPort } from 'serialport';

const path = process.argv[2] ?? '/dev/cu.usbserial-38D76';
const baud = Number(process.argv[3] ?? 115200);
const ms = Number(process.argv[4] ?? 15000);

const port = new SerialPort({ path, baudRate: baud, autoOpen: false });
const chunks = [];
await new Promise((resolve, reject) => port.open((err) => (err ? reject(err) : resolve())));
port.on('data', (b) => chunks.push(b));
await new Promise((r) => setTimeout(r, ms));
await new Promise((r) => port.close(() => r()));

const text = Buffer.concat(chunks).toString('utf8');
const lines = text.split(/\r?\n/).filter((s) => s.length);
const valid = lines.filter((l) => /^[!$][A-Z]{2,5},/.test(l));

const counts = new Map();
const samples = new Map();
for (const l of valid) {
  const m = l.match(/^([!$])([A-Z]{2})([A-Z]{2,3}),/);
  if (!m) continue;
  const tag = `${m[1]}${m[2]}${m[3]}`;
  counts.set(tag, (counts.get(tag) ?? 0) + 1);
  if (!samples.has(tag)) samples.set(tag, l);
}

console.log(`window_ms=${ms} valid=${valid.length} unique_tags=${counts.size}`);
console.log('tag       count   sample');
for (const [tag, n] of [...counts.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`${tag.padEnd(8)} ${String(n).padStart(5)}   ${samples.get(tag).slice(0, 96)}`);
}
