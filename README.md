# Bordás Máté – alkotói honlap

Statikus honlap, build lépés nélkül, beépített szerkesztővel (`/admin`).

## A látvány

A felület egy valós időben számolt WebGL2-kép:

- **Sejtek és halmazok:** a kategóriák (Irodalom, Zene) amőbaszerű halmazok,
  bennük az alkategóriák sejtjei. A halmazok összeérnek; a közös
  alkategóriák (pl. *Zenés felolvasás*) a metszetben ülnek. A sejtek a
  vízfelszínen sodródnak és lökdösik egymást.
- **Anyagok:** a felület foltokban keveri a fémet (acél, réz, a paletta
  színe), a fát, a mészkövet és az agyagot; szemcsés, enyhén rozsdás.
- **Mélység:** kristályszilánkok a víz alatt, fazettás kristályok előtte és
  mögötte, mélységélesség, egérrel mozduló parallaxis.
- **Glitch:** kb. 10 másodpercenként egy rövid sorozat (szeletcsúszás,
  elkenődés, mozaik, képszakadás stb.), oldalváltáskor teljes képes glitch.
- **Színek:** a nyitóoldal színes, az almenük egyszínűek, de színesek
  (Irodalom réz, Zene kobalt, közös alkategóriák lila).

WebGL2 nélküli böngészőben egyszerű linklista jelenik meg. Lassú gépen a
felbontás magától csökken.

## Tartalom és beállítások: `content.json`

Minden szöveg, kategória, mű és beállítás (színek, betűtípus, anyagok,
glitch) a gyökérkönyvtár `content.json` fájljában van. Ezt a
**szerkesztő** írja – kézzel szerkeszteni nem kell, de lehet.

Egy mű mezői: `title`, `slug`, `meta` (sor a cím alatt), `about`
(bekezdések), `poem`, `image`, `audio`, `embed`, `links`, valamint
`entries` – publikációs lista, amely a honlapon évenként csoportosítva
jelenik meg (`year`, `title`, `source`, `link`, `note`).

A kezdő tartalom a 2025-ös szakmai publikációs jegyzékből (szépirodalom,
műfordítás, szerkesztői munka) és a 2026. augusztusi MTMT-listából
(tudományos közlemények) készült.

## A szerkesztő (`/admin`)

A honlap címe után írd: **/admin** (pl. `https://valami.netlify.app/admin`).

- Bal oldalt a szerkezet: kategóriák → alkategóriák → művek, külön a közös
  (metszetbeli) alkategóriák. Hozzáadás, törlés, sorrend, áthelyezés.
- **Megjelenés** fül: fémtónusok és egyszínű árnyalatok, betűtípus,
  anyagok aránya, szemcse, glitch (gyakoriság, erősség, hossz…).
- **Oldal** fül: név, leírás, e-mail és linkek a lap alján.
- Jobb oldalt **élő előnézet**: minden változás azonnal látszik.
- A változások piszkozatként megmaradnak ebben a böngészőben; a honlapra a
  **Közzététel** gomb teszi ki őket.

### Közzététel beállítása (egyszer)

A Közzététel a GitHub API-n keresztül írja a `content.json`-t a tárolóba;
a Netlify ezt észleli, és kb. egy perc alatt frissíti a honlapot.

1. GitHub → Settings → Developer settings → Personal access tokens →
   **Fine-grained tokens** → Generate new token.
2. Repository access: *Only select repositories* → a honlap tárolója.
3. Permissions → Repository permissions → **Contents: Read and write**.
4. A szerkesztőben a **GitHub** gombra kattintva add meg a tárolót
   (`felhasználónév/tárolónév`), az ágat (általában `main`) és a tokent.

A token csak a te böngésződben tárolódik. A `/admin` oldalt bárki
megnyithatja, de token nélkül semmit nem tud módosítani.

A szerkesztőből képet és hangfájlt is fel lehet tölteni; ezek a tároló
`media/` mappájába kerülnek.

Token nélkül is lehet dolgozni: a **Letöltés** gomb a kész `content.json`-t
adja, ezt kézzel feltöltheted a GitHub-tárolóba.

## Közzététel GitHubon és Netlify-on (első alkalommal)

1. Hozz létre egy GitHub-tárolót, és töltsd fel a mappa teljes tartalmát.
2. Netlify: **Add new site → Import an existing project → GitHub**, válaszd ki a tárolót.
3. Build command: *üres*, Publish directory: `.` (a `netlify.toml` beállítja).

## Helyi kipróbálás

```
npx serve -s .
```

## Felépítés

```
index.html          a honlap
content.json        ← tartalom és beállítások (a szerkesztő írja)
admin/              a szerkesztő (index.html, admin.js, admin.css)
css/style.css       feliratok, szövegpanel, listák
css/fonts.css       saját tárhelyről betöltött betűk
fonts/              Syne, Unbounded, Bricolage Grotesque, Space Grotesk,
                    Fraunces, Literata, Newsreader, Source Serif 4 (OFL)
js/main.js          útvonalak, jelenetek, előnézet
js/organism.js      shaderek, anyagok, sejtfizika, glitch
netlify.toml        Netlify beállítás
```
