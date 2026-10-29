# Faliújság – fotózó webapp

Telefonos weboldal a tanári faliújság fotózásához. A fotók az iskolai Google Drive
**„RMG Tools – beküldés”** közös meghajtójának `faliujsag/bejovo/` mappájába mennek,
körönként egy almappába. Onnan az RMG Tools feldolgozója (`rmg_tools/core/board_worker`)
veszi fel őket. Terv: `rmg_tools/docs/faliujsag-fotozo-webapp-terv.md`.

Nincs szerver, nincs build: sima statikus fájlok (GitHub Pages-re való).

**Állapot:** él a GitHub Pages-en (`https://locitanit.github.io/rmg-faliujsag-foto/`), a
feltöltés élő fiókkal kipróbálva (gépről és telefonról). A fotó-ellenőrzés telefonon, valódi ajtón
kipróbálva (2026-10-08: egész ajtó és két fél fotó – az 1. ajtón, mert csak azon van
matrica). A „túl messze" és az „életlen" küszöb még becslés; parafatáblán és oldalfalon nem volt
próba (2026-10-14 óta a végleges kiosztást tudja: oldalfal #42–47, táblák #48–69, `DICT_4X4_250`).
Az átirányításos belépés (lent) 2026-10-08 este lett bekapcsolva, élő fiókkal kipróbálva:
működik. Vészfék: a `config.js`-ben `redirectSignIn: false` visszaadja a felugró ablakos
belépést. A teljes állapot és a teendők: `rmg_tools/docs/faliujsag-plugin-terv.md`,
„ITT KEZDD" → „Hol tartunk".

## Mit tud

- **Képernyő:** sötét, az RMG Tools sötét módjának színeivel. Belépés előtt csak a belépő
  doboz látszik; belépés után a leírás, a Fotó gomb, a fal térképe és a Befejezés gomb. Fent három ikon:
  **?** (a leírás ki-be, alapból csukva; a telefon megjegyzi), **telefon** (tipp a kezdőképernyőre tételhez),
  **fiók** (felugró menü, benne a Kijelentkezés).
- Belépés iskolai Google-fiókkal (Google Identity Services; a token csak a memóriában él).
- **Mindig a jó fiókkal:** a belépés előtt beírható az iskolai e-mail cím. Csak a telefon
  jegyzi meg (`localStorage`), és a Google-nek `login_hint`-ként megy: a fiókválasztó
  kimarad, pontosan ezzel a fiókkal lép be. (Azt, hogy a telefon melyik Chrome-profilban
  nyitja meg az oldalt, a weboldal nem tudja irányítani.) A `config.js` `hostedDomain`
  értékével a választó az iskola fiókjaira szűkíthető.
- **Egy fotózás = egy kör, a végén „Befejezés".** A kör fotói a telefonon gyűlnek
  (IndexedDB); a **Befejezés** gomb küldi fel őket egyszerre, a végén a `done.json`-nal, így a
  feldolgozó egyben kapja a kört. Ha a gomb elmarad, a kör 15 perc csend után magától
  lezárul (vagy az app következő megnyitásakor). Belépni óránként egyszer kell (a böngésző
  csak koppintásra enged belépő ablakot nyitni).
- **Fotó** gomb → a telefon saját kamerája, teljes felbontás (fotónként a „Fotó használata"
  koppintás marad – az appba épített kamerát a felhasználó nem kérte: rosszabb kép, nincs
  saját fókusz / HDR). A kép nem kerül a galériába.
- Feltöltés után a fotó a telefonról törlődik. Net nélkül sem vész el: magától
  újrapróbálja (30 mp-enként, és amikor visszajön a net).
- **Minden fotót megnéz a telefonon** (semmi nem megy ki hozzá): megkeresi rajta az
  ArUco-matricákat, és
  - kiírja, mit ismert fel („✓ Felismertem: …"), és kiszínezi a térképen, mit mutat (ajtó, oldalfal, vagy a parafatábla egy darabja) – ajtónál és
    oldalfalnál a feldolgozó szabályával: mindkét matrica-oszlopából legalább 2–2 matrica; a
    tábla darabja a felső vagy alsó szél két szomszédos matricája közti sáv, mindkettő kell
    (a feldolgozónak a tábla bármely 2 matricája elég);
  - szól, ha **nincs elég matrica**, ha **túl messziről** készült (3,5 px/mm alatt), vagy ha
    **életlen**. Ilyenkor választani lehet: „Újra fotózom" (a kép eldobva) vagy „Így is jó".
  Ez csak tanács: ha az ellenőrzés nem sikerül, a fotó akkor is megmarad.
- **Távoli fotó táblánként:** a térképen minden tábla alatt egy sáv: „+ 1 távoli fotó az
  egészről". Akkor zöld, ha egy fotón a tábla matricáinak legalább 60%-a látszik, és köztük
  4, amelyekből semelyik 3 nincs egy egyenesen (100 mm-en belül) – a feldolgozó
  `doors._general_four` szabálya. Ehhez illeszti a feldolgozó a közeli fotókat (a varratok így
  30–120 mm helyett 1–12 mm-re javultak). Ilyen fotóra nincs „túl messziről" figyelmeztetés,
  de a tábla közeli darabjait sem pipálja (az apró betű rajta nem olvasható). Ha a körben van
  közeli fotó egy tábláról, de távoli nincs, a Befejezés egyszer szól; a második nyomás így is küld.
- **A fal térképe:** a fal 29 része nagyjából méretarányosan, három sorban, ugyanakkora
  léptékben: 1. a bal szekrénysor (6 ajtó), 2. a jobb szekrénysor (6 ajtó), 3. az oldalfal, a
  nagy tábla 8 darabja (felső sor 1–4, alsó sor 1–4) és a kis tábla 6 darabja, mindkét tábla alatt a távoli fotó sávja. A méretek a `zones.json`-ból jönnek
  (`layout.js`: `size`, `box` mm-ben). A legutóbbi fotón felismert rész keretet kap. A térkép
  **csak az aktuális kört** mutatja: Befejezés után kiürül.
- **Ajtó két fotóból:** ha egy fotón csak a felső + középső matricák látszanak, az az ajtó
  **teteje** (a térképen felül zöld); alsó + középső = az **alja** (alul zöld). A kettő együtt (vagy
  egy egész-ajtós fotó) adja a pipát. Az oldalfal ugyanígy. A parafatábla darabja mindig egészben számít. **Ajánlott a két fél fotó** (élesebb): a feldolgozó az ajtó képét is két fix darabból, a felső és az alsó feléből rakja össze, a középső matricasornál vágva és a középső matricák sarkaihoz illesztve (RMG Tools, `board_worker/doors.py`, 2026-10-29). Ajtóhoz távoli fotó nem kell; táblához igen.
- **Üres ajtó fotó nélkül:** ha egy szekrényajtóról (vagy az oldalfalról) minden lekerült, a listán a számára
  a térképen rá koppintva „üres"-nek jelölhető (még egy koppintás visszavonja): szaggatott
  keretet és X-et kap, és a Befejezéssel megy el. A feldolgozó ilyenkor az
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

A matricák kódjai (`dictionary.js`), a fal térképe (`layout.js`) és a tesztképek az RMG Tools
`zones.json`-jából készülnek. Ha ott új zóna vagy más szótár lesz, futtasd újra:

```bash
C:/Loci/prog/rmg_tools/core/.venv/Scripts/python tools/make_data.py C:/Loci/prog/rmg_tools/core
```

(Oszloptávolság vagy táblaméret változásakor is futtasd: a térkép ezekből rajzol.)
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
| `rounds.js` | kör (Befejezés, vagy 15 perc csend után magától), várakozó sor, `done.json`, a kör térképjelei |
| `aruco.js` | saját, függőség nélküli ArUco-kereső + élességmérés |
| `check.js` | mit mutat a fotó, elég közeli-e, éles-e (a figyelmeztetések szövege) |
| `photo.js` | a fotó megnyitása a böngészőben az ellenőrzéshez |
| `dictionary.js`, `layout.js` | **generált** (`tools/make_data.py`): matricakódok, a fal részei és méretei |
| `store.js` | a várakozó sor a telefonon (IndexedDB) |
| `app.js`, `index.html`, `style.css` | a képernyő |
| `sw.js`, `manifest.webmanifest`, `icons/` | PWA |

## Adatvédelem

- A faliújságon diáknevek is lehetnek: a fotó csak a telefon → iskolai Drive úton megy.
- A GitHubon nincs adat. A `done.json`-ban nincs név vagy e-mail.
- Hibaüzenetbe, naplóba nem kerül token, fájlnév, szöveg.

## Belépés gomb nélkül (átirányításos belépés)

**Bekapcsolva (2026-10-08).** `redirectSignIn: false` mellett a belépés felugró ablakkal megy:
óránként egy koppintás a „Belépés" gombra (a böngésző csak koppintásra enged felugró ablakot
nyitni). A `config.js` `redirectSignIn: true` értékével a belépés **átirányítással** megy: az oldal maga megy át a Google-höz és jön vissza
– ehhez nem kell koppintás, ezért az app megnyitáskor (és ha menet közben lejár a belépés)
**magától belép**. Belépni így telefononként egyszer kell; utána csak akkor, ha valaki a
„Kijelentkezés"-re nyom, vagy a Google-fiókból kilép a böngészőben.

**Bekapcsolás előtt** az OAuth-kliensnél (Google Cloud → Credentials → a webes kliens) az
**Authorized redirect URIs** közé fel kell venni az app címét, pontosan, a végén perjellel:

- `https://locitanit.github.io/rmg-faliujsag-foto/`
- helyi próbához: `http://localhost:8765/`

Enélkül a Google hibaoldalt mutat az app helyett. Részletek és a tárolt adatok: a
`redirect-auth.js` eleje. iPhone kezdőképernyős appban (ahol az átirányítás külön
böngészőlapon nyílna) automatikusan a felugró ablakos belépés marad.
