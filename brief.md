---
format: brief/v1
name: Odino
slug: agent-orchestrator
status: ready
created: 2026-10-14
source: mobile
---

## Obiettivo
Repo template da clonare in una cartella per ogni nuovo progetto, basata su Claude Code con subscription: un agente referente fa il briefing, crea i subagent necessari, li orchestra e riporta a Fabio. Un'alternativa snella e parca di token agli strumenti di orchestrazione già provati.

## Contesto
- Altri strumenti di orchestrazione provati erano troppo pesanti per il flusso di lavoro di Fabio: serve qualcosa di più snello.
- Fabio parte di solito con un briefing in chat, spesso dettato dal telefono, poi passa al PC: il tool deve facilitare proprio questo avvio.
- Esiste un design precedente (grafo drag, gerarchia Company → progetto → agenti), vedi Q4.

## Vincoli
- V1: Consumo di token minimo, anche nell'interazione tra agenti: priorità assoluta.
- V2: Snello e veloce, poco codice, setup senza problemi.
- V3: Gira su Claude Code con login subscription; il setup verifica installazione e login.
- V4: Pausa automatica oltre soglie di consumo giornaliere e settimanali.

## Decisioni
- D1: Un progetto = una cartella con la repo template clonata — progetti autonomi e semplici da avviare.
- D2: Si parla col referente in Claude Code normale (terminale o VS Code), senza CLI/TUI propria — non duplicare ciò che Claude Code fa già bene.
- D3: Subagent, non Agent Teams — le Teams consumano diverse volte tanto.
- D4: Il referente passa ai subagent percorsi di file, non contenuti; i subagent restituiscono una sintesi breve e scrivono il dettaglio su file — il contesto del referente cresce lentamente.
- D5: Modello per agente: modello grosso solo sul referente, Sonnet/Haiku per ricerca e lavoro ripetitivo — risparmio di quota.
- D6: Heartbeat: uno scheduler lancia `claude -p` headless con permessi preconfigurati, lock anti-sovrapposizione e budget per run — lavoro autonomo in background.
- D7: Stato narrativo in markdown corti (PROJECT.md, decisions.md, open.md) aggiornati solo dal referente — niente conflitti, sessioni che ripartono senza rileggere tutto.
- D8: SQLite per eventi, log e consumi, scritto da hook e script; il modello lo interroga via script bash, non via MCP — zero token per scrivere, nessun overhead fisso di tool.
- D9: Il file .db non è versionato: migrations SQL numerate nella repo, DB creato al setup, modalità WAL — niente binari in git, aggiornamenti senza perdere dati.
- D10: Seed solo per dati di riferimento (stati, tipi evento, budget di default, tabella modelli); catalogo dei modelli di agente come markdown in templates/agents/ — agenti e obiettivi nascono dal briefing, non da strutture rigide.
- D11: Viewer locale in sola lettura, separato dall'esecuzione: struttura agenti, messaggi, log, report, token, costo e % stimata della subscription — se si rompe, gli agenti continuano a lavorare.
- D12: Soglie su due livelli, per progetto e globale (DB globale in ~/.config/odino/) — la subscription è unica e condivisa tra progetti.
- D13: Report: riga di log per run, digest periodico del referente, "decisione richiesta" quando serve Fabio — per sapere sempre cosa è stato fatto.
- D14: Brief in formato brief/v1 con la skill project-brief; la fonte di verità è nella repo (.claude/skills/), copia caricata su claude.ai — un solo metodo di briefing ovunque.
- D15: Partenza da telefono: brief salvato in MementoVault e importato al PC; partenza da PC: briefing in Claude Code con file scritti subito — l'avvio da telefono è il caso tipico.
- D16: Il tool si chiama Odino; marcatore di progetto `.odino` nella radice — scelta di Fabio, risolve Q1.

## Limiti agenti
- L1: Niente invii, pubblicazioni, deploy, merge su main, acquisti o mail: solo bozze e proposte (default).

## Strumenti
- Claude Code (subscription), SQLite, MementoVault via MCP.

## Domande aperte
- Q1: (superata, vedi D16) Nome del tool.
- Q2: Come impostare e calibrare il budget di riferimento per la % stimata della subscription.
- Q3: Frequenza degli heartbeat e budget per run di default.
- Q4: Il design precedente (grafo drag, gerarchia Company) è abbandonato o è una fase successiva?
- Q5: Stack di CLI minima e viewer.

## Parcheggiate
- P1: Telegram / Claude Code Channels per parlare al referente, con notifiche in uscita via script — quando il nucleo funziona.
- P2: Avvio a zero passaggi (Mac Mini che crea il progetto da solo dai brief in MementoVault) — non interessa per ora.

## Fuori scope
- Un'interfaccia propria per dialogare con gli agenti.
- Agent Teams.

## Successo
- Da un brief salvato dal telefono, al PC un solo comando porta a un progetto con il referente pronto.
- Il briefing rifatto sull'idea iniziale di questa chat arriva alle stesse decisioni.
- Consumi per progetto visibili e sotto controllo grazie alle soglie.
