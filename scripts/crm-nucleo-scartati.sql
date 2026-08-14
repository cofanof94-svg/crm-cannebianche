-- ============================================================================
-- CRM Direct Holiday — Nucleo di viaggio: memoria delle esclusioni.
--
-- PERCHÉ. Fino al 14/08/2026 la precompilazione del nucleo girava UNA VOLTA
-- SOLA, alla prima apertura della scheda. Sui dati veri questo produceva un
-- nucleo fotografato troppo presto: la scheda dell'ospite 81866 è stata aperta
-- il 07/08 prima del check-in, e i tre accompagnatori registrati poche ore dopo
-- non vi sono mai entrati.
--
-- Da oggi il controllo si rifà a ogni apertura e aggiunge chi è comparso nel
-- frattempo. Perché questo non annulli il lavoro di chi ha corretto a mano,
-- serve ricordarsi CHI È STATO TOLTO: senza questa tabella un accompagnatore
-- cancellato tornerebbe alla riapertura successiva, e sembrerebbe un guasto.
--
-- Idempotente. DB: HolidayCanneBianche_CRM.
-- ============================================================================

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'customer_nucleo_scartati')
CREATE TABLE customer_nucleo_scartati (
  pms_customer_id INT       NOT NULL,          -- Anagra.CodCli: la scheda su cui si guardava
  pms_occupant_id INT       NOT NULL,          -- Anagra.CodCli: la persona tolta dal nucleo
  autore_user_id  INT       NULL,              -- chi l'ha tolta (NULL se l'utente non c'è più)
  created_at      DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  CONSTRAINT PK_nucleo_scartati PRIMARY KEY (pms_customer_id, pms_occupant_id)
);
GO

-- NOTA. customer_nucleo_init (il marcatore "già precompilato") non viene più
-- letto da nessuna parte: il controllo ora si rifà sempre. La tabella resta,
-- perché contiene la data di prima apertura di ogni scheda e cancellarla non
-- restituirebbe niente in cambio. Si può eliminare in futuro, con calma.
GO
