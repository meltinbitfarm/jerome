# Fase 0.5 — Dati sui consumi: cosa c'è e dove

Prova del 2026-10-14, Claude Code 2.1.299, login con la subscription Max 5x. È stata una sessione headless (`claude -p`, referente su Opus 5.5) che delega un compito banale al subagent `contatore` su Haiku 5.5. Gli hook su SessionStart, SubagentStop, Stop e SessionEnd salvavano il JSON grezzo. La prova è stata fatta fuori da git e la configurazione è stata rimossa.

## 1. Payload degli hook: niente token

Nessun evento porta token, costo o modello. Portano identificativi e percorsi:

| Evento | Campi utili |
|---|---|
| SessionStart | `session_id`, `transcript_path`, `cwd`, `source` (`startup`) |
| SubagentStop | `agent_id`, `agent_type` (`contatore`), `agent_transcript_path`, `last_assistant_message`, `prompt_id`, `effort.level` |
| Stop | `session_id`, `transcript_path`, `prompt_id`, `last_assistant_message` |
| SessionEnd | `session_id`, `transcript_path`, `reason` |

Esempio di SubagentStop:
```json
{"session_id":"47d40c0f-…","agent_id":"a63e90cf2af7917be","agent_type":"contatore",
 "agent_transcript_path":"~/.claude/projects/<cwd>/47d40c0f-…/subagents/agent-a63e90cf2af7917be.jsonl",
 "last_assistant_message":"9","hook_event_name":"SubagentStop"}
```
Gli hook servono quindi come **segnale e indice**: dicono quando leggere e quale file.

## 2. Transcript JSONL: il dettaglio per chiamata

- Referente: `~/.claude/projects/<cwd-codificata>/<session_id>.jsonl`
- Subagent: `…/<session_id>/subagents/agent-<agent_id>.jsonl`, più un `.meta.json` con `agentType`, `toolUseId` e `spawnDepth`.

Ogni riga `type: "assistant"` contiene `message.model`, `requestId` e `message.usage`:
```json
{"input_tokens":2,"cache_creation_input_tokens":13871,"cache_read_input_tokens":8608,
 "output_tokens":163,"output_tokens_details":{"thinking_tokens":0},
 "cache_creation":{"ephemeral_1h_input_tokens":13871,"ephemeral_5m_input_tokens":0}}
```
- **Referente e subagent sono distinti**: file separati, e nelle righe del subagent ci sono `isSidechain: true` e `agentId`.
- Nel transcript del referente, il `toolUseResult` del tool Agent riassume il subagent: `agentId`, `agentType`, `resolvedModel: "claude-haiku-5-5"`, `usage`, `totalTokens: 1012` e `totalDurationMs`.
- **Rischio di doppio conteggio**: una risposta con più blocchi (thinking e testo) scrive più righe con lo stesso `requestId` e lo stesso `usage`. Per evitarlo bisogna deduplicare per `requestId`.
- L'ultima riga del file è `type: "cost-state"`: totali di sessione per modello (token e `costUSD`). Include anche il subagent, quindi non va sommata ai dettagli.
- Dettaglio sulla cache: il referente scrive la cache a 1h, il subagent a 5m.

## 3. Output di `claude -p`

**`--output-format json`** restituisce un solo oggetto finale, con:
- `total_cost_usd` (0.1976), `usage` aggregato e `num_turns`;
- `modelUsage` diviso per modello (opus: 239 out, 31087 cache read, 23309 cache write; haiku: 3 out, 1007 cache write), con `costUSD` e `costBasis: "list"`;
- `subagent_stats`: spawned, completed, failed e `by_type: {"contatore": 1}`.

Con la subscription, `costUSD` è il **prezzo di listino equivalente**, non una spesa reale.

**`--output-format stream-json --verbose`** dà gli stessi dati in più, cioè messaggi ed eventi `hook_*`, e soprattutto un evento **`rate_limit_event`**:
```json
{"type":"rate_limit_event","rate_limit_info":{"status":"allowed","rateLimitType":"five_hour",
 "resetsAt":1791998400,"overageStatus":"rejected","isUsingOverage":false,
 "unifiedWindows":{"five_hour":{"utilization":0.42,"resetsAt":1791998400},
                   "seven_day":{"utilization":0.1,"resetsAt":1792548000}}}}
```

## 4. Uso della subscription

- **È esposto in `stream-json`** (`rate_limit_event`) **e nell'input della status line** (vedi §5): utilizzo delle finestre a 5 ore e a 7 giorni (frazione 0–1, ad esempio 0.42 = 42%), orario di reset e stato dell'overage. È un dato **dell'account, non del progetto**.
- Non compare nei payload degli hook, nei transcript e nel `result` di `--output-format json`.
- `~/.claude.json` → `oauthAccount` contiene solo il piano (`organizationType: claude_max`, `organizationRateLimitTier: default_claude_max_5x`), non l'utilizzo.
- Non verificato: se l'evento arriva in ogni run o solo quando cambia qualcosa. In questa prova è arrivato una volta, dopo la prima risposta.

## 5. Status line: sì, contiene i limiti della subscription

Ho dato a una sessione **interattiva** (in tmux) una status line che salva l'input su file. Prima della prima risposta il campo non c'è; dopo arriva `rate_limits`, con gli stessi valori di `stream-json` espressi in percentuale intera:
```json
"rate_limits":{"five_hour":{"used_percentage":43,"resets_at":1791998400},
               "seven_day":{"used_percentage":10,"resets_at":1792548000}}
```
Nello stesso input ci sono anche `cost.total_cost_usd`, `context_window.current_usage` (token dell'ultima chiamata) e `transcript_path`.
Conseguenza: anche le sessioni interattive possono aggiornare la % nel DB globale. Basta una status line del template che chiama `jerome` e stampa una riga. Questo supera il punto 3 qui sotto, ma non cambia D20.

## 6. Costo fisso di avvio di una sessione headless

Misura: `claude -p "Rispondi solo: ok" --output-format json`, con il referente su Opus 5.5. Il valore è la somma di input, cache write e cache read della prima e unica chiamata. Ogni riga aggiunge l'esclusione alle precedenti, tramite `.claude/settings.json` di progetto:

| Configurazione | Token in ingresso | Differenza | Skill caricate |
|---|---:|---:|---:|
| A. come oggi (tutto ciò che è installato a livello utente) | 28.726 | — | 59 |
| B. + `enabledPlugins`: i 4 plugin a `false` | 24.873 | −3,9k | 28 |
| C. + `disableClaudeAiConnectors: true` | 17.559 | −7,3k | 28 |
| D. + `disableBundledSkills: true` | 15.379 | −2,2k | 16 |
| E. + `skillOverrides`: skill sincronizzate da claude.ai a `"off"`, tranne project-brief | 12.378 | −3,0k | 2 |

Prezzo di listino della prima chiamata (cache da scrivere): A 0,163 $, E 0,032 $.

**Di cosa è fatto:**
- **≈12,4k fissi e non eliminabili:** prompt di sistema (2,4k) e schemi dei tool di base di Claude Code.
- **Connettori claude.ai (≈7,3k):** sono la voce più pesante. Non pesano gli schemi dei tool, che restano differiti (`/context` ne stima 173k, mai caricati), ma l'elenco dei nomi dei tool e soprattutto le istruzioni dei server MCP (Notion, Memento, Pulso, Celora…). Il peso varia tra un run e l'altro perché i connettori si caricano in modo asincrono: nella prima prova la chiamata era di 22,5k.
- **Descrizioni delle skill (≈9k in totale):** plugin 3,9k (Shopify da solo ha 22 skill), skill sincronizzate da claude.ai 3,0k, skill integrate 2,2k.

**Si possono escludere per progetto?** Sì, tutte quelle viste, con il `.claude/settings.json` del progetto e senza toccare la configurazione utente:
- `enabledPlugins: {"<plugin>@<marketplace>": false}`, compresi i plugin sincronizzati (`@synced`);
- `disableClaudeAiConnectors: true` (equivale a `ENABLE_CLAUDEAI_MCP_SERVERS=false`);
- `disableBundledSkills: true`;
- `skillOverrides: {"<skill>": "off"}`, che funziona anche sulle skill sincronizzate da claude.ai.

`--bare` toglierebbe quasi tutto, ma accetta solo `ANTHROPIC_API_KEY` e non il login con la subscription, quindi non è utilizzabile.

**Attenzione:** la fase 3 usa MementoVault, che oggi arriva come connettore claude.ai. Con i connettori spenti, il progetto deve configurare Memento come server MCP proprio, oppure lasciare i connettori accesi solo dove serve, per esempio non negli heartbeat. L'elenco dei plugin da spegnere dipende da cosa ha installato l'utente: il template non lo conosce in anticipo, quindi `jerome new` deve generarlo.

## Decisione (approvata, registrata come D20)

**Fonte dei consumi:**
1. **I token per agente e per run si leggono dai transcript JSONL, usando gli hook come innesco.** `jerome hook subagent-stop` legge `agent_transcript_path`, mentre `stop` e `session-end` leggono `transcript_path`. In tutti i casi si sommano le righe `assistant` deduplicate per `requestId`, e si salvano modello, input, output, cache read e cache write (1h e 5m). Il costo si stima dalla tabella modelli del seed, non dal `costUSD` del transcript. Si registrano solo i numeri, non il contenuto.
2. **Gli heartbeat girano con `--output-format stream-json`.** La CLI legge `result`, che serve come controllo incrociato dei totali, e `rate_limit_event`, che salva la % della subscription a 5h e a 7 giorni nel DB **globale**, con un timestamp. In questo modo la fase 9 ha una % reale invece di una stima calibrata a mano, e Q2 si riduce di molto.
3. Per le sessioni interattive la % della subscription non è disponibile: il viewer mostra l'ultimo valore letto da un heartbeat, con la sua data.

**Conseguenze sullo schema della fase 5:**
- tabella dei consumi per richiesta o per agente, con session_id, agent_id, agent_type, modello e i quattro contatori dei token;
- tabella globale con le letture della subscription (finestra, utilizzo, reset, letta il).

**Rischio:** il formato dei transcript non è un'interfaccia documentata e stabile. Il parser va tenuto piccolo, isolato e tollerante ai campi mancanti.
