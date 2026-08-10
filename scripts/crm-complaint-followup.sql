-- ============================================================================
-- CRM Direct Holiday — "Follow-up" del complaint (come è stato gestito/risolto).
-- Esempi: 'Cambio camera effettuato', 'Upgrade gratuito', 'Omaggio SPA offerto'.
--
-- NON è una nota separata: è una colonna della riga del complaint, quindi resta
-- legata a quel reclamo e segue le stesse regole di lettura (gruppo di fusione),
-- modifica ed eliminazione già in uso.
--
-- I complaint risolti PRIMA di questa evolutiva restano senza follow-up (NULL):
-- il campo è obbligatorio solo per le risoluzioni fatte da qui in avanti, quindi
-- la colonna è NULLable e non serve alcun riempimento retroattivo.
--
-- Idempotente. DB: HolidayCanneBianche_CRM.
-- ============================================================================

IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('customer_complaints') AND name = 'follow_up'
)
  ALTER TABLE customer_complaints ADD follow_up NVARCHAR(500) NULL;
GO

-- Verifica: quanti complaint risolti sono senza follow-up (storici, atteso > 0).
-- SELECT COUNT(*) AS risolti_senza_followup
--   FROM customer_complaints WHERE stato = 'risolto' AND follow_up IS NULL;
