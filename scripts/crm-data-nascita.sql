-- ============================================================================
-- CRM Direct Holiday — colonna customer_profile.data_nascita — NON PIÙ USATA.
--
-- Era nata come override CRM del dato PMS (Anagra.dtNascita) per permettere alla
-- reception di correggere/compilare la data di nascita. Scelta rientrata: due
-- copie dello stesso dato possono divergere e non si sa più quale valga, quindi
-- la data di nascita si legge SOLO dal gestionale e lì si corregge.
--
-- Lo script resta per documentare la colonna, che sul DB di produzione è già
-- stata creata. Nessun codice la legge o la scrive: è innocua (NULLable), ma se
-- si vuole ripulire lo schema basta eseguire, in hotel, la DROP in fondo.
-- DB: HolidayCanneBianche_CRM.
-- ============================================================================

IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('customer_profile') AND name = 'data_nascita'
)
  ALTER TABLE customer_profile ADD data_nascita DATE NULL;
GO

-- Pulizia facoltativa (verificare prima che la colonna sia davvero vuota):
--   SELECT COUNT(*) FROM customer_profile WHERE data_nascita IS NOT NULL;
--   ALTER TABLE customer_profile DROP COLUMN data_nascita;
