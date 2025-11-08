# 📘 Meta File Search (sp_meta_search_v154)

## Översikt

**Meta File Search** är en Node.js/Express-applikation som indexerar, importerar och söker metadata för filer av olika typer.  
Syftet är att enkelt kunna **importera**, **söka** och **visualisera** metadata för filer som lagras i lokala mappar.  

Applikationen består av:

- En **backend** i Node.js (Express + MySQL)
- Ett **webbgränssnitt** (HTML/JS/CSS)
- Realtidsuppdatering via **Server-Sent Events (SSE)** vid import

---

## Funktionella delar

### 1. Sök (search.html)

- Möjliggör sökning i databasen över alla filtyper:
  - Bilder (`sp_image`)
  - PDF-dokument (`sp_pdf`)
  - PowerPoint-presentationer (`sp_ppt`)
  - Musikfiler (`sp_music`)
- Resultaten visar relevant metadata:
  - **Bilder**: Latitude, Longitude, Camera Make, Camera Model  
    - Innehåller även länk till **Google Maps** utifrån GPS-position.  
  - **Musik**: Titel, Artist, Album  
  - **PDF**: Antal sidor  
  - **PPT**: Antal slides  

### 2. Ladda upp (upload.html)

- Används för att ladda upp nya filer till serverns katalogstruktur:

  meta_files/
  ├── image/
  ├── pdf/
  ├── ppt/
  └── music/

- Filen sparas i rätt mapp baserat på vald kategori.
- Efter uppladdning kan metadata importeras via **import.html**.
- För alla filtyper laddas datum när filen skapades, förutom för images där istället när bilden togs hämtas om den meta-informationen finns.

### 3. Importera metadata (import.html)

- Skannar alla kataloger under `meta_files/`.
- För varje fil:
  - Beräknar **SHA-256**.
  - Jämför mot befintliga poster i MySQL.
  - Läsning av metadata sker via moduler i `server/src/services/metadata.js`.

#### Importlogik

| Situation | Resultat i logg |
|------------|----------------|
| Ny fil (okänd SHA) | *inserted* |
| Samma fil redan i DB (samma SHA) | ⏭️ *skipped* |
| Filnamn finns men hash skiljer sig | ↻ *updated* |

#### Visuella element

- Progressbars per kategori:
  - Images, PDFs, PPTs, Music
- Realtidsloggning av status via **SSE** (Server-Sent Events)
- Knappar:
  - **Run Import** – startar import
  - **Stoppa import** – avbryter
  - **Räkna filer** – räknar antal filer per kategori innan import

---

## Databasstruktur (MySQL)

Tabellerna skapas automatiskt via `server/src/db.js` vid första körning.  
Alla tabeller använder **utf8mb4** och har **unikt SHA-index** för snabb matchning.

### sp_image

| Kolumn | Typ | Beskrivning |
|--------|-----|-------------|
| Id | INT | Primärnyckel |
| FileName | VARCHAR(512) | Filnamn |
| FullPath | VARCHAR(2048) | Fullständig sökväg |
| MimeType | VARCHAR(128) | MIME-typ |
| SizeBytes | BIGINT | Filstorlek |
| LastWriteTimeUtc | DATETIME | Senaste ändringsdatum |
| Sha256 | VARCHAR(64) | Hash för jämförelse |
| Width / Height | INT | Bilddimensioner |
| Latitude / Longitude | DOUBLE | GPS-position |
| CameraMake / CameraModel | VARCHAR(128) | Kamerainformation |

### sp_pdf

| Kolumn | Typ | Beskrivning |
|--------|-----|-------------|
| Id | INT | Primärnyckel |
| FileName | VARCHAR(512) | Filnamn |
| FullPath | VARCHAR(2048) | Fullständig sökväg |
| MimeType | VARCHAR(128) | MIME-typ |
| SizeBytes | BIGINT | Filstorlek |
| LastWriteTimeUtc | DATETIME | Senaste ändringsdatum |
| Sha256 | VARCHAR(64) | Hash |
| PageCount | INT | Antal sidor |

### sp_ppt

| Kolumn | Typ | Beskrivning |
|--------|-----|-------------|
| Id | INT | Primärnyckel |
| FileName | VARCHAR(512) | Filnamn |
| FullPath | VARCHAR(2048) | Fullständig sökväg |
| MimeType | VARCHAR(128) | MIME-typ |
| SizeBytes | BIGINT | Filstorlek |
| LastWriteTimeUtc | DATETIME | Senaste ändringsdatum |
| Sha256 | VARCHAR(64) | Hash |
| SlideCount | INT | Antal slides |

### sp_music

| Kolumn | Typ | Beskrivning |
|--------|-----|-------------|
| Id | INT | Primärnyckel |
| FileName | VARCHAR(512) | Filnamn |
| FullPath | VARCHAR(2048) | Fullständig sökväg |
| MimeType | VARCHAR(128) | MIME-typ |
| SizeBytes | BIGINT | Filstorlek |
| LastWriteTimeUtc | DATETIME | Senaste ändringsdatum |
| Sha256 | VARCHAR(64) | Hash |
| BitrateKbps | INT | Bitrate |
| DurationSeconds | INT | Speltid i sekunder |
| Title | VARCHAR(256) | Titel |
| Artist | VARCHAR(256) | Artist |
| Album | VARCHAR(256) | Album |

---

## Backendkomponenter

### `/server/src/server.js`

- Startar Express-servern.
- Registrerar routes:
  - `/api/import`
  - `/api/search`
  - `/api/debug/dbcheck`
- Loggar startadress, t.ex.  

  sp_meta_search_js v3 listening on http://localhost:3000

### `/server/src/routes/import.js`

- Sköter filimport med loggning.
- Använder `sha256File()` för hashjämförelse.
- Returnerar *inserted*, *updated* eller *skipped*.
- Stöd för SSE-strömmar för realtidsloggning till webbsidan.

### `/server/src/routes/search.js`

- Tar emot söksträngar från frontenden.
- Använder MySQL-querys mot alla fyra tabeller.
- Returnerar träffar som JSON till klienten.

### `/server/src/services/metadata.js`

- Läser ut metadata beroende på filtyp:
  - **Images**: via `exifr` (EXIF, GPS, kamera)
  - **PDF**: via `pdf-parse`
  - **Music**: via `music-metadata`
  - **PPT**: (placeholder – endast slideCount = null i v154)

### `/server/src/db.js`

- Skapar databasens tabeller om de saknas.
- Har stöd för `multipleStatements`.
- Exponerar `getPool()` för delad MySQL-anslutning.
- Endpoint `/api/debug/dbcheck` returnerar JSON:

  ```json
  {"ok": true, "multipleStatements": true, "details": {"sets": 2}}
  ```

---

## Körning

### 1️ Installera beroenden

```bash
cd server
npm install
```

### 2️ Starta applikationen

```bash
npm start
```

### 3️ Öppna i webbläsare

http://localhost:3000

## Inställningar i .env

MYSQL_HOST=5.189.183.23
MYSQL_PORT=4567
MYSQL_USER=dm24-sthm-grupp5
MYSQL_PASSWORD=NYVFT44234
MYSQL_DATABASE=dm24-sthm-grupp5

BASE_DIR=C:/Grupparbete/sp_meta_search_js/meta_files
IMAGE_DIR=C:/Grupparbete/sp_meta_search_js/meta_files/image
PDF_DIR=C:/Grupparbete/sp_meta_search_js/meta_files/pdf
PPT_DIR=C:/Grupparbete/sp_meta_search_js/meta_files/ppt
MUSIC_DIR=C:/Grupparbete/sp_meta_search_js/meta_files/music

# -Kommentera bort om inloggning skall krävas-# BASIC_USER=admin

# -Kommentera bort om inloggning skall krävas-# #BASIC_PASS=admin

PORT=3000

---

## Realtidsloggning (SSE)

Importflödet använder **Server-Sent Events**:

- `/api/import/stream` – öppen anslutning för loggar i realtid  
- Varje händelse skickas som JSON med:

  ```json
  {
    "phase": "processed",
    "file": "C:\meta_files\image\DSC00042.JPG",
    "result": "inserted"
  }
  ```

---

## Tekniska beroenden

| Paket | Användning |
|-------|-------------|
| express | REST API |
| mysql2/promise | MySQL-anslutning |
| exifr | EXIF och GPS från bilder |
| pdf-parse | Metadata från PDF-filer |
| music-metadata | Metadata från MP3 |
| image-size | Bilddimensioner |
| dotenv | Miljökonfiguration |

---

## Sammanfattning

**Meta File Search v154** erbjuder:

- Automatisk filscanning och metadataimport  
- Realtidsloggning av förlopp per kategori  
- Sökning och filtrering av alla typer av filer  
- Stöd för kamera- och GPS-data, musikmetadata  
- Stabil databasstruktur med SHA-baserad duplikatkontroll  

---

## Kontakt / Underhåll

Utvecklad av Susanne Pålsson för lokal metadatahantering och analys av filsystem under utbildningen Metadata och Webanalys.  
Alla komponenter är självständiga och kan anpassas för andra datatyper.
