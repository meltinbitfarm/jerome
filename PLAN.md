# Piano di sviluppo Jérôme

Basato su PROJECT.md e decisions.md (D1–D19). Ogni fase ha un risultato che Fabio può provare a mano e un criterio di "fatto". Si passa alla fase dopo solo quando la precedente è fatta.

## Fase 0 — Separare lo sviluppo di Jérôme dal template

**Il problema.** Oggi la repo contiene due cose diverse:
- lo stato di sviluppo di Jérôme: PROJECT.md, decisions.md, open.md, brief.md, PLAN.md e il marcatore `.jerome` (Jérôme usa se stesso per gestire il proprio sviluppo);
- il contenuto che finirà in ogni progetto: la skill project-brief e, più avanti, CLAUDE.md del referente, templates/agents/ e la configurazione degli hook.

Se il template è l'intera repo, D1 ("un progetto = una cartella con la repo template clonata") porterebbe in ogni progetto anche le decisioni e il piano di Jérôme.

**Decisione (D17, approvata):** il contenuto del template sta in una sottocartella `template/`, e `jerome new` la copia in una cartella nuova (il template viaggia dentro il pacchetto, D19). Non si clona più l'intera repo.
- Nella radice resta solo ciò che serve per sviluppare Jérôme; in `template/` c'è solo ciò che deve finire nei progetti.
- La skill project-brief ha una sola copia canonica, in `template/.claude/skills/`. La copia usata per sviluppare Jérôme ne è un collegamento, così D14 (un solo metodo di briefing) resta vero.
- Il template non contiene PROJECT.md, decisions.md e open.md: nascono in ogni progetto dal briefing o dall'import.
- Gli aggiornamenti arrivano ai progetti sincronizzando solo i file di proprietà del template, elencati in un manifest. Le migrations li accompagnano (D9). I file di stato del progetto restano fuori.
- Scartate: due repo separate (doppia manutenzione per uno sviluppatore solo) e branch dedicato al template (fragile da tenere allineato).

**D1 è precisato da D17:** "clonata" diventa "creata dal template". Il senso resta lo stesso: un progetto per cartella, autonomo.

**Risultato provabile:** l'albero della repo mostra la radice di sviluppo separata da `template/`, e una cartella creata copiando `template/` non contiene nessun file di sviluppo di Jérôme.
**Fatto quando:** D17 è registrata in decisions.md, la skill è spostata in `template/` con il collegamento per lo sviluppo, e il manifest dei file del template esiste.
**Domande da risolvere prima:** nessuna.

## Fase 0.5 — Verifica rapida dei dati sui consumi

Prova usa e getta, fuori da `template/`: un hook minimo registra su file, senza interpretarlo, tutto ciò che riceve a ogni evento. Poi si fa una sessione di prova in cui il referente delega un compito a un subagent.

Cosa verificare:
- quali eventi arrivano (fine risposta, fine subagent, uso dei tool, fine sessione) e con quali campi;
- se i token (input, output, cache) e il modello sono nel payload dell'hook o solo nel transcript a cui il payload rimanda;
- se i consumi del subagent sono distinguibili da quelli del referente;
- se c'è un costo o un dato utile alla % della subscription;
- per gli heartbeat: cosa restituisce `claude -p` con l'output JSON.

**Risultato provabile:** una nota breve con i campi disponibili, dove si trovano e un esempio reale per ciascuno. Fabio la legge e vede da dove verranno i numeri del viewer.
**Fatto quando:** la nota esiste e la fonte dei dati sui consumi è registrata come decisione. Da quella decisione dipende lo schema della fase 5.
**Domande da risolvere prima:** nessuna.
**Stato: fatta (2026-10-14).** Nota in notes/consumi.md, decisione D20. In più è emerso che:
- anche la status line riceve la % della subscription;
- il costo fisso di avvio scende da ~29k a ~12k token spegnendo per progetto plugin, connettori claude.ai e skill non usate.

## Fase 1 — Comando "nuovo progetto" e controllo del setup

Il pacchetto si installa da GitHub con `npm i -g` (D19). `jerome new <nome>` crea la cartella dal template, inizializza git, crea il marcatore `.jerome` e verifica Node ≥ 24, Claude Code installato e login con la subscription (V3).
Il marcatore `.jerome` va creato esplicitamente da `jerome new`: non è in `template/` né nel MANIFEST, quindi la copia del template non lo porta con sé.
**Risultato provabile:** dopo l'installazione, `jerome new prova` produce una cartella pronta. Senza login, o senza Claude Code, il comando si ferma con un messaggio chiaro.
**Fatto quando:** installazione e comando funzionano sia su una macchina pulita sia con il login mancante, e rilanciare il comando su una cartella esistente non sovrascrive nulla.
**Domande da risolvere prima:** nessuna. La parte CLI di Q5 è risolta da D19.

## Fase 2 — Il referente in CLAUDE.md

Il CLAUDE.md del template definisce il referente:
- all'avvio legge PROJECT.md, decisions.md e open.md, non l'intero storico;
- è l'unico che aggiorna quei tre file (D7);
- cita le voci per ID ("vedi D4") invece di ripeterle;
- rispetta i limiti L1;
- quando serve Fabio, chiude con una "decisione richiesta" (D13).

**Risultato provabile:** in un progetto di prova con i tre file già compilati, Fabio apre Claude Code e chiede "a che punto siamo". Il referente risponde citando gli ID. Se gli si chiede un deploy, propone una bozza e non lo esegue.
**Fatto quando:** le due prove passano in una sessione nuova, e CLAUDE.md resta corto (pochi token caricati a ogni sessione, V1).
**Domande da risolvere prima:** nessuna.

## Fase 3 — Briefing e import nel template

La skill project-brief funziona dentro un progetto creato dal template, in entrambi i flussi di D15:
- da PC, il briefing in Claude Code scrive subito i file;
- da telefono, il brief in MementoVault viene importato al PC.

L'import diventa un passo del comando "nuovo progetto": nome del progetto, recupero del brief e file pronti.
**Risultato provabile:** da un brief salvato dal telefono, un solo comando porta a un progetto con il referente pronto (Successo 1). Rifacendo il briefing sull'idea iniziale di Jérôme si arriva alle stesse decisioni (Successo 2).
**Fatto quando:** entrambi i criteri di Successo passano, e un brief con formato diverso da brief/v1 viene rifiutato con un messaggio.
**Domande da risolvere prima:** nessuna. Va però verificato come il progetto accede a MementoVault: MCP configurato nel template o a livello utente.

## Fase 4 — Regole di creazione dei subagent

Dopo il brief, il referente propone la squadra e la crea solo dopo l'approvazione di Fabio. Parte dal catalogo in templates/agents/ (D10). Per ogni agente:
- un modello adatto al compito (D5);
- input sotto forma di percorsi di file e output come una sintesi breve, con il dettaglio scritto su file (D4);
- solo subagent, mai Agent Teams (D3).

**Risultato provabile:** su un progetto di prova il referente propone una squadra, Fabio la approva, e un subagent esegue un compito. Il referente riceve poche righe di sintesi e il dettaglio si trova su file.
**Fatto quando:** gli agenti creati hanno il modello dichiarato, nessuno usa il modello grosso senza motivo, e la sintesi restituita sta entro un limite fissato nelle regole.
**Domande da risolvere prima:** nessuna.

## Fase 5 — Database SQLite e migrations

Migrations SQL numerate nel pacchetto, applicate dalla CLI con `node:sqlite` (D19). `jerome new` crea il DB del progetto in modalità WAL e il DB globale in ~/.config/jerome/ (D9, D12). Il seed contiene solo dati di riferimento: stati, tipi evento, budget di default e tabella modelli (D10).
**Risultato provabile:** un progetto nuovo ha il DB creato da `jerome new`. Aggiungendo una migration e applicandola con la CLI, i dati esistenti restano. Il file .db non compare in git.
**Fatto quando:** le tre prove passano sia per il DB di progetto sia per quello globale.
**Domande da risolvere prima:**
- ~~esito della fase 0.5~~ risolto da D20: consumi per agente e per run (modello, input, output, cache read e cache write) nel DB di progetto, letture della subscription nel DB globale;
- Q4: se la gerarchia Company → progetto → agenti resta, va prevista nello schema globale fin da subito;
- Q2 e Q3 non bloccano, perché i valori di default sono righe del seed modificabili in seguito.

## Fase 6 — Tracciamento con hook

Il template configura gli hook di Claude Code in modo che chiamino `jerome hook <evento>` (D19), che scrive nel DB eventi, run e consumi di token per agente. Il modello li interroga via bash (D8); qui si decide se con script o con un comando della CLI. L'avviso sperimentale di `node:sqlite` va soppresso, così non finisce nell'output degli hook. Il modello non spende token per scrivere i log.
**Risultato provabile:** dopo una sessione con un subagent, uno script mostra gli eventi e i token per agente e per run. Il dato coincide, a grandi linee, con quanto riporta Claude Code.
**Fatto quando:** ogni run e ogni subagent lascia una riga di log (D13, primo livello), e nessuna chiamata a tool del modello serve per il tracciamento.
**Domande da risolvere prima:** nessuna. Il rischio sui dati dei consumi è già stato verificato nella fase 0.5.

## Fase 7 — Viewer in sola lettura

Viewer locale separato dall'esecuzione (D11): struttura degli agenti, messaggi, log, report, token e costo stimato. Per ora non mostra la % della subscription.
**Risultato provabile:** Fabio apre il viewer su un progetto con qualche run e vede gli agenti e i consumi. Spegnendo il viewer durante un run, il run continua senza errori.
**Fatto quando:** il viewer legge solo dal DB e dai file, non scrive mai, e si avvia con `jerome view`.
**Domande da risolvere prima:**
- Q5, parte viewer (stack dell'interfaccia; il comando è `jerome view`);
- Q4 (se il grafo drag fa parte del viewer o di una fase successiva).

## Fase 8 — Heartbeat

Uno scheduler lancia `claude -p` headless con permessi preconfigurati, un lock anti-sovrapposizione e un budget per run (D6). Il referente produce un digest periodico (D13, secondo livello).
**Risultato provabile:**
- un heartbeat programmato esegue un compito e lascia la sua riga di log;
- un secondo heartbeat lanciato in contemporanea si ferma per il lock;
- un run che supera il budget viene interrotto;
- il digest compare dove previsto.

**Fatto quando:** le quattro prove passano, e un heartbeat non esegue mai azioni vietate da L1.
**Domande da risolvere prima:** Q3 (frequenza e budget per run di default).

## Fase 9 — Soglie, pausa e % della subscription

Soglie giornaliere e settimanali per progetto e globali; quelle globali sono in % delle finestre a 5 ore e a 7 giorni (D20). Oltre una soglia, gli heartbeat vanno in pausa automatica (V4, D12). Il viewer mostra la % della subscription letta da Claude Code (D20).
**Risultato provabile:**
- con una soglia di progetto bassa, il prossimo heartbeat non parte e lo stato di pausa è visibile;
- con una soglia globale bassa, la pausa vale per due progetti diversi;
- il viewer mostra la %.

**Fatto quando:** le prove passano, la pausa si toglie in modo esplicito, e i consumi per progetto sono visibili e sotto controllo (Successo 3).
**Domande da risolvere prima:** Q2, ridotta da D20 alle sole soglie per progetto.

## Domande aperte per fase

| Domanda | Da risolvere prima della fase |
|---|---|
| Q5 (parte CLI) | risolta da D19 |
| Q4 | 5 (schema) e 7 (viewer) |
| Q5 (parte viewer) | 7 |
| Q3 | 8 |
| Q2 | 9 |

Restano fuori dal piano P1 e P2 (parcheggiate) e il Fuori scope di PROJECT.md.
