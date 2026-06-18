#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

const args = process.argv.slice(2);
const rawDir = path.resolve(repoRoot, args.find((arg) => !arg.startsWith("--")) ?? "raw");
const outputDir = path.resolve(repoRoot, valueFor("--output") ?? "output");
const chunkSize = Number(valueFor("--chunk-size") ?? 10_000);

function valueFor(flag) {
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
}

const schemas = {
  audio: readJson(path.join(repoRoot, "schemas/audio.schema.json")),
  video: readJson(path.join(repoRoot, "schemas/video.schema.json"))
};

const state = {
  generatedAt: new Date().toISOString(),
  files: [],
  warnings: [],
  eventCount: 0,
  audioEventCount: 0,
  videoEventCount: 0,
  totalMsPlayed: 0,
  normalizedChunk: [],
  chunkFiles: [],
  artists: new Map(),
  songs: new Map(),
  albums: new Map(),
  videos: new Map(),
  yearly: new Map(),
  monthly: new Map(),
  artistYears: new Map(),
  songDays: new Map(),
  albumWeeks: new Map(),
  lateNight: new Map(),
  ndjsonLines: []
};

fs.mkdirSync(outputDir, { recursive: true });
cleanOutputDir();

const rawFiles = fs
  .readdirSync(rawDir)
  .filter((file) => file.endsWith(".json"))
  .sort();

if (rawFiles.length === 0) {
  throw new Error(`No .json files found in ${rawDir}`);
}

for (const fileName of rawFiles) {
  const mediaType = fileName.toLowerCase().includes("video") ? "video" : "audio";
  const fullPath = path.join(rawDir, fileName);
  const rows = readJson(fullPath);

  if (!Array.isArray(rows)) {
    throw new Error(`${fileName} must contain a JSON array`);
  }

  let validRows = 0;
  for (const [sourceIndex, row] of rows.entries()) {
    const validationErrors = validateRow(row, schemas[mediaType]);
    if (validationErrors.length > 0) {
      state.warnings.push({
        fileName,
        sourceIndex,
        errors: validationErrors
      });
      continue;
    }

    const event = normalizeEvent(row, mediaType, fileName, sourceIndex);
    validRows += 1;
    addEvent(event);
  }

  state.files.push({
    fileName,
    mediaType,
    rows: rows.length,
    validRows,
    skippedRows: rows.length - validRows
  });
}

flushChunk();
writeOutputs();

console.log(`Analyzed ${state.eventCount.toLocaleString()} stream events.`);
console.log(`Wrote ${state.chunkFiles.length} normalized event chunk(s) and report files to ${path.relative(repoRoot, outputDir)}.`);
if (state.warnings.length > 0) {
  console.log(`Validation warnings: ${state.warnings.length.toLocaleString()} row(s); see output/validation-warnings.json.`);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(fileName, data) {
  fs.writeFileSync(path.join(outputDir, fileName), `${JSON.stringify(data, null, 2)}\n`);
}

function cleanOutputDir() {
  const generatedNames = new Set([
    "analysis-snapshot.json",
    "analysis-snapshot.ndjson",
    "genre-candidates.json",
    "genre-candidates-top-1000.json",
    "genre-candidates-top-1000.enriched.json",
    "artist-genres.lastfm.json",
    "lastfm-artist-genre-cache.json",
    "import.sql",
    "monthly-trends.json",
    "odd-findings.json",
    "report.json",
    "stream-events-manifest.json",
    "stream-events.ndjson",
    "top-albums.json",
    "top-artists.json",
    "top-songs.json",
    "top-videos.json",
    "validation-warnings.json",
    "yearly-trends.json"
  ]);

  for (const fileName of fs.readdirSync(outputDir)) {
    if (generatedNames.has(fileName) || /^stream-events-\d{4}\.json$/.test(fileName)) {
      fs.unlinkSync(path.join(outputDir, fileName));
    }
  }
}

function normalizeEvent(row, mediaType, sourceFile, sourceIndex) {
  const played = new Date(row.ts);
  const playedAt = played.toISOString();
  const artistName = clean(row.master_metadata_album_artist_name);
  const trackName = clean(row.master_metadata_track_name);
  const albumName = clean(row.master_metadata_album_album_name);
  const episodeName = clean(row.episode_name);
  const episodeShowName = clean(row.episode_show_name);
  const audiobookTitle = clean(row.audiobook_title);
  const audiobookChapterTitle = clean(row.audiobook_chapter_title);

  const event = compact({
    eventId: hashId([
      mediaType,
      sourceFile,
      sourceIndex,
      row.ts,
      row.ms_played,
      artistName,
      trackName,
      episodeName
    ]),
    sourceFile,
    sourceIndex,
    mediaType,
    playedAt,
    playedYear: played.getUTCFullYear(),
    playedMonth: playedAt.slice(0, 7),
    playedHour: played.getUTCHours(),
    msPlayed: row.ms_played,
    artistName,
    trackName,
    albumName,
    spotifyTrackUri: clean(row.spotify_track_uri),
    episodeName,
    episodeShowName,
    spotifyEpisodeUri: clean(row.spotify_episode_uri),
    audiobookTitle,
    audiobookChapterTitle,
    platform: clean(row.platform),
    country: clean(row.conn_country),
    reasonStart: clean(row.reason_start),
    reasonEnd: clean(row.reason_end),
    shuffle: row.shuffle,
    skipped: row.skipped,
    offline: row.offline,
    incognitoMode: row.incognito_mode
  });

  return event;
}

function addEvent(event) {
  state.eventCount += 1;
  state.totalMsPlayed += event.msPlayed;
  if (event.mediaType === "audio") state.audioEventCount += 1;
  if (event.mediaType === "video") state.videoEventCount += 1;

  state.normalizedChunk.push(event);
  state.ndjsonLines.push(JSON.stringify(event));

  const yearKey = String(event.playedYear);
  addMetric(state.yearly, yearKey, event);
  addMetric(state.monthly, event.playedMonth, event);
  if (event.playedHour >= 0 && event.playedHour < 5) addMetric(state.lateNight, yearKey, event);

  if (event.artistName) {
    addMetric(state.artists, event.artistName, event, { artistName: event.artistName });
    setAdd(state.artistYears, event.artistName, yearKey);
  }

  if (event.artistName && event.trackName) {
    addMetric(state.songs, `${event.artistName}\u0000${event.trackName}`, event, {
      artistName: event.artistName,
      trackName: event.trackName,
      spotifyTrackUri: event.spotifyTrackUri
    });
    addMetric(state.songDays, `${event.artistName}\u0000${event.trackName}\u0000${event.playedAt.slice(0, 10)}`, event, {
      artistName: event.artistName,
      trackName: event.trackName,
      date: event.playedAt.slice(0, 10)
    });
  }

  if (event.artistName && event.albumName) {
    addMetric(state.albums, `${event.artistName}\u0000${event.albumName}`, event, {
      artistName: event.artistName,
      albumName: event.albumName
    });
    addMetric(state.albumWeeks, `${event.artistName}\u0000${event.albumName}\u0000${isoWeek(event.playedAt)}`, event, {
      artistName: event.artistName,
      albumName: event.albumName,
      week: isoWeek(event.playedAt)
    });
  }

  if (event.mediaType === "video") {
    const videoTitle = event.episodeName ?? event.trackName ?? event.audiobookChapterTitle;
    const channelName = event.episodeShowName ?? event.artistName ?? event.audiobookTitle;
    if (videoTitle || channelName) {
      addMetric(state.videos, `${channelName ?? "Unknown"}\u0000${videoTitle ?? "Unknown"}`, event, {
        channelName,
        videoTitle
      });
    }
  }

  if (state.normalizedChunk.length >= chunkSize) flushChunk();
}

function flushChunk() {
  if (state.normalizedChunk.length === 0) return;
  const index = state.chunkFiles.length + 1;
  const fileName = `stream-events-${String(index).padStart(4, "0")}.json`;
  writeJson(fileName, state.normalizedChunk);
  state.chunkFiles.push({
    fileName,
    eventCount: state.normalizedChunk.length
  });
  state.normalizedChunk = [];
}

function writeOutputs() {
  const topArtists = ranked(state.artists, 50).map((item) => ({
    ...item,
    yearsActive: state.artistYears.get(item.artistName)?.size ?? item.yearsActive
  }));
  const topSongs = ranked(state.songs, 50);
  const topAlbums = ranked(state.albums, 50);
  const topVideos = ranked(state.videos, 50);
  const yearlyTrends = ranked(state.yearly, state.yearly.size, "key").map(({ key, ...rest }) => ({
    year: Number(key),
    ...rest
  }));
  const monthlyTrends = ranked(state.monthly, state.monthly.size, "key").map(({ key, ...rest }) => ({
    month: key,
    ...rest
  }));

  const genreCandidates = topByListening(state.artists, state.artists.size).map((item) => ({
    artistName: item.artistName,
    totalStreams: item.totalStreams,
    totalMsPlayed: item.totalMsPlayed,
    totalHoursPlayed: item.totalHoursPlayed,
    firstPlayed: item.firstPlayed,
    lastPlayed: item.lastPlayed,
    yearsActive: state.artistYears.get(item.artistName)?.size ?? item.yearsActive,
    genreTags: []
  }));

  const oddFindings = {
    longestArtistLifespans: [...state.artistYears.entries()]
      .map(([artistName, years]) => ({
        artistName,
        yearsActive: years.size,
        activeYears: [...years].sort(),
        totalHoursPlayed: roundHours(state.artists.get(artistName)?.totalMsPlayed ?? 0)
      }))
      .sort((a, b) => b.yearsActive - a.yearsActive || b.totalHoursPlayed - a.totalHoursPlayed)
      .slice(0, 25),
    mostPlayedMonths: ranked(state.monthly, 25, "key").map(({ key, ...rest }) => ({
      month: key,
      ...rest
    })),
    lateNightByYear: ranked(state.lateNight, state.lateNight.size, "key").map(({ key, ...rest }) => ({
      year: Number(key),
      ...rest
    })),
    repeatObsessionTracks: ranked(state.songDays, 25),
    oneWeekFixationAlbums: ranked(state.albumWeeks, 25),
    videoVsMusicRatio: {
      audioEvents: state.audioEventCount,
      videoEvents: state.videoEventCount,
      audioHours: roundHours(sumByMedia("audio")),
      videoHours: roundHours(sumByMedia("video")),
      videoEventRatio: ratio(state.videoEventCount, state.eventCount)
    }
  };

  const report = {
    generatedAt: state.generatedAt,
    totals: {
      files: state.files.length,
      events: state.eventCount,
      audioEvents: state.audioEventCount,
      videoEvents: state.videoEventCount,
      totalMsPlayed: state.totalMsPlayed,
      totalHoursPlayed: roundHours(state.totalMsPlayed)
    },
    topArtists,
    topSongs,
    topAlbums,
    topVideos,
    yearlyTrends,
    oddFindings
  };

  const snapshot = {
    snapshotType: "spotify-local-report",
    generatedAt: state.generatedAt,
    totals: report.totals,
    topArtists,
    topSongs,
    topAlbums,
    topVideos,
    yearlyTrends,
    monthlyTrends,
    oddFindings
  };

  writeJson("stream-events-manifest.json", {
    generatedAt: state.generatedAt,
    chunkSize,
    files: state.chunkFiles,
    eventCount: state.eventCount
  });
  fs.writeFileSync(path.join(outputDir, "stream-events.ndjson"), `${state.ndjsonLines.join("\n")}\n`);
  writeJson("top-artists.json", topArtists);
  writeJson("top-songs.json", topSongs);
  writeJson("top-albums.json", topAlbums);
  writeJson("top-videos.json", topVideos);
  writeJson("yearly-trends.json", yearlyTrends);
  writeJson("monthly-trends.json", monthlyTrends);
  writeJson("genre-candidates.json", genreCandidates);
  writeJson("genre-candidates-top-1000.json", genreCandidates.slice(0, 1000));
  writeJson("odd-findings.json", oddFindings);
  writeJson("analysis-snapshot.json", snapshot);
  fs.writeFileSync(path.join(outputDir, "analysis-snapshot.ndjson"), `${JSON.stringify(snapshot)}\n`);
  writeJson("report.json", report);
  writeJson("validation-warnings.json", state.warnings);
  fs.writeFileSync(path.join(outputDir, "import.sql"), importSql());
}

function validateRow(row, schema) {
  const errors = [];
  const allowed = new Set(Object.keys(schema.properties));

  for (const key of schema.required ?? []) {
    if (!Object.hasOwn(row, key)) errors.push(`Missing required field: ${key}`);
  }

  if (schema.additionalProperties === false) {
    for (const key of Object.keys(row)) {
      if (!allowed.has(key)) errors.push(`Unexpected field: ${key}`);
    }
  }

  for (const [key, propertySchema] of Object.entries(schema.properties)) {
    if (!Object.hasOwn(row, key)) continue;
    const expected = Array.isArray(propertySchema.type) ? propertySchema.type : [propertySchema.type];
    const actual = row[key] === null ? "null" : Number.isInteger(row[key]) ? "integer" : typeof row[key];
    if (!expected.includes(actual)) {
      errors.push(`Invalid type for ${key}: expected ${expected.join(" or ")}, received ${actual}`);
    }
  }

  return errors;
}

function addMetric(map, key, event, attrs = {}) {
  const metric = map.get(key) ?? {
    key,
    ...attrs,
    totalStreams: 0,
    totalMsPlayed: 0,
    firstPlayed: event.playedAt,
    lastPlayed: event.playedAt,
    activeYears: new Set(),
    skipCount: 0,
    skipKnownCount: 0
  };

  metric.totalStreams += 1;
  metric.totalMsPlayed += event.msPlayed;
  metric.firstPlayed = event.playedAt < metric.firstPlayed ? event.playedAt : metric.firstPlayed;
  metric.lastPlayed = event.playedAt > metric.lastPlayed ? event.playedAt : metric.lastPlayed;
  metric.activeYears.add(event.playedYear);
  if (typeof event.skipped === "boolean") {
    metric.skipKnownCount += 1;
    if (event.skipped) metric.skipCount += 1;
  }

  map.set(key, metric);
}

function ranked(map, limit, keyName) {
  return topByListening(map, limit).map((metric) => finishMetric(metric, keyName));
}

function topByListening(map, limit) {
  return [...map.values()]
    .sort((a, b) => b.totalMsPlayed - a.totalMsPlayed || b.totalStreams - a.totalStreams)
    .slice(0, limit);
}

function finishMetric(metric, keyName) {
  const { activeYears, skipKnownCount, ...rest } = metric;
  const output = {
    ...rest,
    totalHoursPlayed: roundHours(metric.totalMsPlayed),
    firstPlayed: metric.firstPlayed,
    lastPlayed: metric.lastPlayed,
    yearsActive: activeYears.size,
    skipRate: skipKnownCount === 0 ? null : Number((metric.skipCount / skipKnownCount).toFixed(4))
  };
  if (!keyName) delete output.key;
  return output;
}

function clean(value) {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

function compact(object) {
  return Object.fromEntries(Object.entries(object).filter(([, value]) => value !== undefined));
}

function hashId(parts) {
  return crypto.createHash("sha1").update(parts.map((part) => part ?? "").join("\u0000")).digest("hex");
}

function setAdd(map, key, value) {
  const set = map.get(key) ?? new Set();
  set.add(value);
  map.set(key, set);
}

function roundHours(ms) {
  return Number((ms / 3_600_000).toFixed(2));
}

function ratio(part, total) {
  return total === 0 ? 0 : Number((part / total).toFixed(4));
}

function sumByMedia(mediaType) {
  return state.ndjsonLines.reduce((sum, line) => {
    const event = JSON.parse(line);
    return event.mediaType === mediaType ? sum + event.msPlayed : sum;
  }, 0);
}

function isoWeek(isoString) {
  const date = new Date(isoString);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((date - yearStart) / 86_400_000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

function importSql() {
  return `-- Generated by npm run spotify:analyze.
-- Run from the repository root with psql connected to your target database.

create table if not exists spotify_stream_events (
  event_id text primary key,
  played_at timestamptz not null,
  media_type text not null check (media_type in ('audio', 'video')),
  artist_name text,
  track_name text,
  album_name text,
  episode_name text,
  episode_show_name text,
  ms_played integer not null,
  payload jsonb not null
);

create table if not exists spotify_artist_metadata (
  artist_name text primary key,
  genre_tags text[] not null default '{}',
  metadata jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists spotify_analysis_snapshots (
  id bigserial primary key,
  snapshot_type text not null,
  generated_at timestamptz not null,
  payload jsonb not null
);

create temp table spotify_stream_events_json (
  payload jsonb not null
);

create temp table spotify_analysis_snapshot_json (
  payload jsonb not null
);

\\copy spotify_stream_events_json(payload) from 'output/stream-events.ndjson'
\\copy spotify_analysis_snapshot_json(payload) from 'output/analysis-snapshot.ndjson'

insert into spotify_stream_events (
  event_id,
  played_at,
  media_type,
  artist_name,
  track_name,
  album_name,
  episode_name,
  episode_show_name,
  ms_played,
  payload
)
select
  payload->>'eventId',
  (payload->>'playedAt')::timestamptz,
  payload->>'mediaType',
  payload->>'artistName',
  payload->>'trackName',
  payload->>'albumName',
  payload->>'episodeName',
  payload->>'episodeShowName',
  (payload->>'msPlayed')::integer,
  payload
from spotify_stream_events_json
on conflict (event_id) do update set
  played_at = excluded.played_at,
  media_type = excluded.media_type,
  artist_name = excluded.artist_name,
  track_name = excluded.track_name,
  album_name = excluded.album_name,
  episode_name = excluded.episode_name,
  episode_show_name = excluded.episode_show_name,
  ms_played = excluded.ms_played,
  payload = excluded.payload;

insert into spotify_artist_metadata (artist_name)
select distinct artist_name
from spotify_stream_events
where artist_name is not null
on conflict (artist_name) do nothing;

insert into spotify_analysis_snapshots (snapshot_type, generated_at, payload)
select
  'spotify-local-report',
  (payload->>'generatedAt')::timestamptz,
  payload
from spotify_analysis_snapshot_json;
`;
}
