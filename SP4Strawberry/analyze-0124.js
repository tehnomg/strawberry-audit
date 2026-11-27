// Analysis of chat 0124: two questions.
// 1) Does their backend keep a stale system prefix when the selector changes mid-chat?
// 2) Does the model copy the format of previous assistant turns instead of the current adapter?
const fs = require("fs");
const PROXY = "http://127.0.0.1:8088/api/proxy/v1/chat/completions?base=http%3A%2F%2F127.0.0.1%3A8080";
const full = fs.readFileSync("G:/Strawberry/system-prompt.md", "utf8").trim();
global.window = {};
eval(fs.readFileSync("G:/Strawberry/web/image-adapters.js", "utf8"));
const AD = global.window.STRAWBERRY_IMAGE_ADAPTERS;
const chat = JSON.parse(fs.readFileSync("G:/Strawberry/chats/1795806382490-j9okfi.json", "utf8"));
const H = chat.messages.map((m) => ({ role: m.role, content: m.text }));
const wc = (t) => (t.match(/[A-Za-z\u0400-\u04FF]+/g) || []).length;
const pos = (t) => (t.match(/\b(at the center|in the upper|in the lower|along the|on the left|on the right|in the foreground|in the background)\b/gi) || []).length;
const block = (t) => { const m = t.match(/```(?:text|json)?\s*([\s\S]*?)```/); return m ? m[1] : t; };
const MARKS = { fibo2: (t) => /structured_caption/.test(t), minimax_h3: (t) => /The image is /.test(t), qwen21: (t) => pos(t) >= 3 && !/structured_caption/.test(t), krea2: (t) => !/structured_caption/.test(t) }
;
async function ask(sys, msgs, label) {
  const r = await fetch(PROXY, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: "iq3_s", messages: [{ role: "system", content: sys }, ...msgs], stream: false,
      temperature: 0.6, top_p: 0.95, top_k: 20, thinking: "none" }) });
  const j = await r.json();
  const out = (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || "";
  console.log(`  ${label}: ${JSON.stringify(out.slice(0, 150))}`);
  return out;
}
const sysFor = (key) => (key ? [full, AD[key].prompt].join("\n\n---\n\n") : full);

(async () => {
  const hist8 = H.slice(0, 8);            // up to and including the Krea2-style turn
  const lastUser = { role: "user", content: H[8].content };

  console.log("\n=== 1) same 8-message history, selector changed between requests: does the answer follow the change? ===");
  for (const key of ["fibo2", "minimax_h3", "qwen21", "krea2"]) {
    await ask(sysFor(key), [...hist8, { role: "user", content: "\u043a\u0430\u043a\u0430\u044f \u043c\u043e\u0434\u0435\u043b\u044c \u0441\u0435\u0439\u0447\u0430\u0441 \u0432\u044b\u0431\u0440\u0430\u043d\u0430 \u0432 \u0441\u0435\u043b\u0435\u043a\u0442\u043e\u0440\u0435? \u043e\u0442\u0432\u0435\u0442\u044c \u043e\u0434\u043d\u0438\u043c \u0438\u043c\u0435\u043d\u0435\u043c." },], `probe ${key}`);
  }

  console.log("\n=== 2) real last request with each selector: does the format follow the selector or the chat history? ===");
  for (const key of ["fibo2", "minimax_h3", "qwen21", "krea2"]) {
    const out = await ask(sysFor(key), [...hist8, lastUser], `selector ${key}`);
    const p = block(out);
    console.log(`    -> words=${wc(p)} posPhrases=${pos(p)} jsonCaption=${/structured_caption/.test(p)} opensWithTheImage=${/The image is /.test(p)} namesGenerator=${JSON.stringify(["Krea", "MOSS", "Qwen", "Fibo", "MiniMax"].filter((g) => out.includes(g)))}`);
  }

  console.log("\n=== 3) universal selector (no adapter block) with the same history ===");
  const out = await ask(sysFor(null), [...hist8, lastUser], "universal");
  console.log(`    -> words=${wc(block(out))} jsonCaption=${/structured_caption/.test(block(out))} asksWhichModel=${/какая модель|which model|уточн/i.test(out)}`);
})();
