import type { GoogleProfile } from "./google";

export interface UserRow {
  id: number;
  google_sub: string;
  email: string;
  name: string | null;
  picture: string | null;
  role: string;
  status: string;
  created_at: number;
  last_login_at: number | null;
  consent_at: number | null;
}

export interface PublicUser {
  id: number;
  email: string;
  name: string | null;
  picture: string | null;
  role: string;
  isAdmin: boolean;
  createdAt: number;
  lastLoginAt: number | null;
}

export function isAdminEmail(adminEmails: string | undefined, email: string): boolean {
  if (!adminEmails) return false;
  return adminEmails
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
    .includes(email.toLowerCase());
}

export function toPublicUser(row: UserRow): PublicUser {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    picture: row.picture,
    role: row.role,
    isAdmin: row.role === "admin",
    createdAt: row.created_at,
    lastLoginAt: row.last_login_at,
  };
}

/** 依 Google sub 建立或更新會員；role 只會升級成 admin，不會被降級 */
export async function upsertUser(db: D1Database, profile: GoogleProfile, admin: boolean): Promise<UserRow> {
  const now = Math.floor(Date.now() / 1000);
  const row = await db
    .prepare(
      `INSERT INTO users (google_sub, email, name, picture, role, status, created_at, last_login_at)
       VALUES (?1, ?2, ?3, ?4, ?5, 'active', ?6, ?6)
       ON CONFLICT(google_sub) DO UPDATE SET
         email = excluded.email,
         name = excluded.name,
         picture = excluded.picture,
         role = CASE WHEN users.role = 'admin' THEN 'admin' ELSE excluded.role END,
         last_login_at = excluded.last_login_at
       RETURNING *`,
    )
    .bind(profile.sub, profile.email, profile.name ?? null, profile.picture ?? null, admin ? "admin" : "user", now)
    .first<UserRow>();
  if (!row) throw new Error("upsert failed");
  return row;
}

export async function userById(db: D1Database, id: number): Promise<UserRow | null> {
  return db.prepare("SELECT * FROM users WHERE id = ?1").bind(id).first<UserRow>();
}

export async function userByEmail(db: D1Database, email: string): Promise<UserRow | null> {
  return db.prepare("SELECT * FROM users WHERE email = ?1").bind(email.toLowerCase()).first<UserRow>();
}
