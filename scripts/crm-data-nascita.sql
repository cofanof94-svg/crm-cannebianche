-- ============================================================================
-- CRM Direct Holiday — Data di nascita del cliente (EVO-010).
-- Il PMS (Anagra.dtNascita) è in SOLA LETTURA: per rendere il dato modificabile
-- dalla reception si tiene un override sul CRM. Il valore CRM, quando presente,
-- vince sul dato PMS; svuotandolo si torna al dato del gestionale.
-- Aggiunge una colonna a customer_profile (tabella 1:1 già esistente). Idempotente.
-- DB: HolidayCanneBianche_CRM.
-- ============================================================================

IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('customer_profile') AND name = 'data_nascita'
)
  ALTER TABLE customer_profile ADD data_nascita DATE NULL;
GO
