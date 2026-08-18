// Dati finti per il server di sviluppo (scripts/dev-mock.js).
//
// Servono a lavorare su frontend e backend quando il DB dell'hotel non è
// raggiungibile (fuori dalla rete: `getaddrinfo ENOTFOUND cb-dh`). Le forme dei
// record rispecchiano quelle reali osservate sul PMS: camere multiple per pratica,
// note lunghissime, tariffe a gradini nella pianificazione, occupanti per camera.
// Nomi e importi sono inventati.
//
// La "data di lavoro" è calcolata da oggi, così gli arrivi e i soggiorni in corso
// restano sempre coerenti con il giorno in cui si sviluppa.

const giorno = 86400000;
const iso = (d) => new Date(d).toISOString().slice(0, 10);
const oggi = new Date(`${iso(Date.now())}T00:00:00Z`).getTime();
const piu = (n) => iso(oggi + n * giorno);

const DATA_LAVORO = piu(0);

// --- Anagrafiche -----------------------------------------------------------
// CodVip: 'V1' classificazione, 'IN' ospite indesiderato, vuoto = nessuna.
const ANAGRAFICHE = [
  { CodCli: 1001, Cognome: 'TOSTI', Nome: 'CARLO', email: 'c.tosti@example.it', Telefono: '0805551001', Cellulare: '3391001001', Citta: 'BARI', CodNaz: 'I', dtNascita: '1968-04-12', CodFis: 'TSTCRL68D12A662X', CodVip: 'V1', DesVip: 'BOLLICINE + FRUTTA FRESCA', Annotazioni: 'Cliente storico, sempre stessa camera.', Privacy: 'N', Privacy2: 'N', PrivacyConservaDati: 'N', PrivacyCessioneDati: 'S' },
  // Allergia scritta nell'ANAGRAFICA e non nella nota della prenotazione (70102,
  // che infatti non ha note): è il caso che il 13/08/2026 in hotel riguardava due
  // ospiti in camera. Deve comparire in card e nella scheda col nome già
  // attribuito, senza tendina — la frase sta sulla sua anagrafica.
  { CodCli: 1002, Cognome: 'HEUSER', Nome: 'HENRY MICHAEL', email: 'h.heuser@example.com', Telefono: '', Cellulare: '+4915112345', Citta: 'MÜNCHEN', CodNaz: 'D', dtNascita: null, CodFis: '', CodVip: '', DesVip: null, Annotazioni: 'ALLERGIA CROSTACEI, MITILI E COZZE', Privacy: 'N', Privacy2: 'S', PrivacyConservaDati: 'N', PrivacyCessioneDati: 'S' },
  { CodCli: 1003, Cognome: 'HAEFLIGER', Nome: 'SANDRA', email: 's.haefliger@example.ch', Telefono: '', Cellulare: '+41791234567', Citta: 'ZÜRICH', CodNaz: 'CH', dtNascita: '1979-08-30', CodFis: '', CodVip: '', DesVip: null, Annotazioni: '', Privacy: 'N', Privacy2: 'N', PrivacyConservaDati: 'N', PrivacyCessioneDati: 'N' },
  { CodCli: 1004, Cognome: 'PAGLIUSO', Nome: 'ROBERT RALPH', email: 'rr.pagliuso@example.com', Telefono: '', Cellulare: '+13475550142', Citta: 'NEW YORK', CodNaz: 'USA', dtNascita: '1971-02-19', CodFis: '', CodVip: 'V1', DesVip: 'BOLLICINE + FRUTTA FRESCA', Annotazioni: 'Gruppo famiglia, 4 camere.', Privacy: 'N', Privacy2: 'N', PrivacyConservaDati: 'N', PrivacyCessioneDati: 'S' },
  { CodCli: 1005, Cognome: 'BORSOS', Nome: 'ANNAMÁRIA', email: 'a.borsos@example.hu', Telefono: '', Cellulare: '+36301234567', Citta: 'BUDAPEST', CodNaz: 'H', dtNascita: null, CodFis: '', CodVip: '', DesVip: null, Annotazioni: '', Privacy: 'S', Privacy2: 'S', PrivacyConservaDati: 'N', PrivacyCessioneDati: 'S' },
  { CodCli: 1006, Cognome: 'DI PIETRANGELO', Nome: 'CARMINE', email: 'c.dipietrangelo@example.it', Telefono: '0805551006', Cellulare: '3391006006', Citta: 'FOGGIA', CodNaz: 'I', dtNascita: '1962-11-03', CodFis: 'DPTCMN62S03D643K', CodVip: 'IN', DesVip: 'OSPITE INDESIDERATO', Annotazioni: 'Contestazioni ripetute sul conto.', Privacy: 'S', Privacy2: 'S', PrivacyConservaDati: 'S', PrivacyCessioneDati: 'S' },
  { CodCli: 1007, Cognome: 'SILLANO', Nome: 'CINZIA', email: 'c.sillano@example.it', Telefono: '', Cellulare: '3391007007', Citta: 'TORINO', CodNaz: 'I', dtNascita: '1974-06-21', CodFis: 'SLLCNZ74H61L219R', CodVip: 'V1', DesVip: 'BOLLICINE + FRUTTA FRESCA', Annotazioni: '', Privacy: 'N', Privacy2: 'N', PrivacyConservaDati: 'N', PrivacyCessioneDati: 'N' },
  { CodCli: 1008, Cognome: 'ANDERSEN', Nome: 'ERIK THOGER', email: 'e.andersen@example.dk', Telefono: '', Cellulare: '+4520123456', Citta: 'AARHUS', CodNaz: 'DK', dtNascita: null, CodFis: '', CodVip: '', DesVip: null, Annotazioni: '', Privacy: 'N', Privacy2: 'N', PrivacyConservaDati: 'N', PrivacyCessioneDati: 'N' },
  // occupanti / accompagnatori
  { CodCli: 1101, Cognome: 'TOSTI', Nome: 'GIULIA', email: '', Telefono: '', Cellulare: '', Citta: 'BARI', CodNaz: 'I', dtNascita: '1972-09-15', CodFis: '', CodVip: '', DesVip: null, Annotazioni: '', Privacy: 'N', Privacy2: 'N', PrivacyConservaDati: 'N', PrivacyCessioneDati: 'N' },
  { CodCli: 1102, Cognome: 'PAGLIUSO', Nome: 'ROSEMARIE', email: '', Telefono: '', Cellulare: '', Citta: 'NEW YORK', CodNaz: 'USA', dtNascita: piu(0).replace(/^\d{4}/, '1968'), CodFis: '', CodVip: '', DesVip: null, Annotazioni: '', Privacy: 'N', Privacy2: 'N', PrivacyConservaDati: 'N', PrivacyCessioneDati: 'N' },
  // compleanno OGGI, dentro il soggiorno della pratica 70104: serve a vedere la
  // ricorrenza (e il nome cliccabile) nelle card senza dover forzare i dati
  { CodCli: 1103, Cognome: 'PAGLIUSO', Nome: 'NATALIA', email: '', Telefono: '', Cellulare: '', Citta: 'NEW YORK', CodNaz: 'USA', dtNascita: piu(0).replace(/^\d{4}/, '2014'), CodFis: '', CodVip: '', DesVip: null, Annotazioni: '', Privacy: 'N', Privacy2: 'N', PrivacyConservaDati: 'N', PrivacyCessioneDati: 'N' },
  // Terzo festeggiato della stessa pratica, ma in un altro giorno: cosi la card
  // mostra insieme i due casi veri misurati il 14/08/2026 — due persone nello
  // stesso giorno (data scritta una volta sola) e una in un giorno diverso.
  { CodCli: 1110, Cognome: 'PAGLIUSO', Nome: 'NICOLAS', email: '', Telefono: '', Cellulare: '', Citta: 'NEW YORK', CodNaz: 'USA', dtNascita: piu(1).replace(/^\d{4}/, '2009'), CodFis: '', CodVip: '', DesVip: null, Annotazioni: '', Privacy: 'N', Privacy2: 'N', PrivacyConservaDati: 'N', PrivacyCessioneDati: 'N' },
  { CodCli: 1104, Cognome: 'HAEFLIGER', Nome: 'MARKUS', email: '', Telefono: '', Cellulare: '', Citta: 'ZÜRICH', CodNaz: 'CH', dtNascita: null, CodFis: '', CodVip: '', DesVip: null, Annotazioni: '', Privacy: 'N', Privacy2: 'N', PrivacyConservaDati: 'N', PrivacyCessioneDati: 'N' },
  // duplicato volutamente simile a 1001 (stesso cognome/nome/data di nascita)
  { CodCli: 1201, Cognome: 'TOSTI', Nome: 'CARLO', email: 'carlo.tosti@example.it', Telefono: '', Cellulare: '3391001001', Citta: 'BARI', CodNaz: 'I', dtNascita: '1968-04-12', CodFis: '', CodVip: '', DesVip: null, Annotazioni: '', Privacy: 'N', Privacy2: 'N', PrivacyConservaDati: 'N', PrivacyCessioneDati: 'N' },

  // --- Ospiti degli arrivi dei prossimi giorni (vedi PRENOTAZIONI) ----------
  { CodCli: 1009, Cognome: 'ZANARDELLI', Nome: 'GIORGIO', email: 'g.zanardelli@example.it', Telefono: '', Cellulare: '3351009009', Citta: 'BRESCIA', CodNaz: 'I', dtNascita: '1970-03-08', CodFis: '', CodVip: 'V1', DesVip: 'BOLLICINE + FRUTTA FRESCA', Annotazioni: 'Cliente affezionato, viene ogni estate.', Privacy: 'N', Privacy2: 'N', PrivacyConservaDati: 'N', PrivacyCessioneDati: 'S' },
  // compleanno DURANTE il soggiorno (+3 giorni): la ricorrenza deve comparire in card
  { CodCli: 1010, Cognome: 'KOVÁCS', Nome: 'ESZTER', email: 'e.kovacs@example.hu', Telefono: '', Cellulare: '+36302223344', Citta: 'DEBRECEN', CodNaz: 'H', dtNascita: piu(3).replace(/^\d{4}/, '1979'), CodFis: '', CodVip: '', DesVip: null, Annotazioni: '', Privacy: 'N', Privacy2: 'N', PrivacyConservaDati: 'N', PrivacyCessioneDati: 'N' },
  { CodCli: 1011, Cognome: 'RUSSO', Nome: 'MARIANNA', email: 'm.russo@example.it', Telefono: '', Cellulare: '3401011011', Citta: 'NAPOLI', CodNaz: 'I', dtNascita: '1988-12-01', CodFis: '', CodVip: '', DesVip: null, Annotazioni: '', Privacy: 'N', Privacy2: 'N', PrivacyConservaDati: 'N', PrivacyCessioneDati: 'N' },
  { CodCli: 1012, Cognome: 'BIANCHI', Nome: 'FEDERICO', email: 'f.bianchi@example.it', Telefono: '', Cellulare: '3491012012', Citta: 'ROMA', CodNaz: 'I', dtNascita: '1965-07-19', CodFis: '', CodVip: 'IN', DesVip: 'OSPITE INDESIDERATO', Annotazioni: 'Contestazioni ripetute, valutare con la direzione.', Privacy: 'S', Privacy2: 'S', PrivacyConservaDati: 'S', PrivacyCessioneDati: 'S' },
  { CodCli: 1013, Cognome: 'DUBOIS', Nome: 'CLAIRE', email: 'c.dubois@example.fr', Telefono: '', Cellulare: '+33612345678', Citta: 'LYON', CodNaz: 'F', dtNascita: '1982-05-23', CodFis: '', CodVip: '', DesVip: null, Annotazioni: '', Privacy: 'N', Privacy2: 'N', PrivacyConservaDati: 'N', PrivacyCessioneDati: 'N' },
  { CodCli: 1014, Cognome: 'SCHMIDT', Nome: 'LUKAS', email: 'l.schmidt@example.de', Telefono: '', Cellulare: '+491701234567', Citta: 'HAMBURG', CodNaz: 'D', dtNascita: '1976-09-30', CodFis: '', CodVip: '', DesVip: null, Annotazioni: '', Privacy: 'N', Privacy2: 'N', PrivacyConservaDati: 'N', PrivacyCessioneDati: 'S' },
  // Stessa allergia scritta in due posti: qui in anagrafica, e nella nota della
  // prenotazione 70211 ("Ospite intollerante al lattosio"). Deve uscire UNA
  // proposta sola, quella con il nome già attribuito.
  { CodCli: 1016, Cognome: 'CONTE', Nome: 'VALERIA', email: 'v.conte@example.it', Telefono: '', Cellulare: '3281016016', Citta: 'LECCE', CodNaz: 'I', dtNascita: '1985-04-27', CodFis: '', CodVip: '', DesVip: null, Annotazioni: 'Intollerante al lattosio.', Privacy: 'N', Privacy2: 'N', PrivacyConservaDati: 'N', PrivacyCessioneDati: 'N' },
  { CodCli: 1015, Cognome: 'AL-FARSI', Nome: 'NOURA', email: 'n.alfarsi@example.com', Telefono: '', Cellulare: '+971501234567', Citta: 'DUBAI', CodNaz: 'UAE', dtNascita: null, CodFis: '', CodVip: 'V1', DesVip: 'BOLLICINE + FRUTTA FRESCA', Annotazioni: '', Privacy: 'N', Privacy2: 'N', PrivacyConservaDati: 'N', PrivacyCessioneDati: 'N' },
  // --- Due ospiti per collaudare il Briefing AI ------------------------------
  // Il briefing è l'unica funzione che cerca DAVVERO su internet: con un nome
  // inventato non trova nulla e non si capisce se funziona. Servono quindi un nome
  // che il web conosce e un nome ambiguo, per vedere i due comportamenti opposti.
  // 1017: personaggio pubblico reale (nome usato solo perché la ricerca trovi
  // qualcosa), con dominio mail aziendale → atteso "Personaggio pubblico".
  { CodCli: 1017, Cognome: 'FARINETTI', Nome: 'OSCAR', email: 'o.farinetti@eataly.it', Telefono: '', Cellulare: '3351017017', Citta: 'ALBA', CodNaz: 'I', dtNascita: null, CodFis: '', CodVip: 'V1', DesVip: 'BOLLICINE + FRUTTA FRESCA', Annotazioni: '', Privacy: 'N', Privacy2: 'N', PrivacyConservaDati: 'N', PrivacyCessioneDati: 'S' },
  // 1018: la trappola dell'omonimia. Nome comunissimo, mail generica, nessun
  // riscontro aziendale → atteso "Identità da confermare" oppure nessuna
  // informazione. Se qui esce un ruolo dato per certo, la regola dei due
  // riscontri non sta funzionando.
  { CodCli: 1018, Cognome: 'ROSSI', Nome: 'MARCO', email: 'marco.rossi@gmail.com', Telefono: '', Cellulare: '3351018018', Citta: 'MILANO', CodNaz: 'I', dtNascita: '1974-11-02', CodFis: '', CodVip: '', DesVip: null, Annotazioni: '', Privacy: 'N', Privacy2: 'N', PrivacyConservaDati: 'N', PrivacyCessioneDati: 'N' },
  // occupanti delle prenotazioni future
  { CodCli: 1105, Cognome: 'ZANARDELLI', Nome: 'BEATRICE', email: '', Telefono: '', Cellulare: '', Citta: 'BRESCIA', CodNaz: 'I', dtNascita: '1974-02-11', CodFis: '', CodVip: '', DesVip: null, Annotazioni: '', Privacy: 'N', Privacy2: 'N', PrivacyConservaDati: 'N', PrivacyCessioneDati: 'N' },
  { CodCli: 1106, Cognome: 'ZANARDELLI', Nome: 'TOMMASO', email: '', Telefono: '', Cellulare: '', Citta: 'BRESCIA', CodNaz: 'I', dtNascita: '2015-06-04', CodFis: '', CodVip: '', DesVip: null, Annotazioni: '', Privacy: 'N', Privacy2: 'N', PrivacyConservaDati: 'N', PrivacyCessioneDati: 'N' },
  { CodCli: 1107, Cognome: 'DUBOIS', Nome: 'ANTOINE', email: '', Telefono: '', Cellulare: '', Citta: 'LYON', CodNaz: 'F', dtNascita: null, CodFis: '', CodVip: '', DesVip: null, Annotazioni: '', Privacy: 'N', Privacy2: 'N', PrivacyConservaDati: 'N', PrivacyCessioneDati: 'N' },
  { CodCli: 1108, Cognome: 'SCHMIDT', Nome: 'ANNIKA', email: '', Telefono: '', Cellulare: '', Citta: 'HAMBURG', CodNaz: 'D', dtNascita: null, CodFis: '', CodVip: '', DesVip: null, Annotazioni: '', Privacy: 'N', Privacy2: 'N', PrivacyConservaDati: 'N', PrivacyCessioneDati: 'N' },
];

const NOTA_LUNGA = `PAGANO TUTTO
4 camere: 1 MJS + 2 SUP + 1 CLS — 6AD + 2CH (under 10y) BB
Rosemarie Pagliuso, Natalia Pagliuso, Raphael Pagliuso, Robert Pagliuso JR
€ 1.870,00 PER 2 NOTTI (${piu(-6)}, ${piu(-5)}) 1550 + €320 sofabed
€ 1.920,00 PER 3 NOTTI (${piu(-4)}, ${piu(-3)}, ${piu(-2)}) 1600 + €320 sofabed
€ 2.070,00 PER 2 NOTTI (${piu(-1)}, ${piu(0)}) 1750 + €320 sofabed
Transfer da BRI il giorno dell'arrivo, volo AZ1613 ore 14:20.
Culla in camera 226. Tavolo riservato ristorante ore 20:30 per tutta la permanenza.
Cena di compleanno da concordare con la maître — la signora compie gli anni durante il soggiorno.
La bambina è intollerante al lattosio, avvisare la cucina. La signora è allergica ai crostacei. I genitori non hanno altre allergie.
TOT: € 13.640,00 — saldo alla partenza con AMEX.`;

// --- Prenotazioni ----------------------------------------------------------
// stato: 'incasa' | 'partenza' (parte oggi) | 'checkout' (già uscito) | 'arrivo'
const PRENOTAZIONI = [
  { codpratica: 70101, codCliente: 1001, camere: '101', tipologie: 'SUP', dtarrivo: piu(-1), dtpartenza: piu(6), trattamento: 'Mezza Pensione', tariffa: 'BAR', extra: 410, stato: 'incasa', paxAdulti: 2, paxBambini: 0, tariffaNotte: 320, note: 'Camera alta, lontano ascensore. Cuscino rigido. Quotidiano italiano ogni mattina.', occupanti: [{ codCli: 1001, camera: '101' }, { codCli: 1101, camera: '101' }] },
  { codpratica: 70102, codCliente: 1002, camere: '102', tipologie: 'CLS', dtarrivo: piu(-2), dtpartenza: piu(3), trattamento: 'B&B', tariffa: 'WEB', extra: 95, stato: 'incasa', paxAdulti: 2, paxBambini: 0, tariffaNotte: 240, note: '', occupanti: [{ codCli: 1002, camera: '102' }] },
  { codpratica: 70103, codCliente: 1003, camere: '103, 104', tipologie: 'SUP', dtarrivo: piu(-4), dtpartenza: piu(2), trattamento: 'Mezza Pensione', tariffa: 'BAR', extra: 780, stato: 'incasa', paxAdulti: 4, paxBambini: 0, tariffaNotte: 290, note: 'Due camere comunicanti se possibile.', occupanti: [{ codCli: 1003, camera: '103' }, { codCli: 1104, camera: '104' }] },
  { codpratica: 70104, codCliente: 1004, camere: '109, 218, 224, 226', tipologie: 'JS, SUP, CLS', dtarrivo: piu(-6), dtpartenza: piu(1), trattamento: 'B&B', tariffa: 'DIRETTO', extra: 2340, stato: 'incasa', paxAdulti: 6, paxBambini: 2, tariffaNotte: 1750, note: NOTA_LUNGA, occupanti: [{ codCli: 1004, camera: '109' }, { codCli: 1102, camera: '218' }, { codCli: 1103, camera: '224' }, { codCli: 1110, camera: '226' }] },
  { codpratica: 70105, codCliente: 1005, camere: '106', tipologie: 'CLS', dtarrivo: piu(-1), dtpartenza: piu(4), trattamento: 'B&B', tariffa: 'WEB', extra: 0, stato: 'incasa', paxAdulti: 2, paxBambini: 0, tariffaNotte: 230, note: 'Late check-out richiesto, da confermare.', occupanti: [{ codCli: 1005, camera: '106' }] },
  { codpratica: 70106, codCliente: 1006, camere: '124', tipologie: 'CLS', dtarrivo: piu(-3), dtpartenza: piu(0), trattamento: 'Pensione Completa', tariffa: 'BAR', extra: 160, stato: 'checkout', paxAdulti: 1, paxBambini: 0, tariffaNotte: 250, note: 'Verificare il conto extra prima della partenza.', occupanti: [{ codCli: 1006, camera: '124' }] },
  { codpratica: 70107, codCliente: 1007, camere: '232, 234', tipologie: 'JSF', dtarrivo: piu(-1), dtpartenza: piu(0), trattamento: 'B&B', tariffa: 'DIRETTO', extra: 220, stato: 'partenza', paxAdulti: 3, paxBambini: 1, tariffaNotte: 620, note: 'Navetta per aeroporto alle 11:00.', occupanti: [{ codCli: 1007, camera: '232' }] },
  { codpratica: 70108, codCliente: 1008, camere: '205', tipologie: 'SUP', dtarrivo: piu(-2), dtpartenza: piu(5), trattamento: 'Mezza Pensione', tariffa: 'BAR', extra: 315, stato: 'incasa', paxAdulti: 2, paxBambini: 0, tariffaNotte: 300, note: '', occupanti: [{ codCli: 1008, camera: '205' }] },
  // arrivi di oggi
  { codpratica: 70201, codCliente: 1201, camere: '211', tipologie: 'SUP', dtarrivo: piu(0), dtpartenza: piu(5), trattamento: 'Mezza Pensione', tariffa: 'WEB', extra: 0, stato: 'arrivo', paxAdulti: 2, paxBambini: 0, tariffaNotte: 310, oraArrivo: '15.30', note: 'Prima volta in hotel. Arrivo previsto nel pomeriggio. Allergia alle arachidi segnalata al momento della prenotazione.', occupanti: [] },
  { codpratica: 70202, codCliente: 1003, camere: '215', tipologie: 'CLS', dtarrivo: piu(0), dtpartenza: piu(2), trattamento: 'B&B', tariffa: 'BAR', extra: 0, stato: 'arrivo', paxAdulti: 2, paxBambini: 0, tariffaNotte: 245, oraArrivo: '', note: '', occupanti: [] },
  // I due casi per il Briefing AI (vedi anagrafiche 1017 e 1018): personaggio
  // pubblico e trappola dell'omonimia, entrambi in arrivo oggi così si prova il
  // pulsante ✨ Briefing AI dalla card senza cercarli in anagrafica.
  { codpratica: 70212, codCliente: 1017, camere: '301', tipologie: 'JSF', dtarrivo: piu(0), dtpartenza: piu(3), trattamento: 'Mezza Pensione', tariffa: 'DIRETTO', extra: 0, stato: 'arrivo', paxAdulti: 2, paxBambini: 0, tariffaNotte: 690, oraArrivo: '17.00', note: 'Prenotazione diretta della segreteria.', occupanti: [] },
  { codpratica: 70213, codCliente: 1018, camere: '216', tipologie: 'CLS', dtarrivo: piu(0), dtpartenza: piu(2), trattamento: 'B&B', tariffa: 'WEB', extra: 0, stato: 'arrivo', paxAdulti: 2, paxBambini: 0, tariffaNotte: 250, oraArrivo: '', note: '', occupanti: [] },

  // OGGI — due proposte nella stessa card, una giusta e una sbagliata:
  // "intollerante al lattosio" è dell'ospite (da accettare), mentre il menù
  // "senza glutine" riguarda un GRUPPO DI SETTEMBRE, non lei (da ignorare).
  // È il falso positivo tipico: le regole vedono marcatore + sostanza, ma il
  // contesto lo capisce solo una persona. Serve a provare il pulsante Ignora.
  {
    codpratica: 70211, codCliente: 1016, camere: '208', tipologie: 'CLS', dtarrivo: piu(0), dtpartenza: piu(4),
    trattamento: 'Mezza Pensione', tariffa: 'WEB', extra: 0, stato: 'arrivo', paxAdulti: 2, paxBambini: 0, tariffaNotte: 255, oraArrivo: '18.00',
    note: 'Ospite intollerante al lattosio. Il tour operator chiede un menù senza glutine per il gruppo di settembre, da confermare con la cucina.',
    occupanti: [],
  },

  // --- Ospiti del giorno (day use) ------------------------------------------
  // Arrivo e partenza nello stesso giorno: gli esterni di SPA, piscina e serate.
  // Il gestionale li segna "partiti" fin dalla prenotazione perché non
  // pernottano, e per questo fino al 13/08/2026 non comparivano da nessuna
  // parte. Ne servono due, per le due situazioni opposte.

  // 1013 è un'ospite che conosciamo (torna fra due giorni con una camera):
  // oggi viene solo per la SPA, ma la sua celiachia deve arrivare in cucina
  // lo stesso. È il motivo per cui questa lista esiste.
  {
    codpratica: 70214, codCliente: 1013, camere: '', tipologie: '', dtarrivo: piu(0), dtpartenza: piu(0),
    trattamento: '', tariffa: '', extra: 180, stato: 'dayuse', paxAdulti: 2, paxBambini: 0, tariffaNotte: 0,
    note: 'ACQUISTO E-SHOP ACCESSO SPA PER DUE. OK SALDO. La signora è celiaca, avvisare il bistrot.',
    occupanti: [],
  },
  // 1001 invece è GIÀ in casa (pratica 70101, camera 101): questa è una
  // scrittura contabile per un extra addebitato a parte, non una persona in
  // più. Non deve produrre una seconda card, altrimenti lo stesso ospite
  // comparirebbe due volte nella stessa lista.
  {
    codpratica: 70215, codCliente: 1001, camere: '', tipologie: '', dtarrivo: piu(0), dtpartenza: piu(0),
    trattamento: '', tariffa: '', extra: 90, stato: 'dayuse', paxAdulti: 1, paxBambini: 0, tariffaNotte: 0,
    note: 'PAGANO EXTRA — cena al ristorante addebitata su pratica separata.',
    occupanti: [],
  },

  // --- Arrivi dei prossimi giorni -------------------------------------------
  // Ogni pratica è pensata per mettere alla prova una cosa precisa: si naviga con
  // le frecce nella pagina Arrivi. Il caso da verificare è scritto sopra ognuna.

  // DOMANI — negazione nelle note: NON deve proporre allergie, e il nome del
  // bambino c'è fra gli occupanti (a chi si attribuirebbe?). Ospite VIP e di ritorno.
  {
    codpratica: 70203, codCliente: 1009, camere: '118, 120', tipologie: 'SUP', dtarrivo: piu(1), dtpartenza: piu(8),
    trattamento: 'Mezza Pensione', tariffa: 'DIRETTO', extra: 0, stato: 'arrivo', paxAdulti: 2, paxBambini: 1, tariffaNotte: 480, oraArrivo: '16.00',
    note: 'Camere comunicanti se possibile. Il bambino non è allergico alle arachidi, mangia di tutto. Tavolo fisso in veranda.',
    occupanti: [{ codCli: 1009, camera: '118' }, { codCli: 1105, camera: '118' }, { codCli: 1106, camera: '120' }],
  },
  // DOMANI — celiachia in nota + compleanno durante il soggiorno.
  {
    codpratica: 70204, codCliente: 1010, camere: '207', tipologie: 'CLS', dtarrivo: piu(1), dtpartenza: piu(6),
    trattamento: 'B&B', tariffa: 'WEB', extra: 0, stato: 'arrivo', paxAdulti: 2, paxBambini: 0, tariffaNotte: 260, oraArrivo: '14.00',
    note: 'La signora è celiaca, avvisare la cucina per la colazione.',
    occupanti: [],
  },
  // DOMANI — caso pulito: nessun alert, nessuna proposta. Serve per confronto.
  {
    codpratica: 70205, codCliente: 1011, camere: '210', tipologie: 'CLS', dtarrivo: piu(1), dtpartenza: piu(3),
    trattamento: 'B&B', tariffa: 'WEB', extra: 0, stato: 'arrivo', paxAdulti: 2, paxBambini: 0, tariffaNotte: 235, oraArrivo: '',
    note: 'Arrivo in tarda serata, tenere la reception avvisata.',
    occupanti: [],
  },

  // FRA 2 GIORNI — ospite indesiderato con reclamo aperto: card in rosso, il
  // testo del reclamo e il suo reparto devono comparire in evidenza.
  {
    codpratica: 70206, codCliente: 1012, camere: '221', tipologie: 'SUP', dtarrivo: piu(2), dtpartenza: piu(4),
    trattamento: 'B&B', tariffa: 'BAR', extra: 0, stato: 'arrivo', paxAdulti: 1, paxBambini: 0, tariffaNotte: 290, oraArrivo: '12.30',
    note: 'Richiesto upgrade gratuito già in fase di prenotazione.',
    occupanti: [],
  },
  // FRA 2 GIORNI — DUE allergie in frasi diverse, con una negazione in mezzo:
  // devono uscire due proposte (glutine e crostacei) e nessuna dalla negazione.
  {
    codpratica: 70207, codCliente: 1013, camere: '224', tipologie: 'JS', dtarrivo: piu(2), dtpartenza: piu(9),
    trattamento: 'Mezza Pensione', tariffa: 'DIRETTO', extra: 0, stato: 'arrivo', paxAdulti: 2, paxBambini: 0, tariffaNotte: 520, oraArrivo: '15.00',
    note: 'Madame Dubois: senza glutine a tutti i pasti. Il marito non ha allergie. È allergica anche ai crostacei, attenzione al buffet.',
    occupanti: [{ codCli: 1013, camera: '224' }, { codCli: 1107, camera: '224' }],
  },

  // FRA 3 GIORNI — nota lunga e commerciale con parole "pericolose" (noci, pesce,
  // uova): non deve uscire NESSUNA proposta. È il test dei falsi positivi.
  {
    codpratica: 70208, codCliente: 1014, camere: '301, 302, 303', tipologie: 'SUP, CLS', dtarrivo: piu(3), dtpartenza: piu(7),
    trattamento: 'Pensione Completa', tariffa: 'T.O.', extra: 0, stato: 'arrivo', paxAdulti: 5, paxBambini: 1, tariffaNotte: 890, oraArrivo: '17.30',
    note: `Gruppo Schmidt — 3 camere, voucher T.O. da allegare al conto.
Cena a base di pesce prenotata per la seconda sera, tavolo da 6.
Torta alle noci per l'anniversario, da concordare con la pasticceria.
Colazione con uova strapazzate tutti i giorni.
Transfer da BRI il giorno dell'arrivo, volo LH1234 ore 16:05.`,
    occupanti: [{ codCli: 1014, camera: '301' }, { codCli: 1108, camera: '302' }],
  },

  // FRA 4 GIORNI — ospite di ritorno con storico ricco, note personali e
  // preferenze già in scheda: verifica "Nª volta", nota ospite e export.
  {
    codpratica: 70209, codCliente: 1001, camere: '101', tipologie: 'SUP', dtarrivo: piu(4), dtpartenza: piu(11),
    trattamento: 'Mezza Pensione', tariffa: 'DIRETTO', extra: 0, stato: 'arrivo', paxAdulti: 2, paxBambini: 0, tariffaNotte: 330, oraArrivo: '15.00',
    note: 'Solita camera, quotidiano italiano ogni mattina.',
    occupanti: [{ codCli: 1001, camera: '101' }, { codCli: 1101, camera: '101' }],
  },

  // FRA 6 GIORNI — allergia FUORI elenco (pollini) più una già registrata in
  // scheda (Nichel): la prima si propone, la seconda no.
  {
    codpratica: 70210, codCliente: 1015, camere: '226', tipologie: 'JS', dtarrivo: piu(6), dtpartenza: piu(13),
    trattamento: 'B&B', tariffa: 'DIRETTO', extra: 0, stato: 'arrivo', paxAdulti: 2, paxBambini: 0, tariffaNotte: 610, oraArrivo: '11.00',
    note: 'Ospite allergica ai pollini di betulla: evitare fiori freschi in camera. Intolleranza al nichel già segnalata.',
    occupanti: [],
  },
];

// Pianificazione di soggiorno: tariffe a gradini per notte (GG = indice notte
// 1-based dell'intero soggiorno). Solo per qualche pratica, come nella realtà.
const PIANIFICAZIONE = {
  70101: [{ GG: 2, impoEur: 300 }, { GG: 4, impoEur: 345 }, { GG: 6, impoEur: 300 }],
  70104: [{ GG: 3, impoEur: 1600 }, { GG: 6, impoEur: 1750 }],
};

// Soggiorni conclusi (StorPrenota) → alimentano storico cliente e "ospite di ritorno".
const STORICO = [
  { codpratica: 60011, codCli: 1001, dtarrivo: '2025-08-02', dtpartenza: '2025-08-09', camere: '101', arrangiamento: 2240, extra: 380 },
  { codpratica: 60012, codCli: 1001, dtarrivo: '2024-07-20', dtpartenza: '2024-07-27', camere: '101', arrangiamento: 2100, extra: 410 },
  { codpratica: 60013, codCli: 1001, dtarrivo: '2023-08-11', dtpartenza: '2023-08-16', camere: '103', arrangiamento: 1500, extra: 220 },
  { codpratica: 60021, codCli: 1004, dtarrivo: '2025-08-01', dtpartenza: '2025-08-08', camere: '109', arrangiamento: 9800, extra: 1980 },
  { codpratica: 60031, codCli: 1007, dtarrivo: '2022-08-14', dtpartenza: '2022-08-19', camere: '232', arrangiamento: 2600, extra: 300 },
  { codpratica: 60032, codCli: 1007, dtarrivo: '2021-08-10', dtpartenza: '2021-08-15', camere: '230', arrangiamento: 2400, extra: 190 },
  { codpratica: 60041, codCli: 1006, dtarrivo: '2024-06-05', dtpartenza: '2024-06-08', camere: '124', arrangiamento: 750, extra: 90 },
  // Zanardelli: cliente affezionato → in card deve leggersi "4ª volta".
  { codpratica: 60051, codCli: 1009, dtarrivo: '2025-07-12', dtpartenza: '2025-07-19', camere: '118', arrangiamento: 3200, extra: 640 },
  { codpratica: 60052, codCli: 1009, dtarrivo: '2024-07-14', dtpartenza: '2024-07-21', camere: '118', arrangiamento: 3050, extra: 520 },
  { codpratica: 60053, codCli: 1009, dtarrivo: '2023-07-15', dtpartenza: '2023-07-22', camere: '120', arrangiamento: 2900, extra: 480 },
  { codpratica: 60061, codCli: 1013, dtarrivo: '2024-09-02', dtpartenza: '2024-09-09', camere: '224', arrangiamento: 3600, extra: 720 },
  // Due ospiti IN ARRIVO che sono già stati qui: dal 14/08 il badge "Nª volta"
  // sta anche nella card degli Arrivi, e senza questi nessun arrivo di prova lo
  // mostrerebbe. Haefliger torna per la terza volta; Farinetti ha dormito qui
  // una volta sola ma viene spesso in giornata — le due cose restano separate.
  { codpratica: 60071, codCli: 1003, dtarrivo: '2025-05-18', dtpartenza: '2025-05-22', camere: '215', arrangiamento: 1480, extra: 260 },
  { codpratica: 60072, codCli: 1003, dtarrivo: '2023-09-03', dtpartenza: '2023-09-07', camere: '212', arrangiamento: 1350, extra: 190 },
  { codpratica: 60081, codCli: 1017, dtarrivo: '2024-10-11', dtpartenza: '2024-10-13', camere: '301', arrangiamento: 900, extra: 340 },
  { codpratica: 60082, codCli: 1017, dtarrivo: '2026-03-21', dtpartenza: '2026-03-21', camere: '', arrangiamento: 0, extra: 220 },
  { codpratica: 60083, codCli: 1017, dtarrivo: '2026-06-06', dtpartenza: '2026-06-06', camere: '', arrangiamento: 0, extra: 190 },
  // 1013 è anche una cliente della SPA: tre giornate concluse, che NON devono
  // finire nel badge "Nª volta". In card deve leggersi "2ª volta" (un solo
  // soggiorno) accanto a "3 in giornata". Sui dati veri dell'hotel questo
  // errore riguardava 9.996 ospiti (misurato il 13/08/2026).
  { codpratica: 60062, codCli: 1013, dtarrivo: '2025-06-14', dtpartenza: '2025-06-14', camere: '', arrangiamento: 0, extra: 150 },
  { codpratica: 60063, codCli: 1013, dtarrivo: '2025-09-27', dtpartenza: '2025-09-27', camere: '', arrangiamento: 0, extra: 180 },
  { codpratica: 60064, codCli: 1013, dtarrivo: '2026-05-30', dtpartenza: '2026-05-30', camere: '', arrangiamento: 0, extra: 130 },
];

// Consumi F&B e SPA per la scheda ospite.
const GUSTI = {
  1001: [
    { codArt: 'AMARONE', nome: 'AMARONE DELLA VALPOLICELLA', fb: 'B', grp: 'VINI ROSSI', volte: 6, qta: 6, eur: 480 },
    { codArt: 'CAFFLEC', nome: 'CAFFÈ LECCESE', fb: 'B', grp: 'BEV.CALDE', volte: 14, qta: 14, eur: 56 },
    { codArt: 'CRUDOPS', nome: 'CRUDO DI PESCE', fb: 'F', grp: 'ANTIPASTI', volte: 4, qta: 4, eur: 180 },
  ],
  1004: [
    { codArt: 'CHAMPB', nome: 'CHAMPAGNE BRUT', fb: 'B', grp: 'BOLLICINE', volte: 8, qta: 9, eur: 1080 },
    { codArt: 'COCAZ', nome: 'COCA COLA ZERO', fb: 'B', grp: 'BEV.BI', volte: 12, qta: 15, eur: 75 },
  ],
};

const SPA = {
  1001: [{ nome: 'MASSAGGIO DECONTRATTURANTE', grp: 'SPA', volte: 3, qta: 3, eur: 330 }],
  1007: [
    { nome: 'PERCORSO ACQUA', grp: 'SPA', volte: 2, qta: 4, eur: 160 },
    { nome: 'SERENITY', grp: 'SPA', volte: 1, qta: 1, eur: 140 },
  ],
};

// --- Dati CRM iniziali (poi modificabili dall'app, restano in memoria) -------
const CRM_INIZIALE = {
  preferenze: [
    { id: 1, pms_customer_id: 1001, reparto: 'F&B', categoria: 'F&B', testo: 'Predilige Amarone a cena', ambito: 'nucleo', autore: 'admin' },
    { id: 2, pms_customer_id: 1001, reparto: 'Rooms', categoria: 'Camera', testo: 'Camera lato mare, piano alto', ambito: 'nucleo', autore: 'admin' },
    { id: 3, pms_customer_id: 1001, reparto: 'F&B', categoria: 'F&B', testo: 'Caffè leccese al mattino', ambito: 'nucleo', autore: 'reception' },
    { id: 4, pms_customer_id: 1004, reparto: 'Rooms', categoria: 'Camera', testo: 'Cuscini extra e culla', ambito: 'nucleo', autore: 'admin' },
    { id: 5, pms_customer_id: 1007, reparto: 'SPA', categoria: 'Persona', testo: 'Prenota sempre percorso acqua', ambito: 'personale', autore: 'admin' },
    // Preferenza PERSONALE della moglie, che sta nella stessa camera del 1001:
    // è il caso del ticket del 14/08 — prima non compariva in nessuna card, e
    // senza il nome non si saprebbe a chi servire il decaffeinato.
    { id: 6, pms_customer_id: 1101, reparto: 'F&B', categoria: 'F&B', testo: 'Caffè decaffeinato dopo cena', ambito: 'personale', autore: 'reception' },
  ],
  intolleranze: [
    { id: 1, pms_customer_id: 1004, testo: 'Lattosio', autore: 'admin' },
    { id: 2, pms_customer_id: 1102, testo: 'Frutta a guscio', autore: 'reception' },
    { id: 3, pms_customer_id: 1008, testo: 'Glutine', autore: 'admin' },
    // già in scheda: la nota della pratica 70210 la ricita, non va riproposta
    { id: 4, pms_customer_id: 1015, testo: 'Nichel', autore: 'admin' },
  ],
  complaints: [
    { id: 1, pms_customer_id: 1006, testo: 'Rumore dal corridoio, camera cambiata', stato: 'risolto', periodo: 'giu 2024', reparto: 'Rooms', categoria: 'Rumore', follow_up: 'Spostato in 118 lato mare, upgrade gratuito per le due notti restanti.', autore: 'admin' },
    { id: 2, pms_customer_id: 1006, testo: 'Contestazione conto extra bar', stato: 'aperto', periodo: 'oggi', reparto: 'F&B', categoria: 'Conto', follow_up: null, autore: 'reception' },
    { id: 3, pms_customer_id: 1003, testo: 'Ritardo nella pulizia camera', stato: 'aperto', periodo: 'ieri', reparto: 'Rooms', categoria: 'Pulizia', follow_up: null, autore: 'reception' },
    // Storico: risolto prima di queste evolutive, quindi senza follow-up E senza
    // classificazione. Serve a vedere che i vecchi reclami restano leggibili,
    // mostrano "da classificare" e non rompono niente.
    { id: 4, pms_customer_id: 1001, testo: 'Aria condizionata rumorosa in camera 101', stato: 'risolto', periodo: 'ago 2025', reparto: null, categoria: null, follow_up: null, autore: 'admin' },
    // Bianchi arriva fra 2 giorni con un reclamo ancora aperto: in card deve
    // comparire il testo, non il numero, col reparto davanti.
    { id: 5, pms_customer_id: 1012, testo: 'Attesa di 40 minuti al check-in in alta stagione', stato: 'aperto', periodo: 'lug 2025', reparto: 'Front office', categoria: 'Attesa', follow_up: null, autore: 'admin' },
  ],
  nucleo: [
    { id: 1, pms_customer_id: 1001, pms_occupant_id: 1101, tipo_relazione: 'Coniuge', nome: 'GIULIA', cognome: 'TOSTI', nota: '', autore: 'admin' },
    { id: 2, pms_customer_id: 1004, pms_occupant_id: 1102, tipo_relazione: 'Coniuge', nome: 'ROSEMARIE', cognome: 'PAGLIUSO', nota: 'Intollerante alla frutta a guscio', autore: 'admin' },
    { id: 3, pms_customer_id: 1004, pms_occupant_id: 1103, tipo_relazione: 'Figlio-a', nome: 'NATALIA', cognome: 'PAGLIUSO', nota: '', autore: 'admin' },
  ],
  profili: [
    { pms_customer_id: 1001, lingua: 'IT', note_personali: 'Direttore generale di un gruppo industriale pugliese. Rivolgersi come "Dottore".', data_nascita: null, autore: 'admin' },
    { pms_customer_id: 1004, lingua: 'EN', note_personali: null, data_nascita: null, autore: 'admin' },
    // 1003 arriva oggi ED è in casa: la stessa nota si vede su entrambe le pagine.
    // Volutamente più lunga di una riga, per vedere la sintesi nella card e il
    // testo intero nel suggerimento del mouse.
    {
      pms_customer_id: 1003, lingua: 'DE', data_nascita: null, autore: 'admin',
      note_personali: 'Amministratore delegato di un gruppo del fashion; viaggia spesso per lavoro. '
        + 'Chiede una scrivania in camera e la stampante alla reception per i documenti. Cena presto, mai dopo le 21.',
    },
  ],
  merge: [], // { pms_customer_id, canonical_id }
  // Componenti del nucleo tolti a mano: il controllo dei co-occupanti si rifà a
  // ogni apertura della scheda, e senza questa memoria li rimetterebbe.
  nucleoScartati: [], // 'pms_customer_id|pms_occupant_id'
};

module.exports = {
  DATA_LAVORO, piu, ANAGRAFICHE, PRENOTAZIONI, PIANIFICAZIONE, STORICO,
  GUSTI, SPA, CRM_INIZIALE,
};
