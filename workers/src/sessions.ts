/**
 * KV-based session and message CRUD.
 * Keys:
 *   sessions:{email} → SessionMeta[]
 *   messages:{session_id} → Message[]
 */

export interface SessionMeta {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

export interface Message {
  role: "user" | "assistant";
  content: string;
  sources?: Array<{ title: string; url: string }>;
  model?: string;
  created_at: string;
}

function sessionsKey(email: string): string {
  return `sessions:${email}`;
}

function messagesKey(sessionId: string): string {
  return `messages:${sessionId}`;
}

function generateId(): string {
  return crypto.randomUUID();
}

function autoTitle(content: string): string {
  const cleaned = content.replace(/\n/g, " ").trim();
  return cleaned.length > 30 ? cleaned.slice(0, 30) + "…" : cleaned;
}

export async function listSessions(kv: KVNamespace, email: string): Promise<SessionMeta[]> {
  const data = await kv.get(sessionsKey(email), "json");
  if (!data || !Array.isArray(data)) {
    return [];
  }
  return (data as SessionMeta[]).sort(
    (a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime(),
  );
}

export async function getMessages(kv: KVNamespace, sessionId: string): Promise<Message[]> {
  const data = await kv.get(messagesKey(sessionId), "json");
  if (!data || !Array.isArray(data)) {
    return [];
  }
  return data as Message[];
}

export async function saveMessage(
  kv: KVNamespace,
  email: string,
  sessionId: string | null,
  message: Message,
): Promise<{ session_id: string; is_new: boolean }> {
  const now = new Date().toISOString();
  let isNew = false;

  // Resolve or create session
  let sid = sessionId;
  const sessions = await listSessions(kv, email);

  if (!sid) {
    sid = generateId();
    isNew = true;
    const newSession: SessionMeta = {
      id: sid,
      title: message.role === "user" ? autoTitle(message.content) : "新對話",
      created_at: now,
      updated_at: now,
    };
    sessions.unshift(newSession);
    await kv.put(sessionsKey(email), JSON.stringify(sessions));
  } else {
    // Update existing session timestamp
    const updated = sessions.map((s) =>
      s.id === sid ? { ...s, updated_at: now } : s,
    );
    await kv.put(sessionsKey(email), JSON.stringify(updated));
  }

  // Append message
  const messages = await getMessages(kv, sid);
  const newMessages = [...messages, { ...message, created_at: now }];
  await kv.put(messagesKey(sid), JSON.stringify(newMessages));

  return { session_id: sid, is_new: isNew };
}

export async function deleteSession(
  kv: KVNamespace,
  email: string,
  sessionId: string,
): Promise<boolean> {
  const sessions = await listSessions(kv, email);
  const filtered = sessions.filter((s) => s.id !== sessionId);

  if (filtered.length === sessions.length) {
    return false; // session not found
  }

  await kv.put(sessionsKey(email), JSON.stringify(filtered));
  await kv.delete(messagesKey(sessionId));
  return true;
}
