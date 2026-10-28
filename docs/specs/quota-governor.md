# Brief

---
format: brief/v2
name: Jérôme – Quota governor
slug: jerome-quota-governor
status: draft
created: 2026-10-28
source: mobile
---

## Goal
Un coordinatore centrale che legge la quota reale della subscription Claude e distribuisce i run degli agenti Jérôme tra tutti i progetti e tutti i Mac, per arrivare al reset settimanale con almeno il 90% di quota usata, sfruttando bene anche ogni finestra da 5 ore.

## Context
- Jérôme gira su più progetti, su due Mac, con un solo account Claude (Max, ~100 €/mese): la quota è per account, non per Mac.
- Oggi i heartbeat partono come cron locali e il viewer mostra soglie stimate: si arriva al reset con quota avanzata (es. 50%).
- La quota reale (5h, 7 giorni, secchi Opus/Sonnet, con utilization e resets_at) si legge con il token OAuth di Claude Code dall'endpoint non documentato api.anthropic.com/api/oauth/usage.
- La quota settimanale include anche l'uso a mano di Fabio (claude.ai e Claude Code).
- Fabio lavora al Mac quasi tutto il giorno.

## Constraints
- V1: un solo account Claude condiviso da tutti i Mac e da Fabio.
- V2: il coordinatore gira sulla VPS di Fabio; i Mac si collegano solo in uscita.
- V3: Jérôme è repo pubblico MIT: deve restare usabile in locale, senza VPS.
- V4: l'endpoint della quota non è documentato e può cambiare: va isolato in un solo modulo.

## Decisions
- D1: coordinatore centrale sulla VPS come unica fonte di verità, Mac client alla pari — niente master/slave, un Mac spento non blocca nulla, aggiungere un Mac è banale.
- D2: un daemon per Mac (servizio launchd) collegato con `jerome connect <url>` e approvazione del Mac — un solo punto di contatto per macchina, non uno per progetto.
- D3: ogni run parte solo con un permesso a tempo dal coordinatore (progetto, agente, modello, durata massima) — il coordinatore decide quanti agenti girano in tutto.
- D4: i permessi scadono — lo slot di un Mac spento a metà torna libero per l'altro.
- D5: pacing sulla quota reale, non stimata — è per account e include già il consumo di Fabio.
- D6: obiettivo 90%+ settimanale al reset; la finestra 5h è un tetto (~90%) e un'occasione di burst prima del reset — saturare tutte le 5h esaurirebbe la settimana in pochi giorni.
- D7: riserva del 20% della quota settimanale per l'uso a mano di Fabio — deve poter lavorare senza restare bloccato.
- D8: nessuna pausa degli agenti quando Fabio lavora al Mac — ci lavora tutto il giorno e il pacing vede già il suo consumo.
- D9: scelta del modello anche in base ai secchi Opus/Sonnet: lavoro ripetitivo su Sonnet quando Opus è avanti rispetto al target — sfrutta entrambi i secchi.
- D10: ogni progetto tiene un backlog di task riempitivi (test, refactor, ricerca) — senza lavoro in coda non si può saturare.
- D11: se la VPS non risponde, i daemon continuano a passo ridotto — né blocco né ruota libera.
- D12: la quota la legge un daemon con il suo token e la invia al coordinatore — sulla VPS non c'è Claude Code.
- D13: codice, istruzioni e log completi restano in locale; sulla VPS solo stato, code, consumi, digest e decisioni pendenti — il minimo per governare.
- D14: i heartbeat diventano richieste di lavoro con cadenza e priorità, non più cron locali — il coordinatore li esegue al momento giusto.
- D15: coordinatore opzionale: senza `jerome connect` Jérôme funziona in locale come oggi — vedi V3.
- D16: sviluppo in tre fasi: 1) governatore locale con quota reale e pacing su un Mac; 2) coordinatore VPS con daemon, permessi e registro progetti; 3) dashboard unica e bot Telegram sul coordinatore — ogni fase utile da sola.

## Agent limits
- L1: No sending, publishing, deploying, merging to main, purchases or emails: drafts and proposals only (default).

## Tools (optional)
- Claude Code con login subscription su ogni Mac; VPS di Fabio per il coordinatore; bot Telegram (fase 3).

## Open questions
- Q1: se la riserva del 20% non viene usata, va rilasciata agli agenti verso fine settimana? Senza, la saturazione reale può fermarsi intorno all'80%.
- Q2: stack del coordinatore e deploy sulla VPS.
- Q3: come si approva un nuovo Mac (dashboard, Telegram o entrambi).
- Q4: frequenza del battito dei daemon e della lettura quota.
- Q5: le soglie giornaliere/settimanali stimate del viewer vanno tolte o restano per l'uso locale senza coordinatore?
- Q6: fallback se l'endpoint della quota cambia o smette di rispondere.

## Parked
- none

## Out of scope
- Più account Claude o API a consumo.

## Success
- A ogni reset settimanale la quota usata è almeno al 90%.
- Fabio non resta mai bloccato dalla finestra 5h mentre lavora a mano.
- Entrambi i Mac ricevono lavoro; se uno si spegne, l'altro prende gli slot liberi.
