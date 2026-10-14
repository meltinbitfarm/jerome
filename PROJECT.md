# Odino

Fonte: brief.md (brief/v1, importato da MementoVault agent-orchestrator il 2026-10-14). Da qui la fonte viva sono PROJECT.md, decisions.md, open.md.

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

## Limiti agenti
- L1: Niente invii, pubblicazioni, deploy, merge su main, acquisti o mail: solo bozze e proposte (default).

## Strumenti
- Claude Code (subscription), SQLite, MementoVault via MCP.

## Fuori scope
- Un'interfaccia propria per dialogare con gli agenti.
- Agent Teams.

## Successo
- Da un brief salvato dal telefono, al PC un solo comando porta a un progetto con il referente pronto.
- Il briefing rifatto sull'idea iniziale di questa chat arriva alle stesse decisioni.
- Consumi per progetto visibili e sotto controllo grazie alle soglie.
