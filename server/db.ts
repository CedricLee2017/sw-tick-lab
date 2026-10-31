export interface UserRow {
  id: number;
  email: string;
  name: string | null;
  picture: string | null;
  role: string;
  status: string;
  password_hash: string | null;
  password_salt: string | null;
  password_updated_at: number | null;
  google_sub: string | null;
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

export async function userById(db: D1Database, id: number): Promise<UserRow | null> {
  return db.prepare("SELECT * FROM users WHERE id = ?1").bind(id).first<UserRow>();
}

export async function userByEmail(db: D1Database, email: string): Promise<UserRow | null> {
  return db.prepare("SELECT * FROM users WHERE email = ?1").bind(email.toLowerCase()).first<UserRow>();
}

export async function createUser(
  db: D1Database,
  input: { email: string; name: string | null; hash: string; salt: string; admin: boolean },
): Promise<UserRow> {
  const now = Math.floor(Date.now() / 1000);
  const row = await db
    .prepare(
      `INSERT INTO users (email, name, role, status, password_hash, password_salt, password_updated_at, created_at, last_login_at)
       VALUES (?1, ?2, ?3, 'active', ?4, ?5, ?6, ?6, ?6)
       RETURNING *`,
    )
    .bind(input.email, input.name, input.admin ? "admin" : "user", input.hash, input.salt, now)
    .first<UserRow>();
  if (!row) throw new Error("create user failed");
  return row;
}
