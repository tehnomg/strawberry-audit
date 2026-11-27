// Проверка совместимости базового system-prompt с Visual Protocol (§9) и адаптерами:
// размеры сборки + карта пересечения правил по темам.
const fs = require("fs");
const W = "C:/Users/User/Documents/Strata/Workspace/SP4Strawberry";
const base = fs.readFileSync(W + "/prompt/strawberry-system-prompt-base-v1.md", "utf8");
const s9 = fs.readFileSync(W + "/strawberry_visual_protocol_patch/system-prompt-section-9.md", "utf8");
global.window = {};
eval(fs.readFileSync(W + "/strawberry_visual_protocol_patch/web/image-adapters.js", "utf8"));
const A = global.window.STRAWBERRY_IMAGE_ADAPTERS;

const words = (t) => t.replace(/\s+/g, " ").trim().split(" ").length;
function splitSections(text, prefix) {
  const out = {};
  const re = new RegExp("^" + prefix + "\\.?\\s*(\\d+(?:\\.\\d+)?)\\.?\\s+(.*)$", "gm");
  const marks = [];
  let m;
  while ((m = re.exec(text))) marks.push({ num: m[1], idx: m.index });
  marks.forEach((mk, i) => {
    const end = i + 1 < marks.length ? marks[i + 1].idx : text.length;
    out[mk.num] = text.slice(mk.idx, end);
  });
  return out;
}
const B = splitSections(base, "#");
const S9 = splitSections(s9, "##");

console.log("=== Размеры ===");
console.log("база: chars=" + base.length + " words=" + words(base));
for (const k of Object.keys(B)) console.log("  база " + k + ": chars=" + B[k].length);
const vp9 = s9.slice(0, s9.indexOf("## 9.4")) + s9.slice(s9.indexOf("## 9.5"));
console.log("VP без 9.4: chars=" + vp9.length + " words=" + words(vp9));
for (const k of Object.keys(S9)) console.log("  §" + k + ": chars=" + S9[k].length);

console.log("\n=== Сборка system-сообщения (chars) ===");
const lens = Object.keys(A).map((k) => A[k].prompt.length);
const mn = Math.min(...lens), mx = Math.max(...lens);
const core = base.trim().length + vp9.trim().length;
console.log("база + VP(9.1-9.3,9.5): " + core);
console.log("+ адаптер: " + (core + mn) + " … " + (core + mx));
console.log("+ память (профили): krea.md 4316, wangp.md 3852, самый большой 8102");
console.log("итог с памятью: " + (core + mn + 3852) + " … " + (core + mx + 8102));

console.log("\n=== Карта пересечений по темам ===");
const topics = {
  "язык промпта (английский/русский)": /(по-английски|английский текст|английский абзац|на английский|русский промпт|язык промпта|языке и письме)/gi,
  "негативный промпт": /(негатив|негативн|negative)/gi,
  "последовательность / порядок": /(последовательност|порядок содержания|порядок блоков|Порядки|порядке чтения)/gi,
  "длина промпта": /(слов|токенов|лимит|длину|длина|укорот)/gi,
  "селектор / выбор генератора": /(селектор|селектр|адаптер выбран|универсальн)/gi,
  "техпараметры (CFG, seed, шаги, разрешение)": /(CFG|cfg|seed|sampler|шаг[а-я]* генерации|разрешени|соотношени[а-я]* сторон|--ar)/gi,
  "кавычки для рисуемого текста": /(кавычк)/gi,
  "референсы": /(референс|<image|<Picture|image 1|image_1)/gi,
  "память / профиль проекта": /(памят|профил[а-я]* проект|канон)/gi,
  "количество вариантов ответа": /(вариант)/gi,
  "размерность / стилистика Midjourney": /(Midjourney|стилистическ)/gi,
};
const srcs = { "база": base, "§9 (VP)": s9 };
for (const k of Object.keys(A)) srcs["адаптер " + k] = A[k].prompt;
for (const [topic, re] of Object.entries(topics)) {
  const hits = {};
  for (const [name, text] of Object.entries(srcs)) {
    const ms = [...text.matchAll(re)];
    if (ms.length) hits[name] = ms.length;
  }
  console.log(topic.padEnd(42) + JSON.stringify(hits));
}

console.log("\n=== Ключевые цитаты по языку ===");
const quote = (text, re, label) => {
  const lines = text.split("\n");
  lines.forEach((l, i) => { if (re.test(l)) console.log("  " + label + ":" + (i + 1) + ": " + l.trim().slice(0, 190)); });
};
quote(base, /(английск|русский промпт|Язык промпта)/i, "база");
quote(s9, /(по-английски|английский текст)/i, "§9");
quote(base, /(негативн)/i, "база");
quote(s9, /(негатив)/i, "§9");
for (const k of Object.keys(A)) quote(A[k].prompt, /(негатив)/i, "адаптер " + k);
