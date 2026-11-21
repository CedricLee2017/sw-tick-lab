/** 據點戰上傳：API token / 登入 cookie 驗證，以及共用的 token hash。 */
import type { Env } from "./env";
import { currentUser } from "./auth";
import { normalizeSiegeBattle, type SiegeBattle } from "../src/lib/siegeBattleCore";

export interface SiegeUploader {
  userId: number;
  via: "token" | "session";
}

export interface SiegeTokenRow {
  user_id: number;
  token_hash: string;
  token_prefix: string;
  created_at: number;
  last_used_at: number | null;
}

function hex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function hashSiegeToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return hex(digest);
}

export function newSiegeToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return `swt_${hex(bytes.buffer)}`;
}

function tokenFromRequest(request: Request): string {
  const auth = request.headers.get("authorization") ?? "";
  const match = auth.match(/^Bearer\s+(.+)$/i);
  if (match?.[1]) return match[1].trim();
  const header = request.headers.get("x-swtick-token");
  if (header) return header.trim();
  return new URL(request.url).searchParams.get("token")?.trim() ?? "";
}

export async function siegeUploader(request: Request, env: Env): Promise<SiegeUploader | null> {
  const token = tokenFromRequest(request);
  if (token) {
    try {
      const hash = await hashSiegeToken(token);
      const row = await env.DB.prepare(
        `SELECT t.user_id, u.status
         FROM siege_tokens t
         JOIN users u ON u.id = t.user_id
         WHERE t.token_hash = ?1`,
      )
        .bind(hash)
        .first<{ user_id: number; status: string }>();
      if (!row || row.status !== "active") return null;
      await env.DB.prepare("UPDATE siege_tokens SET last_used_at = ?1 WHERE user_id = ?2")
        .bind(Math.floor(Date.now() / 1000), row.user_id)
        .run();
      return { userId: row.user_id, via: "token" };
    } catch (err) {
      console.error("siege token auth failed", err instanceof Error ? err.message : err);
      return null;
    }
  }

  const user = await currentUser(request, env);
  return user ? { userId: user.id, via: "session" } : null;
}

export function normalizeBattleList(value: unknown): SiegeBattle[] {
  const raw = Array.isArray(value)
    ? value
    : value && typeof value === "object" && Array.isArray((value as { battles?: unknown }).battles)
      ? (value as { battles: unknown[] }).battles
      : value && typeof value === "object"
        ? [value]
        : [];
  const out: SiegeBattle[] = [];
  for (const item of raw) {
    const battle = normalizeSiegeBattle(item);
    if (battle) out.push(battle);
  }
  return out;
}
