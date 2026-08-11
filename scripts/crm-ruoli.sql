-- Ruoli utente: allineamento ai tre ruoli della Fase 1.
--
--   readonly   consulta e basta
--   reception  piena operatività sul cliente
--   admin      reception + gestione utenti + funzioni direzionali
--
-- La colonna users.role è NVARCHAR(20) e NON ha un CHECK: nessuna modifica di
-- schema è necessaria. Questo script sistema solo i DATI, cioè gli utenti che
-- hanno un ruolo non più previsto (tipicamente il vecchio 'marketing').
--
-- Sicuro anche senza lanciarlo: un ruolo sconosciuto viene già trattato come sola
-- lettura dall'applicazione (src/auth/permessi.js). Lo script serve a mettere in
-- chiaro nel database quello che l'applicazione fa comunque, così chi guarda la
-- pagina Utenti vede un ruolo vero invece di un'etichetta gialla "non previsto".
--
-- Idempotente: rilanciarlo non fa danni.
--
--   sqlcmd -S CB-DH -d HolidayCanneBianche_CRM -i scripts/crm-ruoli.sql

SET NOCOUNT ON;

-- 1. Cosa c'è adesso. Da leggere PRIMA di decidere: se comparissero ruoli che non
--    ci si aspetta, meglio guardarli uno per uno che convertirli alla cieca.
PRINT '--- Ruoli presenti nella tabella users ---';
SELECT role AS ruolo, COUNT(*) AS utenti, SUM(CAST(attivo AS INT)) AS attivi
FROM users
GROUP BY role
ORDER BY role;

-- 2. Il ruolo 'marketing' non esiste più. Se in hotel non ne è mai stato creato
--    nessuno questa riga non tocca niente: resta come rete, perché un utente
--    dimenticato costa più di una UPDATE che aggiorna zero righe.
--    Era comunque un profilo di consultazione: diventa 'readonly', senza guadagnare
--    nessun permesso rispetto a quelli che ha già oggi.
UPDATE users SET role = 'readonly' WHERE role = 'marketing';
PRINT CONCAT('Utenti marketing convertiti in readonly: ', @@ROWCOUNT);

-- 3. Chi resta fuori dai tre ruoli previsti. NON si tocca in automatico: un valore
--    inatteso va guardato da una persona, non convertito da uno script.
IF EXISTS (SELECT 1 FROM users WHERE role NOT IN ('readonly', 'reception', 'admin'))
BEGIN
  PRINT '';
  PRINT 'ATTENZIONE: ci sono utenti con un ruolo non previsto (elencati qui sotto).';
  PRINT 'Nell''applicazione possono solo consultare. Assegnare loro un ruolo dalla pagina Utenti.';
  SELECT id, username, role AS ruolo_non_previsto, attivo FROM users
  WHERE role NOT IN ('readonly', 'reception', 'admin')
  ORDER BY username;
END

-- 4. Deve restare almeno un amministratore attivo, altrimenti nessuno può più
--    gestire gli utenti e si rientra solo mettendo le mani nel database.
IF NOT EXISTS (SELECT 1 FROM users WHERE role = 'admin' AND attivo = 1)
BEGIN
  PRINT '';
  PRINT 'ATTENZIONE: nessun amministratore attivo. Promuovere un utente prima di uscire:';
  PRINT '  UPDATE users SET role = ''admin'' WHERE username = ''<nome utente>'';';
END

PRINT '';
PRINT '--- Situazione finale ---';
SELECT role AS ruolo, COUNT(*) AS utenti FROM users GROUP BY role ORDER BY role;
GO
