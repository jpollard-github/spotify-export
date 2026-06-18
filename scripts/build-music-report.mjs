#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const outputRoot = path.join(repoRoot, "output");
const reportDir = path.join(outputRoot, "music-report");

const data = {
  monthlyTrends: readJson("monthly-trends.json"),
  oddFindings: readJson("odd-findings.json"),
  topAlbums: readJson("top-albums.json"),
  topArtists: readJson("top-artists.json"),
  topSongs: readJson("top-songs.json"),
  topVideos: readJson("top-videos.json"),
  yearlyTrends: readJson("yearly-trends.json"),
  artistGenres: readJson("artist-genres.lastfm.json"),
  recentRankings: summarizeRecentRankings(readNdjson("stream-events.ndjson"))
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

.leaderboards { grid-template-columns: repeat(4, minmax(0, 1fr)); }
.leaderboard-card, .panel, .recent-card { padding: 16px; }

.recent-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
.recent-card .rank-list { max-height: 760px; overflow: auto; padding-right: 4px; }
.recent-card .rank-list li { grid-template-columns: 34px minmax(0, 1fr) auto; padding: 8px 0; }

.mini-stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin: 18px 0 0; }
.mini-stats div { padding: 12px; background: rgba(255, 255, 255, 0.055); }
.mini-stats dt { color: var(--muted); font-size: 0.78rem; }
.mini-stats dd { margin: 6px 0 0; font-weight: 900; }

.footer { display: flex; justify-content: space-between; gap: 16px; padding-top: 22px; font-size: 0.85rem; }

@media (max-width: 920px) {
  .hero, .split, .leaderboards, .recent-grid { grid-template-columns: 1fr; }
  .hero { min-height: auto; padding: 44px 0 28px; }
}

@media (max-width: 620px) {
  .page-shell { width: min(100% - 20px, 1180px); }
  .section-heading, .footer { display: block; }
  .month-strip { grid-template-columns: repeat(18, minmax(8px, 1fr)); }
  .rank-list li { grid-template-columns: 28px minmax(0, 1fr); }
  .rank-value { grid-column: 2; }
  .mini-stats { grid-template-columns: 1fr; }
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

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
