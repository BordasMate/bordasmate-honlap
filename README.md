# Bordás Máté – alkotói honlap

Statikus honlap, build lépés nélkül. A felület egy valós időben számolt
WebGL2-shader: sötét, folyékony fémtükör, rajta krómos, irizáló, bordázott
peremű sejtek. A tartalmat hordozó sejtek egymáshoz préselődnek (közös,
ívelt határvonallal), és a vízfelszínen sodródva folyamatosan lökdösik
egymást. Oldalváltáskor a közös sejtek (pl. a kategória) átúsznak az új
helyükre, a többi elmerül vagy felbukkan.

WebGL2 nélküli böngészőben egyszerű, sötét linklista jelenik meg.
Ha a gép lassú, a felbontás magától csökken; „csökkentett mozgás”
beállítás mellett a sejtek nem sodródnak.

## Tartalom szerkesztése

Minden szöveg a **`js/content.js`** fájlban van. A fájl elején le van írva,
milyen mezői lehetnek egy műnek (`title`, `slug`, `meta`, `about`, `poem`,
`embed`, `audio`, `links`, `image`). Új kategória, alkategória vagy mű:
másolj le egy meglévő blokkot és írd át. A nyitóoldal és az aloldalak
elrendezése automatikusan igazodik az elemek számához.

Képek, hangfájlok: tedd egy `media/` mappába, és hivatkozz rájuk így:
`image: "/media/borito.jpg"`.

## Helyi kipróbálás

A mappában futtasd:

```
npx serve -s .
```

majd nyisd meg a kiírt címet (pl. http://localhost:3000). A `-s` kapcsoló
kell ahhoz, hogy az aloldalak (pl. `/irodalom/vers`) frissítéskor is
betöltődjenek.

## Közzététel GitHubon és Netlify-on

1. Hozz létre egy új GitHub-tárolót, és töltsd fel a mappa teljes tartalmát.
2. Netlify: **Add new site → Import an existing project → GitHub**, válaszd ki a tárolót.
3. Build command: *üres*, Publish directory: `.` (a `netlify.toml` ezt már beállítja).
4. Ezután minden `git push` automatikusan frissíti az oldalt.

A `netlify.toml` gondoskodik arról, hogy a tiszta címek (`/zene/techno`)
közvetlenül megnyitva is működjenek.

## Felépítés

```
index.html          oldalváz
css/style.css       feliratok, szövegpanel, lábléc
css/fonts.css       saját tárhelyről betöltött betűk
fonts/              Syne és Literata (SIL Open Font License)
js/content.js       ← a tartalom
js/main.js          útvonalak, jelenetek összeállítása
js/organism.js      shader, sejtfizika, feliratok követése
netlify.toml        Netlify beállítás
```

Fémtónusok (`palette` mező): `titan`, `rez`, `kobalt`, `zoldarany`.
A színek a `js/organism.js` `TINT_DATA` és `GLOW_DATA` tömbjében
hangolhatók.
