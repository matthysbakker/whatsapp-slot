import { describe, expect, test } from "bun:test";
import { createBeeper, type ChatIds } from "./beeper";
import { isValidName } from "./config";
import { buildTools, callTool, handleMessage, type Slot } from "./server";

const CHATS: ChatIds = { partner: "!partner:beeper", mezelf: "!self:beeper" };

type Call = { url: string; method: string; body?: unknown; auth: string | null };

function fakeFetch(routes: Record<string, unknown[]>) {
  const calls: Call[] = [];
  const queues = Object.fromEntries(Object.entries(routes).map(([k, v]) => [k, [...v]]));
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    calls.push({
      url,
      method,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
      auth: new Headers(init?.headers).get("Authorization"),
    });
    const key = `${method} ${decodeURIComponent(new URL(url).pathname)}`;
    const next = queues[key]?.shift();
    if (next === undefined) return new Response("not found", { status: 404 });
    return Response.json(next);
  }) as typeof fetch;
  return { impl, calls };
}

const beeperWith = (routes: Record<string, unknown[]>) => {
  const fake = fakeFetch(routes);
  return { beeper: createBeeper({ baseUrl: "http://beeper", token: "t0k", chats: CHATS, fetch: fake.impl }), calls: fake.calls };
};

const message = (id: string, timestamp: string, extra: Record<string, unknown> = {}) => ({
  id,
  senderID: "@partner",
  timestamp,
  text: id,
  ...extra,
});

describe("stuur_bericht", () => {
  test("sends only to the configured chat for the recipient, with the bearer token", async () => {
    const { beeper, calls } = beeperWith({ "POST /v1/chats/!partner:beeper/messages": [{ pendingMessageID: "p1" }] });
    const result = await callTool(beeper, "stuur_bericht", { aan: "partner", tekst: "  D1 · Diner · Traybake  " });
    expect(result.isError).toBeUndefined();
    expect(calls[0]?.url).toBe("http://beeper/v1/chats/!partner%3Abeeper/messages");
    expect(calls[0]?.body).toEqual({ text: "D1 · Diner · Traybake" });
    expect(calls[0]?.auth).toBe("Bearer t0k");
  });

  test("refuses any other recipient without calling Beeper", async () => {
    const { beeper, calls } = beeperWith({});
    const result = await callTool(beeper, "stuur_bericht", { aan: "oma", tekst: "hoi" });
    expect(result.isError).toBe(true);
    expect(calls).toHaveLength(0);
  });

  test("refuses empty and very long texts", async () => {
    const { beeper, calls } = beeperWith({});
    expect((await callTool(beeper, "stuur_bericht", { aan: "partner", tekst: "   " })).isError).toBe(true);
    expect((await callTool(beeper, "stuur_bericht", { aan: "partner", tekst: "x".repeat(4001) })).isError).toBe(true);
    expect(calls).toHaveLength(0);
  });

  test("a Beeper error becomes a tool error that says not to work around it", async () => {
    const { beeper } = beeperWith({});
    const result = await callTool(beeper, "stuur_bericht", { aan: "partner", tekst: "hoi" });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("Gebruik geen omweg via de Beeper-app");
  });
});

describe("lees_berichten", () => {
  test("returns messages since a moment, oldest first, with reactions labelled by who reacted", async () => {
    const { beeper } = beeperWith({
      "GET /v1/chats/!partner:beeper/messages": [
        {
          hasMore: false,
          items: [
            message("D2", "2026-10-22T09:02:00Z", {
              senderID: "@me",
              isSender: true,
              reactions: [{ participantID: "@partner", reactionKey: "👎" }],
            }),
            message("D1", "2026-10-22T09:01:00Z", {
              senderID: "@me",
              isSender: true,
              reactions: [
                { participantID: "@partner", reactionKey: "👍" },
                { participantID: "@me", reactionKey: "👍" },
              ],
            }),
            message("oud", "2026-10-15T09:00:00Z"),
            message("lekker!", "2026-10-22T12:00:00Z", { linkedMessageID: "D1" }),
          ],
        },
      ],
    });
    const result = await callTool(beeper, "lees_berichten", { van: "partner", sinds: "2026-10-22T09:00:00Z" });
    const messages = JSON.parse(result.content[0]!.text);
    expect(messages.map((m: { id: string }) => m.id)).toEqual(["D1", "D2", "lekker!"]);
    expect(messages[0].afzender).toBe("ik");
    expect(messages[0].reacties).toEqual([
      { emoji: "👍", door: "partner" },
      { emoji: "👍", door: "ik" },
    ]);
    expect(messages[2]).toMatchObject({ afzender: "partner", antwoordOp: "D1" });
  });

  test("pages back to older messages until it reaches the since moment", async () => {
    const { beeper, calls } = beeperWith({
      "GET /v1/chats/!partner:beeper/messages": [
        { hasMore: true, oldestCursor: "c1", items: [message("nieuw", "2026-10-22T10:00:00Z")] },
        { hasMore: true, oldestCursor: "c2", items: [message("ouder", "2026-10-21T10:00:00Z")] },
      ],
    });
    const messages = await beeper.read("partner", { since: "2026-10-22T09:00:00Z" });
    expect(messages.map((m) => m.id)).toEqual(["nieuw"]);
    expect(calls).toHaveLength(2);
    expect(calls[1]?.url).toContain("cursor=c1&direction=before");
  });

  test("rejects an invalid since date", async () => {
    const { beeper } = beeperWith({});
    const result = await callTool(beeper, "lees_berichten", { van: "partner", sinds: "donderdag" });
    expect(result.isError).toBe(true);
  });
});

describe("MCP protocol", () => {
  const unused: Slot = {
    names: () => ["partner", "mezelf"],
    beeper: () => {
      throw new Error("not configured");
    },
  };

  test("initialize echoes the protocol version and announces tools", async () => {
    const response = await handleMessage(unused, {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-06-18" },
    });
    expect(response).toMatchObject({ id: 1, result: { protocolVersion: "2025-06-18", serverInfo: { name: "whatsapp-slot" } } });
  });

  test("lists exactly three tools and no way to name another chat", async () => {
    const response = (await handleMessage(unused, { jsonrpc: "2.0", id: 2, method: "tools/list" })) as {
      result: { tools: ReturnType<typeof buildTools> };
    };
    expect(response.result.tools.map((t) => t.name)).toEqual(["controleer_beeper", "stuur_bericht", "lees_berichten"]);
    expect(JSON.stringify(response.result.tools)).not.toContain("chatID");
    expect(JSON.stringify(response.result.tools)).not.toContain("!partner:beeper");
  });

  test("the recipient choice is the list of names in chats.json", () => {
    const [, send, read] = buildTools(["partner", "mezelf"]);
    expect(send?.inputSchema.properties.aan).toEqual({ type: "string", enum: ["partner", "mezelf"] });
    expect((read?.inputSchema.properties as Record<string, unknown>).van).toEqual({ type: "string", enum: ["partner", "mezelf"] });
  });

  test("without chats.json the tools are still listed, without an empty enum", () => {
    const [, send] = buildTools([]);
    expect(send?.inputSchema.properties.aan).toEqual({ type: "string" });
    expect(send?.description).toContain("setup.ts");
  });

  test("a missing token or chats.json is a tool error, not a crash", async () => {
    const response = (await handleMessage(unused, {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "controleer_beeper", arguments: {} },
    })) as { result: { isError: boolean; content: { text: string }[] } };
    expect(response.result.isError).toBe(true);
    expect(response.result.content[0]?.text).toContain("not configured");
  });

  test("notifications get no answer and unknown methods get an error", async () => {
    expect(await handleMessage(unused, { jsonrpc: "2.0", method: "notifications/initialized" })).toBeUndefined();
    expect(await handleMessage(unused, { jsonrpc: "2.0", id: 4, method: "resources/list" })).toMatchObject({
      error: { code: -32601 },
    });
  });

  test("the server speaks newline-delimited JSON-RPC over stdio", async () => {
    const proc = Bun.spawn(["bun", `${import.meta.dir}/server.ts`], {
      stdin: "pipe",
      stdout: "pipe",
      env: { ...process.env, BEEPER_TOKEN: "x", BEEPER_URL: "http://127.0.0.1:9" },
    });
    proc.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} })}\n`);
    proc.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" })}\n`);
    await proc.stdin.end();
    const lines = (await new Response(proc.stdout).text()).trim().split("\n").map((l) => JSON.parse(l));
    expect(lines.map((l) => l.id)).toEqual([1, 2]);
    expect(lines[1].result.tools).toHaveLength(3);
  });
});

describe("chat names", () => {
  test("only short lowercase names, and never the reserved name for your own account", () => {
    expect(isValidName("sanne")).toBe(true);
    expect(isValidName("mezelf")).toBe(true);
    expect(isValidName("oma-2")).toBe(true);
    expect(isValidName("ik")).toBe(false);
    expect(isValidName("Sanne")).toBe(false);
    expect(isValidName("../chats")).toBe(false);
    expect(isValidName("")).toBe(false);
  });

  test("a beeper for one set of chats cannot reach a name outside it", async () => {
    const { beeper, calls } = beeperWith({});
    await expect(beeper.send("oma", "hoi")).rejects.toThrow("staat niet in chats.json");
    await expect(beeper.read("constructor")).rejects.toThrow("staat niet in chats.json");
    expect(calls).toHaveLength(0);
  });
});
