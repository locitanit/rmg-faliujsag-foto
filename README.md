# Faliújság – fotózó webapp

Telefonos weboldal a tanári faliújság fotózásához. A fotók az iskolai Google Drive
**„RMG Tools – beküldés”** közös meghajtójának `faliujsag/bejovo/` mappájába mennek,
körönként egy almappába. Onnan az RMG Tools feldolgozója (`rmg_tools/core/board_worker`)
veszi fel őket. Terv: `rmg_tools/docs/faliujsag-fotozo-webapp-terv.md`.

Nincs szerver, nincs build: sima statikus fájlok (GitHub Pages-re való).

**Állapot: megírva, élő Google-fiókkal még NEM próbálva.** Előbb a lenti beállítás kell.

## Mit tud

- Belépés iskolai Google-fiókkal (Google Identity Services; a token csak a memóriában él).
- **Fotó** gomb → a telefon kamerája, teljes felbontás. A kép nem kerül a galériába.
- A fotó előbb a telefonon vár (IndexedDB), aztán felmegy, és a telefonról törlődik.
  Net nélkül sem vész el: magától újrapróbálja (30 mp-enként, és amikor visszajön a net).
- **Kész** gomb → `done.json` a kör mappájába (csak darabszám és időpont). A feldolgozó
  csak a `done.json`-nal lezárt kört olvassa be.
- Kezdőképernyőre tehető (PWA), a héja net nélkül is megnyílik.

Mappa a meghajtón: `faliujsag/bejovo/<ÉÉÉÉHHNN-ÓÓPPMM-xxxx>/foto-01.jpg … done.json`.

## Beállítás (egyszer)

1. **OAuth-kliens** a Google Cloud „RMG Tools” (Internal) projektjében:
   Hitelesítő adatok → OAuth-ügyfélazonosító → *Webes alkalmazás* →
   engedélyezett JavaScript-forrás: az oldal címe (pl. `https://<felhasználó>.github.io`;
   helyi próbához `http://localhost:8765`).
2. `config.js`: írd be a `clientId`-t és az `inboxFolderId`-t (a `faliujsag/bejovo` mappa
   azonosítója: a mappa Drive-címének utolsó része). **Client secret nincs és nem is kell.**
3. A fotózó kolléga legyen tagja a „beküldés” meghajtónak (közreműködő).

### Az első élő próba (W1) – ezt még senki nem próbálta ki

A `drive.file` engedéllyel az app csak a saját feltöltéseihez fér hozzá. **Nem biztos**, hogy
így létre tud hozni mappát a `bejovo` mappában. Ha az első fotónál azt írja ki, hogy
„a beküldő mappa nem érhető el”, akkor nem megy – ilyenkor a `config.js`-ben a `scope`
átírható `https://www.googleapis.com/auth/drive`-ra. Ez sokkal szélesebb engedély (a
belépett felhasználó minden Drive-fájlja), ezért tudatos döntés legyen.

## Fejlesztés

```bash
npm test
```

A tesztek (`tests/`) a Drive-hívásokat és a kör-logikát fedik, ál-Drive-val és ál-fotóval.
Valódi fotó vagy valódi válasz soha ne kerüljön a repóba.

Helyi megnézés:

```bash
python -m http.server 8765
```

## Fájlok

| Fájl | Mi van benne |
|---|---|
| `config.js` | a két beállítandó érték + a kért engedély |
| `auth.js` | Google-belépés |
| `drive.js` | mappa létrehozása, feltöltés; időkorlát, újrapróbálás, magyar hibaüzenetek |
| `rounds.js` | kör, várakozó sor, `done.json` |
| `store.js` | a várakozó sor a telefonon (IndexedDB) |
| `app.js`, `index.html`, `style.css` | a képernyő |
| `sw.js`, `manifest.webmanifest`, `icons/` | PWA |

## Adatvédelem

- A faliújságon diáknevek is lehetnek: a fotó csak a telefon → iskolai Drive úton megy.
- A GitHubon nincs adat. A `done.json`-ban nincs név vagy e-mail.
- Hibaüzenetbe, naplóba nem kerül token, fájlnév, szöveg.
