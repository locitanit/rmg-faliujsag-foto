# Faliújság – fotózó webapp

Telefonos weboldal a tanári faliújság fotózásához. A fotók az iskolai Google Drive
**„RMG Tools – beküldés”** közös meghajtójának `faliujsag/bejovo/` mappájába mennek,
körönként egy almappába. Onnan az RMG Tools feldolgozója (`rmg_tools/core/board_worker`)
veszi fel őket. Terv: `rmg_tools/docs/faliujsag-fotozo-webapp-terv.md`.

Nincs szerver, nincs build: sima statikus fájlok (GitHub Pages-re való).

**Állapot:** él a GitHub Pages-en (`https://locitanit.github.io/rmg-faliujsag-foto/`), a
feltöltés élő fiókkal kipróbálva (gépről és telefonról). A fotó-ellenőrzés telefonon, valódi ajtón
kipróbálva (2026-10-08: egész ajtó és két fél fotó – az 1. ajtón, mert csak azon van
matrica). A „túl messze" és az „életlen" küszöb még becslés; parafatáblán nem volt próba.

## Mit tud

- Belépés iskolai Google-fiókkal (Google Identity Services; a token csak a memóriában él).
- **Mindig a jó fiókkal:** a belépés előtt beírható az iskolai e-mail cím. Csak a telefon
  jegyzi meg (`localStorage`), és a Google-nek `login_hint`-ként megy: a fiókválasztó
  kimarad, pontosan ezzel a fiókkal lép be. (Azt, hogy a telefon melyik Chrome-profilban
  nyitja meg az oldalt, a weboldal nem tudja irányítani.) A `config.js` `hostedDomain`
  értékével a választó az iskola fiókjaira szűkíthető.
- **Nincs „Kész" gomb, semmit nem kell lezárni.** Belépés után minden fotó azonnal felmegy.
  A kör magától lezárul 30 másodperccel az utolsó fotó / koppintás után (akkor megy fel a
  `done.json`), és ha ez elmaradna (bezárt app, nincs net), a feldolgozó 3 perc csend után
  így is beolvassa a mappa fotóit. Belépni óránként egyszer kell (a böngésző csak
  koppintásra enged belépő ablakot nyitni).
- **Fotó** gomb → a telefon kamerája, teljes felbontás. A kép nem kerül a galériába.
- A fotó előbb a telefonon vár (IndexedDB), aztán felmegy, és a telefonról törlődik.
  Net nélkül sem vész el: magától újrapróbálja (30 mp-enként, és amikor visszajön a net).
- **Minden fotót megnéz a telefonon** (semmi nem megy ki hozzá): megkeresi rajta az
  ArUco-matricákat, és
  - kipipálja a listán, mit mutat (ajtó, vagy a parafatábla egy része) – ugyanazzal a
    szabállyal, mint a feldolgozó: a rész mindkét matrica-oszlopából legalább 2–2 matrica;
  - szól, ha **nincs elég matrica**, ha **túl messziről** készült (3,5 px/mm alatt), vagy ha
    **életlen**. Ilyenkor választani lehet: „Újra fotózom" (a kép eldobva) vagy „Így is jó".
  Ez csak tanács: ha az ellenőrzés nem sikerül, a fotó akkor is megmarad.
- **Pipalista:** a fal 17 része (12 ajtó + a két tábla 3 + 2 része); a pipák **egész nap** megmaradnak
  (a körök közben a háttérben lezárulnak), másnap tiszta lappal indul.
- **Ajtó két fotóból:** ha egy fotón csak a felső + középső matricák látszanak, az az ajtó
  **teteje** (▲, a csempe felül zöld); alsó + középső = az **alja** (▼). A kettő együtt (vagy
  egy egész-ajtós fotó) adja a pipát. A parafatábla része mindig egészben számít.
- **Üres ajtó fotó nélkül:** ha egy szekrényajtóról minden lekerült, a listán a számára
  koppintva „üres"-nek jelölhető (még egy koppintás visszavonja). A feldolgozó ilyenkor az
  ajtó papírjait fotó nélkül „lekerült"-re állítja. Ha ugyanarról az ajtóról fotó is készül
  a körben, a fotó számít. Parafatáblán nincs ilyen.
- A kör végén `done.json` megy a kör mappájába: darabszám, időpont, és az üresnek jelölt
  ajtók (`"empty": ["sor-1-ajto-3"]`). A feldolgozó a `done.json`-nal lezárt kört azonnal
  olvassa be. Fotó nélküli kör is beküldhető, ha van benne üresnek jelölt ajtó.
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

A `drive.file` engedély (az app csak a saját feltöltéseihez fér hozzá) elég: az élő próbán
létre tudott hozni mappát a közös meghajtó `bejovo` mappájában (2026-10-08).

### Ha változik a fal leírása

A matricák kódjai (`dictionary.js`), a pipalista (`layout.js`) és a tesztképek az RMG Tools
`zones.json`-jából készülnek. Ha ott új zóna vagy más szótár lesz, futtasd újra:

```bash
C:/Loci/prog/rmg_tools/core/.venv/Scripts/python tools/make_data.py C:/Loci/prog/rmg_tools/core
```

(Az oszloptávolságok átírása miatt nem kell: a webapp csak azt nézi, melyik matrica látszik.)
A két küszöb (`MIN_PX_PER_MM`, `MIN_SHARPNESS`) a `check.js` elején van – valódi fotók
alapján érdemes lehet hangolni.

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
| `rounds.js` | kör (magától záródik), várakozó sor, `done.json`, a nap pipái |
| `aruco.js` | saját, függőség nélküli ArUco-kereső + élességmérés |
| `check.js` | mit mutat a fotó, elég közeli-e, éles-e (a figyelmeztetések szövege) |
| `photo.js` | a fotó megnyitása a böngészőben az ellenőrzéshez |
| `dictionary.js`, `layout.js` | **generált** (`tools/make_data.py`): matricakódok, pipalista |
| `store.js` | a várakozó sor a telefonon (IndexedDB) |
| `app.js`, `index.html`, `style.css` | a képernyő |
| `sw.js`, `manifest.webmanifest`, `icons/` | PWA |

## Adatvédelem

- A faliújságon diáknevek is lehetnek: a fotó csak a telefon → iskolai Drive úton megy.
- A GitHubon nincs adat. A `done.json`-ban nincs név vagy e-mail.
- Hibaüzenetbe, naplóba nem kerül token, fájlnév, szöveg.
