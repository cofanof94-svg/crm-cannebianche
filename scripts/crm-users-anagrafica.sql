IF COL_LENGTH('users','nome')    IS NULL ALTER TABLE users ADD nome    NVARCHAR(60)  NULL;
IF COL_LENGTH('users','cognome') IS NULL ALTER TABLE users ADD cognome NVARCHAR(60)  NULL;
IF COL_LENGTH('users','email')   IS NULL ALTER TABLE users ADD email   NVARCHAR(120) NULL;
