/**
 * Шаг 1а — исследование готового HTML-экспорта ACE на реальных файлах.
 *
 * Что делает:
 *  1. Берёт реальные оригиналы из хранилища StrawBerry (имя файла = sha256 байтов).
 *  2. Собирает объект разбора такого же вида, какой выдаёт ChatGPT-парсер ACE
 *     (data URI для картинок из API, внешние URL для картинок из DOM, заметки
 *     [Attached: имя] для документов).
 *  3. Прогоняет его через те же шаги, что и entrypoints/content.js для формата html:
 *     inlineConversationImages → applyAttachmentOption → HtmlFormatter.format.
 *  4. Достаёт из полученного HTML все <img>/<a>, декодирует base64, считает размер и
 *     sha256 и сверяет с оригиналами.
 *  5. Отдельно прогоняет результат через DOMPurify (как в браузере) и проверяет,
 *     остаются ли байты картинок после санитайзера.
 *
 * Ничего не меняет в ACE и StrawBerry: копирует нужные модули во временную папку.
 * Запуск: node probe/html_export_probe.mjs   (cwd = ace-fork)
 */
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const FORK = process.argv[2] || process.cwd();
const ATT = 'G:\\Strawberry\\attachments';
const OUT = path.resolve(process.argv[3] || 'probe');

const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

async function loadOriginal(rel) {
  const buf = await fs.readFile(path.join(ATT, rel));
  const name = path.basename(rel);
  const stem = name.split('.')[0];
  return {
    file: rel,
    bytes: buf,
    size: buf.length,
    sha256: sha(buf),
    // Имя файла в хранилище StrawBerry — это sha256 байтов; сверяем сразу.
    name_matches_sha: stem === sha(buf) || sha(buf).startsWith(stem),
    mime: path.extname(rel).toLowerCase() === '.jpg' ? 'image/jpeg' : null,
  };
}

// --- копии модулей ACE во временную папку (как в тестах ACE), но импорт по file:// URL
async function importFormatterModules() {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'se-html-probe-'));
  for (const sub of ['content/formatters', 'content/utils', 'content/lib']) {
    await fs.mkdir(path.join(tmp, sub), { recursive: true });
  }
  await fs.writeFile(path.join(tmp, 'package.json'), '{"type":"module"}');
  const files = [
    'content/formatters/base.js',
    'content/formatters/html.js',
    'content/utils/sanitizer.js',
    'content/utils/strip-attachments.js',
    'content/utils/strip-images.js',
    'content/utils/image-inliner.js',
    'content/lib/purify.es.js',
    'content/lib/assets.js',
  ];
  for (const f of files) {
    await fs.copyFile(path.join(FORK, f), path.join(tmp, f));
  }
  const url = (f) => pathToFileURL(path.join(tmp, f)).href;
  return {
    tmp,
    html: await import(url('content/formatters/html.js')),
    strip: await import(url('content/utils/strip-attachments.js')),
    stripImages: await import(url('content/utils/strip-images.js')),
    inliner: await import(url('content/utils/image-inliner.js')),
  };
}

const ORIG = {
  jpgA: 'chatgpt-6aaa1f50-0e78-83eb-8c01-9153effd07ea/6bf9354b85106302f1e75b33e490096be6c7d8351cc91363571496f9ee8b9368.jpg',
  jpgB: 'chatgpt-69beca28-ad34-8326-818a-dba8c39e883c/8b4f5fa78d410a5449f338cb12940da62bcd3f669880c69879e814c5d1e10fae.jpg',
  webp: 'chatgpt-67a47e8f-7be4-800d-b293-f6607dfa0ee6/10712152094af622fe6a23757359a7e70d0f72566757031eb491e85a467de00d.webp',
  py: 'chatgpt-6a955f43-2a48-83ed-ab8f-a4f00a4c114b/36a9744c674cf29d77d6517cd8719f16cf4089068710e658ff626279e654f9e4.py',
  json: 'chatgpt-6a422372-6368-83ea-b57d-380fa30c29e3/3f9c5f083768c2a70ae18a0d77b8673c8d7231bab2f548faa67cf2ed04ab1d2b.json',
};

// --- реальные внешние URL: одна и та же фотография в двух рендициях CDNs
const CDN_SMALL = 'https://images.unsplash.com/photo-1518791841217-8f162f1e1131?w=400';
const CDN_LARGE = 'https://images.unsplash.com/photo-1518791841217-8f162f1e1131?w=1600';
const DEAD_URL = 'https://chatgpt.com/backend-api/files/download/file_000000000000000000000000000000de';

async function main() {
  const orig = {};
  for (const [k, rel] of Object.entries(ORIG)) orig[k] = await loadOriginal(rel);

  const b64 = (o) => o.bytes.toString('base64');

  // Объект разбора в форме ChatGPT-парсера ACE (content/chatgpt.js formatApiResult).
  const conv = {
    title: 'Strawberry probe: HTML-экспорт ACE',
    url: 'https://chatgpt.com/c/6aaa1f50-0e78-83eb-8c01-9153effd07ea',
    metadata: {
      Source: 'ChatGPT',
      Date: new Date('2026-10-23T04:31:11').toLocaleString(),
      Link: 'https://chatgpt.com/c/6aaa1f50-0e78-83eb-8c01-9153effd07ea',
      Model: 'GPT-5',
      Method: 'Backend API',
    },
    messages: [
      {
        role: 'User',
        content: `Подбери схему по фото.\n\n![Image](data:image/jpeg;base64,${b64(orig.jpgA)})\n\n[Attached: 25598.jpg]`,
        timestamp: '23.10.2026 04:31',
      },
      {
        role: 'Assistant',
        content: `Принято.\n\n![Image](data:image/webp;base64,${b64(orig.webp)})`,
        timestamp: '23.10.2026 04:32',
      },
      {
        role: 'User',
        content: `Прилагаю файлы.\n\n[Attached: h3_text_validator.py, config.json, Younger_Lens_Availability_Guide.pdf]`,
        timestamp: '23.10.2026 04:35',
      },
      {
        role: 'Assistant',
        content: `Миниатюра из DOM: ![Image](${CDN_SMALL})\n\nПолный размер: ![Image](${CDN_LARGE})\n\nМёртвая ссылка: ![Image](${DEAD_URL})\n\nPDF как картинка: ![Image](https://chatgpt.com/backend-api/files/download/file_000000007c50722f9fb6ad9dc546a213)`,
        timestamp: '23.10.2026 04:36',
      },
      {
        role: 'User',
        content: `Ещё одно фото.\n\n![Image](data:image/jpeg;base64,${b64(orig.jpgB)})`,
        timestamp: '23.10.2026 04:40',
      },
    ],
  };

  const m = await importFormatterModules();

  // --- что реально удалось вытянуть из внешних URL (замер сети + лимит inliner 4 с)
  const fetchProbe = {};
  for (const u of [CDN_SMALL, CDN_LARGE, DEAD_URL]) {
    const t0 = Date.now();
    const du = await m.inliner.fetchUrlAsDataUri(u, 4000);
    fetchProbe[u] = {
      ms: Date.now() - t0,
      ok: Boolean(du),
      dataUriBytes: du ? Math.round(((du.length - du.indexOf(',') - 1) * 3) / 4) : null,
      mimeLabel: du ? du.slice(5, du.indexOf(';')) : null,
      sha256: du ? sha(Buffer.from(du.slice(du.indexOf(',') + 1), 'base64')) : null,
    };
  }

  // --- шаг 1: как content.js готовит html-экспорт
  await m.inliner.inlineConversationImages(conv);
  const convStrippedCopy = JSON.parse(JSON.stringify(conv));
  conv.messages.forEach((msg) => {
    msg.content = m.strip.applyAttachmentOption(msg, {
      includeAttachments: true,
      imagesStripped: false,
    });
  });

  const formatter = new m.html.HtmlFormatter();
  const html = await formatter.format(conv, { includeTimestamps: true, includeToc: true });
  await fs.writeFile(path.join(OUT, 'html_export_real.html'), html, 'utf8');

  // --- разбор результата
  const imgs = [...html.matchAll(/<img[^>]*?\ssrc="([^"]*)"[^>]*>/gi)].map((x) => x[1]);
  const links = [...html.matchAll(/<a[^>]*?\shref="([^"]*)"[^>]*>/gi)].map((x) => x[1]);
  const decoded = [];
  for (const src of imgs) {
    if (src.startsWith('data:')) {
      const comma = src.indexOf(',');
      const buf = Buffer.from(src.slice(comma + 1), 'base64');
      decoded.push({
        kind: 'data URI',
        mimeLabel: src.slice(5, src.indexOf(';')),
        bytes: buf.length,
        sha256: sha(buf),
        matches: Object.entries(orig).find(([, o]) => o.sha256 === sha(buf))?.[0] ?? null,
      });
    } else {
      decoded.push({ kind: 'внешний URL', url: src.slice(0, 110) });
    }
  }

  // Имена файлов-оригиналов и их байты в HTML
  const names = ['25598.jpg', 'h3_text_validator.py', 'config.json', 'Younger_Lens_Availability_Guide.pdf'];
  const nameFound = Object.fromEntries(names.map((n) => [n, html.includes(n)]));
  const docBytesFound = {
    py_first64_base64_in_html: html.includes(orig.py.bytes.subarray(0, 64).toString('base64')),
    json_head_in_html: html.includes(orig.json.bytes.subarray(0, 40).toString('utf8')),
  };

  // --- шаг 2: DOMPurify как в браузере (linkedom даёт window)
  let purifyPass = null;
  try {
    const require2 = createRequire(path.join(FORK, 'package.json'));
    const linkedom = require2('linkedom');
    const dom = linkedom.parseHTML('<!doctype html><html><body></body></html>');
    const win = dom.window ?? dom;
    const purifyMod = await import(pathToFileURL(path.join(m.tmp, 'content/lib/purify.es.js')).href);
    const factory = purifyMod.default ?? purifyMod;
    const purify = typeof factory === 'function' ? factory(win) : factory;
    const t0 = Date.now();
    const clean = purify.sanitize(html, {
      USE_PROFILES: { html: true, svg: true, mathMl: true },
      ADD_TAGS: ['details', 'summary', 'input'],
      ADD_ATTR: ['target', 'rel', 'class', 'style', 'disabled', 'checked', 'type'],
    });
    const imgsAfter = [...String(clean).matchAll(/<img[^>]*?\ssrc="([^"]*)"[^>]*>/gi)].map((x) => x[1]);
    const dataAfter = imgsAfter.filter((s) => s.startsWith('data:'));
    purifyPass = {
      available: true,
      ms: Date.now() - t0,
      htmlBytesBefore: html.length,
      htmlBytesAfter: String(clean).length,
      imgsBefore: imgs.length,
      imgsAfter: imgsAfter.length,
      dataUriImgsAfter: dataAfter.length,
      sameDataUris: imgs.filter((s) => s.startsWith('data:')).every((s) => dataAfter.includes(s)),
    };
  } catch (e) {
    purifyPass = { available: false, error: String(e.message ?? e).slice(0, 200) };
  }

  // --- вариант «картинки выключены» и «файлы выключены»
  const stripped = convStrippedCopy.messages.map((msg) => ({
    role: msg.role,
    includeAttachments_false: m.strip.applyAttachmentOption(
      { ...msg, content: m.stripImages.stripImages(msg.content) },
      { includeAttachments: false, imagesStripped: true },
    ).slice(0, 160),
  }));

  // --- масштабный прогон: тот же конвейер, но много картинок (замер времени и потерь)
  const REPEAT = Number(process.argv[4] || 1);
  let scale = null;
  if (REPEAT > 1) {
    const big = { ...conv, messages: [] };
    for (let i = 0; i < REPEAT; i++) {
      const src = i % 3 === 0 ? orig.jpgA : i % 3 === 1 ? orig.jpgB : orig.webp;
      const mime = src === orig.webp ? 'image/webp' : 'image/jpeg';
      big.messages.push({
        role: 'User',
        content: `msg ${i}\n\n![Image](data:${mime};base64,${src.bytes.toString('base64')})`,
      });
    }
    const t0 = Date.now();
    const bigHtml = await new m.html.HtmlFormatter().format(big, { includeTimestamps: false });
    const ms = Date.now() - t0;
    const bigImgs = [...bigHtml.matchAll(/<img[^>]*?\ssrc="(data:[^"]*)"[^>]*>/gi)].map((x) => x[1]);
    const shas = bigImgs.map((s) => sha(Buffer.from(s.slice(s.indexOf(',') + 1), 'base64')));
    const expected = new Set([orig.jpgA.sha256, orig.jpgB.sha256, orig.webp.sha256]);
    scale = {
      repeat: REPEAT,
      imagesExpected: REPEAT,
      imagesInHtml: bigImgs.length,
      allBytesIdentical: shas.every((s) => expected.has(s)),
      formatMs: ms,
      htmlBytes: bigHtml.length,
      rssMB: Math.round(process.memoryUsage().rss / 1024 / 1024),
    };
  }

  const report = {
    at: new Date().toISOString(),
    node: process.version,
    scale,
    originals: Object.fromEntries(
      Object.entries(orig).map(([k, o]) => [
        k,
        { file: o.file, size: o.size, sha256: o.sha256, archive_name_is_sha256: o.name_matches_sha },
      ]),
    ),
    externalFetch: fetchProbe,
    html: {
      bytes: html.length,
      imgs: decoded,
      links: links.slice(0, 12),
      imagesTotalBytes: decoded
        .filter((d) => d.bytes)
        .reduce((s, d) => s + d.bytes, 0),
      originalsTotalBytes: orig.jpgA.size + orig.jpgB.size + orig.webp.size,
      fileNamesInHtml: nameFound,
      documentBytesInHtml: docBytesFound,
    },
    dompurify: purifyPass,
    strippedVariants: stripped,
    savedHtml: path.join(OUT, 'html_export_real.html'),
  };
  await fs.writeFile(path.join(OUT, 'html_export_report.json'), JSON.stringify(report, null, 2), 'utf8');
  console.log(JSON.stringify(report, null, 2));
}

main().catch((e) => {
  console.error('PROBE FAILED:', e);
  process.exitCode = 1;
});
