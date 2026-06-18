#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const args = process.argv.slice(2);

const inputFile = path.resolve(repoRoot, valueFor("--input") ?? "output/genre-candidates-top-1000.json");
const outputFile = path.resolve(repoRoot, valueFor("--output") ?? "output/genre-candidates-top-1000.enriched.json");
const cacheFile = path.resolve(repoRoot, valueFor("--cache") ?? "output/lastfm-artist-genre-cache.json");
const limit = Number(valueFor("--limit") ?? 1000);
const delayMs = Number(valueFor("--delay-ms") ?? 150);
const requestTimeoutMs = Number(valueFor("--timeout-ms") ?? 30_000);
const maxRetries = Number(valueFor("--max-retries") ?? 4);
const maxTags = Number(valueFor("--max-tags") ?? 8);
const minTagCount = Number(valueFor("--min-tag-count") ?? 5);

loadDotEnv(path.join(repoRoot, ".env.local"));

const apiKey = process.env.LASTFM_API_KEY;

if (!apiKey) {
  throw new Error("Missing LASTFM_API_KEY. Add it to .env.local.");
}

const candidates = readJson(inputFile).slice(0, limit);
const cache = fs.existsSync(cacheFile) ? readJson(cacheFile) : {};
const enriched = [];
let stoppedEarly = false;

for (const [index, candidate] of candidates.entries()) {
  const artistName = candidate.artistName;
  const cached = cache[artistName];

  let lastfmArtist;
  try {
    lastfmArtist = cached ?? await getArtistTopTags(artistName);
  } catch (error) {
    if (error instanceof LastfmRateLimitError) {
      stoppedEarly = true;
      console.log(`Last.fm rate limit reached at ${index}/${candidates.length} artists. Writing partial outputs from cache and stopping.`);
      break;
    }

    throw error;
  }

  const genreTags = filterTags(lastfmArtist.tags);

  cache[artistName] = lastfmArtist;
  enriched.push({
    ...candidate,
    genreTags,
    genreSource: "lastfm",
    lastfmArtist
  });

  if (!cached) {
    writeJson(cacheFile, cache);
    writeOutputs(enriched);
    await sleep(delayMs);
  }

  if ((index + 1) % 50 === 0) {
    console.log(`Enriched ${index + 1}/${candidates.length} artists...`);
  }
}

writeOutputs(buildEnrichedFromCache(candidates, cache));

console.log(`Wrote ${path.relative(repoRoot, outputFile)}${stoppedEarly ? " with partial cached data" : ""}.`);
console.log(`Cached Last.fm lookups in ${path.relative(repoRoot, cacheFile)}.`);

function valueFor(flag) {
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`);
}

function loadDotEnv(filePath) {
  if (!fs.existsSync(filePath)) return;

  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;

    const [, key, rawValue] = match;
    const value = rawValue.trim().replace(/^['"]|['"]$/g, "");
    if (!process.env[key]) process.env[key] = value;
  }
}

async function getArtistTopTags(artistName) {
  const params = new URLSearchParams({
    method: "artist.gettoptags",
    artist: artistName,
    autocorrect: "1",
    api_key: apiKey,
    format: "json"
  });

  const response = await lastfmFetch(`https://ws.audioscrobbler.com/2.0/?${params}`);
  const rawTags = response.toptags?.tag;
  const tags = Array.isArray(rawTags) ? rawTags.map(normalizeTag).filter(Boolean) : [];

  return {
    matchStatus: response.error ? "error" : tags.length > 0 ? "found" : "not_found",
    query: artistName,
    correctedArtistName: response.toptags?.["@attr"]?.artist,
    tags
  };
}

async function lastfmFetch(url) {
  for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);

    try {
      const response = await fetch(url, { signal: controller.signal });
      const body = await response.json();

      if (response.status === 429 || body.error === 29) {
        throw new LastfmRateLimitError(body.message ?? "Rate limit exceeded");
      }

      if (!response.ok || body.error) {
        throw new Error(`Last.fm request failed: ${body.error ?? response.status} ${body.message ?? response.statusText}`);
      }

      return body;
    } catch (error) {
      if (error instanceof LastfmRateLimitError) throw error;
      if (attempt === maxRetries) throw error;

      const waitMs = 1000 * attempt;
      console.log(`Last.fm request attempt ${attempt} failed (${error.name ?? "Error"}). Retrying in ${waitMs / 1000}s...`);
      await sleep(waitMs);
    } finally {
      clearTimeout(timeout);
    }
  }

  throw new Error("Last.fm request failed after retries.");
}

class LastfmRateLimitError extends Error {
  constructor(message) {
    super(message);
    this.name = "LastfmRateLimitError";
  }
}

function normalizeTag(tag) {
  const name = typeof tag.name === "string" ? tag.name.trim().toLowerCase() : "";
  const count = Number(tag.count ?? 0);
  const url = typeof tag.url === "string" ? tag.url : undefined;

  if (!name) return undefined;
  return { name, count, url };
}

function filterTags(tags) {
  return tags
    .filter((tag) => tag.count >= minTagCount)
    .slice(0, maxTags)
    .map((tag) => tag.name);
}

function artistGenres(enriched) {
  return enriched.map((item) => ({
    artistName: item.artistName,
    lastfmArtistName: item.lastfmArtist?.correctedArtistName,
    matchStatus: item.lastfmArtist?.matchStatus,
    genreTags: item.genreTags,
    topLastfmTags: item.lastfmArtist?.tags?.slice(0, maxTags),
    totalStreams: item.totalStreams,
    totalMsPlayed: item.totalMsPlayed,
    totalHoursPlayed: hoursFor(item)
  }));
}

function buildEnrichedFromCache(candidates, cache) {
  return candidates
    .filter((candidate) => cache[candidate.artistName])
    .map((candidate) => {
      const lastfmArtist = cache[candidate.artistName];

      return {
        ...candidate,
        totalHoursPlayed: hoursFor(candidate),
        genreTags: filterTags(lastfmArtist.tags),
        genreSource: "lastfm",
        lastfmArtist
      };
    });
}

function writeOutputs(enriched) {
  writeJson(outputFile, enriched);
  writeJson(path.join(path.dirname(outputFile), "artist-genres.lastfm.json"), artistGenres(enriched));
}

function hoursFor(item) {
  if (typeof item.totalHoursPlayed === "number") return item.totalHoursPlayed;
  return Number(((item.totalMsPlayed ?? 0) / 3_600_000).toFixed(2));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
