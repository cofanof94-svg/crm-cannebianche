# CRM Direct Holiday

CRM web sopra il PMS **Direct Holiday** (Holiday Canne Bianche Lifestyle Hotel).
Backend Node/Express, frontend HTML5 vanilla, legge in sola lettura dal SQL Server del PMS e usa un DB CRM proprio.

## Avvio rapido

```bash
npm install
# crea .env con le credenziali (chiedile a Mik) — vedi DOCS/HANDOFF.md
npm run seed     # utente admin
npm start        # http://localhost:3000
npm test         # suite (deve essere verde)
```

## 📖 Documentazione

- **[DOCS/HANDOFF.md](DOCS/HANDOFF.md)** — guida completa: setup, architettura, **regole di dominio PMS critiche**, funzionalità, aperti, sicurezza. **Leggila prima di iniziare.**
- `DOCS/2026-07-*` — spec e piani per fase.

## Regole d'oro

- **PMS = SOLA LETTURA** (solo SELECT in `src/pms/`). Il DB CRM è read/write.
- Credenziali **solo in `.env`** (git-ignored), mai in codice/git.
- Node 20 + `mssql@11` (non aggiornare a mssql@12: richiede Node 22).
- La logica del PMS non è intuitiva: vedi §6 dell'HANDOFF prima di toccare le query.
