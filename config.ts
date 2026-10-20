// Settings shared by server.ts and setup.ts: where the chat IDs live and where the Beeper token comes from.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ChatIds } from "./beeper";

export const CHATS_FILE = join(import.meta.dir, "chats.json");
export const BASE_URL = process.env.BEEPER_URL ?? "http://localhost:23373";
export const KEYCHAIN_SERVICE = process.env.BEEPER_KEYCHAIN_SERVICE ?? "beeper-whatsapp-slot";

// "ik" is the label for your own account in lees_berichten, so a chat cannot be called that.
export const RESERVED_NAMES = ["ik"];
const NAME_PATTERN = /^[a-z][a-z0-9-]{0,31}$/;

export function isValidName(name: string): boolean {
  return NAME_PATTERN.test(name) && !RESERVED_NAMES.includes(name);
}

export function readToken(): string {
  if (process.env.BEEPER_TOKEN) return process.env.BEEPER_TOKEN;
  const result = Bun.spawnSync(["security", "find-generic-password", "-s", KEYCHAIN_SERVICE, "-w"]);
  const token = result.stdout.toString().trim();
  if (result.exitCode !== 0 || token === "") throw new Error(`geen sleutel in de Keychain onder "${KEYCHAIN_SERVICE}"`);
  return token;
}

export function readChats(): ChatIds {
  if (!existsSync(CHATS_FILE)) return {};
  const raw = JSON.parse(readFileSync(CHATS_FILE, "utf8")) as Record<string, unknown>;
  const chats: ChatIds = {};
  for (const [name, id] of Object.entries(raw)) {
    if (isValidName(name) && typeof id === "string" && id !== "") chats[name] = id;
  }
  return chats;
}
