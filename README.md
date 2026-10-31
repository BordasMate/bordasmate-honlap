# Bordás Máté – alkotói honlap

Statikus honlap beépített szerkesztővel (`/admin`). A szerkesztő mentései
egy kis Netlify Functionön keresztül a Netlify saját tárhelyére (Netlify
Blobs) kerülnek, és azonnal élnek – GitHub és újraépítés nélkül.

## A látvány

A felület egy valós időben számolt, LiDAR-szerű **pontfelhő 3D térben**:

- **Térképlap:** dőlt, perspektivikus lap a sötét térben; a talaj pontjai
  lila–kék színűek, lassan hullámoznak, kattintásra gyűrűk futnak rajtuk.
- **Amőbák:** a kategóriák, alkategóriák és művek pontokból álló 3D
  kupolák, mint a szkennelt fák lombja – alul kékek, felül sárga–vörösek.
  Sodródnak, lökdösik egymást, és lélegzenek.
- **Halmazok:** az Irodalom és a Zene halmazát a talajon fénylő kontúr és
  színezett terület jelöli; a közös alkategóriák (pl. *Zenés felolvasás*)
  a két kontúr metszetében ülnek. Az egérrel ráállt sejt körül fényes gyűrű.
- **Mélység:** lebegő pontkristályok a lap fölött, mögött és a kamera előtt,
  mélységélesség, lassan mozgó kamera, egérrel parallaxis.
- **Glitch:** kb. 10 másodpercenként egy rövid sorozat, oldalváltáskor teljes
  képes glitch. **Színek:** a nyitóoldal színes, az almenük egyszínűek, de
  színesek (Irodalom réz, Zene kobalt, közös alkategóriák lila).

A feliratok és szövegek HTML-ben vannak, ezért mindig élesek.

## Teljesítmény

A grafika eszközönként választ minőségi szintet (pontszám, felbontás,
képkockaszám); ha egy gép nem bírja, menet közben visszavesz.

| Szint | Mikor | Felbontás | Képkocka |
|---|---|---|---|
| magas | erős asztali gép | legfeljebb 1,4 millió pixel | 60 fps |
| közepes | telefon, tablet, átlagos laptop | legfeljebb 0,75 millió pixel | 30 fps |
| alacsony | gyenge vagy régi eszköz | legfeljebb 0,42 millió pixel | 30 fps |

Kipróbáláshoz kézzel is választható: `?q=low`, `?q=mid`, `?q=high`.

## A szerkesztő (`/admin`)

A honlap címe után írd: **/admin**.

- Bal oldalt a szerkezet: kategóriák → alkategóriák → művek, külön a közös
  (metszetbeli) alkategóriák. Hozzáadás, törlés, sorrend, áthelyezés.
- **Megjelenés:** színek, betűtípus, pontfelhő és kamera (pontsűrűség,
  pontméret, kategóriaszín, domborzat, dőlésszög, elforgatás, kameramozgás,
  szemcse), glitch.
- **Oldal:** név, leírás, e-mail és linkek a lap alján.
- Jobb oldalt **élő előnézet**. A változások piszkozatként ebben a
  böngészőben megmaradnak; a **Mentés** gomb (vagy Ctrl+S) teszi őket a
  honlapra – onnantól mindenkinek így látszik, és így is marad.
- **Előzmények:** az utolsó 40 mentés bármelyike visszatölthető.
- Kép, hang, videó vagy PDF feltölthető (legfeljebb 5 MB); a honlap
  tárhelyére kerül.

### Beállítás (egyszer)

A Netlify felületén: **Site configuration → Environment variables → Add a
variable**: kulcs `ADMIN_PASSWORD`, érték a szerkesztő jelszava. Utána
indíts egy új telepítést (**Deploys → Trigger deploy**), hogy a függvény
megkapja. A jelszót a szerkesztő az első mentéskor kéri.

A `/admin` oldalt bárki megnyithatja, de jelszó nélkül semmit nem tud menteni.

## Tartalom

A kezdő tartalom a `public/content.json` fájlban van (a 2025-ös szakmai
publikációs jegyzékből és a 2026. augusztusi MTMT-listából). Amíg a
szerkesztőben nincs mentés, a honlap ezt mutatja; az első mentés után a
tárhelyen levő változatot. A **Letöltés** gombbal a teljes tartalom bármikor
lementhető fájlba (biztonsági másolatnak is jó), a **Betöltés** gombbal
visszatölthető.

Egy mű mezői: `title`, `slug`, `meta`, `about`, `poem`, `image`, `audio`,
`embed`, `app`, `links`, valamint `entries` – publikációs lista, amely a honlapon
évenként csoportosítva jelenik meg (`year`, `title`, `source`, `link`, `note`).

## Beágyazott programok

A `public/muvek/` mappában a generatív művek böngészős átiratai vannak; a mű
`app` mezője mutat rájuk (a szerkesztőben: „Interaktív mű”). A honlapon
keretben futnak, a „Teljes képernyő” gombbal kinagyíthatók (Esc: vissza).

- `muvek/tervrajzok/` – *Tervrajzok: az audiovizualitás üledékei* (2025).
  A 24 oldal fóliaszimulációja, olvasósáv, betűhang-generátor és szűrt
  fehérzaj. A hangmotor (`audio-worklet.js`) az eredeti Python-program
  pontos átirata; a SciPy Butterworth-szűrőit számszerűen ellenőrizve követi.
- `muvek/monstrorum-infinitum/` – *Monstrorum Infinitum* (Bordás Máté –
  Mezei Gábor, 2025), az eredeti 12 hangmintával.

A böngészők csak kattintás után engednek hangot, ezért a programok egy
kattintással indulnak.

## Közzététel GitHubon és Netlify-on (első alkalommal)

1. Hozz létre egy GitHub-tárolót, és töltsd fel a mappa teljes tartalmát.
2. Netlify: **Add new site → Import an existing project → GitHub**, válaszd ki a tárolót.
3. Build command: *üres*, Publish directory: `public` (a `netlify.toml`
   beállítja; ha a Netlify felületén más van megadva, töröld vagy írd át).
   A Netlify a `package.json` alapján telepíti a függvényhez kellő csomagot.

**Fontos:** a honlapot GitHubról kell telepíteni. A Netlify „húzd ide”
(drag & drop) feltöltése nem futtatja a szerkesztő mentéseit végző függvényt.
4. Add meg az `ADMIN_PASSWORD` változót (lásd fent).

A tartalom szerkesztéséhez ezután már nem kell a GitHubhoz nyúlni; csak a
honlap kódjának módosításakor.

## Felépítés

```
public/                     a közzétett honlap
  index.html                a honlap
  content.json              kezdő tartalom és beállítások
  admin/                    a szerkesztő
  js/main.js                útvonalak, jelenetek, előnézet
  js/organism.js            elrendezés, fizika, glitch, utófeldolgozás
  js/lidar.js               a pontfelhős 3D renderelő
  css/, fonts/              stílusok, saját tárhelyről betöltött betűk (OFL)
netlify/functions/api.mjs   mentés, előzmények, média (Netlify Blobs)
netlify.toml, package.json  Netlify beállítás (Node 22)
```
