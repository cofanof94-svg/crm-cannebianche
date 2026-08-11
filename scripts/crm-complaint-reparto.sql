-- ============================================================================
-- CRM Direct Holiday — Reparto e categoria sul complaint.
--
-- REPARTO: stessa lista chiusa delle preferenze (Rooms / F&B / SPA / Front
-- office). Deliberatamente identica: è la dimensione con cui si segregheranno i
-- dati per reparto, e due liste diverse renderebbero impossibile incrociarle.
--
-- CATEGORIA: lista PROPRIA, diversa da quella delle preferenze. Le categorie
-- delle preferenze (F&B, Camera, Persona, Occasioni, Generale) descrivono un
-- gradimento; un reclamo ha bisogno di dire cosa NON ha funzionato. È anche ciò
-- che rende sensata la futura analisi "tipologie di reclamo più frequenti".
--
-- Entrambe NULLABLE: i reclami inseriti prima di oggi non hanno queste
-- informazioni e non è possibile dedurle dal testo libero. Restano "non
-- classificati"; l'obbligo vale solo per i nuovi, ed è imposto dall'API.
-- Per lo stesso motivo i CHECK ammettono NULL.
--
-- Idempotente. DB: HolidayCanneBianche_CRM.
-- ============================================================================

IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('customer_complaints') AND name = 'reparto'
)
  ALTER TABLE customer_complaints ADD reparto NVARCHAR(20) NULL;
GO

IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('customer_complaints') AND name = 'categoria'
)
  ALTER TABLE customer_complaints ADD categoria NVARCHAR(30) NULL;
GO

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_compl_reparto')
  ALTER TABLE customer_complaints ADD CONSTRAINT CK_compl_reparto
    CHECK (reparto IS NULL OR reparto IN (N'Rooms', N'F&B', N'SPA', N'Front office'));
GO

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_compl_categoria')
  ALTER TABLE customer_complaints ADD CONSTRAINT CK_compl_categoria
    CHECK (categoria IS NULL OR categoria IN (
      N'Pulizia', N'Manutenzione', N'Rumore', N'Servizio',
      N'Cibo e bevande', N'Attesa', N'Conto', N'Altro'));
GO

-- Verifica: quanti reclami restano senza classificazione (storici, atteso > 0).
-- SELECT COUNT(*) AS non_classificati
--   FROM customer_complaints WHERE reparto IS NULL OR categoria IS NULL;
