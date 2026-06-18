#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const outputRoot = path.join(repoRoot, "output");
const reportDir = path.join(outputRoot, "music-report");
const artistGenres = readJson("artist-genres.lastfm.json");
const streamEvents = readNdjson("stream-events.ndjson");

const data = {
  monthlyTrends: readJson("monthly-trends.json"),
  oddFindings: readJson("odd-findings.json"),
  topAlbums: readJson("top-albums.json"),
  topArtists: readJson("top-artists.json"),
  topSongs: readJson("top-songs.json"),
  topVideos: readJson("top-videos.json"),
  yearlyTrends: readJson("yearly-trends.json"),
  artistGenres,
  recentRankings: summarizeRecentRankings(streamEvents),
  moodTimelines: summarizeMoodTimelines(streamEvents, artistGenres),
  eras: detectEras(streamEvents, artistGenres),
  musicalDna: summarizeMusicalDna(streamEvents)
};

fs.mkdirSync(reportDir, { recursive: true });
fs.writeFileSync(path.join(reportDir, "index.html"), renderHtml(data));
fs.writeFileSync(path.join(reportDir, "styles.css"), renderCss());

console.log(`Wrote ${path.relative(repoRoot, path.join(reportDir, "index.html"))}`);

function readJson(fileName) {
  return JSON.parse(fs.readFileSync(path.join(outputRoot, fileName), "utf8"));
}

function readNdjson(fileName) {
  return fs
    .readFileSync(path.join(outputRoot, fileName), "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function renderHtml(source) {
  const totals = summarizeTotals(source.yearlyTrends);
  const genreSummary = summarizeGenres(source.artistGenres);
  const recentGenreSummary = summarizeGenresForArtistMetrics(source.recentRankings.artists, source.artistGenres);
  const fullMood = inferMood({
    title: "Whole Timeframe",
    genres: genreSummary.topGenres,
    artists: source.topArtists,
    songs: source.topSongs,
    albums: source.topAlbums
  });
  const recentMood = inferMood({
    title: "Past Three Months",
    genres: recentGenreSummary.topGenres,
    artists: source.recentRankings.artists,
    songs: source.recentRankings.songs,
    albums: source.recentRankings.albums
  });
  const peakMonths = [...source.monthlyTrends]
    .sort((a, b) => b.totalHoursPlayed - a.totalHoursPlayed)
    .slice(0, 12);
  const recentMonthly = [...source.monthlyTrends]
    .sort((a, b) => a.month.localeCompare(b.month))
    .slice(-36);
  const generatedAt = new Date().toISOString().slice(0, 10);

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>ArcadeGhosts Music Memory Console</title>
  <link rel="stylesheet" href="styles.css">
</head>
<body>
  <main class="page-shell">
    <section class="hero" aria-labelledby="page-title">
      <div class="hero-copy">
        <p class="kicker">ArcadeGhosts Music Memory Console</p>
        <h1 id="page-title">Listening history, tuned by hours.</h1>
        <p class="lede">${formatHours(totals.hours)} hours across ${formatNumber(totals.streams)} plays from ${totals.firstYear} to ${totals.lastYear}. Ranked by time, not just taps.</p>
      </div>
      <div class="signal-panel" aria-label="Listening summary">
        ${stat("Total hours", formatHours(totals.hours))}
        ${stat("Total streams", formatNumber(totals.streams))}
        ${stat("Peak year", `${totals.peakYear.year} (${formatHours(totals.peakYear.totalHoursPlayed)}h)`)}
        ${stat("Genre matches", `${genreSummary.coveredArtists}/${source.artistGenres.length}`)}
      </div>
    </section>

    <section class="band">
      <div class="section-heading">
        <h2>Yearly Signal</h2>
        <p>Hours by year, with skip rate riding shotgun.</p>
      </div>
      <div class="year-grid">
        ${source.yearlyTrends
          .sort((a, b) => a.year - b.year)
          .map((year) => yearCard(year, totals.peakYear.totalHoursPlayed))
          .join("")}
      </div>
    </section>

    <section class="band split">
      <div>
        <div class="section-heading">
          <h2>Recent Months</h2>
          <p>The last 36 months as a compact pulse line.</p>
        </div>
        <div class="month-strip">
          ${recentMonthly.map((month) => monthBar(month, maxBy(recentMonthly, "totalHoursPlayed"))).join("")}
        </div>
      </div>
      <div>
        <div class="section-heading">
          <h2>Peak Months</h2>
          <p>The biggest listening months in the archive.</p>
        </div>
        <ol class="rank-list compact">
          ${peakMonths.map((month, index) => listItem(index, month.month, `${formatHours(month.totalHoursPlayed)}h`, `${formatNumber(month.totalStreams)} plays`)).join("")}
        </ol>
      </div>
    </section>

    <section class="band">
      <div class="section-heading">
        <h2>Genre Weather</h2>
        <p>Last.fm tags weighted by your artist listening time.</p>
      </div>
      <div class="genre-grid">
        ${genreSummary.topGenres.map((genre) => genreTile(genre, genreSummary.topGenres[0]?.hours ?? 1)).join("")}
      </div>
    </section>

    <section class="band">
      <div class="section-heading">
        <h2>Eras</h2>
        <p>Detected chapters where an artist, album, or genre suddenly dominated a month or season.</p>
      </div>
      <div class="era-grid">
        ${source.eras.map((era) => eraCard(era)).join("")}
      </div>
    </section>

    <section class="band">
      <div class="section-heading">
        <h2>Musical DNA</h2>
        <p>Artist-level fingerprints: foundations, growth arcs, disappearances, recurring comforts, and new discoveries.</p>
      </div>
      <div class="dna-grid">
        ${dnaPanel("Foundational Artists", source.musicalDna.foundationalArtists, (item) => item.artistName, (item) => `${item.yearsActive} active years`, (item) => `${formatHours(item.totalHoursPlayed)}h - ${item.firstYear}-${item.lastYear}`)}
        ${dnaPanel("Evolution Artists", source.musicalDna.evolutionArtists, (item) => item.artistName, (item) => `${item.growthRatio}x rise`, (item) => `${formatHours(item.previousBestHours)}h before ${item.peakYear}; ${formatHours(item.peakYearHours)}h in ${item.peakYear}`)}
        ${dnaPanel("One-Season Wonders", source.musicalDna.oneSeasonWonders, (item) => item.artistName, (item) => `${formatHours(item.peakYearHours)}h in ${item.peakYear}`, (item) => `${Math.round(item.peakShare * 100)}% of all listening to this artist happened then`)}
        ${dnaPanel("Comfort Artists", source.musicalDna.comfortArtists, (item) => item.artistName, (item) => `${item.streakYears} year streak`, (item) => `${formatHours(item.totalHoursPlayed)}h - returned every year in span`)}
        ${dnaPanel("Discovery Artists", source.musicalDna.discoveryArtists, (item) => item.artistName, (item) => `first heard ${shortDateLabel(item.firstPlayed.slice(0, 10), "day")}`, (item) => `${formatHours(item.totalHoursPlayed)}h - ${formatNumber(item.totalStreams)} plays`)}
      </div>
    </section>

    <section class="band mood-section">
      <div class="section-heading">
        <h2>Past Three Months Mood Read</h2>
        <p>Possible emotional signals inferred from recent repeated artists, songs, albums, and Last.fm genre tags. Treat this as interpretive texture, not a diagnosis.</p>
      </div>
      ${moodPanel(recentMood)}
    </section>

    <section class="band mood-section">
      <div class="section-heading">
        <h2>Whole Timeframe Mood Read</h2>
        <p>Possible emotional signals inferred from the full archive of artists, songs, albums, and genre tags. This is a pattern read, not a claim about mental health.</p>
      </div>
      ${moodPanel(fullMood)}
    </section>

    <section class="band mood-section">
      <div class="section-heading">
        <h2>Past Three Months Mood Graph</h2>
        <p>Daily low-to-high mood signal from ${escapeHtml(source.moodTimelines.recent.startDate)} through ${escapeHtml(source.moodTimelines.recent.endDate)}, weighted by listening time.</p>
      </div>
      ${moodChart(source.moodTimelines.recent, "Daily mood signal")}
    </section>

    <section class="band mood-section">
      <div class="section-heading">
        <h2>Whole Timeframe Mood Graph</h2>
        <p>Monthly low-to-high mood signal across the full export. Darker/heavier tags pull lower; brighter pop/dance tags pull higher.</p>
      </div>
      ${moodChart(source.moodTimelines.full, "Monthly mood signal")}
    </section>

    <section class="band">
      <div class="section-heading">
        <h2>Past 3 Months</h2>
        <p>Most listens from ${escapeHtml(source.recentRankings.startDate)} through ${escapeHtml(source.recentRankings.endDate)}, ranked by play count with listening time as the tie-breaker.</p>
      </div>
      <div class="recent-grid">
        ${recentLeaderboard("Artists", source.recentRankings.artists, (item) => item.artistName, (item) => `${formatNumber(item.totalStreams)} plays`, (item) => `${formatHours(item.totalHoursPlayed)}h`)}
        ${recentLeaderboard("Songs", source.recentRankings.songs, (item) => item.trackName, (item) => `${formatNumber(item.totalStreams)} plays`, (item) => `${item.artistName} - ${formatHours(item.totalHoursPlayed)}h`)}
        ${recentLeaderboard("Albums", source.recentRankings.albums, (item) => item.albumName, (item) => `${formatNumber(item.totalStreams)} plays`, (item) => `${item.artistName} - ${formatHours(item.totalHoursPlayed)}h`)}
      </div>
    </section>

    <section class="band leaderboards">
      ${leaderboard("Artists", source.topArtists, (item) => item.artistName, (item) => `${formatHours(item.totalHoursPlayed)}h`, (item) => `${formatNumber(item.totalStreams)} plays - ${formatPercent(item.skipRate)} skipped`)}
      ${leaderboard("Songs", source.topSongs, (item) => item.trackName, (item) => `${formatHours(item.totalHoursPlayed)}h`, (item) => `${item.artistName} - ${formatNumber(item.totalStreams)} plays`)}
      ${leaderboard("Albums", source.topAlbums, (item) => item.albumName, (item) => `${formatHours(item.totalHoursPlayed)}h`, (item) => `${item.artistName} - ${formatNumber(item.totalStreams)} plays`)}
      ${leaderboard("Videos", source.topVideos, (item) => item.videoTitle, (item) => `${formatHours(item.totalHoursPlayed)}h`, (item) => `${item.channelName ?? "Unknown"} - ${formatNumber(item.totalStreams)} plays`)}
    </section>

    <section class="band split">
      ${findingPanel("Long Lifespans", source.oddFindings.longestArtistLifespans.slice(0, 10), (item) => item.artistName, (item) => `${item.yearsActive} years - ${formatHours(item.totalHoursPlayed)}h`)}
      ${findingPanel("Repeat Track Fixations", source.oddFindings.repeatObsessionTracks.slice(0, 10), (item) => item.trackName, (item) => `${item.artistName} - ${item.date} - ${formatHours(item.totalHoursPlayed)}h`)}
    </section>

    <section class="band split">
      ${findingPanel("Album Fixation Weeks", source.oddFindings.oneWeekFixationAlbums.slice(0, 10), (item) => item.albumName, (item) => `${item.artistName} - ${item.week} - ${formatHours(item.totalHoursPlayed)}h`)}
      <div class="panel">
        <div class="section-heading tight">
          <h2>Video / Music Ratio</h2>
          <p>Mostly music, with a tiny video comet trail.</p>
        </div>
        <div class="ratio">
          <span style="--value:${source.oddFindings.videoVsMusicRatio.videoEventRatio * 100}%"></span>
        </div>
        <dl class="mini-stats">
          <div><dt>Audio</dt><dd>${formatHours(source.oddFindings.videoVsMusicRatio.audioHours)}h</dd></div>
          <div><dt>Video</dt><dd>${formatHours(source.oddFindings.videoVsMusicRatio.videoHours)}h</dd></div>
          <div><dt>Video share</dt><dd>${formatPercent(source.oddFindings.videoVsMusicRatio.videoEventRatio)}</dd></div>
        </dl>
      </div>
    </section>

    <footer class="footer">
      <span>Generated ${escapeHtml(generatedAt)}</span>
      <span>Static prototype for the ArcadeGhosts music section</span>
    </footer>
  </main>
</body>
</html>`;
}

function renderCss() {
  return `:root {
  color-scheme: dark;
  --ink: #f8f6ff;
  --muted: #b9b2c9;
  --panel: rgba(18, 15, 29, 0.86);
  --line: rgba(255, 255, 255, 0.16);
  --pink: #ff2d95;
  --cyan: #22e8ff;
  --yellow: #ffe45c;
  --green: #68ff9b;
}

* { box-sizing: border-box; }

body {
  margin: 0;
  min-width: 320px;
  background:
    linear-gradient(rgba(255, 45, 149, 0.18) 1px, transparent 1px),
    linear-gradient(90deg, rgba(34, 232, 255, 0.14) 1px, transparent 1px),
    linear-gradient(145deg, #09070f 0%, #181025 52%, #111822 100%);
  background-size: 48px 48px, 48px 48px, auto;
  color: var(--ink);
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

.page-shell { width: min(1180px, calc(100% - 32px)); margin: 0 auto; padding: 32px 0 48px; }

.hero {
  min-height: 72vh;
  display: grid;
  grid-template-columns: minmax(0, 1.35fr) minmax(280px, 0.65fr);
  gap: 24px;
  align-items: center;
  border-bottom: 1px solid var(--line);
}

.kicker, .footer, .rank-meta, .section-heading p { color: var(--muted); }

.kicker { margin: 0 0 14px; text-transform: uppercase; font-size: 0.78rem; letter-spacing: 0.18em; }

h1, h2, p { margin-top: 0; }

h1 {
  max-width: 820px;
  margin-bottom: 20px;
  font-size: clamp(3rem, 7vw, 6.6rem);
  line-height: 0.9;
  letter-spacing: 0;
  text-shadow: 0 0 30px rgba(255, 45, 149, 0.45);
}

h2 { margin-bottom: 6px; font-size: 1.05rem; text-transform: uppercase; letter-spacing: 0.12em; }

.lede { max-width: 680px; color: #e9e5f4; font-size: 1.12rem; line-height: 1.6; }

.signal-panel, .panel, .leaderboard-card, .recent-card { border: 1px solid var(--line); background: var(--panel); box-shadow: 0 16px 60px rgba(0, 0, 0, 0.28); }

.signal-panel { display: grid; gap: 10px; padding: 16px; }

.stat { display: flex; justify-content: space-between; gap: 16px; padding: 14px; border-left: 3px solid var(--cyan); background: rgba(255, 255, 255, 0.05); }
.stat dt { color: var(--muted); font-size: 0.78rem; text-transform: uppercase; }
.stat dd { margin: 0; font-size: 1.1rem; font-weight: 800; }

.band { padding: 34px 0; border-bottom: 1px solid var(--line); }

.section-heading { display: flex; justify-content: space-between; gap: 18px; align-items: end; margin-bottom: 16px; }
.section-heading p { max-width: 420px; margin-bottom: 0; line-height: 1.45; }
.tight { display: block; }

.year-grid, .genre-grid, .leaderboards { display: grid; gap: 12px; }
.year-grid { grid-template-columns: repeat(auto-fit, minmax(132px, 1fr)); }

.year-card, .genre-tile { padding: 14px; border: 1px solid var(--line); background: rgba(255, 255, 255, 0.055); }
.year-card { min-height: 134px; }
.year-card strong { display: block; margin-bottom: 16px; color: var(--yellow); font-size: 1.45rem; }

.meter, .ratio { height: 8px; overflow: hidden; background: rgba(255, 255, 255, 0.1); }
.meter span, .ratio span { display: block; width: max(var(--value), 2%); height: 100%; background: linear-gradient(90deg, var(--pink), var(--cyan), var(--yellow)); }

.metric-line { display: flex; justify-content: space-between; gap: 8px; margin-top: 9px; color: var(--muted); font-size: 0.82rem; }

.split { display: grid; grid-template-columns: minmax(0, 1.25fr) minmax(280px, 0.75fr); gap: 24px; }

.month-strip {
  display: grid;
  grid-template-columns: repeat(36, minmax(8px, 1fr));
  gap: 4px;
  align-items: end;
  min-height: 180px;
  padding: 14px;
  border: 1px solid var(--line);
  background: rgba(255, 255, 255, 0.045);
}

.month-bar { position: relative; min-height: 18px; height: max(var(--value), 4px); background: linear-gradient(180deg, var(--cyan), var(--pink)); }
.month-bar:hover::after { content: attr(aria-label); position: absolute; bottom: calc(100% + 8px); left: 50%; z-index: 2; width: max-content; max-width: 180px; transform: translateX(-50%); padding: 6px 8px; background: #fff; color: #120f1d; font-size: 0.78rem; }

.rank-list { display: grid; gap: 8px; margin: 0; padding: 0; list-style: none; }
.rank-list li { display: grid; grid-template-columns: 34px minmax(0, 1fr) auto; gap: 10px; align-items: center; padding: 10px 0; border-bottom: 1px solid var(--line); }
.compact li { grid-template-columns: 30px minmax(0, 1fr) auto; }
.rank-num { color: var(--cyan); font-weight: 900; }
.rank-title { min-width: 0; overflow-wrap: anywhere; font-weight: 800; }
.rank-value { color: var(--yellow); font-weight: 900; }
.rank-meta { grid-column: 2 / -1; font-size: 0.82rem; }

.genre-grid { grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); }
.genre-tile strong { display: block; min-height: 2.4em; overflow-wrap: anywhere; }

.era-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 12px; }
.era-card { padding: 16px; border: 1px solid var(--line); background: var(--panel); }
.era-card h3 { margin: 0 0 10px; color: var(--yellow); font-size: 1.1rem; line-height: 1.25; overflow-wrap: anywhere; }
.era-meta { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 12px; color: var(--muted); font-size: 0.78rem; }
.era-meta span { padding: 5px 7px; border: 1px solid var(--line); }
.era-card p { margin-bottom: 0; color: #e9e5f4; line-height: 1.5; }

.dna-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px; }
.dna-card { padding: 16px; border: 1px solid var(--line); background: var(--panel); }
.dna-card h3 { margin: 0 0 12px; color: var(--yellow); font-size: 1rem; line-height: 1.25; }
.dna-card .rank-list li { grid-template-columns: 28px minmax(0, 1fr); padding: 8px 0; }
.dna-card .rank-value { grid-column: 2; }

.leaderboards { grid-template-columns: repeat(4, minmax(0, 1fr)); }
.leaderboard-card, .panel, .recent-card { padding: 16px; }

.recent-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
.recent-card .rank-list { max-height: 760px; overflow: auto; padding-right: 4px; }
.recent-card .rank-list li { grid-template-columns: 34px minmax(0, 1fr) auto; padding: 8px 0; }

.mood-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
.mood-panel { padding: 18px; border: 1px solid var(--line); background: var(--panel); }
.mood-panel h3 { margin: 0 0 14px; color: var(--yellow); font-size: 1.15rem; letter-spacing: 0; }
.mood-clusters { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; margin-bottom: 16px; }
.mood-cluster { padding: 12px; background: rgba(255, 255, 255, 0.055); }
.mood-label { display: block; margin-bottom: 7px; color: var(--muted); font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.12em; }
.mood-value { display: block; font-weight: 900; line-height: 1.25; overflow-wrap: anywhere; }
.mood-panel p { color: #e9e5f4; line-height: 1.55; }
.evidence-list { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 14px; }
.evidence-list span { padding: 6px 8px; border: 1px solid var(--line); color: var(--muted); font-size: 0.78rem; }
.mood-chart-panel { padding: 16px; border: 1px solid var(--line); background: var(--panel); }
.mood-chart { display: block; width: 100%; height: auto; min-height: 240px; }
.mood-chart text { fill: var(--muted); font-size: 11px; }
.mood-chart .axis { stroke: rgba(255, 255, 255, 0.25); stroke-width: 1; }
.mood-chart .grid { stroke: rgba(255, 255, 255, 0.12); stroke-width: 1; }
.mood-chart .area { fill: rgba(255, 45, 149, 0.14); }
.mood-chart .line { fill: none; stroke: var(--cyan); stroke-width: 3; stroke-linejoin: round; stroke-linecap: round; }
.mood-chart .point { fill: var(--yellow); stroke: #120f1d; stroke-width: 1.5; }
.mood-chart-summary { display: flex; justify-content: space-between; gap: 16px; margin-top: 12px; color: var(--muted); font-size: 0.86rem; }

.mini-stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin: 18px 0 0; }
.mini-stats div { padding: 12px; background: rgba(255, 255, 255, 0.055); }
.mini-stats dt { color: var(--muted); font-size: 0.78rem; }
.mini-stats dd { margin: 6px 0 0; font-weight: 900; }

.footer { display: flex; justify-content: space-between; gap: 16px; padding-top: 22px; font-size: 0.85rem; }

@media (max-width: 920px) {
  .hero, .split, .leaderboards, .recent-grid, .mood-grid { grid-template-columns: 1fr; }
  .hero { min-height: auto; padding: 44px 0 28px; }
}

@media (max-width: 620px) {
  .page-shell { width: min(100% - 20px, 1180px); }
  .section-heading, .footer { display: block; }
  .month-strip { grid-template-columns: repeat(18, minmax(8px, 1fr)); }
  .rank-list li { grid-template-columns: 28px minmax(0, 1fr); }
  .rank-value { grid-column: 2; }
  .mini-stats { grid-template-columns: 1fr; }
  .mood-clusters { grid-template-columns: 1fr; }
}`;
}

function summarizeTotals(yearlyTrends) {
  const ordered = [...yearlyTrends].sort((a, b) => a.year - b.year);
  const peakYear = [...yearlyTrends].sort((a, b) => b.totalHoursPlayed - a.totalHoursPlayed)[0];

  return {
    hours: yearlyTrends.reduce((sum, year) => sum + year.totalHoursPlayed, 0),
    streams: yearlyTrends.reduce((sum, year) => sum + year.totalStreams, 0),
    firstYear: ordered[0]?.year,
    lastYear: ordered.at(-1)?.year,
    peakYear
  };
}

function summarizeGenres(artistGenres) {
  const genres = new Map();
  let coveredArtists = 0;

  for (const artist of artistGenres) {
    if (artist.genreTags?.length) coveredArtists += 1;

    for (const tag of artist.genreTags ?? []) {
      const metric = genres.get(tag) ?? { genre: tag, artists: 0, streams: 0, hours: 0 };
      metric.artists += 1;
      metric.streams += artist.totalStreams ?? 0;
      metric.hours += hoursFor(artist);
      genres.set(tag, metric);
    }
  }

  return {
    coveredArtists,
    topGenres: [...genres.values()]
      .sort((a, b) => b.hours - a.hours || b.streams - a.streams)
      .slice(0, 18)
  };
}

function summarizeGenresForArtistMetrics(artistMetrics, artistGenres) {
  const genreByArtist = new Map(artistGenres.map((artist) => [artist.artistName, artist.genreTags ?? []]));
  const genres = new Map();
  let coveredArtists = 0;

  for (const artist of artistMetrics) {
    const tags = genreByArtist.get(artist.artistName) ?? [];
    if (tags.length) coveredArtists += 1;

    for (const tag of tags) {
      const metric = genres.get(tag) ?? { genre: tag, artists: 0, streams: 0, hours: 0 };
      metric.artists += 1;
      metric.streams += artist.totalStreams ?? 0;
      metric.hours += hoursFor(artist);
      genres.set(tag, metric);
    }
  }

  return {
    coveredArtists,
    topGenres: [...genres.values()]
      .sort((a, b) => b.streams - a.streams || b.hours - a.hours)
      .slice(0, 18)
  };
}

function summarizeMusicalDna(events) {
  const artists = new Map();
  const latestTime = events.reduce((latest, event) => {
    const playedTime = Date.parse(event.playedAt);
    return Number.isFinite(playedTime) && playedTime > latest ? playedTime : latest;
  }, 0);
  const latestDate = new Date(latestTime);
  const latestYear = latestDate.getUTCFullYear();
  const discoveryStart = new Date(latestTime);
  discoveryStart.setUTCFullYear(discoveryStart.getUTCFullYear() - 1);

  for (const event of events) {
    if (!event.artistName || !event.playedAt) continue;

    const year = String(event.playedYear ?? new Date(event.playedAt).getUTCFullYear());
    const metric = artists.get(event.artistName) ?? {
      artistName: event.artistName,
      totalMsPlayed: 0,
      totalStreams: 0,
      firstPlayed: event.playedAt,
      lastPlayed: event.playedAt,
      years: new Map()
    };
    const yearMetric = metric.years.get(year) ?? {
      year,
      totalMsPlayed: 0,
      totalStreams: 0
    };

    metric.totalMsPlayed += event.msPlayed ?? 0;
    metric.totalStreams += 1;
    metric.firstPlayed = event.playedAt < metric.firstPlayed ? event.playedAt : metric.firstPlayed;
    metric.lastPlayed = event.playedAt > metric.lastPlayed ? event.playedAt : metric.lastPlayed;
    yearMetric.totalMsPlayed += event.msPlayed ?? 0;
    yearMetric.totalStreams += 1;
    metric.years.set(year, yearMetric);
    artists.set(event.artistName, metric);
  }

  const artistRows = [...artists.values()].map(finishArtistDnaMetric);

  return {
    foundationalArtists: artistRows
      .filter((artist) => artist.yearsActive >= 8)
      .sort((a, b) => b.yearsActive - a.yearsActive || b.totalMsPlayed - a.totalMsPlayed)
      .slice(0, 8),
    evolutionArtists: artistRows
      .map(evolutionMetric)
      .filter(Boolean)
      .sort((a, b) => b.score - a.score)
      .slice(0, 8),
    oneSeasonWonders: artistRows
      .map(oneSeasonMetric)
      .filter(Boolean)
      .sort((a, b) => b.score - a.score)
      .slice(0, 8),
    comfortArtists: artistRows
      .filter((artist) => artist.streakYears >= 5)
      .sort((a, b) => b.streakYears - a.streakYears || b.totalMsPlayed - a.totalMsPlayed)
      .slice(0, 8),
    discoveryArtists: artistRows
      .filter((artist) => Date.parse(artist.firstPlayed) >= discoveryStart.getTime() && (artist.totalHoursPlayed >= 2 || artist.totalStreams >= 20))
      .sort((a, b) => b.totalMsPlayed - a.totalMsPlayed || b.totalStreams - a.totalStreams)
      .slice(0, 8),
    latestYear
  };
}

function finishArtistDnaMetric(metric) {
  const years = [...metric.years.values()].sort((a, b) => a.year.localeCompare(b.year));
  const activeYears = years.map((year) => Number(year.year));
  const firstYear = activeYears[0];
  const lastYear = activeYears.at(-1);

  return {
    artistName: metric.artistName,
    totalMsPlayed: metric.totalMsPlayed,
    totalHoursPlayed: Number((metric.totalMsPlayed / 3_600_000).toFixed(2)),
    totalStreams: metric.totalStreams,
    firstPlayed: metric.firstPlayed,
    lastPlayed: metric.lastPlayed,
    firstYear,
    lastYear,
    yearsActive: activeYears.length,
    streakYears: contiguousYearStreak(activeYears),
    years
  };
}

function contiguousYearStreak(activeYears) {
  if (!activeYears.length) return 0;

  let longest = 1;
  let current = 1;

  for (let index = 1; index < activeYears.length; index += 1) {
    if (activeYears[index] === activeYears[index - 1] + 1) {
      current += 1;
    } else {
      longest = Math.max(longest, current);
      current = 1;
    }
  }

  return Math.max(longest, current);
}

function evolutionMetric(artist) {
  const years = artist.years;
  let best = undefined;

  for (let index = 1; index < years.length; index += 1) {
    const current = years[index];
    const previousBest = Math.max(...years.slice(0, index).map((year) => year.totalMsPlayed), 1);
    const previousBestHours = previousBest / 3_600_000;
    const ratio = current.totalMsPlayed / previousBest;
    const currentHours = current.totalMsPlayed / 3_600_000;

    if (previousBestHours < 1 || ratio < 3 || currentHours < 8) continue;

    const candidate = {
      artistName: artist.artistName,
      growthRatio: Number(ratio.toFixed(1)),
      previousBestHours: Number(previousBestHours.toFixed(2)),
      peakYearHours: Number(currentHours.toFixed(2)),
      peakYear: current.year,
      totalHoursPlayed: artist.totalHoursPlayed,
      totalStreams: artist.totalStreams,
      score: ratio * currentHours
    };

    if (!best || candidate.score > best.score) best = candidate;
  }

  return best;
}

function oneSeasonMetric(artist) {
  if (artist.years.length < 2) return undefined;

  const peak = [...artist.years].sort((a, b) => b.totalMsPlayed - a.totalMsPlayed)[0];
  const afterPeakMs = artist.years
    .filter((year) => year.year > peak.year)
    .reduce((sum, year) => sum + year.totalMsPlayed, 0);
  const peakShare = peak.totalMsPlayed / Math.max(artist.totalMsPlayed, 1);
  const peakYearHours = peak.totalMsPlayed / 3_600_000;

  if (peakShare < 0.65 || peakYearHours < 8 || afterPeakMs > peak.totalMsPlayed * 0.25) return undefined;

  return {
    artistName: artist.artistName,
    peakYear: peak.year,
    peakYearHours: Number(peakYearHours.toFixed(2)),
    peakShare: Number(peakShare.toFixed(3)),
    totalHoursPlayed: artist.totalHoursPlayed,
    totalStreams: artist.totalStreams,
    score: peakShare * peakYearHours
  };
}

function detectEras(events, artistGenres) {
  const tagsByArtist = new Map(artistGenres.map((artist) => [artist.artistName, artist.genreTags ?? []]));
  const monthTotals = new Map();
  const artists = new Map();
  const albums = new Map();
  const genres = new Map();
  const firstSeen = new Map();
  const monthsByEntity = new Map();

  for (const event of events) {
    if (!event.playedMonth || !event.artistName) continue;

    const weight = event.msPlayed ?? 0;
    addTotal(monthTotals, event.playedMonth, weight);
    firstSeen.set(event.artistName, minString(firstSeen.get(event.artistName), event.playedMonth));

    addEraMetric(artists, event.artistName, event.playedMonth, weight, event, {
      type: "artist",
      subject: event.artistName
    });
    setMonth(monthsByEntity, `artist:${event.artistName}`, event.playedMonth);

    if (event.albumName) {
      const albumKey = `${event.artistName}\u0000${event.albumName}`;
      addEraMetric(albums, albumKey, event.playedMonth, weight, event, {
        type: "album",
        subject: event.albumName,
        artistName: event.artistName
      });
      setMonth(monthsByEntity, `album:${albumKey}`, event.playedMonth);
    }

    for (const tag of (tagsByArtist.get(event.artistName) ?? []).slice(0, 3)) {
      addEraMetric(genres, tag, event.playedMonth, weight, event, {
        type: "genre",
        subject: tag
      });
      setMonth(monthsByEntity, `genre:${tag}`, event.playedMonth);
    }
  }

  const candidates = [
    ...eraCandidates(artists, monthTotals, monthsByEntity, firstSeen),
    ...eraCandidates(albums, monthTotals, monthsByEntity, firstSeen),
    ...eraCandidates(genres, monthTotals, monthsByEntity, firstSeen)
  ];

  const ranked = candidates.sort((a, b) => b.score - a.score);
  const latestYear = Math.max(...ranked.map((era) => Number(era.year)));
  const selected = [
    ...ranked.slice(0, 9),
    ...ranked.filter((era) => Number(era.year) >= latestYear - 1).slice(0, 8)
  ];

  return selected
    .filter(uniqueEra())
    .slice(0, 14)
    .sort((a, b) => a.month.localeCompare(b.month));
}

function addTotal(map, key, value) {
  map.set(key, (map.get(key) ?? 0) + value);
}

function minString(a, b) {
  if (!a) return b;
  return a < b ? a : b;
}

function setMonth(map, key, month) {
  const months = map.get(key) ?? new Set();
  months.add(month);
  map.set(key, months);
}

function addEraMetric(map, key, month, weight, event, attrs) {
  const monthMap = map.get(key) ?? new Map();
  const metric = monthMap.get(month) ?? {
    key,
    month,
    ...attrs,
    totalMsPlayed: 0,
    totalStreams: 0,
    meaningfulStreams: 0,
    topTrack: undefined,
    tracks: new Map()
  };

  metric.totalMsPlayed += weight;
  metric.totalStreams += 1;
  if (weight >= 30_000) metric.meaningfulStreams += 1;

  if (event.trackName) {
    const track = metric.tracks.get(event.trackName) ?? {
      trackName: event.trackName,
      totalMsPlayed: 0,
      totalStreams: 0
    };
    track.totalMsPlayed += weight;
    track.totalStreams += 1;
    metric.tracks.set(event.trackName, track);
    metric.topTrack = [...metric.tracks.values()].sort((a, b) => b.totalMsPlayed - a.totalMsPlayed)[0]?.trackName;
  }

  monthMap.set(month, metric);
  map.set(key, monthMap);
}

function eraCandidates(entityMap, monthTotals, monthsByEntity, firstSeen) {
  const candidates = [];

  for (const [entityKey, monthMap] of entityMap.entries()) {
    const sortedMonths = [...monthMap.keys()].sort();
    const fullEntityKey = `${monthMap.values().next().value.type}:${entityKey}`;

    for (const month of sortedMonths) {
      const metric = monthMap.get(month);
      const monthTotal = monthTotals.get(month) ?? 1;
      const share = metric.totalMsPlayed / monthTotal;
      const hours = metric.totalMsPlayed / 3_600_000;
      const previousMonths = sortedMonths.filter((item) => item < month);
      const previousStrongMonth = previousMonths.at(-1);
      const gap = previousStrongMonth ? monthDistance(previousStrongMonth, month) : null;
      const firstMonth = metric.type === "artist" ? firstSeen.get(metric.subject) : sortedMonths[0];
      const strongMonthsInYear = sortedMonths.filter((item) => item.startsWith(month.slice(0, 4)) && (monthMap.get(item).totalMsPlayed / (monthTotals.get(item) ?? 1)) >= 0.1);

      if (!isEraWorthy(metric.type, share, hours, metric.meaningfulStreams)) continue;

      const recencyBonus = (Number(month.slice(0, 4)) - 2014) * 8;
      const score = share * 100 + hours + metric.meaningfulStreams * 0.12 + (gap && gap >= 12 ? 12 : 0) + strongMonthsInYear.length * 3 + recencyBonus;
      const name = eraName(metric, month, {
        gap,
        firstMonth,
        strongMonthsInYear
      });

      candidates.push({
        name,
        month,
        year: month.slice(0, 4),
        type: metric.type,
        subject: metric.subject,
        artistName: metric.artistName,
        totalHoursPlayed: Number(hours.toFixed(1)),
        totalStreams: metric.totalStreams,
        meaningfulStreams: metric.meaningfulStreams,
        share: Number(share.toFixed(3)),
        score,
        explanation: eraExplanation(metric, month, share, gap, strongMonthsInYear),
        topTrack: metric.topTrack,
        entityKey: fullEntityKey
      });
    }
  }

  return candidates;
}

function isEraWorthy(type, share, hours, streams) {
  if (type === "genre") return share >= 0.28 && hours >= 18;
  if (type === "album") return share >= 0.12 && (hours >= 8 || streams >= 45);
  return share >= 0.08 && (hours >= 6 || streams >= 30);
}

function eraName(metric, month, context) {
  const year = month.slice(0, 4);
  const subject = titleCasePreserve(metric.subject);

  if (metric.type === "genre") return eraTitle(subject, `${seasonName(month)} (${year})`);
  if (context.gap && context.gap >= 18) return eraTitle(subject, `Return (${year})`);
  if (context.gap && context.gap >= 10) return eraTitle(subject, `Revival (${year})`);
  if (context.firstMonth === month) return eraTitle(subject, `Discovery (${year})`);
  if (context.strongMonthsInYear.length >= 2) return eraTitle(subject, `Months (${year})`);
  return eraTitle(subject, `Chapter (${year})`);
}

function eraTitle(subject, suffix) {
  const cleanSubject = subject.trim();

  return cleanSubject.toLowerCase().startsWith("the ")
    ? `${cleanSubject} ${suffix}`
    : `The ${cleanSubject} ${suffix}`;
}

function eraExplanation(metric, month, share, gap, strongMonthsInYear) {
  const shareText = `${Math.round(share * 100)}%`;
  const period = readableMonth(month);
  const subject = metric.type === "album" ? `${metric.subject} by ${metric.artistName}` : metric.subject;
  const repeatText = strongMonthsInYear.length >= 2 ? ` It was part of ${strongMonthsInYear.length} strong month(s) that year.` : "";
  const gapText = gap && gap >= 10 ? ` It also followed roughly ${gap} months away from that level of attention.` : "";
  const trackText = metric.topTrack ? ` The anchor track was "${metric.topTrack}."` : "";

  return `${subject} took ${shareText} of listening time in ${period}, with ${formatHours(metric.totalMsPlayed / 3_600_000)} hours and ${formatNumber(metric.meaningfulStreams)} meaningful plays.${repeatText}${gapText}${trackText}`;
}

function monthDistance(a, b) {
  const [ay, am] = a.split("-").map(Number);
  const [by, bm] = b.split("-").map(Number);
  return (by - ay) * 12 + (bm - am);
}

function seasonName(month) {
  const monthNumber = Number(month.slice(5, 7));
  if ([12, 1, 2].includes(monthNumber)) return "Winter";
  if ([3, 4, 5].includes(monthNumber)) return "Spring";
  if ([6, 7, 8].includes(monthNumber)) return "Summer";
  return "Autumn";
}

function readableMonth(month) {
  const date = new Date(`${month}-01T00:00:00Z`);
  return date.toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC"
  });
}

function titleCasePreserve(value) {
  return value
    .split(" ")
    .map((word) => (word.length <= 3 && word === word.toUpperCase() ? word : word.charAt(0).toUpperCase() + word.slice(1)))
    .join(" ");
}

function uniqueEra() {
  const seenSubjects = new Set();
  const seenMonths = new Map();

  return (era) => {
    const subjectKey = `${era.type}:${era.subject}`;
    const monthKey = `${era.year}:${era.type}`;
    const monthCount = seenMonths.get(monthKey) ?? 0;
    const maxForYearType = era.type === "genre" ? 1 : 2;

    if (seenSubjects.has(subjectKey)) return false;
    if (monthCount >= maxForYearType) return false;

    seenSubjects.add(subjectKey);
    seenMonths.set(monthKey, monthCount + 1);
    return true;
  };
}

function inferMood(scope) {
  const profiles = [
    {
      name: "Shadow / Catharsis",
      keywords: ["black metal", "death metal", "doom", "sludge", "gothic", "dark ambient", "industrial", "noise"],
      emotions: "catharsis, tension release, fascination with darkness",
      mentalState: "high-intensity processing, private focus, emotional pressure valve",
      mood: "brooding, armored, nocturnal"
    },
    {
      name: "Atmospheric Solitude",
      keywords: ["ambient", "drone", "soundscape", "post-rock", "minimalism", "field recording", "instrumental"],
      emotions: "stillness, distance, inwardness",
      mentalState: "reflective attention, decompression, spacious thought",
      mood: "hushed, suspended, solitary"
    },
    {
      name: "Momentum / Defiance",
      keywords: ["metal", "heavy metal", "hard rock", "punk", "thrash", "hardcore", "rock"],
      emotions: "drive, resolve, friction",
      mentalState: "energized persistence, boundary setting, forward motion",
      mood: "charged, resilient, defiant"
    },
    {
      name: "Pop Radiance / Identity Play",
      keywords: ["synthpop", "electropop", "pop", "dance", "female vocalists", "new wave", "disco"],
      emotions: "brightness, confidence, theatrical release",
      mentalState: "social imagination, self-styling, playful momentum",
      mood: "glossy, vivid, neon-lit"
    },
    {
      name: "Melancholy / Memory",
      keywords: ["post-punk", "darkwave", "new wave", "goth", "sad", "melancholy", "dream pop", "shoegaze"],
      emotions: "nostalgia, ache, romantic distance",
      mentalState: "memory sorting, longing, bittersweet reflection",
      mood: "wistful, cinematic, rain-lit"
    },
    {
      name: "Curiosity / Pattern Seeking",
      keywords: ["experimental", "progressive", "electronic", "krautrock", "psychedelic", "avant-garde"],
      emotions: "curiosity, surprise, playful analysis",
      mentalState: "exploration, pattern hunting, appetite for texture",
      mood: "restless, cerebral, exploratory"
    }
  ];

  const genreEvidence = scope.genres.slice(0, 18);
  const textEvidence = [
    ...scope.artists.slice(0, 12).map((item) => item.artistName),
    ...scope.songs.slice(0, 12).map((item) => item.trackName),
    ...scope.albums.slice(0, 12).map((item) => item.albumName)
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  const scored = profiles
    .map((profile) => {
      const genreScore = genreEvidence.reduce((sum, genre) => {
        const genreName = genre.genre.toLowerCase();
        const matched = profile.keywords.some((keyword) => genreMatches(genreName, keyword));
        return matched ? sum + (genre.hours ?? genre.streams ?? 0) : sum;
      }, 0);
      const textScore = profile.keywords.reduce((sum, keyword) => sum + (textEvidence.includes(keyword) ? 1 : 0), 0);

      return {
        ...profile,
        score: genreScore + textScore
      };
    })
    .sort((a, b) => b.score - a.score);

  const primary = scored[0];
  const secondary = scored.find((profile) => profile.score > 0 && profile.name !== primary.name) ?? scored[1];
  const topGenres = genreEvidence.slice(0, 6).map((genre) => titleCase(genre.genre));
  const topArtists = scope.artists.slice(0, 4).map((artist) => artist.artistName);
  const topSongs = scope.songs.slice(0, 3).map((song) => song.trackName);
  const topAlbums = scope.albums.slice(0, 3).map((album) => album.albumName);

  return {
    title: scope.title,
    emotions: `${primary.emotions}; ${secondary.emotions}`,
    mentalState: `${primary.mentalState}; ${secondary.mentalState}`,
    mood: `${primary.mood}; ${secondary.mood}`,
    explanation: `The strongest signals are ${topGenres.join(", ") || "uncategorized genres"}, plus repeated listening to ${topArtists.join(", ") || "the leading artists"}. Those tags and repeat patterns point toward ${primary.name.toLowerCase()} first, with ${secondary.name.toLowerCase()} as the secondary color.`,
    evidence: [
      ...topGenres.map((genre) => `Genre: ${genre}`),
      ...topArtists.map((artist) => `Artist: ${artist}`),
      ...topSongs.map((song) => `Song: ${song}`),
      ...topAlbums.map((album) => `Album: ${album}`)
    ].slice(0, 12)
  };
}

function genreMatches(genreName, keyword) {
  if (["metal", "rock", "pop"].includes(keyword)) return genreName === keyword;
  return genreName === keyword || genreName.includes(keyword);
}

function summarizeMoodTimelines(events, artistGenres) {
  const tagsByArtist = new Map(artistGenres.map((artist) => [artist.artistName, artist.genreTags ?? []]));
  const latestTime = events.reduce((latest, event) => {
    const playedTime = Date.parse(event.playedAt);
    return Number.isFinite(playedTime) && playedTime > latest ? playedTime : latest;
  }, 0);
  const recentStart = new Date(latestTime);
  recentStart.setUTCMonth(recentStart.getUTCMonth() - 3);

  const fullBuckets = new Map();
  const recentBuckets = new Map();

  for (const event of events) {
    const playedTime = Date.parse(event.playedAt);
    if (!Number.isFinite(playedTime) || !event.artistName) continue;

    const score = scoreEventMood(tagsByArtist.get(event.artistName) ?? []);
    const weight = Math.max(event.msPlayed ?? 0, 1);
    addMoodBucket(fullBuckets, event.playedMonth ?? event.playedAt.slice(0, 7), score, weight);

    if (playedTime >= recentStart.getTime() && playedTime <= latestTime) {
      addMoodBucket(recentBuckets, event.playedAt.slice(0, 10), score, weight);
    }
  }

  return {
    recent: finishMoodTimeline(recentBuckets, "day"),
    full: finishMoodTimeline(fullBuckets, "month")
  };
}

function addMoodBucket(map, key, score, weight) {
  const bucket = map.get(key) ?? {
    key,
    weightedScore: 0,
    weight: 0,
    streams: 0
  };

  bucket.weightedScore += score * weight;
  bucket.weight += weight;
  bucket.streams += 1;
  map.set(key, bucket);
}

function finishMoodTimeline(map, grain) {
  const points = [...map.values()]
    .sort((a, b) => a.key.localeCompare(b.key))
    .map((bucket) => ({
      key: bucket.key,
      score: Number((bucket.weightedScore / Math.max(bucket.weight, 1)).toFixed(1)),
      streams: bucket.streams,
      hours: Number((bucket.weight / 3_600_000).toFixed(2))
    }));

  const average = points.reduce((sum, point) => sum + point.score, 0) / Math.max(points.length, 1);

  return {
    grain,
    startDate: points[0]?.key ?? "",
    endDate: points.at(-1)?.key ?? "",
    averageScore: Number(average.toFixed(1)),
    lowPoint: [...points].sort((a, b) => a.score - b.score)[0],
    highPoint: [...points].sort((a, b) => b.score - a.score)[0],
    points
  };
}

function scoreEventMood(tags) {
  if (!tags.length) return 50;

  const scores = tags
    .map((tag) => scoreTagMood(tag))
    .filter((score) => typeof score === "number");

  if (!scores.length) return 50;
  return scores.reduce((sum, score) => sum + score, 0) / scores.length;
}

function scoreTagMood(tag) {
  const name = tag.toLowerCase();
  const rules = [
    { keywords: ["black metal", "death metal", "doom", "sludge", "dark ambient", "industrial", "noise"], score: 30 },
    { keywords: ["synthpop", "electropop", "dance", "disco", "funk", "pop"], score: 78 },
    { keywords: ["female vocalists", "new wave", "power pop"], score: 72 },
    { keywords: ["ambient", "drone", "soundscape", "minimalism", "instrumental"], score: 48 },
    { keywords: ["experimental", "progressive", "electronic", "psychedelic"], score: 57 },
    { keywords: ["rock", "hard rock", "heavy metal", "punk", "thrash", "hardcore"], score: 61 },
    { keywords: ["post-punk", "darkwave", "goth", "shoegaze", "dream pop"], score: 42 }
  ];

  const matched = rules.find((rule) => rule.keywords.some((keyword) => genreMatches(name, keyword)));
  return matched?.score ?? 50;
}

function summarizeRecentRankings(events) {
  const latestTime = events.reduce((latest, event) => {
    const playedTime = Date.parse(event.playedAt);
    return Number.isFinite(playedTime) && playedTime > latest ? playedTime : latest;
  }, 0);
  const end = new Date(latestTime);
  const start = new Date(latestTime);
  start.setUTCMonth(start.getUTCMonth() - 3);

  const artists = new Map();
  const songs = new Map();
  const albums = new Map();

  for (const event of events) {
    const playedTime = Date.parse(event.playedAt);
    if (!Number.isFinite(playedTime) || playedTime < start.getTime() || playedTime > end.getTime()) continue;

    if (event.artistName) {
      addRecentMetric(artists, event.artistName, event, { artistName: event.artistName });
    }

    if (event.artistName && event.trackName) {
      addRecentMetric(songs, `${event.artistName}\u0000${event.trackName}`, event, {
        artistName: event.artistName,
        trackName: event.trackName
      });
    }

    if (event.artistName && event.albumName) {
      addRecentMetric(albums, `${event.artistName}\u0000${event.albumName}`, event, {
        artistName: event.artistName,
        albumName: event.albumName
      });
    }
  }

  return {
    startDate: start.toISOString().slice(0, 10),
    endDate: end.toISOString().slice(0, 10),
    artists: rankRecent(artists, 50),
    songs: rankRecent(songs, 50),
    albums: rankRecent(albums, 50)
  };
}

function addRecentMetric(map, key, event, attrs) {
  const metric = map.get(key) ?? {
    key,
    ...attrs,
    totalStreams: 0,
    totalMsPlayed: 0,
    firstPlayed: event.playedAt,
    lastPlayed: event.playedAt
  };

  metric.totalStreams += 1;
  metric.totalMsPlayed += event.msPlayed ?? 0;
  metric.firstPlayed = event.playedAt < metric.firstPlayed ? event.playedAt : metric.firstPlayed;
  metric.lastPlayed = event.playedAt > metric.lastPlayed ? event.playedAt : metric.lastPlayed;
  map.set(key, metric);
}

function rankRecent(map, limit) {
  return [...map.values()]
    .sort((a, b) => b.totalStreams - a.totalStreams || b.totalMsPlayed - a.totalMsPlayed)
    .slice(0, limit)
    .map(({ key, ...metric }) => ({
      ...metric,
      totalHoursPlayed: Number((metric.totalMsPlayed / 3_600_000).toFixed(2))
    }));
}

function stat(label, value) {
  return `<dl class="stat"><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></dl>`;
}

function yearCard(year, maxHours) {
  return `<article class="year-card">
    <strong>${year.year}</strong>
    <div class="meter"><span style="--value:${percentOf(year.totalHoursPlayed, maxHours)}%"></span></div>
    <div class="metric-line"><span>${formatHours(year.totalHoursPlayed)}h</span><span>${formatNumber(year.totalStreams)}</span></div>
    <div class="metric-line"><span>Skip</span><span>${formatPercent(year.skipRate)}</span></div>
  </article>`;
}

function monthBar(month, maxHours) {
  const label = `${month.month}: ${formatHours(month.totalHoursPlayed)} hours, ${formatNumber(month.totalStreams)} plays`;
  return `<span class="month-bar" style="--value:${percentOf(month.totalHoursPlayed, maxHours)}%" aria-label="${escapeHtml(label)}"></span>`;
}

function genreTile(genre, maxHours) {
  return `<article class="genre-tile">
    <strong>${escapeHtml(titleCase(genre.genre))}</strong>
    <div class="meter"><span style="--value:${percentOf(genre.hours, maxHours)}%"></span></div>
    <div class="metric-line"><span>${formatHours(genre.hours)}h</span><span>${formatNumber(genre.artists)} artists</span></div>
  </article>`;
}

function eraCard(era) {
  const subject = era.artistName ? `${era.subject} / ${era.artistName}` : era.subject;

  return `<article class="era-card">
    <h3>${escapeHtml(era.name)}</h3>
    <div class="era-meta">
      <span>${escapeHtml(readableMonth(era.month))}</span>
      <span>${escapeHtml(titleCase(era.type))}</span>
      <span>${formatHours(era.totalHoursPlayed)}h</span>
      <span>${formatNumber(era.meaningfulStreams)} meaningful plays</span>
      <span>${Math.round(era.share * 100)}% of month</span>
    </div>
    <p>${escapeHtml(era.explanation)}</p>
    <div class="evidence-list">
      <span>${escapeHtml(subject)}</span>
      ${era.topTrack ? `<span>Anchor: ${escapeHtml(era.topTrack)}</span>` : ""}
    </div>
  </article>`;
}

function dnaPanel(title, items, titleFor, valueForItem, metaFor) {
  return `<section class="dna-card">
    <h3>${escapeHtml(title)}</h3>
    <ol class="rank-list">
      ${items.map((item, index) => listItem(index, titleFor(item), valueForItem(item), metaFor(item))).join("")}
    </ol>
  </section>`;
}

function leaderboard(title, items, titleFor, valueForItem, metaFor) {
  return `<section class="leaderboard-card">
    <div class="section-heading tight"><h2>${escapeHtml(title)}</h2></div>
    <ol class="rank-list">
      ${items.slice(0, 10).map((item, index) => listItem(index, titleFor(item), valueForItem(item), metaFor(item))).join("")}
    </ol>
  </section>`;
}

function recentLeaderboard(title, items, titleFor, valueForItem, metaFor) {
  return `<section class="recent-card">
    <div class="section-heading tight"><h2>${escapeHtml(title)}</h2></div>
    <ol class="rank-list">
      ${items.map((item, index) => listItem(index, titleFor(item), valueForItem(item), metaFor(item))).join("")}
    </ol>
  </section>`;
}

function moodPanel(mood) {
  return `<article class="mood-panel">
    <h3>${escapeHtml(mood.title)}</h3>
    <div class="mood-clusters">
      <div class="mood-cluster">
        <span class="mood-label">Possible emotions</span>
        <span class="mood-value">${escapeHtml(mood.emotions)}</span>
      </div>
      <div class="mood-cluster">
        <span class="mood-label">Possible mental state</span>
        <span class="mood-value">${escapeHtml(mood.mentalState)}</span>
      </div>
      <div class="mood-cluster">
        <span class="mood-label">Possible mood</span>
        <span class="mood-value">${escapeHtml(mood.mood)}</span>
      </div>
    </div>
    <p>${escapeHtml(mood.explanation)}</p>
    <div class="evidence-list">
      ${mood.evidence.map((item) => `<span>${escapeHtml(item)}</span>`).join("")}
    </div>
  </article>`;
}

function moodChart(timeline, label) {
  const width = 860;
  const height = 260;
  const margin = { top: 22, right: 22, bottom: 44, left: 58 };
  const chartWidth = width - margin.left - margin.right;
  const chartHeight = height - margin.top - margin.bottom;
  const points = timeline.points;

  if (!points.length) {
    return `<div class="mood-chart-panel"><p>No mood timeline data available.</p></div>`;
  }

  const xFor = (index) => margin.left + (points.length === 1 ? chartWidth / 2 : (index / (points.length - 1)) * chartWidth);
  const yFor = (score) => margin.top + ((100 - score) / 100) * chartHeight;
  const chartPoints = points.map((point, index) => ({
    ...point,
    x: xFor(index),
    y: yFor(point.score)
  }));
  const linePoints = chartPoints.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(" ");
  const areaPoints = `${margin.left},${margin.top + chartHeight} ${linePoints} ${margin.left + chartWidth},${margin.top + chartHeight}`;
  const low = timeline.lowPoint;
  const high = timeline.highPoint;
  const labelEvery = Math.max(1, Math.ceil(points.length / 8));
  const labeledPoints = timeline.grain === "month"
    ? chartPoints.filter((point, index) => index === 0 || point.key.slice(0, 4) !== chartPoints[index - 1]?.key.slice(0, 4))
    : chartPoints.filter((_, index) => index % labelEvery === 0 || index === chartPoints.length - 1);

  return `<div class="mood-chart-panel">
    <svg class="mood-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(label)} from ${escapeHtml(timeline.startDate)} to ${escapeHtml(timeline.endDate)}">
      <line class="grid" x1="${margin.left}" y1="${yFor(75)}" x2="${margin.left + chartWidth}" y2="${yFor(75)}"></line>
      <line class="grid" x1="${margin.left}" y1="${yFor(50)}" x2="${margin.left + chartWidth}" y2="${yFor(50)}"></line>
      <line class="grid" x1="${margin.left}" y1="${yFor(25)}" x2="${margin.left + chartWidth}" y2="${yFor(25)}"></line>
      <line class="axis" x1="${margin.left}" y1="${margin.top}" x2="${margin.left}" y2="${margin.top + chartHeight}"></line>
      <line class="axis" x1="${margin.left}" y1="${margin.top + chartHeight}" x2="${margin.left + chartWidth}" y2="${margin.top + chartHeight}"></line>
      <text x="8" y="${yFor(86)}">high</text>
      <text x="8" y="${yFor(52)}">neutral</text>
      <text x="8" y="${yFor(18)}">low</text>
      <polygon class="area" points="${areaPoints}"></polygon>
      <polyline class="line" points="${linePoints}"></polyline>
      ${chartPoints
        .filter((_, index) => index % labelEvery === 0 || index === chartPoints.length - 1)
        .map((point) => `<circle class="point" cx="${point.x.toFixed(1)}" cy="${point.y.toFixed(1)}" r="3"><title>${escapeHtml(point.key)}: ${point.score}/100, ${formatHours(point.hours)}h, ${formatNumber(point.streams)} plays</title></circle>`)
        .join("")}
      ${labeledPoints
        .map((point, index) => `<text x="${point.x.toFixed(1)}" y="${height - 16}" text-anchor="${index === 0 ? "start" : "middle"}">${escapeHtml(shortDateLabel(point.key, timeline.grain))}</text>`)
        .join("")}
    </svg>
    <div class="mood-chart-summary">
      <span>Average ${timeline.averageScore}/100</span>
      <span>Low ${shortDateLabel(low.key, timeline.grain)}: ${low.score}/100</span>
      <span>High ${shortDateLabel(high.key, timeline.grain)}: ${high.score}/100</span>
    </div>
  </div>`;
}

function findingPanel(title, items, titleFor, metaFor) {
  return `<section class="panel">
    <div class="section-heading tight"><h2>${escapeHtml(title)}</h2></div>
    <ol class="rank-list">
      ${items.map((item, index) => listItem(index, titleFor(item), "", metaFor(item))).join("")}
    </ol>
  </section>`;
}

function listItem(index, title, value, meta) {
  return `<li>
    <span class="rank-num">${String(index + 1).padStart(2, "0")}</span>
    <span class="rank-title">${escapeHtml(title ?? "Unknown")}</span>
    ${value ? `<span class="rank-value">${escapeHtml(value)}</span>` : ""}
    <span class="rank-meta">${escapeHtml(meta ?? "")}</span>
  </li>`;
}

function maxBy(items, key) {
  return Math.max(...items.map((item) => item[key] ?? 0), 1);
}

function percentOf(value, max) {
  return Math.max(2, Math.round(((value ?? 0) / Math.max(max, 1)) * 100));
}

function formatHours(value) {
  return Number(value ?? 0).toLocaleString("en-US", {
    maximumFractionDigits: value >= 100 ? 0 : 1
  });
}

function hoursFor(item) {
  if (typeof item.totalHoursPlayed === "number") return item.totalHoursPlayed;
  return Number(((item.totalMsPlayed ?? 0) / 3_600_000).toFixed(2));
}

function formatNumber(value) {
  return Number(value ?? 0).toLocaleString("en-US");
}

function formatPercent(value) {
  if (value === null || value === undefined) return "n/a";
  return `${Math.round(value * 100)}%`;
}

function titleCase(value) {
  return value.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function shortDateLabel(value, grain) {
  if (grain === "month") {
    return value.slice(0, 4);
  }

  const date = new Date(`${value}T00:00:00Z`);
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC"
  });
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
