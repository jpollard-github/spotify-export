# Spotify Export Analyzer

<img width="1536" height="1024" alt="image" src="https://github.com/user-attachments/assets/18b36d52-5f69-4576-aa10-053cc443c37e" />

Local tools for turning Spotify extended streaming-history JSON exports into normalized JSON, ranked summaries, Last.fm genre enrichment, and a static music report prototype.

The intended flow is:

```text
Spotify raw JSON exports
  -> npm run spotify:analyze
  -> npm run lastfm:enrich
  -> npm run music:report
  -> output/music-report/index.html
```

## Requirements

- Node.js 20 or newer.
- Spotify extended streaming-history export JSON files.
- A Last.fm API key if you want genre enrichment.

No npm dependencies are currently required.

## Folder Setup

Create a `raw/` folder at the project root and put your Spotify export JSON files in it:

```bash
mkdir -p raw
```

Expected examples:

```text
raw/Streaming_History_Audio_2024.json
raw/Streaming_History_Audio_2025.json
raw/Streaming_History_Video_2025.json
```

The `output/` folder is created automatically by `npm run spotify:analyze` if it does not already exist.

These local folders/files are intentionally ignored by Git:

```text
raw/
output/
.env.local
.DS_Store
```

## Environment Variables

Create `.env.local` only if you want Last.fm genre enrichment:

```bash
LASTFM_API_KEY=your_lastfm_api_key
```

Spotify API keys are not needed. Spotify no longer provides useful genre data for this project, so genre enrichment uses Last.fm artist tags.

## Scripts

### Analyze Spotify Exports

```bash
npm run spotify:analyze
```

This reads JSON files from `raw/`, validates them against the schemas in `schemas/`, normalizes stream events, and writes summary files to `output/`.

Main outputs:

```text
output/stream-events-0001.json
output/stream-events.ndjson
output/stream-events-manifest.json
output/top-artists.json
output/top-songs.json
output/top-albums.json
output/top-videos.json
output/yearly-trends.json
output/monthly-trends.json
output/genre-candidates.json
output/genre-candidates-top-1000.json
output/odd-findings.json
output/report.json
output/import.sql
output/validation-warnings.json
```

Optional flags:

```bash
npm run spotify:analyze -- ./raw --output output --chunk-size 10000
```

Rankings are primarily sorted by total milliseconds played, with total streams as the tie-breaker.

### Enrich Genres With Last.fm

```bash
npm run lastfm:enrich
```

This reads:

```text
output/genre-candidates-top-1000.json
```

and writes:

```text
output/genre-candidates-top-1000.enriched.json
output/artist-genres.lastfm.json
output/lastfm-artist-genre-cache.json
```

The cache lets the script resume without re-fetching artists it already looked up. If Last.fm rate-limits the run, the script stops and writes partial output from whatever is already cached.

Optional flags:

```bash
npm run lastfm:enrich -- --limit 1000 --delay-ms 250 --max-tags 8 --min-tag-count 5
```

### Build Static Music Report

```bash
npm run music:report
```

This reads the generated summary files and writes:

```text
output/music-report/index.html
output/music-report/styles.css
```

Open `output/music-report/index.html` in a browser to view the static 80s-themed report prototype.

The report also reads `output/stream-events.ndjson` to build the “Past 3 Months” section, which shows the top 50 artists, songs, and albums by listen count for the three months ending at the latest play date in the export.

The generated HTML currently includes these sections:

- Hero summary with total hours, streams, peak year, and genre match count.
- Yearly Signal: listening hours and skip rate by year.
- Recent Months: compact pulse chart for the latest 36 months.
- Peak Months: highest listening months by hours played.
- Genre Weather: Last.fm genre tags weighted by listening time.
- Eras: detected artist, album, and genre chapters where something suddenly dominated a month or season.
- Musical DNA: foundational artists, evolution artists, one-season wonders, comfort artists, and discovery artists.
- Past Three Months Mood Read: possible emotions, mental state, mood, explanation, and evidence.
- Whole Timeframe Mood Read: possible emotions, mental state, mood, explanation, and evidence.
- Past Three Months Mood Graph: daily low-to-high mood score graph.
- Whole Timeframe Mood Graph: monthly low-to-high mood score graph.
- Past 3 Months: top 50 artists, songs, and albums by listen count.
- All-time leaderboards: top artists, songs, albums, and videos.
- Long Lifespans: artists active across the most years.
- Repeat Track Fixations: strongest single-day song repeats.
- Album Fixation Weeks: strongest one-week album repeats.
- Video / Music Ratio: audio versus video listening split.

## Website Import Notes

The website should not process raw Spotify exports directly. The better flow is:

```text
raw Spotify JSON
  -> local scripts
  -> normalized data and summaries
  -> Postgres import
  -> Next.js pages/components
```

Use Postgres for queryable stream events and summaries. Use Vercel Blob later for archived exports or generated public JSON/chart data if that becomes useful.

`output/import.sql` is a starter import scaffold for:

```text
spotify_stream_events
spotify_artist_metadata
spotify_analysis_snapshots
```

## Suggested Workflow

1. Put Spotify export files in `raw/`.
2. Run `npm run spotify:analyze`.
3. Add `LASTFM_API_KEY` to `.env.local`.
4. Run `npm run lastfm:enrich`.
5. Run `npm run music:report`.
6. Review `output/music-report/index.html`.
7. Import only the useful, interesting parts into the ArcadeGhosts music page.


Local tools for turning Spotify extended streaming-history JSON exports into normalized JSON, ranked summaries, Last.fm genre enrichment, and a static music report prototype.

The intended flow is:

```text
Spotify raw JSON exports
  -> npm run spotify:analyze
  -> npm run lastfm:enrich
  -> npm run music:report
  -> output/music-report/index.html
```

## Requirements

- Node.js 20 or newer.
- Spotify extended streaming-history export JSON files.
- A Last.fm API key if you want genre enrichment.

No npm dependencies are currently required.

## Folder Setup

Create a `raw/` folder at the project root and put your Spotify export JSON files in it:

```bash
mkdir -p raw
```

Expected examples:

```text
raw/Streaming_History_Audio_2024.json
raw/Streaming_History_Audio_2025.json
raw/Streaming_History_Video_2025.json
```

The `output/` folder is created automatically by `npm run spotify:analyze` if it does not already exist.

These local folders/files are intentionally ignored by Git:

```text
raw/
output/
.env.local
.DS_Store
```

## Environment Variables

Create `.env.local` only if you want Last.fm genre enrichment:

```bash
LASTFM_API_KEY=your_lastfm_api_key
```

Spotify API keys are not needed. Spotify no longer provides useful genre data for this project, so genre enrichment uses Last.fm artist tags.

## Scripts

### Analyze Spotify Exports

```bash
npm run spotify:analyze
```

This reads JSON files from `raw/`, validates them against the schemas in `schemas/`, normalizes stream events, and writes summary files to `output/`.

Main outputs:

```text
output/stream-events-0001.json
output/stream-events.ndjson
output/stream-events-manifest.json
output/top-artists.json
output/top-songs.json
output/top-albums.json
output/top-videos.json
output/yearly-trends.json
output/monthly-trends.json
output/genre-candidates.json
output/genre-candidates-top-1000.json
output/odd-findings.json
output/report.json
output/import.sql
output/validation-warnings.json
```

Optional flags:

```bash
npm run spotify:analyze -- ./raw --output output --chunk-size 10000
```

Rankings are primarily sorted by total milliseconds played, with total streams as the tie-breaker.

### Enrich Genres With Last.fm

```bash
npm run lastfm:enrich
```

This reads:

```text
output/genre-candidates-top-1000.json
```

and writes:

```text
output/genre-candidates-top-1000.enriched.json
output/artist-genres.lastfm.json
output/lastfm-artist-genre-cache.json
```

The cache lets the script resume without re-fetching artists it already looked up. If Last.fm rate-limits the run, the script stops and writes partial output from whatever is already cached.

Optional flags:

```bash
npm run lastfm:enrich -- --limit 1000 --delay-ms 250 --max-tags 8 --min-tag-count 5
```

### Build Static Music Report

```bash
npm run music:report
```

This reads the generated summary files and writes:

```text
output/music-report/index.html
output/music-report/styles.css
```

Open `output/music-report/index.html` in a browser to view the static 80s-themed report prototype.

The report also reads `output/stream-events.ndjson` to build the “Past 3 Months” section, which shows the top 50 artists, songs, and albums by listen count for the three months ending at the latest play date in the export.

The generated HTML currently includes these sections:

- Hero summary with total hours, streams, peak year, and genre match count.
- Yearly Signal: listening hours and skip rate by year.
- Recent Months: compact pulse chart for the latest 36 months.
- Peak Months: highest listening months by hours played.
- Genre Weather: Last.fm genre tags weighted by listening time.
- Eras: detected artist, album, and genre chapters where something suddenly dominated a month or season.
- Musical DNA: foundational artists, evolution artists, one-season wonders, comfort artists, and discovery artists.
- Past Three Months Mood Read: possible emotions, mental state, mood, explanation, and evidence.
- Whole Timeframe Mood Read: possible emotions, mental state, mood, explanation, and evidence.
- Past Three Months Mood Graph: daily low-to-high mood score graph.
- Whole Timeframe Mood Graph: monthly low-to-high mood score graph.
- Past 3 Months: top 50 artists, songs, and albums by listen count.
- All-time leaderboards: top artists, songs, albums, and videos.
- Long Lifespans: artists active across the most years.
- Repeat Track Fixations: strongest single-day song repeats.
- Album Fixation Weeks: strongest one-week album repeats.
- Video / Music Ratio: audio versus video listening split.

## Website Import Notes

The website should not process raw Spotify exports directly. The better flow is:

```text
raw Spotify JSON
  -> local scripts
  -> normalized data and summaries
  -> Postgres import
  -> Next.js pages/components
```

Use Postgres for queryable stream events and summaries. Use Vercel Blob later for archived exports or generated public JSON/chart data if that becomes useful.

`output/import.sql` is a starter import scaffold for:

```text
spotify_stream_events
spotify_artist_metadata
spotify_analysis_snapshots
```

## Suggested Workflow

1. Put Spotify export files in `raw/`.
2. Run `npm run spotify:analyze`.
3. Add `LASTFM_API_KEY` to `.env.local`.
4. Run `npm run lastfm:enrich`.
5. Run `npm run music:report`.
6. Review `output/music-report/index.html`.
7. Import only the useful, interesting parts into the ArcadeGhosts music page.
