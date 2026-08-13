-- Elimina customer_notes, il "diario" interno delle prime specifiche di Fase 2.
--
-- Nessuna riga di src/ o web/ la legge o la scrive: le sue funzioni sono state
-- assorbite dalle preferenze (strutturate, e per questo arrivano ai reparti sul
-- foglio di stampa), dalla nota personale e dai reclami. Restava solo nello
-- schema, dove faceva credere a chi lo legge che ci fosse un blocco note.
--
-- Le due righe presenti al momento dell'eliminazione (13/08/2026), trascritte
-- qui perché non si cancella un dato senza lasciarne traccia:
--
--   id 5 · cliente 78602 (BOUMANS CHARLOTTE) · 28/07/2026 · "test"
--   id 6 · cliente 81304 (LEVY KATE)         · 30/07/2026 · "apprezza il polpo arrosto"
--
-- Entrambe scritte da admin durante una sessione di prova: la seconda a un
-- minuto di distanza da una preferenza e da una lingua sullo stesso ospite.
-- Confermato da Mik il 13/08/2026: sono sue note di test, si eliminano.
--
-- Idempotente: rilanciarlo su un database dove la tabella non c'è più non fa
-- niente.

IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_notes_customer')
  DROP INDEX IX_notes_customer ON customer_notes;
GO

IF EXISTS (SELECT 1 FROM sys.tables WHERE name = 'customer_notes')
  DROP TABLE customer_notes;
GO
