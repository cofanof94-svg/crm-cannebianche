-- ============================================================================
-- CRM Direct Holiday — "Note personali" del cliente (info biografiche/ruoli).
-- Campo libero 1:1, distinto dalle preferenze e dalle intolleranze. Compilabile
-- dalla reception e popolabile dal Guest Briefing AI (cariche, ruoli pubblici, ecc.).
-- Aggiunge una colonna a customer_profile (tabella 1:1 già esistente). Idempotente.
-- DB: HolidayCanneBianche_CRM.
-- ============================================================================

IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('customer_profile') AND name = 'note_personali'
)
  ALTER TABLE customer_profile ADD note_personali NVARCHAR(MAX) NULL;
GO
