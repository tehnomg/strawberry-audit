// A/B: reproduce chat 0124 exactly. Old (pre-fix, anonymous) adapters vs installed (named) adapters,
// same history, same sampling, selector = krea2 — which format does the model produce?
const fs = require("fs");
const PROXY = "http://127.0.0.1:8088/api/proxy/v1/chat/completions?base=http%3A%2F%2F127.0.0.1%3A8080";
const full = fs.readFileSync("G:/Strawberry/system-prompt.md", "utf8").trim();
function load(file) { global.window = {}; eval(fs.readFileSync(file, "utf8")); return global.window.STRAWBERRY_IMAGE_ADAPTERS; }
const NEW = load("G:/Strawberry/web/image-adapters.js");
const OLD = load("C:/Users/User/Documents/Strata/Workspace/SP4Strawberry/install-backup/2026-11-27-pre-adapter-naming/image-adapters.js");
const chat = JSON.parse(fs.readFileSync("G:/Strawberry/chats/1795806382490-j9okfi.json", "utf8"));
const H = chat.messages.map((m) => ({ role: m.role, content: m.text }));
const wc = (t) => (t.match(/[A-Za-z\u0400-\u04FF]+/g) || []).length;
const block = (t) => { const m = t.match(/```(?:text|json)?\s*([\s\S]*?)```/); return m ? m[1] : t; };
async function ask(sys, msgs) {
  const r = await fetch(PROXY, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: "iq3_s", messages: [{ role: "system", content: sys }, ...msgs], stream: false,
      temperature: 0.6, top_p: 0.95, top_k: 20, thinking: "none" }) });
  const j = await r.json();
  return (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || "";
}
function show(tag, out, expected) {
  const p = block(out);
  console.log(`\n[${tag}] jsonCaption=${/structured_caption/.test(p)} namesModel=${JSON.stringify(["Krea", "Fibo", "Qwen", "MiniMax", "MOSS"].filter((g) => out.includes(g)))} words=${wc(p)}`);
  console.log("  got:", JSON.stringify(out.slice(0, 150)));
  if (expected) console.log("  their real answer was:", JSON.stringify(expected.slice(0, 150)));
}
(async () => {
  // Turn at index 4: user repeats the request; per the user the selector was Krea 2 by then.
  for (const [tag, AD] of [["OLD anonymous adapters", OLD], ["INSTALLED named adapters", NEW]]) {
    const sys = [full, AD.krea2.prompt].join("\n\n---\n\n");
    const out = await ask(sys, [...H.slice(0, 4), { role: "user", content: H[4].content }]);
    show(`${tag} | turn 4 (selector krea2, history has Fibo JSON)`, out, H[5].text);
  }
  // Last turn: their answer named no model.
  for (const [tag, AD] of [["OLD anonymous adapters", OLD], ["INSTALLED named adapters", NEW]]) {
    const sys = [full, AD.krea2.prompt].join("\n\n---\n\n");
    const out = await ask(sys, [...H.slice(0, 8), { role: "user", content: H[8].content }]);
    show(`${tag} | turn 8 (selector krea2)`, out, H[9].text);
  }
})();
