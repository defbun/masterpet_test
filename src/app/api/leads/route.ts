import { db } from "@/db";
import { leads } from "@/db/schema";
import { clientIp, rateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 8 * 1024;
const NAME_RE = /^\p{L}[\p{L} .'-]{1,99}$/u;
const PHONE_RE = /^\+?[\d\s()-]{6,25}$/;
const SOURCE_RE = /^\/[A-Za-z0-9/_-]{0,199}$/;
const NO_STORE = { "Cache-Control": "no-store" };

function reply(body: Record<string, unknown>, status: number, headers: Record<string, string> = {}) {
  return Response.json(body, { status, headers: { ...NO_STORE, ...headers } });
}

/**
 * Rejects cross-site requests (CSRF and embedding abuse).
 * Browsers always send Sec-Fetch-Site; other clients (curl, scripts) send neither header.
 */
function isSameSite(request: Request): boolean {
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite) return fetchSite === "same-origin" || fetchSite === "same-site" || fetchSite === "none";

  const origin = request.headers.get("origin");
  if (!origin) return true;

  let originHost: string;
  try {
    originHost = new URL(origin).host.toLowerCase();
  } catch {
    return false;
  }
  return [request.headers.get("host"), request.headers.get("x-forwarded-host")]
    .filter((value): value is string => Boolean(value))
    .some((value) => value.split(",")[0].trim().toLowerCase() === originHost);
}

/** Reads the body but never more than `limit` bytes, even if Content-Length is missing or wrong. */
async function readBody(request: Request, limit: number): Promise<string | null> {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > limit) return null;
  if (!request.body) return "";

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const result = await reader.read();
    if (result.done) break;
    received += result.value.byteLength;
    if (received > limit) {
      await reader.cancel();
      return null;
    }
    chunks.push(result.value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/** Trims text, drops control characters and angle brackets (lead text is never rendered as HTML). */
function clean(value: unknown): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/[<>]/g, "")
    .replace(/[ \t]+/g, " ")
    .trim();
}

export async function POST(request: Request) {
  if (!isSameSite(request)) {
    return reply({ ok: false, error: "Запрос отклонён" }, 403);
  }

  const contentType = (request.headers.get("content-type") ?? "").toLowerCase();
  if (!contentType.startsWith("application/json")) {
    return reply({ ok: false, error: "Ожидается JSON" }, 415);
  }

  const perClient = rateLimit(`leads:${clientIp(request)}`, 10, 10 * 60_000);
  const overall = rateLimit("leads:all", 300, 60 * 60_000);
  if (!perClient.ok || !overall.ok) {
    return reply({ ok: false, error: "Слишком много запросов. Попробуйте позже или позвоните нам." }, 429, {
      "Retry-After": String(Math.max(perClient.retryAfter, overall.retryAfter)),
    });
  }

  const raw = await readBody(request, MAX_BODY_BYTES);
  if (raw === null) {
    return reply({ ok: false, error: "Слишком большой запрос" }, 413);
  }

  let body: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
    body = parsed as Record<string, unknown>;
  } catch {
    return reply({ ok: false, error: "Некорректный запрос" }, 400);
  }

  // Honeypot: only bots fill the hidden "website" field. Pretend success and store nothing.
  if (clean(body.website) !== "") return reply({ ok: true }, 200);

  const name = clean(body.name);
  const phone = clean(body.phone);
  const message = clean(body.message);
  const product = clean(body.product);
  const sourcePath = clean(body.source);
  const digits = phone.replace(/\D/g, "");

  if (!NAME_RE.test(name)) {
    return reply({ ok: false, error: "Укажите имя (только буквы)" }, 400);
  }
  if (!PHONE_RE.test(phone) || digits.length < 6 || digits.length > 15) {
    return reply({ ok: false, error: "Укажите корректный телефон" }, 400);
  }
  if (message.length > 1000 || product.length > 300) {
    return reply({ ok: false, error: "Слишком длинный текст" }, 400);
  }

  try {
    await db.insert(leads).values({
      name,
      phone,
      product: product || null,
      message: message || null,
      source: SOURCE_RE.test(sourcePath) ? sourcePath : null,
    });
    return reply({ ok: true }, 200);
  } catch (error) {
    console.error("[leads] insert failed:", error instanceof Error ? error.message : "unknown error");
    return reply({ ok: false, error: "Не удалось сохранить заявку. Позвоните нам." }, 500);
  }
}
