-- Rete di sicurezza: rimette un amministratore attivo quando non ce n'è più
-- nessuno.
--
-- PERCHÉ ESISTE. Il controllo "deve restare almeno un admin attivo" vive
-- nell'applicazione (src/api/admin.js) ed è fatto in due tempi: prima conta gli
-- amministratori, poi scrive. Fra il conteggio e la scrittura c'è una finestra,
-- e nel progetto non esiste nessuna transazione. Due amministratori che si
-- declassano a vicenda nello stesso istante passano tutti e due il controllo, e
-- restano zero.
--
-- A quel punto nessuno ha più il permesso di gestire gli utenti: la pagina
-- Utenti è irraggiungibile per chiunque, e l'unico modo di rientrare è questo
-- file. È la porta che si chiude dall'interno, e questa è la chiave di scorta.
--
-- Trovato il 19/08/2026 durante la revisione del codice; la correzione vera —
-- il controllo dentro la scrittura, con il blocco sulla lettura — va scritta e
-- provata sul database vero, perché il server finto non valida il SQL.
--
-- COME SI USA
--   1. cambia @utente qui sotto se l'account da riabilitare non si chiama 'admin';
--   2. esegui il file sul database CRM (HolidayCanneBianche_CRM);
--   3. leggi il messaggio finale: dice cosa ha fatto.
--
-- È PRUDENTE PER COSTRUZIONE: se un amministratore attivo c'è già, non tocca
-- niente. Si può lanciare per sbaglio senza conseguenze.
--
-- Se invece la tabella degli utenti è VUOTA (può succedere solo con la variante
-- peggiore, due eliminazioni simultanee), questo file non basta: una password
-- non si può generare in SQL. In quel caso serve
--     set ADMIN_PASSWORD=... && npm run seed
-- che crea l'utente 'admin' con la password che scegli tu.

DECLARE @utente NVARCHAR(50) = N'admin';

DECLARE @attivi INT = (SELECT COUNT(*) FROM users WHERE role = 'admin' AND attivo = 1);

IF @attivi > 0
BEGIN
  PRINT CONCAT('Nessuna azione: ci sono già ', @attivi, ' amministratori attivi.');
END
ELSE IF EXISTS (SELECT 1 FROM users WHERE username = @utente)
BEGIN
  UPDATE users SET role = 'admin', attivo = 1 WHERE username = @utente;
  PRINT CONCAT('Ripristinato: ', @utente, ' è di nuovo amministratore attivo.');
END
ELSE IF EXISTS (SELECT 1 FROM users)
BEGIN
  -- L'account indicato non c'è, ma qualcuno in tabella sì: si promuove il più
  -- vecchio, che è quasi sempre quello di servizio creato per primo. Meglio
  -- rientrare da un account esistente che crearne uno nuovo al buio.
  DECLARE @primo NVARCHAR(50) = (SELECT TOP 1 username FROM users ORDER BY id);
  UPDATE users SET role = 'admin', attivo = 1 WHERE username = @primo;
  PRINT CONCAT('Utente "', @utente, '" non trovato. Promosso il più vecchio: ', @primo, '.');
END
ELSE
BEGIN
  PRINT 'La tabella degli utenti è vuota: questo file non può creare una password.';
  PRINT 'Usa:  set ADMIN_PASSWORD=... && npm run seed';
END
GO
