-- ============================================================================
-- CRM Direct Holiday — Anagrafica v2: tabelle per i dati MANUALI (Origine CRM)
-- Deriva da DOCS/2026-07-30-crm-anagrafica-v2-mapping-specs.md (campi 🟢).
-- Idempotente: eseguibile più volte senza errori. DB: HolidayCanneBianche_CRM.
-- Il legame col cliente PMS è logico: pms_customer_id = Anagra.CodCli (no FK cross-db).
-- ============================================================================

-- 1) PROFILO cliente (1:1) — campi singoli manuali. Oggi: lingua preferita.
--    Tabella estendibile per futuri campi anagrafici propri del CRM.
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'customer_profile')
CREATE TABLE customer_profile (
  id              INT IDENTITY(1,1) PRIMARY KEY,
  pms_customer_id INT           NOT NULL UNIQUE,   -- Anagra.CodCli (uno per cliente)
  lingua          NVARCHAR(40)  NULL,              -- es. 'IT', 'EN' (lista aperta lato UI)
  autore_user_id  INT           NULL,
  updated_at      DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME(),
  CONSTRAINT FK_profile_user FOREIGN KEY (autore_user_id) REFERENCES users(id)
);
GO

-- 2) INTOLLERANZE / allergie (N per cliente) — dato di SICUREZZA, separato dalle preferenze.
--    Una riga per intolleranza.
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'customer_intolerances')
CREATE TABLE customer_intolerances (
  id              INT IDENTITY(1,1) PRIMARY KEY,
  pms_customer_id INT           NOT NULL,          -- Anagra.CodCli
  testo           NVARCHAR(200) NOT NULL,          -- es. 'Celiachia', 'Frutta a guscio'
  autore_user_id  INT           NOT NULL,
  created_at      DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME(),
  CONSTRAINT FK_intol_user FOREIGN KEY (autore_user_id) REFERENCES users(id)
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_intol_customer')
CREATE INDEX IX_intol_customer ON customer_intolerances(pms_customer_id);
GO

-- 3) PREFERENZE (N per cliente) — categorizzate per reparto (destinatario) e categoria (tipo).
--    reparto  = lista chiusa: Rooms / F&B / SPA / Front office
--    categoria= lista chiusa: F&B / Camera / Persona / Occasioni / Generale
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'customer_preferences')
CREATE TABLE customer_preferences (
  id              INT IDENTITY(1,1) PRIMARY KEY,
  pms_customer_id INT           NOT NULL,          -- Anagra.CodCli
  reparto         NVARCHAR(20)  NOT NULL,
  categoria       NVARCHAR(20)  NOT NULL,
  testo           NVARCHAR(400) NOT NULL,          -- es. 'Predilige Amarone'
  autore_user_id  INT           NOT NULL,
  created_at      DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME(),
  CONSTRAINT FK_pref_user FOREIGN KEY (autore_user_id) REFERENCES users(id),
  CONSTRAINT CK_pref_reparto  CHECK (reparto  IN (N'Rooms', N'F&B', N'SPA', N'Front office')),
  CONSTRAINT CK_pref_categoria CHECK (categoria IN (N'F&B', N'Camera', N'Persona', N'Occasioni', N'Generale'))
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_pref_customer')
CREATE INDEX IX_pref_customer ON customer_preferences(pms_customer_id);
GO

-- 4) NUCLEO DI VIAGGIO / accompagnatori (N per cliente) — parte manuale.
--    (I nomi degli occupanti effettivi arrivano già dal PMS via Alberg; qui si
--    aggiungono relazione e nota, che il PMS non esporta.)
--    tipo_relazione = lista chiusa: Coniuge / Figlio-a / Genitore / Amico-a / Assistente / Altro
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'customer_travel_party')
CREATE TABLE customer_travel_party (
  id              INT IDENTITY(1,1) PRIMARY KEY,
  pms_customer_id INT           NOT NULL,          -- Anagra.CodCli (cliente di riferimento)
  tipo_relazione  NVARCHAR(20)  NOT NULL,
  nome            NVARCHAR(80)  NULL,
  cognome         NVARCHAR(80)  NULL,
  nota            NVARCHAR(400) NULL,              -- es. 'Celiaca'
  autore_user_id  INT           NOT NULL,
  created_at      DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME(),
  CONSTRAINT FK_party_user FOREIGN KEY (autore_user_id) REFERENCES users(id),
  CONSTRAINT CK_party_rel CHECK (tipo_relazione IN (N'Coniuge', N'Figlio-a', N'Genitore', N'Amico-a', N'Assistente', N'Altro'))
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_party_customer')
CREATE INDEX IX_party_customer ON customer_travel_party(pms_customer_id);
GO

-- 5) CLAIM: aggiunta "periodo indicativo" alla tabella complaints esistente.
--    Testo libero (es. 'ago 2025'); opzionale.
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('customer_complaints') AND name = 'periodo')
ALTER TABLE customer_complaints ADD periodo NVARCHAR(60) NULL;
GO
