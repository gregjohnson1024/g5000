import { SerialPort } from 'serialport';

const path = process.argv[2] ?? '/dev/cu.usbserial-38D76';
const baud = Number(process.argv[3] ?? 38400);
const ms = Number(process.argv[4] ?? 3000);

const port = new SerialPort({ path, baudRate: baud, autoOpen: false });
const chunks = [];

await new Promise((resolve, reject) => port.open((err) => (err ? reject(err) : resolve())));
port.on('data', (b) => chunks.push(b));

await new Promise((r) => setTimeout(r, ms));
await new Promise((r) => port.close(() => r()));

const buf = Buffer.concat(chunks);
const text = buf.toString('utf8');
const lines = text.split(/\r?\n/).filter((s) => s.length);
const sentences = lines.filter((l) => /^[!$][A-Z]{2,5},/.test(l));

console.log(
  `baud=${baud} bytes=${buf.length} lines=${lines.length} valid_sentences=${sentences.length}`,
);
console.log('--- first 5 lines (raw) ---');
for (const l of lines.slice(0, 5)) console.log(JSON.stringify(l));
console.log('--- first 200 bytes (hex) ---');
console.log(buf.subarray(0, 200).toString('hex'));
