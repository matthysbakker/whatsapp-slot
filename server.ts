// MCP server (stdio) "whatsapp-slot": WhatsApp via Beeper Desktop, but only in the chats listed in chats.json.
// An MCP client such as Codex starts it from its config. Token and chat IDs: see config.ts and the README.
import { createBeeper } from "./beeper";
import { BASE_URL, readChats, readToken } from "./config";

const SERVER_INFO = { name: "whatsapp-slot", version: "1.0.0" };
const DEFAULT_PROTOCOL = "2025-06-18";

type Beeper = ReturnType<typeof createBeeper>;
type JsonRpcRequest = { jsonrpc: "2.0"; id?: string | number; method: string; params?: Record<string, any> };
export type Slot = { names: () => string[]; beeper: () => Beeper };

// The recipient enum is the list of names in chats.json, so the agent never sees or chooses a chat ID.
export function buildTools(names: string[]) {
  const recipient = names.length > 0 ? { type: "string", enum: names } : { type: "string" };
  const who = names.length > 0 ? names.join(" of ") : "de chats in chats.json (nog leeg: draai setup.ts)";
  return [
    {
      name: "controleer_beeper",
      description: "Controleert of Beeper Desktop draait en bereikbaar is. Gebruik dit aan het begin van een run.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
    },
    {
      name: "stuur_bericht",
      description: `Stuurt één WhatsApp-bericht aan ${who}. Andere ontvangers kunnen niet.`,
      inputSchema: {
        type: "object",
        properties: { aan: recipient, tekst: { type: "string", description: "Platte tekst, maximaal 4000 tekens" } },
        required: ["aan", "tekst"],
        additionalProperties: false,
      },
    },
    {
      name: "lees_berichten",
      description: `Leest recente berichten uit de chat met ${who}, met reacties (emoji) per bericht. Oudste eerst. 'afzender' en 'door' zijn 'ik' (je eigen account) of de naam van de chat.`,
      inputSchema: {
        type: "object",
        properties: {
          van: recipient,
          sinds: { type: "string", description: "ISO-datum en tijd; alleen berichten vanaf dit moment" },
          max: { type: "number", description: "Maximaal aantal berichten, standaard 50, hoogstens 200" },
        },
        required: ["van"],
        additionalProperties: false,
      },
    },
  ];
}

const text = (value: string, isError = false) => ({ content: [{ type: "text", text: value }], ...(isError ? { isError } : {}) });

export async function callTool(beeper: Beeper, name: string, args: Record<string, unknown> = {}) {
  const allowed = beeper.recipients.join(" of ");
  try {
    if (name === "controleer_beeper") {
      await beeper.info();
      return text("Beeper is bereikbaar.");
    }
    if (name === "stuur_bericht") {
      if (typeof args.aan !== "string" || !beeper.recipients.includes(args.aan)) return text(`"aan" moet ${allowed} zijn.`, true);
      if (typeof args.tekst !== "string") return text(`"tekst" ontbreekt.`, true);
      await beeper.send(args.aan, args.tekst);
      return text(`Verstuurd aan ${args.aan}.`);
    }
    if (name === "lees_berichten") {
      if (typeof args.van !== "string" || !beeper.recipients.includes(args.van)) return text(`"van" moet ${allowed} zijn.`, true);
      const messages = await beeper.read(args.van, {
        since: typeof args.sinds === "string" ? args.sinds : undefined,
        max: typeof args.max === "number" ? args.max : undefined,
      });
      return text(JSON.stringify(messages, null, 1));
    }
    return text(`Onbekende tool: ${name}`, true);
  } catch (error) {
    return text(`Mislukt: ${(error as Error).message}. Gebruik geen omweg via de Beeper-app; stop en meld dit.`, true);
  }
}

// Answers one JSON-RPC message; notifications (no id) get no answer.
export async function handleMessage(slot: Slot, message: JsonRpcRequest) {
  if (message.id === undefined) return undefined;
  const reply = (result: unknown) => ({ jsonrpc: "2.0", id: message.id, result });
  switch (message.method) {
    case "initialize":
      return reply({
        protocolVersion: message.params?.protocolVersion ?? DEFAULT_PROTOCOL,
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
      });
    case "ping":
      return reply({});
    case "tools/list": {
      let names: string[] = [];
      try {
        names = slot.names();
      } catch {
        // An unreadable chats.json shows up as a tool error on the first call.
      }
      return reply({ tools: buildTools(names) });
    }
    case "tools/call": {
      let beeper: Beeper;
      try {
        beeper = slot.beeper();
      } catch (error) {
        return reply(text(`Niet ingesteld: ${(error as Error).message}`, true));
      }
      return reply(await callTool(beeper, message.params?.name, message.params?.arguments));
    }
    default:
      return { jsonrpc: "2.0", id: message.id, error: { code: -32601, message: `Method not found: ${message.method}` } };
  }
}

// Token and chats are read on the first tool call, so a missing setting shows up as a tool error, not a crash.
function lazySlot(): Slot {
  let beeper: Beeper | undefined;
  return {
    names: () => Object.keys(readChats()),
    beeper: () => {
      if (beeper) return beeper;
      const chats = readChats();
      if (Object.keys(chats).length === 0) throw new Error("chats.json is leeg of ontbreekt; draai setup.ts");
      beeper = createBeeper({ baseUrl: BASE_URL, token: readToken(), chats });
      return beeper;
    },
  };
}

if (import.meta.main) {
  const slot = lazySlot();
  const decoder = new TextDecoder();
  let buffer = "";
  const write = (message: unknown) => process.stdout.write(`${JSON.stringify(message)}\n`);
  for await (const chunk of Bun.stdin.stream()) {
    buffer += decoder.decode(chunk, { stream: true });
    let newline: number;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line === "") continue;
      let message: JsonRpcRequest;
      try {
        message = JSON.parse(line);
      } catch {
        write({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
        continue;
      }
      const response = await handleMessage(slot, message);
      if (response) write(response);
    }
  }
}
