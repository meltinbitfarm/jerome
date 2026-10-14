---
name: project-brief
description: Conduce il briefing iniziale di un nuovo progetto di Fabio e lo salva nel formato standard brief/v1. Usala ogni volta che Fabio vuole partire con un progetto, un prodotto, un tool o una funzionalità nuova ("ho un'idea", "stavo pensando di fare", "facciamo il briefing", "nuovo progetto"), quando dice "salva il brief", "chiudi il brief", "il brief è pronto", o quando chiede di importare un brief ("importa il brief di …") in una cartella di progetto. Vale sia su claude.ai (anche da telefono, spesso con messaggi dettati) sia in Claude Code dentro un progetto creato dal template.
---

# Project brief

Il briefing è il punto di partenza di ogni progetto di Fabio. Lo scopo è arrivare, con poche domande mirate, a un brief compatto che un agente referente in Claude Code possa leggere spendendo pochi token, e da cui proporre gli agenti.

Il formato è in `references/brief-v1.md`: leggilo prima di compilare o importare un brief.

## Come condurre il briefing

- **Ingresso libero.** Fabio spesso detta: messaggi lunghi, disordinati, con errori di trascrizione ("MaldB" = "il DB", "immigration" = "migration"). Interpreta senza farlo notare e non chiedere di riformulare.
- **Una domanda alla volta.** Alla fine di ogni risposta chiedi solo la cosa aperta più importante. Mai elenchi di domande.
- **Spirito critico.** Di' con franchezza cosa esiste già (verifica con una ricerca quando parli di strumenti o funzioni attuali), cosa costa token, cosa è fragile o ipercomplesso. Non assecondare per cortesia.
- **Risposte brevi.** Fabio legge spesso dal telefono: vai al punto, niente premesse.
- **Tieni il conto.** Ogni scelta presa è una decisione con il suo perché. Non rimettere in discussione decisioni già prese, a meno che emerga un problema concreto, e in quel caso dillo esplicitamente.
- **Parcheggio.** Quando Fabio mette un tema in pausa, registralo come parcheggiato e non riproporlo finché non lo riapre lui.
- **Niente agenti nel brief.** La squadra la propone il referente dopo aver letto il brief. Se Fabio ha già idee sugli agenti, annotale in Contesto.

## Quando Fabio chiede di salvare il brief

1. Compila il brief seguendo `references/brief-v1.md`, usando solo ciò che è emerso nella conversazione. Quello che non è stato deciso va in Domande aperte, non inventarlo.
2. `status: ready` solo se Fabio dice che è pronto o che passa allo sviluppo, altrimenti `draft`.
3. Salva secondo l'ambiente (sezione sotto).
4. Rispondi con 2-3 righe: dove l'hai salvato, quante decisioni e domande aperte contiene, e il comando o la frase per riprenderlo.

## Dove salvare: due ambienti

**Claude Code dentro un progetto del template** (la radice della cartella contiene il file marcatore `.odino`):
- Scrivi direttamente i file di progetto come indicato in "Import" in `references/brief-v1.md`.
- Salva anche una copia del brief completo in `brief.md`.

**Qualsiasi altro ambiente** (claude.ai, telefono, Claude Code fuori dal template), con MementoVault disponibile via MCP:
- Cerca una collection esistente per il progetto (graph overview o search). Se non esiste, creala con lo slug del brief.
- Salva il brief come documento `brief` in quella collection (titolo esattamente "Brief", così lo slug è `brief`). Se esiste già, aggiornalo invece di crearne un secondo.
- I documenti accettano circa 4000 caratteri per chiamata: se il brief è più lungo, crea e poi usa append.
- Se MementoVault non è disponibile, mostra il brief in un blocco markdown da copiare e dillo chiaramente.

## Import (solo Claude Code)

Quando Fabio chiede di importare un brief in un progetto del template:
1. Recupera il documento `brief` dalla collection del progetto in MementoVault.
2. Controlla il campo `format`. Se non è `brief/v1`, fermati e segnala la versione.
3. Smista le sezioni nei file come indicato in "Import" in `references/brief-v1.md` e conferma in una riga.
4. Proponi la squadra di agenti solo dopo l'import, come passo separato da far approvare a Fabio.
