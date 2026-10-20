// One-time setup: find WhatsApp chat IDs in Beeper Desktop and store them under a short name in chats.json.
// Usage:
//   bun setup.ts zoek <naam>            lists matching chats with their ID
//   bun setup.ts zet <naam> <chatID>    stores the ID under that name, for example "sanne" or "mezelf"
//   bun setup.ts weg <naam>             removes a name
//   bun setup.ts toon                   shows chats.json
// Needs Beeper Desktop running and the token in the Keychain (see README).
import { writeFileSync } from "node:fs";
import { BASE_URL, CHATS_FILE, isValidName, readChats, readToken, RESERVED_NAMES } from "./config";

const [command, ...args] = Bun.argv.slice(2);
const save = (chats: Record<string, string>) => writeFileSync(CHATS_FILE, `${JSON.stringify(chats, null, 2)}\n`);

if (command === "zoek" && args.length > 0) {
  const query = new URLSearchParams({ query: args.join(" "), scope: "titles", type: "single", limit: "20" });
  const response = await fetch(`${BASE_URL}/v1/chats/search?${query}`, { headers: { Authorization: `Bearer ${readToken()}` } });
  if (!response.ok) throw new Error(`Beeper antwoordde ${response.status}`);
  const { items } = (await response.json()) as { items: { id: string; title?: string; network?: string }[] };
  if (items.length === 0) console.log("Geen chats gevonden.");
  for (const chat of items) console.log(`${chat.id}\t${chat.network ?? ""}\t${chat.title ?? ""}`);
} else if (command === "zet" && args[0] && args[1]) {
  if (!isValidName(args[0])) {
    console.log(`Kies een naam met kleine letters, cijfers of streepjes, zoals "sanne" of "mezelf". Niet: ${RESERVED_NAMES.join(", ")}.`);
    process.exitCode = 1;
  } else {
    save({ ...readChats(), [args[0]]: args[1] });
    console.log(`Opgeslagen: ${args[0]} = ${args[1]}`);
  }
} else if (command === "weg" && args[0]) {
  const { [args[0]]: removed, ...rest } = readChats();
  save(rest);
  console.log(removed ? `Verwijderd: ${args[0]}` : `${args[0]} stond er niet in.`);
} else if (command === "toon") {
  console.log(JSON.stringify(readChats(), null, 2));
} else {
  console.log("Gebruik: zoek <naam> | zet <naam> <chatID> | weg <naam> | toon");
  process.exitCode = 1;
}
