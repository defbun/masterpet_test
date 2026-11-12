#!/usr/bin/env node
/**
 * Security and smoke tests for the running site.
 *
 *   node scripts/security-test.mjs                  # tests http://localhost:3000
 *   node scripts/security-test.mjs https://example  # tests another base URL
 *
 * Requirements: the server is running and DATABASE_URL is set (.env).
 * The lead API allows 10 submissions per 10 minutes per client, so start the
 * server fresh (or wait 10 minutes) before running the suite again.
 * The suite creates its own rows in `leads` and deletes them afterwards.
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import pg from "pg";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASE = (process.argv[2] ?? process.env.BASE_URL ?? "http://localhost:3000").replace(/\/+$/, "");
const ORIGIN = new URL(BASE).origin;
const TAG = `security-test-${Date.now()}`;
const SELF = path.join("scripts", "security-test.mjs");
const CREDENTIALS_RE = /postgres(ql)?:\/\/[^\s'"`/]+:[^\s'"`@/]+@/;

let passed = 0;
const failed = [];

function check(group, name, ok, detail = "") {
  if (ok) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failed.push(`[${group}] ${name}${detail ? ` — ${detail}` : ""}`);
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function section(title) {
  console.log(`\n■ ${title}`);
}

async function http(url, init = {}, follow = false) {
  const res = await fetch(new URL(url, BASE), { redirect: follow ? "follow" : "manual", ...init });
  const text = await res.text();
  return { status: res.status, headers: res.headers, text };
}

async function statusOf(url) {
  const res = await fetch(url, { redirect: "follow" });
  await res.arrayBuffer();
  return res.status;
}

async function parallel(items, limit, worker) {
  const queue = [...items];
  const runners = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    while (queue.length > 0) await worker(queue.shift());
  });
  await Promise.all(runners);
}

function walk(dir, visit) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, visit);
    else visit(full);
  }
}

function readDotEnv() {
  const values = {};
  const file = path.join(ROOT, ".env");
  if (!fs.existsSync(file)) return values;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (match) values[match[1]] = match[2].replace(/^(['"])(.*)\1$/, "$2");
  }
  return values;
}

async function main() {
  const env = { ...readDotEnv(), ...process.env };
  console.log(`Тест безопасности и работоспособности: ${BASE}`);

  // ───────── 1. Заголовки безопасности ─────────
  section("1. Заголовки безопасности");
  const home = await http("/");
  const csp = home.headers.get("content-security-policy") ?? "";
  const directive = (name) =>
    csp
      .split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${name} `)) ?? "";
  const nonce = csp.match(/'nonce-([^']+)'/)?.[1] ?? "";

  check("headers", "Content-Security-Policy выдаётся", csp.length > 0);
  check("headers", "CSP: default-src 'self'", directive("default-src") === "default-src 'self'");
  check(
    "headers",
    "CSP: скрипты только по nonce, без unsafe-inline и unsafe-eval",
    /'strict-dynamic'/.test(directive("script-src")) && !/unsafe-(inline|eval)/.test(directive("script-src")),
  );
  check("headers", "CSP: object-src 'none'", directive("object-src") === "object-src 'none'");
  check(
    "headers",
    "CSP: встроить сайт могут только сам сайт и arena.ai (frame-ancestors)",
    directive("frame-ancestors") === "frame-ancestors 'self' https://arena.ai https://*.arena.ai",
  );
  check(
    "headers",
    "CSP: base-uri 'self' и form-action 'self'",
    directive("base-uri") === "base-uri 'self'" && directive("form-action") === "form-action 'self'",
  );

  const scriptTags = [...home.text.matchAll(/<script\b([^>]*)>/gi)].map((m) => m[1]);
  const withoutNonce = scriptTags.filter((attrs) => !nonce || !attrs.includes(`nonce="${nonce}"`));
  check(
    "headers",
    `все <script> на главной имеют nonce (${scriptTags.length} шт.)`,
    scriptTags.length > 0 && withoutNonce.length === 0,
    `без nonce: ${withoutNonce.length}`,
  );

  const rules = [
    ["x-content-type-options", (v) => v === "nosniff", "nosniff"],

    ["referrer-policy", (v) => v.includes("strict-origin"), "strict-origin-when-cross-origin"],
    ["permissions-policy", (v) => v.includes("camera=()"), "camera=() и др."],
    ["cross-origin-opener-policy", (v) => v === "same-origin", "same-origin"],
    ["strict-transport-security", (v) => /max-age=\d+/.test(v), "max-age=…"],
  ];
  for (const [name, ok, expected] of rules) {
    const value = home.headers.get(name) ?? "";
    check("headers", `заголовок ${name}`, ok(value), `ожидалось: ${expected}, получено: "${value}"`);
  }
  check("headers", "X-Powered-By скрыт", !home.headers.get("x-powered-by"));
  check("headers", "X-Frame-Options не задан: встраивание регулирует frame-ancestors", !home.headers.get("x-frame-options"));
  const foreignCors = await http("/", { headers: { origin: "https://evil.example" } });
  check("headers", "CORS закрыт для чужих сайтов", !foreignCors.headers.get("access-control-allow-origin"));

  // ───────── 2. Служебные файлы и обход путей ─────────
  section("2. Служебные файлы и обход путей");
  const probes = [
    "/.env",
    "/.env.local",
    "/.git/config",
    "/package.json",
    "/package-lock.json",
    "/drizzle.config.ts",
    "/next.config.ts",
    "/src/proxy.ts",
    "/src/app/page.tsx",
    "/content/pages.json",
    "/media/images-i.zip",
    "/media/..%2F..%2Fpackage.json",
    "/node_modules/next/package.json",
    "/.next/BUILD_ID",
    "/_next/../package.json",
    "/..%2Fpackage.json",
    "/%2e%2e%2fpackage.json",
    "/bottling/..%2F..%2Fpackage.json",
    "/prises%2F..%2F..%2Fpackage",
    "/api/%2e%2e/package.json",
  ];
  const leakPatterns = [
    /"dependencies"\s*:/,
    /"devDependencies"/,
    /DATABASE_URL/,
    /postgres(ql)?:\/\//,
    /"use client"/,
    /export default function/,
  ];
  for (const probe of probes) {
    const res = await http(probe);
    const leaked = leakPatterns.some((re) => re.test(res.text));
    check("traversal", `${probe} — нет доступа к файлам проекта (HTTP ${res.status})`, !leaked && (res.status === 404 || res.status === 400));
  }

  const longPath = await http(`/${"a".repeat(8000)}`, {}, true);
  check("robustness", "очень длинный путь (8 КБ) → 404/414, без падения", longPath.status === 404 || longPath.status === 414, `HTTP ${longPath.status}`);
  const nullByte = await http("/bottling%00/", {}, true);
  check("robustness", "нулевой байт в пути → 404", nullByte.status === 404, `HTTP ${nullByte.status}`);
  const badUtf = await http("/%E0%A4%A", {}, true);
  check("robustness", "битая кодировка → 4xx без трассировки стека", badUtf.status < 500 && !/\n\s+at\s+\S+\s+\(/.test(badUtf.text), `HTTP ${badUtf.status}`);
  const missing = await http("/no-such-page-xyz/", {}, true);
  check("robustness", "несуществующая страница → 404", missing.status === 404, `HTTP ${missing.status}`);

  // ───────── 3. API заявок ─────────
  section("3. API заявок /api/leads");
  const json = (body) => JSON.stringify(body);
  const sameSite = { "content-type": "application/json", "sec-fetch-site": "same-origin" };
  const payload = { name: "Security Tester", phone: "+7 (900) 123-45-67", product: "Тест безопасности", source: "/bottling/beer/" };

  const getLeads = await http("/api/leads");
  check("api", "GET /api/leads → 405", getLeads.status === 405, `HTTP ${getLeads.status}`);

  const textPlain = await http("/api/leads", {
    method: "POST",
    headers: { "content-type": "text/plain" },
    body: json({ ...payload, message: TAG }),
  });
  check("api", "text/plain (типичная CSRF-форма) → 415", textPlain.status === 415, `HTTP ${textPlain.status}`);

  const crossSite = await http("/api/leads", {
    method: "POST",
    headers: { ...sameSite, "sec-fetch-site": "cross-site" },
    body: json({ ...payload, message: TAG }),
  });
  check("api", "Sec-Fetch-Site: cross-site → 403", crossSite.status === 403, `HTTP ${crossSite.status}`);

  const foreign = await http("/api/leads", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://evil.example" },
    body: json({ ...payload, message: TAG }),
  });
  check("api", "чужой Origin → 403", foreign.status === 403, `HTTP ${foreign.status}`);

  const brokenJson = await http("/api/leads", { method: "POST", headers: sameSite, body: "{not json" });
  check("api", "битый JSON → 400", brokenJson.status === 400, `HTTP ${brokenJson.status}`);

  const oversized = await http("/api/leads", {
    method: "POST",
    headers: sameSite,
    body: json({ ...payload, message: "x".repeat(20000) }),
  });
  check("api", "запрос 20 КБ → 413", oversized.status === 413, `HTTP ${oversized.status}`);

  const invalid = [
    ["HTML-код вместо имени", { ...payload, name: "<script>alert(1)</script>" }],
    ["пустой телефон", { ...payload, phone: "" }],
    ["телефон из букв", { ...payload, phone: "позвоните мне" }],
    ["сообщение длиннее 1000 символов", { ...payload, message: "a".repeat(1001) }],
  ];
  for (const [label, body] of invalid) {
    const res = await http("/api/leads", { method: "POST", headers: sameSite, body: json(body) });
    check("api", `валидация: ${label} → 400`, res.status === 400, `HTTP ${res.status}`);
  }

  const honeypotMessage = `${TAG}-honeypot`;
  const bot = await http("/api/leads", {
    method: "POST",
    headers: sameSite,
    body: json({ ...payload, message: honeypotMessage, website: "http://spam.example" }),
  });
  check("api", "honeypot заполнен → ответ ok (боту не сообщаем об отказе)", bot.status === 200 && /"ok":\s*true/.test(bot.text), `HTTP ${bot.status}`);

  const sqlAndHtml = `${TAG}-valid<script>alert(1)</script>' OR '1'='1'); DROP TABLE leads;--`;
  const valid = await http("/api/leads", {
    method: "POST",
    headers: sameSite,
    body: json({ ...payload, message: sqlAndHtml }),
  });
  check("api", "заявка с HTML и SQL-инъекцией в тексте → 200 ok", valid.status === 200 && /"ok":\s*true/.test(valid.text), `HTTP ${valid.status} ${valid.text.slice(0, 120)}`);

  let limitedAt = 0;
  let retryAfter = null;
  for (let attempt = 1; attempt <= 25 && limitedAt === 0; attempt++) {
    const res = await http("/api/leads", {
      method: "POST",
      headers: sameSite,
      body: json({ ...payload, message: `${TAG}-flood` }),
    });
    if (res.status === 429) {
      limitedAt = attempt;
      retryAfter = res.headers.get("retry-after");
    }
  }
  check("api", `частые запросы блокируются (429${limitedAt ? `, на попытке ${limitedAt}` : ""})`, limitedAt > 0);
  check("api", "ответ 429 содержит Retry-After", Boolean(retryAfter));

  const client = new pg.Client({ connectionString: env.DATABASE_URL });
  try {
    await client.connect();
    const { rows } = await client.query("SELECT name, phone, message, source FROM leads WHERE message LIKE $1", [`${TAG}%`]);
    check("db", "honeypot-заявка не записана", !rows.some((row) => row.message === honeypotMessage));
    const saved = rows.find((row) => row.message.startsWith(`${TAG}-valid`));
    check("db", "корректная заявка записана в базу", Boolean(saved));
    check("db", "угловые скобки вырезаны из сохранённого текста", Boolean(saved) && !/[<>]/.test(saved.message));
    check("db", "SQL-инъекция сохранена как обычный текст", Boolean(saved) && saved.message.includes("DROP TABLE leads"));
    const count = await client.query("SELECT count(*)::int AS n FROM leads");
    check("db", "таблица leads цела после атаки", Number.isInteger(count.rows[0]?.n));
    await client.query("DELETE FROM leads WHERE message LIKE $1", [`${TAG}%`]);
  } catch (error) {
    check("db", "подключение к базе для проверки заявок", false, error instanceof Error ? error.message : String(error));
  } finally {
    await client.end().catch(() => {});
  }

  // ───────── 4. Страницы, ссылки, медиа ─────────
  section("4. Страницы и контент (XSS, iframe, ссылки, медиа)");
  const pagesFile = path.join(ROOT, "content", "pages.json");
  const contentRoutes = Object.keys(JSON.parse(fs.readFileSync(pagesFile, "utf8"))).map((key) => `/${key}/`);
  const routes = [...new Set(["/", "/news/", "/company/modern/", "/company/photo/", "/company/why-us/", ...contentRoutes])];
  const allowedFrames = directive("frame-src").replace("frame-src", "").trim().split(/\s+/).filter(Boolean);

  const pages = new Map();
  const notOk = [];
  const pageIssues = [];
  await parallel(routes, 12, async (route) => {
    const url = new URL(route, BASE).href;
    const res = await fetch(url);
    const html = await res.text();
    if (res.status !== 200) {
      notOk.push(`${route} → ${res.status}`);
      return;
    }
    pages.set(res.url || url, html); // resolve relative links against the final URL, as a browser does

    const issues = new Set();
    // every response has its own nonce, so compare scripts with the nonce of this response
    const pageNonce = (res.headers.get("content-security-policy") ?? "").match(/'nonce-([^']+)'/)?.[1] ?? "";
    for (const m of html.matchAll(/<script\b([^>]*)>/gi)) {
      if (!pageNonce || !m[1].includes(`nonce="${pageNonce}"`)) issues.add("скрипт без nonce этого ответа");
    }
    if (/<[^>]+\s(on[a-z]+)\s*=\s*["']/i.test(html)) issues.add("обработчик on*=");
    if (/(href|src|action)\s*=\s*["']\s*javascript:/i.test(html)) issues.add("javascript:-ссылка");
    if (/<(object|embed|applet|base)\b/i.test(html)) issues.add("object/embed/base");
    if ((html.match(/<form\b/gi) ?? []).length > 1) issues.add("лишняя форма");
    for (const m of html.matchAll(/<iframe\b[^>]*\ssrc="([^"]+)"/gi)) {
      let frameOrigin = "invalid";
      try {
        frameOrigin = new URL(m[1].replace(/&amp;/g, "&")).origin;
      } catch {
        // keep "invalid"
      }
      if (!allowedFrames.includes(frameOrigin)) issues.add(`чужой iframe ${frameOrigin}`);
    }
    for (const m of html.matchAll(/<a\b[^>]*\starget="_blank"[^>]*>/gi)) {
      if (!/\srel="[^"]*noopener/i.test(m[0])) {
        issues.add("target=_blank без noopener");
        break;
      }
    }
    if (/<(img|source|video|iframe)\b[^>]*\s(src|poster)="http:\/\//i.test(html)) issues.add("небезопасный http-ресурс");
    if (issues.size > 0) pageIssues.push(`${route}: ${[...issues].join(", ")}`);
  });
  check("pages", `все страницы отвечают 200 (${routes.length} шт.)`, notOk.length === 0, notOk.slice(0, 5).join("; "));
  check("pages", "нет XSS-признаков, чужих iframe и небезопасных ссылок", pageIssues.length === 0, pageIssues.slice(0, 4).join(" | "));

  const links = new Set();
  const assets = new Set();
  for (const [pageUrl, html] of pages) {
    for (const m of html.matchAll(/\shref="([^"]+)"/g)) {
      const href = m[1].replace(/&amp;/g, "&");
      if (href.startsWith("/") && !href.startsWith("//")) links.add(href.split("#")[0] || "/");
    }
    for (const m of html.matchAll(/<(img|source)\b[^>]*\ssrc="([^"]+)"/gi)) {
      const src = m[2].replace(/&amp;/g, "&");
      if (/^(data|blob|mailto|tel):/i.test(src)) continue;
      try {
        const absolute = new URL(src, pageUrl);
        if (absolute.origin === ORIGIN) assets.add(absolute.pathname + absolute.search);
      } catch {
        // malformed URL: reported below as a broken asset if it matters
      }
    }
  }

  const brokenLinks = [];
  await parallel([...links], 12, async (href) => {
    const status = await statusOf(new URL(href, BASE));
    if (status !== 200) brokenLinks.push(`${href} → ${status}`);
  });
  check("links", `внутренние ссылки ведут на существующие страницы (${links.size} шт.)`, brokenLinks.length === 0, brokenLinks.slice(0, 8).join("; "));

  const brokenAssets = [];
  await parallel([...assets], 16, async (assetPath) => {
    const status = await statusOf(new URL(assetPath, BASE));
    if (status !== 200) brokenAssets.push(`${assetPath} → ${status}`);
  });
  check("assets", `изображения и видео загружаются (${assets.size} шт.)`, brokenAssets.length === 0, brokenAssets.slice(0, 8).join("; "));

  // ───────── 5. Сборка, секреты, зависимости ─────────
  section("5. Сборка, секреты и зависимости");
  const chunk = home.text.match(/src="(\/_next\/static\/[^"]+\.js)"/)?.[1];
  if (chunk) {
    const map = await http(`${chunk}.map`);
    check("assets", "source maps не публикуются", map.status === 404, `HTTP ${map.status}`);
  } else {
    check("assets", "source maps не публикуются", false, "JS-чанк на главной не найден");
  }

  const clientLeaks = [];
  walk(path.join(ROOT, ".next", "static"), (file) => {
    if (!/\.(js|css|html|json|txt)$/.test(file)) return;
    if (/postgres(ql)?:\/\/|DATABASE_URL/.test(fs.readFileSync(file, "utf8"))) clientLeaks.push(path.relative(ROOT, file));
  });
  check("secrets", "строка подключения к БД не попадает в клиентский код", clientLeaks.length === 0, clientLeaks.slice(0, 3).join(", "));

  const sourceLeaks = [];
  for (const dir of [path.join(ROOT, "src"), path.join(ROOT, "content"), path.join(ROOT, "scripts")]) {
    walk(dir, (file) => {
      if (file.endsWith(SELF)) return;
      if (!/\.(ts|tsx|js|mjs|json)$/.test(file)) return;
      if (CREDENTIALS_RE.test(fs.readFileSync(file, "utf8"))) sourceLeaks.push(path.relative(ROOT, file));
    });
  }
  for (const file of ["next.config.ts", "drizzle.config.ts", "drizzle.config.json"]) {
    const full = path.join(ROOT, file);
    if (fs.existsSync(full) && CREDENTIALS_RE.test(fs.readFileSync(full, "utf8"))) sourceLeaks.push(file);
  }
  check("secrets", "в исходном коде нет паролей от базы данных", sourceLeaks.length === 0, sourceLeaks.join(", "));

  const gitignore = fs.existsSync(path.join(ROOT, ".gitignore")) ? fs.readFileSync(path.join(ROOT, ".gitignore"), "utf8") : "";
  check("secrets", ".gitignore исключает .env и node_modules", /^\.env\s*$/m.test(gitignore) && /^\/?node_modules\/?\s*$/m.test(gitignore));

  const audit = spawnSync("npm", ["audit", "--omit=dev", "--json"], { cwd: ROOT, encoding: "utf8", timeout: 180000 });
  let summary = null;
  try {
    summary = JSON.parse(audit.stdout || "{}").metadata?.vulnerabilities ?? null;
  } catch {
    summary = null;
  }
  if (summary) {
    check(
      "deps",
      `зависимости продакшена: high и critical = 0 (moderate: ${summary.moderate ?? 0})`,
      (summary.high ?? 0) + (summary.critical ?? 0) === 0,
      JSON.stringify(summary),
    );
  } else {
    console.log("  · npm audit недоступен (нет сети), проверка зависимостей пропущена");
  }

  // ───────── 6. Работоспособность ─────────
  section("6. Работоспособность");
  const health = await http("/api/health");
  check("health", "/api/health → 200, ok:true (база доступна)", health.status === 200 && /"ok":\s*true/.test(health.text), `HTTP ${health.status}`);
  const newsPage = await http("/news/", {}, true);
  const newsItems = (newsPage.text.match(/<li class="rounded-2xl border border-line bg-white">/g) ?? []).length;
  const newsTotal = JSON.parse(fs.readFileSync(path.join(ROOT, "src", "data", "news.json"), "utf8")).length;
  check("health", `страница новостей выводит материалы (${newsItems} шт.)`, newsPage.status === 200 && newsItems === newsTotal, `HTTP ${newsPage.status}, найдено ${newsItems}`);

  console.log(`\n═══ Итого: пройдено ${passed}, провалено ${failed.length}`);
  if (failed.length > 0) {
    console.log("Провалы:");
    for (const item of failed) console.log(`  - ${item}`);
  }
  process.exitCode = failed.length > 0 ? 1 : 0;
}

main().catch((error) => {
  console.error("Тест прерван:", error);
  process.exitCode = 1;
});
