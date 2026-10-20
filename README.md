# WhatsApp-slot

Een kleine MCP-server waarmee een AI-agent, zoals Codex in de ChatGPT-app, WhatsApp gebruikt via Beeper Desktop. De agent kan alleen bij de chats die jij instelt.

Ik gebruik het voor Cocky, de agent die ons weekmenu maakt. Hij appt mijn vriendin per recept, leest haar duimpjes en appt mij in de chat met mezelf. Meer daarover in [de instructie](https://bakker-ai.nl/blog/boodschappen-agent-bouwen/).

## Waarom een slot

De MCP-koppeling van Beeper zelf kan bij al je chats: lezen en versturen. Een regel in `AGENTS.md` ("app alleen met Sanne") is een afspraak met de agent, en een agent kan zich vergissen.

Het slot zit tussen de agent en Beeper. Het kent alleen de chats in `chats.json`, onder een naam die jij kiest. De agent ziet geen chat-ID's en kan geen andere chat kiezen. Het slot gebruikt een eigen sleutel uit de Sleutelhanger, dus je hoeft niet steeds opnieuw toestemming te geven.

Het slot voorkomt vergissingen. Het is geen kluis: een agent die alles op je computer mag, kan er omheen. Zet het slot daarom buiten de map waarin je agent werkt.

## Wat het kan

| Tool | Wat het doet |
|---|---|
| `controleer_beeper` | Kijkt of Beeper Desktop draait en bereikbaar is |
| `stuur_bericht` | Stuurt een bericht (`aan`, `tekst`) aan een naam uit `chats.json`, maximaal 4000 tekens |
| `lees_berichten` | Leest berichten (`van`, optioneel `sinds` en `max`) uit een chat, oudste eerst, met emoji-reacties |

In `lees_berichten` is `afzender` je eigen account (`ik`) of de naam van de chat. Let op: in de chat met jezelf komt alles van `ik`, ook de berichten van de agent. Laat de agent daarom elk bericht aan jou met zijn naam beginnen, bijvoorbeeld `Cocky:`. Dan zijn jouw antwoorden te herkennen.

## Wat je nodig hebt

- Een Mac. De sleutel staat in de Sleutelhanger (Keychain) van macOS.
- [Beeper Desktop](https://www.beeper.com/download) met WhatsApp gekoppeld. Het gratis abonnement is genoeg.
- [Bun](https://bun.sh), om het script te draaien.
- Een agent die MCP-servers kan gebruiken, zoals Codex in de ChatGPT-app.

## Installeren

Deze stappen kan Codex voor je doen. Alleen stap 4 doe je zelf, zodat de agent je sleutel nooit ziet.

1. **Bun.** Kijk of het er is met `bun --version`. Zo niet: `brew install oven-sh/bun/bun`, of `curl -fsSL https://bun.sh/install | bash`.
2. **Het slot ophalen,** in je thuismap en buiten de map van je agent:

   ```sh
   git clone https://github.com/matthysbakker/whatsapp-slot ~/whatsapp-slot
   cd ~/whatsapp-slot
   bun install
   bun test
   ```

3. **Een sleutel maken in Beeper.**
   - Open Beeper Desktop en ga naar Settings > Integrations.
   - Zet bij Beeper Desktop API "Allow connections" aan.
   - Klik bij "Approved connections" op +.
   - Geef de sleutel de naam `whatsapp-slot`, kies bij "Expires In" een lange termijn en zet "Allow sensitive actions" aan. Dat laatste is nodig om berichten te versturen.
   - Klik op "Create Access Token" en kopieer de sleutel.
4. **De sleutel in de Sleutelhanger zetten.** Doe dit zelf, in Terminal. Het commando vraagt om de sleutel; plak hem en druk op Enter.

   ```sh
   security add-generic-password -a "$USER" -s beeper-whatsapp-slot -w
   ```

5. **Chats koppelen.** Beeper moet openstaan. Zoek een chat en sla hem op onder een korte naam met kleine letters:

   ```sh
   bun setup.ts zoek Sanne
   bun setup.ts zet sanne <chatID>
   ```

   Voor de chat met jezelf zoek je op je eigen naam en kies je bijvoorbeeld de naam `mezelf`. De naam `ik` is gereserveerd. Met `bun setup.ts toon` zie je wat er staat, met `bun setup.ts weg <naam>` haal je een chat eruit.

6. **Codex instellen.** Zet dit in `~/.codex/config.toml`. Gebruik bij `command` de uitkomst van `which bun`, en bij `args` het volledige pad naar `server.ts`:

   ```toml
   [mcp_servers.whatsapp-slot]
   command = "/opt/homebrew/bin/bun"
   args = ["/Users/<jouw gebruikersnaam>/whatsapp-slot/server.ts"]
   ```

   Had je de koppeling van Beeper zelf al toegevoegd? Zet die uit, zodat alleen het slot overblijft:

   ```toml
   [mcp_servers.beeper]
   url = "http://127.0.0.1:23373/v0/mcp"
   enabled = false
   ```

   Herstart de ChatGPT-app. Vraagt macOS of `security` of `bun` de sleutel mag lezen, kies dan "Altijd toestaan".

7. **Testen.** Start een nieuwe taak en vraag: "Gebruik controleer_beeper van whatsapp-slot en stuur mezelf daarna een testbericht." Vraagt de app om toestemming voor de tool, kies dan de optie die altijd toestaat. Een geplande taak kan die vraag niet stellen.

## Een regel voor je agent

Zet dit in `AGENTS.md`, met jouw namen:

```
WhatsApp alleen via de tools van whatsapp-slot. Die kunnen alleen sanne en mezelf bereiken. Open of bedien nooit de Beeper-app of WhatsApp met computer use. Werkt het slot niet, stop dan en meld het. Berichten aan mij beginnen met je naam, bijvoorbeeld "Cocky:".
```

## Goed om te weten

- Beeper Desktop moet openstaan. Laat het starten als je inlogt.
- Open WhatsApp op je telefoon minstens elke 12 dagen. Anders koppelt WhatsApp Beeper los.
- Het slot praat alleen met Beeper op je eigen computer (`http://localhost:23373`). Er gaat niets naar een andere server.
- Bijwerken: `cd ~/whatsapp-slot && git pull`.
- `bun test` test het slot zonder echte berichten te sturen.

## Instellingen voor gevorderden

| Variabele | Standaard | Waarvoor |
|---|---|---|
| `BEEPER_KEYCHAIN_SERVICE` | `beeper-whatsapp-slot` | Een andere naam voor de sleutel in de Sleutelhanger |
| `BEEPER_URL` | `http://localhost:23373` | Een ander adres voor Beeper Desktop |
| `BEEPER_TOKEN` | | De sleutel direct meegeven, bijvoorbeeld voor tests |

In Codex zet je een variabele met `env = { BEEPER_KEYCHAIN_SERVICE = "..." }` onder `[mcp_servers.whatsapp-slot]`.
