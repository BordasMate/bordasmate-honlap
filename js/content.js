/*
  A HONLAP TARTALMA
  =================
  Minden szöveg, kategória és mű ebben az egy fájlban van.
  Új mű felvételéhez másold le egy meglévő mű blokkját a megfelelő
  alkategóriában, és írd át. A "slug" lesz a webcím része
  (csak kisbetű, szám és kötőjel: pl. "egy-volgy-elarasztasa").

  Egy mű mezői (mindegyik elhagyható, kivéve a title és slug):
    title    – cím
    slug     – webcím-rész
    meta     – rövid sor a cím alatt (pl. "verseskötet · Kiadó, 2020")
    about    – bevezető bekezdések (tömb; egy elem = egy bekezdés)
    poem     – vers vagy szövegrészlet; a sortöréseket megtartja
    embed    – beágyazható lejátszó/videó URL-je (pl. Bandcamp, SoundCloud,
               YouTube "embed" link) – iframe-ként jelenik meg
    audio    – saját hangfájl elérési útja (pl. "/media/felolvasas.mp3")
    links    – külső hivatkozások: [{ label: "...", href: "https://..." }]
    image    – kép elérési útja (pl. "/media/borito.jpg")

  A kategóriák halmazokként jelennek meg; a több kategóriához tartozó
  alkategóriák a fájl végén, a "shared" listában vannak (a halmazok metszete).

  A kategóriák "palette" mezője a fém tónusát választja (az almenükben ez lesz
  az egyszínű kép árnyalata is):
    "titan"     – ezüstös titán, szivárványos futtatással (a nyitóoldalé)
    "rez"       – vörösréz, izzó narancs fénnyel
    "kobalt"    – kékes kobalt, erős irizálással
    "zoldarany" – zöldes arany (szabad egy harmadik kategóriának)
*/

export const site = {
  name: "Bordás Máté",
  description: "Bordás Máté költő, irodalomtudós és zenész alkotói honlapja.",
  palette: "titan",

  // Ha kitöltöd, a lap alján megjelenik. Üresen hagyva nem látszik.
  contact: {
    email: "",
    links: [
      // { label: "Instagram", href: "https://instagram.com/..." },
    ],
  },

  categories: [
    {
      title: "Irodalom",
      slug: "irodalom",
      palette: "rez",
      children: [
        {
          title: "Vers",
          slug: "vers",
          works: [
            {
              title: "Egy völgy elárasztása",
              slug: "egy-volgy-elarasztasa",
              meta: "verseskötet",
              about: ["A kötet rövid ismertetője ide kerül."],
            },
            {
              title: "Gnóm",
              slug: "gnom",
              meta: "verseskötet",
              about: ["A kötet rövid ismertetője ide kerül."],
            },
            {
              title: "A terhelés poétikája",
              slug: "a-terheles-poetikaja",
              meta: "verseskötet",
              about: ["A kötet rövid ismertetője ide kerül."],
              poem: "Ide kerülhet egy vers vagy részlet.\nA sortörések\n    és a behúzások\nmegmaradnak.",
            },
          ],
        },
        {
          title: "Műfordítás",
          slug: "muforditas",
          works: [
            {
              title: "Fordítás címe",
              slug: "forditas-1",
              meta: "szerző · eredeti nyelv",
              about: ["Néhány mondat a fordításról."],
            },
          ],
        },
        {
          title: "Irodalomtudomány",
          slug: "irodalomtudomany",
          works: [
            {
              title: "A poszthumán líra",
              slug: "poszthuman-lira",
              meta: "doktori disszertáció · folyamatban",
              about: ["A kutatás rövid összefoglalója ide kerül."],
            },
            {
              title: "Tanulmány címe",
              slug: "tanulmany-1",
              meta: "folyóirat, év",
              about: ["Absztrakt vagy rövid leírás."],
              links: [{ label: "Elérhető online", href: "https://example.com" }],
            },
          ],
        },
        {
          title: "Digitális költészet",
          slug: "digitalis-kolteszet",
          works: [
            {
              title: "Digitális mű címe",
              slug: "digitalis-1",
              meta: "generatív szöveg · böngészős mű",
              about: ["A mű leírása; az embed mezőbe a mű saját URL-je is kerülhet."],
            },
          ],
        },
      ],
    },
    {
      title: "Zene",
      slug: "zene",
      palette: "kobalt",
      children: [
        {
          title: "Kísérleti",
          slug: "kiserleti",
          works: [
            {
              title: "Hangszőnyeg",
              slug: "hangszonyeg",
              meta: "böngészős hangszer",
              about: ["Extrém időnyújtáson alapuló hangszövő hangszer a böngészőben."],
            },
          ],
        },
        {
          title: "Techno",
          slug: "techno",
          works: [
            {
              title: "Track címe",
              slug: "track-1",
              meta: "év",
              about: ["Rövid leírás."],
              // embed: "https://bandcamp.com/EmbeddedPlayer/track=.../size=large/...",
            },
          ],
        },
      ],
    },
  ],

  // KÖZÖS ALKATEGÓRIÁK – több kategóriához is tartoznak, a halmazok metszetében
  // jelennek meg. Az "in" mező sorolja fel, melyik kategóriák (slug) metszetébe kerül.
  shared: [
    {
      title: "Zenés felolvasás",
      slug: "zenes-felolvasas",
      in: ["irodalom", "zene"],
      works: [
        {
          title: "Felolvasás címe",
          slug: "felolvasas-1",
          meta: "helyszín, dátum",
          about: ["Rövid leírás."],
          // embed: "https://www.youtube.com/embed/...",
        },
      ],
    },
  ],
};
