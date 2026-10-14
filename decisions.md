# Decisioni

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
