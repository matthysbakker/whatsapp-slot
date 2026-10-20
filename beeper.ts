// Narrow Beeper Desktop API client: only the chats named in chats.json can be read or messaged.
// The full Beeper MCP can read and send in every chat; this slot keeps an agent to the chats you chose.
// API reference: https://developers.beeper.com/desktop-api-reference (local server, default port 23373).

export type ChatIds = Record<string, string>;

const MAX_TEXT_LENGTH = 4000;
const MAX_READ_TEXT = 1000;
const MAX_PAGES = 5;

type ApiMessage = {
  id: string;
  senderID: string;
  timestamp: string;
  text?: string;
  isSender?: boolean;
  linkedMessageID?: string;
  reactions?: { participantID: string; reactionKey: string }[];
};
type MessagePage = { items: ApiMessage[]; hasMore: boolean; oldestCursor?: string };

export type ReadMessage = {
  id: string;
  tijd: string;
  afzender: string;
  tekst: string;
  antwoordOp?: string;
  reacties: { emoji: string; door: string }[];
};

export type BeeperOptions = {
  baseUrl: string;
  token: string;
  chats: ChatIds;
  fetch?: typeof fetch;
};

export function isRecipient(chats: ChatIds, value: unknown): value is string {
  return typeof value === "string" && Object.hasOwn(chats, value);
}

export function createBeeper({ baseUrl, token, chats, fetch: fetchImpl = fetch }: BeeperOptions) {
  async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await fetchImpl(`${baseUrl}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...init.headers },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`Beeper antwoordde ${response.status} op ${init.method ?? "GET"} ${path.split("?")[0]}`);
    return (await response.json()) as T;
  }

  function chatPath(who: string): string {
    if (!isRecipient(chats, who)) throw new Error(`"${who}" staat niet in chats.json`);
    return `/v1/chats/${encodeURIComponent(chats[who]!)}`;
  }

  return {
    recipients: Object.keys(chats),

    async info(): Promise<unknown> {
      return call("/v1/info");
    },

    async send(to: string, text: string): Promise<string> {
      const path = chatPath(to);
      const trimmed = text.trim();
      if (trimmed === "") throw new Error("Lege tekst wordt niet verstuurd");
      if (trimmed.length > MAX_TEXT_LENGTH) throw new Error(`Bericht is langer dan ${MAX_TEXT_LENGTH} tekens; splits het op`);
      const result = await call<{ pendingMessageID?: string }>(`${path}/messages`, {
        method: "POST",
        body: JSON.stringify({ text: trimmed }),
      });
      return result.pendingMessageID ?? "";
    },

    // Newest pages first, until the messages are older than `since` or `max` is reached. Returned oldest first.
    async read(from: string, { since, max = 50 }: { since?: string; max?: number } = {}): Promise<ReadMessage[]> {
      const path = chatPath(from);
      const sinceTime = since ? Date.parse(since) : Number.NEGATIVE_INFINITY;
      if (Number.isNaN(sinceTime)) throw new Error(`"sinds" is geen geldige datum: ${since}`);
      const limit = Math.max(1, Math.min(200, max));
      const collected: ApiMessage[] = [];
      let cursor: string | undefined;
      for (let page = 0; page < MAX_PAGES; page++) {
        const query = cursor ? `?cursor=${encodeURIComponent(cursor)}&direction=before` : "";
        const result = await call<MessagePage>(`${path}/messages${query}`);
        collected.push(...result.items);
        const oldest = Math.min(...result.items.map((m) => Date.parse(m.timestamp)));
        if (!result.hasMore || !result.oldestCursor || oldest < sinceTime || collected.length >= limit * 2) break;
        cursor = result.oldestCursor;
      }

      const selfId = collected.find((m) => m.isSender)?.senderID;
      const who = (participantID: string, isSender?: boolean): string =>
        isSender || (selfId !== undefined && participantID === selfId) ? "ik" : from;

      return collected
        .filter((m) => Date.parse(m.timestamp) >= sinceTime)
        .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp))
        .slice(-limit)
        .map((m) => ({
          id: m.id,
          tijd: m.timestamp,
          afzender: who(m.senderID, m.isSender),
          tekst: (m.text ?? "").slice(0, MAX_READ_TEXT),
          ...(m.linkedMessageID ? { antwoordOp: m.linkedMessageID } : {}),
          reacties: (m.reactions ?? []).map((r) => ({ emoji: r.reactionKey, door: who(r.participantID) })),
        }));
    },
  };
}
