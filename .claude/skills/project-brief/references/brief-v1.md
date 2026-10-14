# Formato brief/v1

Un unico documento markdown, scritto per essere letto dal modello con pochi token.

## Regole

- Una riga per voce. Niente paragrafi, salvo Obiettivo (massimo 3 righe).
- ID brevi e stabili per prefisso: V vincoli, D decisioni, Q domande aperte, P parcheggiate, L limiti. Agenti e log citano "vedi D4" invece di ripetere il testo. Non rinumerare: le voci superate restano e si marcano come superate.
- Ogni decisione ha il suo perché: `D3: decisione — perché`. Senza il perché, più avanti la scelta viene rimessa in discussione.
- Solo ciò che Fabio ha detto o confermato. Ciò che manca va in Domande aperte.
- Le sezioni marcate (opzionale) si omettono se vuote. Le altre restano sempre, anche con "nessuna".

## Modello

```markdown
---
format: brief/v1
name: Nome leggibile
slug: nome-progetto
status: draft        # draft | ready
created: AAAA-MM-GG
source: mobile       # mobile | pc
---

## Obiettivo
Massimo 3 righe: cosa deve esistere alla fine e per chi.

## Contesto
- Solo ciò che il referente non può dedurre da solo.

## Vincoli
- V1: ...

## Decisioni
- D1: decisione — perché

## Limiti agenti
- L1: Niente invii, pubblicazioni, deploy, merge su main, acquisti o mail: solo bozze e proposte (default).

## Strumenti (opzionale)
- MCP, servizi, requisiti sulla macchina.

## Ritmo e consumi (opzionale)
- Urgenza, frequenza heartbeat, priorità di quota rispetto agli altri progetti.

## Domande aperte
- Q1: ...

## Parcheggiate
- P1: tema — quando riparlarne

## Fuori scope
- ...

## Successo
- Come capiamo che funziona.
```

## Import

Quando un brief viene importato in un progetto del template:

| Sezioni del brief | File di progetto |
|---|---|
| Obiettivo, Contesto, Vincoli, Limiti agenti, Strumenti, Ritmo e consumi, Fuori scope, Successo | `PROJECT.md` |
| Decisioni | `decisions.md` |
| Domande aperte, Parcheggiate | `open.md` |

Il brief originale resta in `brief.md` come riferimento. Da quel momento la fonte viva sono i tre file di progetto, non il brief.
