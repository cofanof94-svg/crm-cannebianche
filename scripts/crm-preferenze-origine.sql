-- Da dove nasce una preferenza: scritta a mano o confermata da un suggerimento
-- dell'AI.
--
-- Oggi le due strade passano dalla stessa chiamata e diventano righe identiche:
-- le preferenze salvate NON si perdono, si perde solo la provenienza. Senza,
-- non si può rispondere a "l'AI ci sta facendo risparmiare tempo o ci stiamo
-- solo rileggendo quello che sapevamo già".
--
-- La colonna è NULLABILE apposta e le righe esistenti restano a NULL: non
-- sappiamo come sono nate le 64 preferenze già scritte, e riempirle con
-- 'manuale' significherebbe inventare un dato. NULL vuol dire "non registrata",
-- che è la verità.
--
-- Idempotente.

IF NOT EXISTS (
  SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_NAME = 'customer_preferences' AND COLUMN_NAME = 'origine'
)
ALTER TABLE customer_preferences ADD origine NVARCHAR(20) NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_preferenze_origine')
ALTER TABLE customer_preferences
  ADD CONSTRAINT CK_preferenze_origine CHECK (origine IS NULL OR origine IN ('manuale', 'ai'));
GO
