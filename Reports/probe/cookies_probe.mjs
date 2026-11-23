// Шаг 1а — вспомогательная проба: какие куки ChatGPT/OpenAI есть в профиле браузера.
// Только чтение скопированных копий базы куки. Ничего не отправляет в сеть.
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

const dir = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const dbPath = process.argv[2];
const keyHex = process.argv[3] ? fs.readFileSync(process.argv[3], 'utf8').trim() : null;

const db = new DatabaseSync(dbPath, { readOnly: true });
const rows = db
  .prepare(
    `SELECT host, name, path, is_secure, expires_utc, length(encrypted_value) AS len, encrypted_value
     FROM cookies '%chatgpt%' OR host LIKE '%openai%' OR host LIKE '%oaistatic%' OR host LIKE '%oaiusercontent%'
     ORDER BY host, name`,
  )
  .all();

console.log(`cookies rows: ${rows.length}`);
const cryptoMod = keyHex ? (await import('node:crypto')).default : null;

function decrypt(buf, key) {
  if (!buf || !key) return null;
  const v = Buffer.from(buf);
  if (v.length < 3) return null;
  const prefix = v.subarray(0, 3).toString('latin1');
  if (prefix !== 'v10' && prefix !== 'v11' && prefix !== 'v20') return `<raw:${v.length}>`;
  const nonce = v.subarray(3, 15);
  const tag = v.subarray(v.length - 16);
  const data = v.subarray(15, v.length - 16);
  const d = cryptoMod.createDecipheriv('aes-256-gcm', Buffer.from(key, 'hex'), nonce);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(data), d.final()]).toString('utf8');
}

for (const r of rows) {
  const exp = r.expires_utc
    ? new Date((Number(r.expires_utc) / 1000000 - 11644473600) * 1000).toISOString()
    : 'session';
  const val = keyHex ? decrypt(r.encrypted_value, keyHex) : null;
  console.log(
    [
      r.host,
      r.name,
      `path=${r.path}`,
      `secure=${r.is_secure}`,
      `expires=${exp}`,
      `len=${r.len}`,
      val ? `value_head=${String(val).slice(0, 18)}…` : '',
    ].join('  '),
  );
}
db.close();

