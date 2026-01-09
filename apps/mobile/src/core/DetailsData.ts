/**
 * Details screen data fetchers using FlixorCore
 * Replaces the old api/data.ts functions for Details screen
 */

import { getFlixorCore } from './index';
import type { PlexMediaItem } from '@flixor/core';

export type RowItem = {
  id: string;
  title: string;
  image?: string;
  mediaType?: 'movie' | 'tv';
};

// ============================================
// Media Metadata (Unified for all server types)
// ============================================

/**
 * Fetch metadata for an item - works for Plex, Jellyfin, and Emby
 */
export async function fetchPlexMetadata(ratingKey: string): Promise<PlexMediaItem | null> {
  try {
    const core = getFlixorCore();
    const serverType = core.activeServerType;
    
    if (serverType === 'jellyfin' && core.isJellyfinServerConnected) {
      const item = await core.jellyfinServerService.getItem(ratingKey, true);
      if (!item) return null;
      // Convert MediaItem to PlexMediaItem-compatible format
      return convertMediaItemToPlexFormat(item, 'jellyfin');
    } else if (serverType === 'emby' && core.isEmbyServerConnected) {
      const item = await core.embyServerService.getItem(ratingKey, true);
      if (!item) return null;
      return convertMediaItemToPlexFormat(item, 'emby');
    } else {
      // Plex
      return await core.plexServer.getMetadata(ratingKey);
    }
  } catch (e) {
    console.log('[DetailsData] fetchPlexMetadata error:', e);
    return null;
  }
}

/**
 * Convert MediaItem (Jellyfin/Emby) to PlexMediaItem format for UI compatibility
 */
function convertMediaItemToPlexFormat(item: any, source: 'jellyfin' | 'emby'): PlexMediaItem {
  return {
    ratingKey: item.id,
    key: item.id,
    type: item.type === 'episode' ? 'episode' : item.type === 'series' ? 'show' : item.type,
    title: item.name || item.title,
    grandparentTitle: item.seriesName,
    grandparentThumb: item.seriesThumb,
    parentTitle: item.seasonName,
    parentIndex: item.seasonNumber,
    index: item.episodeNumber,
    year: item.year,
    thumb: item.posterPath,
    art: item.backdropPath,
    summary: item.overview,
    duration: item.runTimeMs,
    viewOffset: item.playbackPositionMs,
    viewCount: item.played ? 1 : 0,
    addedAt: item.dateAdded ? Math.floor(new Date(item.dateAdded).getTime() / 1000) : undefined,
    contentRating: item.officialRating,
    rating: item.communityRating,
    audienceRating: item.communityRating,
    Genre: item.genres?.map((g: string) => ({ tag: g })) || [],
    Director: item.directors?.map((d: string) => ({ tag: d })) || [],
    Role: item.actors?.map((a: any) => ({
      tag: typeof a === 'string' ? a : a.name,
      thumb: typeof a === 'object' ? a.thumb : undefined,
    })) || [],
    Guid: [
      ...(item.tmdbId ? [{ id: `tmdb://${item.tmdbId}` }] : []),
      ...(item.imdbId ? [{ id: `imdb://${item.imdbId}` }] : []),
      ...(item.tvdbId ? [{ id: `tvdb://${item.tvdbId}` }] : []),
    ],
    // Store source info for routing and image URLs
    _source: source,
    _originalItem: item,
  } as any;
}

export async function fetchPlexSeasons(showRatingKey: string): Promise<PlexMediaItem[]> {
  try {
    const core = getFlixorCore();
    const serverType = core.activeServerType;
    
    if (serverType === 'jellyfin' && core.isJellyfinServerConnected) {
      const result = await core.jellyfinServerService.getChildren(showRatingKey);
      const seasons = result.items.filter((c: any) => c.type === 'season');
      return seasons.map((s: any) => convertMediaItemToPlexFormat(s, 'jellyfin'));
    } else if (serverType === 'emby' && core.isEmbyServerConnected) {
      const result = await core.embyServerService.getChildren(showRatingKey);
      const seasons = result.items.filter((c: any) => c.type === 'season');
      return seasons.map((s: any) => convertMediaItemToPlexFormat(s, 'emby'));
    } else {
      const children = await core.plexServer.getChildren(showRatingKey);
      let seasons = children.filter((c: PlexMediaItem) => c.type === 'season');
      if (!seasons.length) {
        seasons = children;
      }
      return seasons;
    }
  } catch (e) {
    console.log('[DetailsData] fetchPlexSeasons error:', e);
    return [];
  }
}

export async function fetchPlexSeasonEpisodes(seasonRatingKey: string): Promise<PlexMediaItem[]> {
  try {
    const core = getFlixorCore();
    const serverType = core.activeServerType;
    
    if (serverType === 'jellyfin' && core.isJellyfinServerConnected) {
      const result = await core.jellyfinServerService.getChildren(seasonRatingKey);
      return result.items.map((e: any) => convertMediaItemToPlexFormat(e, 'jellyfin'));
    } else if (serverType === 'emby' && core.isEmbyServerConnected) {
      const result = await core.embyServerService.getChildren(seasonRatingKey);
      return result.items.map((e: any) => convertMediaItemToPlexFormat(e, 'emby'));
    } else {
      return await core.plexServer.getChildren(seasonRatingKey);
    }
  } catch (e) {
    console.log('[DetailsData] fetchPlexSeasonEpisodes error:', e);
    return [];
  }
}

// ============================================
// TMDB Details and Images
// ============================================

export async function fetchTmdbDetails(mediaType: 'movie' | 'tv', tmdbId: number): Promise<any> {
  try {
    const core = getFlixorCore();
    if (mediaType === 'movie') {
      return await core.tmdb.getMovieDetails(tmdbId);
    } else {
      return await core.tmdb.getTVDetails(tmdbId);
    }
  } catch (e) {
    console.log('[DetailsData] fetchTmdbDetails error:', e);
    return null;
  }
}

export async function fetchTmdbLogo(mediaType: 'movie' | 'tv', tmdbId: number): Promise<string | undefined> {
  try {
    const core = getFlixorCore();
    const images = mediaType === 'movie'
      ? await core.tmdb.getMovieImages(tmdbId)
      : await core.tmdb.getTVImages(tmdbId);

    const logos = images.logos || [];
    const logo = logos.find((l: any) => l.iso_639_1 === 'en') || logos[0];
    if (logo?.file_path) {
      return core.tmdb.getImageUrl(logo.file_path, 'w500');
    }
    return undefined;
  } catch (e) {
    console.log('[DetailsData] fetchTmdbLogo error:', e);
    return undefined;
  }
}

export async function fetchTmdbCredits(mediaType: 'movie' | 'tv', tmdbId: number): Promise<{ cast: any[]; crew: any[] }> {
  try {
    const core = getFlixorCore();
    const credits = mediaType === 'movie'
      ? await core.tmdb.getMovieCredits(tmdbId)
      : await core.tmdb.getTVCredits(tmdbId);

    return {
      cast: (credits.cast || []).slice(0, 16),
      crew: (credits.crew || []).slice(0, 16),
    };
  } catch (e) {
    console.log('[DetailsData] fetchTmdbCredits error:', e);
    return { cast: [], crew: [] };
  }
}

// ============================================
// TMDB Seasons and Episodes
// ============================================

export async function fetchTmdbSeasonsList(tvId: number): Promise<Array<{ key: string; title: string; season_number: number }>> {
  try {
    const core = getFlixorCore();
    const details = await core.tmdb.getTVDetails(tvId);
    const seasons = details.seasons || [];

    return seasons
      .filter((s: any) => (s?.season_number ?? 0) > 0)
      .map((s: any) => ({
        key: String(s.season_number),
        title: `Season ${s.season_number}`,
        season_number: s.season_number,
      }));
  } catch (e) {
    console.log('[DetailsData] fetchTmdbSeasonsList error:', e);
    return [];
  }
}

export async function fetchTmdbSeasonEpisodes(tvId: number, seasonNumber: number): Promise<any[]> {
  try {
    const core = getFlixorCore();
    const seasonDetails = await core.tmdb.getSeasonDetails(tvId, seasonNumber);
    return seasonDetails.episodes || [];
  } catch (e) {
    console.log('[DetailsData] fetchTmdbSeasonEpisodes error:', e);
    return [];
  }
}

// ============================================
// TMDB Recommendations and Similar
// ============================================

export async function fetchTmdbRecommendations(mediaType: 'movie' | 'tv', tmdbId: number): Promise<RowItem[]> {
  try {
    const core = getFlixorCore();
    const data = mediaType === 'movie'
      ? await core.tmdb.getMovieRecommendations(tmdbId)
      : await core.tmdb.getTVRecommendations(tmdbId);

    const results = data.results || [];
    return results.slice(0, 12).map((r: any) => ({
      id: `tmdb:${mediaType}:${r.id}`,
      title: r.title || r.name || 'Untitled',
      image: r.poster_path ? core.tmdb.getPosterUrl(r.poster_path, 'w342') : undefined,
      mediaType,
    }));
  } catch (e) {
    console.log('[DetailsData] fetchTmdbRecommendations error:', e);
    return [];
  }
}

export async function fetchTmdbSimilar(mediaType: 'movie' | 'tv', tmdbId: number): Promise<RowItem[]> {
  try {
    const core = getFlixorCore();
    const data = mediaType === 'movie'
      ? await core.tmdb.getSimilarMovies(tmdbId)
      : await core.tmdb.getSimilarTV(tmdbId);

    const results = data.results || [];
    return results.slice(0, 12).map((r: any) => ({
      id: `tmdb:${mediaType}:${r.id}`,
      title: r.title || r.name || 'Untitled',
      image: r.poster_path ? core.tmdb.getPosterUrl(r.poster_path, 'w342') : undefined,
      mediaType,
    }));
  } catch (e) {
    console.log('[DetailsData] fetchTmdbSimilar error:', e);
    return [];
  }
}

// ============================================
// TMDB to Plex Mapping
// ============================================

function normalizeTitle(s: string): string {
  const base = (s || '').toLowerCase();
  const noArticles = base.replace(/^(the|a|an)\s+/i, '');
  const noDiacritics = noArticles.normalize('NFD').replace(/\p{Diacritic}+/gu, '');
  return noDiacritics.replace(/[^a-z0-9]+/g, '');
}

export async function mapTmdbToPlex(
  mediaType: 'movie' | 'tv',
  tmdbId: string,
  title?: string,
  year?: string
): Promise<PlexMediaItem | null> {
  try {
    const core = getFlixorCore();
    const serverType = core.activeServerType;
    const typeNum = mediaType === 'movie' ? 1 : 2;
    const hits: PlexMediaItem[] = [];

    // Store external IDs for later matching
    let imdbId: string | undefined;
    let tvdbId: number | undefined;

    // 1) First, get TMDB details to get title and external IDs
    try {
      const details = mediaType === 'movie'
        ? await core.tmdb.getMovieDetails(Number(tmdbId))
        : await core.tmdb.getTVDetails(Number(tmdbId));

      // Get external IDs
      const externalIds = (details as any)?.external_ids;
      imdbId = externalIds?.imdb_id;
      tvdbId = externalIds?.tvdb_id;

      // Extract title/year if not provided
      if (!title) {
        title = (details as any)?.title || (details as any)?.name;
      }
      if (!year) {
        const releaseDate = (details as any)?.release_date || (details as any)?.first_air_date;
        if (releaseDate) {
          year = releaseDate.slice(0, 4);
        }
      }
    } catch (e) {
      console.log('[DetailsData] Failed to get TMDB details:', e);
    }

    // 2) Search media server by title
    if (title) {
      try {
        console.log(`[DetailsData] Searching ${serverType} for: "${title}"`);
        
        if (serverType === 'jellyfin' && core.isJellyfinServerConnected) {
          const result = await core.jellyfinServerService.search(title, mediaType === 'movie' ? 'movie' : 'series');
          for (const item of result.items) {
            hits.push(convertMediaItemToPlexFormat(item, 'jellyfin'));
          }
        } else if (serverType === 'emby' && core.isEmbyServerConnected) {
          const result = await core.embyServerService.search(title, mediaType === 'movie' ? 'movie' : 'series');
          for (const item of result.items) {
            hits.push(convertMediaItemToPlexFormat(item, 'emby'));
          }
        } else {
          // Plex
          const searchResults = await core.plexServer.search(title, typeNum);
          console.log(`[DetailsData] Search returned ${searchResults.length} results`);
          if (searchResults.length > 0) {
            hits.push(...searchResults);
          }
        }
      } catch (e) {
        console.log('[DetailsData] Typed search failed:', e);
      }

      // Try untyped search if no results (Plex only)
      if (hits.length === 0 && serverType === 'plex') {
        try {
          const searchResults = await core.plexServer.search(title);
          console.log(`[DetailsData] Untyped search returned ${searchResults.length} results`);
          if (searchResults.length > 0) {
            hits.push(...searchResults);
          }
        } catch (e) {
          console.log('[DetailsData] Untyped search failed:', e);
        }
      }
    }

    if (hits.length === 0) {
      console.log(`[DetailsData] No ${serverType} matches found for:`, { tmdbId, title, year });
      return null;
    }

    // Deduplicate by ratingKey
    const unique = Array.from(
      new Map(hits.map((h) => [String(h.ratingKey), h])).values()
    );
    console.log(`[DetailsData] Found ${unique.length} unique items`);

    // 3) Selection policy - match by GUID from search results
    // a) Exact TMDB GUID match
    for (const h of unique) {
      const guids = extractGuidsFromItem(h);
      if (guids.includes(`tmdb://${tmdbId}`)) {
        console.log(`[DetailsData] Matched by TMDB GUID: ${h.ratingKey}`);
        return h;
      }
    }

    // b) IMDB GUID match
    if (imdbId) {
      for (const h of unique) {
        const guids = extractGuidsFromItem(h);
        if (guids.includes(`imdb://${imdbId}`)) {
          console.log(`[DetailsData] Matched by IMDB GUID: ${h.ratingKey}`);
          return h;
        }
      }
    }

    // c) TVDB GUID match (for TV shows)
    if (tvdbId && mediaType === 'tv') {
      for (const h of unique) {
        const guids = extractGuidsFromItem(h);
        if (guids.includes(`tvdb://${tvdbId}`)) {
          console.log(`[DetailsData] Matched by TVDB GUID: ${h.ratingKey}`);
          return h;
        }
      }
    }

    // d) Normalized title + same/near year (±1)
    if (title) {
      const nTitle = normalizeTitle(title);
      const yy = Number(year || 0);
      for (const h of unique) {
        const t = normalizeTitle(h.title || (h as any).grandparentTitle || '');
        const y = Number(h.year || 0);
        const yearOk = !yy || y === yy || y === yy - 1 || y === yy + 1;
        if (t === nTitle && yearOk) {
          console.log(`[DetailsData] Matched by title+year: ${h.ratingKey} (${h.title} ${h.year})`);
          return h;
        }
      }
    }

    // e) Fallback: first item
    console.log(`[DetailsData] Fallback to first result: ${unique[0]?.ratingKey}`);
    return unique[0] || null;
  } catch (e) {
    console.log('[DetailsData] mapTmdbToPlex error:', e);
    return null;
  }
}

/**
 * Extract all GUIDs from a Plex item (handles different formats)
 */
function extractGuidsFromItem(item: PlexMediaItem): string[] {
  const guids: string[] = [];

  // Check Guid array (modern Plex format)
  if (Array.isArray((item as any).Guid)) {
    for (const g of (item as any).Guid) {
      const id = String(g.id || '');
      if (id) guids.push(id);
    }
  }

  // Check guid field (older format)
  if ((item as any).guid) {
    const guid = String((item as any).guid);
    // Extract embedded GUIDs from plex:// format
    if (guid.includes('tmdb://')) {
      const match = guid.match(/tmdb:\/\/(\d+)/);
      if (match) guids.push(`tmdb://${match[1]}`);
    }
    if (guid.includes('imdb://')) {
      const match = guid.match(/imdb:\/\/([a-z0-9]+)/i);
      if (match) guids.push(`imdb://${match[1]}`);
    }
    if (guid.includes('tvdb://')) {
      const match = guid.match(/tvdb:\/\/(\d+)/);
      if (match) guids.push(`tvdb://${match[1]}`);
    }
    if (guid.includes('themoviedb://')) {
      const match = guid.match(/themoviedb:\/\/(\d+)/);
      if (match) guids.push(`tmdb://${match[1]}`);
    }
  }

  return guids;
}

// ============================================
// TMDB Videos/Trailers
// ============================================

// Supported video types (ordered by priority)
const VIDEO_TYPES = ['Trailer', 'Teaser', 'Clip', 'Featurette', 'Behind the Scenes'];

export interface TrailerInfo {
  key: string;
  name: string;
  site: string;
  type: string;
  official?: boolean;
  publishedAt?: string;
}

export async function fetchTmdbTrailers(
  mediaType: 'movie' | 'tv',
  tmdbId: number
): Promise<TrailerInfo[]> {
  try {
    const core = getFlixorCore();
    const videos = mediaType === 'movie'
      ? await core.tmdb.getMovieVideos(tmdbId)
      : await core.tmdb.getTVVideos(tmdbId);

    const results = videos.results || [];

    // Filter for YouTube videos of supported types
    const trailers = results
      .filter((v: any) => v.site === 'YouTube' && VIDEO_TYPES.includes(v.type))
      .sort((a: any, b: any) => {
        // Prioritize official videos
        if (a.official && !b.official) return -1;
        if (!a.official && b.official) return 1;
        // Then by type priority
        const aTypeIndex = VIDEO_TYPES.indexOf(a.type);
        const bTypeIndex = VIDEO_TYPES.indexOf(b.type);
        if (aTypeIndex !== bTypeIndex) return aTypeIndex - bTypeIndex;
        // Then by publish date (newest first)
        if (a.published_at && b.published_at) {
          return new Date(b.published_at).getTime() - new Date(a.published_at).getTime();
        }
        return 0;
      })
      .map((v: any) => ({
        key: v.key,
        name: v.name,
        site: v.site,
        type: v.type,
        official: v.official,
        publishedAt: v.published_at,
      }));

    return trailers;
  } catch (e) {
    console.log('[DetailsData] fetchTmdbTrailers error:', e);
    return [];
  }
}

export function getYouTubeUrl(videoKey: string): string {
  return `https://www.youtube.com/watch?v=${videoKey}`;
}

export function getYouTubeThumbnailUrl(videoKey: string): string {
  return `https://img.youtube.com/vi/${videoKey}/hqdefault.jpg`;
}

// ============================================
// Image URLs (Unified for all server types)
// ============================================

export function getPlexImageUrl(path: string | undefined, width: number = 300, itemId?: string): string {
  if (!path && !itemId) return '';
  try {
    const core = getFlixorCore();
    const serverType = core.activeServerType;
    
    if (serverType === 'jellyfin' && core.isJellyfinServerConnected && itemId) {
      return core.jellyfinServerService.getImageUrl(itemId, 'poster', { width });
    } else if (serverType === 'emby' && core.isEmbyServerConnected && itemId) {
      return core.embyServerService.getImageUrl(itemId, 'poster', { width });
    } else if (path) {
      return core.plexServer.getImageUrl(path, width);
    }
    return '';
  } catch {
    return '';
  }
}

export function getTmdbImageUrl(path: string | undefined, size: string = 'w780'): string {
  if (!path) return '';
  try {
    const core = getFlixorCore();
    return core.tmdb.getImageUrl(path, size);
  } catch {
    return '';
  }
}

export function getTmdbProfileUrl(path: string | undefined): string {
  if (!path) return '';
  try {
    const core = getFlixorCore();
    return core.tmdb.getProfileUrl(path, 'w185');
  } catch {
    return '';
  }
}

// ============================================
// Helper: Extract TMDB ID from Plex Guids
// ============================================

export function extractTmdbIdFromGuids(guids: any[]): string | null {
  if (!Array.isArray(guids)) return null;
  for (const g of guids) {
    const id = String(g.id || '');
    if (id.includes('tmdb://') || id.includes('themoviedb://')) {
      return id.split('://')[1];
    }
  }
  return null;
}

// ============================================
// Helper: Extract IMDB ID from Plex Guids
// ============================================

export function extractImdbIdFromGuids(guids: any[]): string | null {
  if (!Array.isArray(guids)) return null;
  for (const g of guids) {
    const id = String(g.id || '');
    if (id.includes('imdb://')) {
      return id.split('://')[1];
    }
  }
  return null;
}

// ============================================
// Person Data
// ============================================

export interface PersonInfo {
  id: number;
  name: string;
  biography?: string;
  birthday?: string;
  deathday?: string;
  placeOfBirth?: string;
  profilePath?: string;
  knownFor?: string;
}

export interface PersonCredit {
  id: number;
  title: string;
  posterPath?: string;
  mediaType: 'movie' | 'tv';
  character?: string;
  job?: string;
  year?: string;
  voteAverage?: number;
}

export async function fetchPersonDetails(personId: number): Promise<PersonInfo | null> {
  try {
    const core = getFlixorCore();
    const person = await core.tmdb.getPersonDetails(personId);

    return {
      id: person.id,
      name: person.name,
      biography: person.biography,
      birthday: person.birthday,
      deathday: person.deathday,
      placeOfBirth: person.place_of_birth,
      profilePath: person.profile_path,
      knownFor: person.known_for_department,
    };
  } catch (e) {
    console.log('[DetailsData] fetchPersonDetails error:', e);
    return null;
  }
}

export async function fetchPersonCredits(personId: number): Promise<PersonCredit[]> {
  try {
    const core = getFlixorCore();
    const credits = await core.tmdb.getPersonCredits(personId);

    // Combine cast and crew, dedupe by id+media_type
    const allCredits: PersonCredit[] = [];
    const seen = new Set<string>();

    // Process cast credits
    for (const item of credits.cast || []) {
      const key = `${item.media_type}:${item.id}`;
      if (seen.has(key)) continue;
      seen.add(key);

      allCredits.push({
        id: item.id,
        title: item.title || item.name || 'Untitled',
        posterPath: item.poster_path,
        mediaType: item.media_type,
        character: item.character,
        year: (item.release_date || item.first_air_date || '').slice(0, 4),
        voteAverage: item.vote_average,
      });
    }

    // Process crew credits (if not already added as cast)
    for (const item of credits.crew || []) {
      const key = `${item.media_type}:${item.id}`;
      if (seen.has(key)) continue;
      seen.add(key);

      allCredits.push({
        id: item.id,
        title: item.title || item.name || 'Untitled',
        posterPath: item.poster_path,
        mediaType: item.media_type,
        job: item.job,
        year: (item.release_date || item.first_air_date || '').slice(0, 4),
        voteAverage: item.vote_average,
      });
    }

    // Sort by popularity (vote_average as proxy)
    allCredits.sort((a, b) => (b.voteAverage || 0) - (a.voteAverage || 0));

    return allCredits.slice(0, 20); // Top 20 credits
  } catch (e) {
    console.log('[DetailsData] fetchPersonCredits error:', e);
    return [];
  }
}

export function getPersonProfileUrl(profilePath: string | undefined, size: string = 'w185'): string {
  if (!profilePath) return '';
  try {
    const core = getFlixorCore();
    return core.tmdb.getProfileUrl(profilePath, size);
  } catch {
    return '';
  }
}

// ============================================
// Next Up Episode for TV Shows
// ============================================

export interface NextUpEpisode {
  ratingKey: string;
  title: string;
  seasonNumber: number;
  episodeNumber: number;
  thumb?: string;
  progress: number; // 0-100
  status: 'in-progress' | 'next-unwatched' | 'all-watched';
}

/**
 * Get the next episode to watch for a TV show
 * Priority:
 * 1. Episode currently in progress (has viewOffset but not completed)
 * 2. First unwatched episode
 * 3. If all watched, returns first episode for "Rewatch"
 * Supports Plex, Jellyfin, and Emby servers
 */
export async function getNextUpEpisode(
  showRatingKey: string,
  allSeasons: any[]
): Promise<NextUpEpisode | null> {
  try {
    const core = getFlixorCore();
    const serverType = core.activeServerType;

    // First, check on-deck/continue watching for this show
    try {
      let onDeck: any[] = [];
      
      if (serverType === 'jellyfin' && core.isJellyfinServerConnected) {
        const result = await core.jellyfinServerService.getContinueWatching();
        onDeck = result.items;
      } else if (serverType === 'emby' && core.isEmbyServerConnected) {
        const result = await core.embyServerService.getContinueWatching();
        onDeck = result.items;
      } else {
        onDeck = await core.plexServer.getOnDeck();
      }
      
      const showOnDeck = onDeck.find((item: any) => {
        if (serverType === 'jellyfin' || serverType === 'emby') {
          return item.type === 'episode' && 
            (item.seriesId === showRatingKey || String(item.seriesId) === String(showRatingKey));
        }
        return item.type === 'episode' &&
          (item.grandparentRatingKey === showRatingKey ||
            String(item.grandparentRatingKey) === String(showRatingKey));
      });

      if (showOnDeck) {
        let progress = 0;
        if (serverType === 'jellyfin' || serverType === 'emby') {
          progress = showOnDeck.playbackPositionMs && showOnDeck.runTimeMs
            ? Math.round((showOnDeck.playbackPositionMs / showOnDeck.runTimeMs) * 100)
            : 0;
          return {
            ratingKey: String(showOnDeck.id),
            title: showOnDeck.name || 'Episode',
            seasonNumber: showOnDeck.seasonNumber || 1,
            episodeNumber: showOnDeck.episodeNumber || 1,
            thumb: showOnDeck.posterPath,
            progress,
            status: 'in-progress',
          };
        } else {
          progress = showOnDeck.viewOffset && showOnDeck.duration
            ? Math.round((showOnDeck.viewOffset / showOnDeck.duration) * 100)
            : 0;
          return {
            ratingKey: String(showOnDeck.ratingKey),
            title: showOnDeck.title || 'Episode',
            seasonNumber: showOnDeck.parentIndex || 1,
            episodeNumber: showOnDeck.index || 1,
            thumb: showOnDeck.thumb,
            progress,
            status: 'in-progress',
          };
        }
      }
    } catch (e) {
      console.log('[DetailsData] getOnDeck failed, falling back to episode scan:', e);
    }

    // Fallback: scan through all seasons/episodes to find next up
    let firstEpisode: NextUpEpisode | null = null;
    let firstUnwatched: NextUpEpisode | null = null;
    let inProgress: NextUpEpisode | null = null;

    for (const season of allSeasons) {
      const seasonRk = season.ratingKey || season.key || season.id;
      if (!seasonRk) continue;

      // Skip specials (season 0)
      const seasonNum = season.index || season.parentIndex || season.seasonNumber || parseInt(season.key) || 0;
      if (seasonNum === 0) continue;

      try {
        let episodes: any[] = [];
        
        if (serverType === 'jellyfin' && core.isJellyfinServerConnected) {
          const result = await core.jellyfinServerService.getChildren(String(seasonRk));
          episodes = result.items;
        } else if (serverType === 'emby' && core.isEmbyServerConnected) {
          const result = await core.embyServerService.getChildren(String(seasonRk));
          episodes = result.items;
        } else {
          episodes = await core.plexServer.getChildren(String(seasonRk));
        }

        for (const ep of episodes) {
          let epNum: number, viewOffset: number, duration: number, viewCount: number, ratingKey: string, title: string, thumb: string | undefined;
          
          if (serverType === 'jellyfin' || serverType === 'emby') {
            epNum = ep.episodeNumber || ep.index || 1;
            viewOffset = ep.playbackPositionMs || 0;
            duration = ep.runTimeMs || 1;
            viewCount = ep.played ? 1 : 0;
            ratingKey = String(ep.id);
            title = ep.name || `Episode ${epNum}`;
            thumb = ep.posterPath;
          } else {
            epNum = ep.index || 1;
            viewOffset = ep.viewOffset || 0;
            duration = ep.duration || 1;
            viewCount = ep.viewCount || 0;
            ratingKey = String(ep.ratingKey);
            title = ep.title || `Episode ${epNum}`;
            thumb = ep.thumb;
          }
          
          const progress = Math.round((viewOffset / duration) * 100);
          const isCompleted = viewCount > 0 || progress >= 95;

          const epInfo: NextUpEpisode = {
            ratingKey,
            title,
            seasonNumber: seasonNum,
            episodeNumber: epNum,
            thumb,
            progress,
            status: 'next-unwatched',
          };

          // Track first episode for rewatch
          if (!firstEpisode) {
            firstEpisode = { ...epInfo, status: 'all-watched' };
          }

          // Check for in-progress episode (has progress but not completed)
          if (viewOffset > 0 && !isCompleted && !inProgress) {
            inProgress = { ...epInfo, status: 'in-progress' };
          }

          // Check for first unwatched episode
          if (!isCompleted && !firstUnwatched) {
            firstUnwatched = epInfo;
          }

          // If we found an in-progress episode, we can stop
          if (inProgress) break;
        }

        if (inProgress) break;
      } catch (e) {
        console.log(`[DetailsData] Failed to fetch episodes for season ${seasonRk}:`, e);
      }
    }

    // Return in priority order
    if (inProgress) return inProgress;
    if (firstUnwatched) return firstUnwatched;
    if (firstEpisode) return firstEpisode; // All watched - offer rewatch

    return null;
  } catch (e) {
    console.log('[DetailsData] getNextUpEpisode error:', e);
    return null;
  }
}

// ============================================
// Watchlist Functions
// ============================================

export interface WatchlistIds {
  tmdbId?: number;
  imdbId?: string;
  plexRatingKey?: string;
  mediaType: 'movie' | 'tv';
}

/**
 * Check if item is in Plex watchlist
 */
export async function isInPlexWatchlist(ratingKey: string): Promise<boolean> {
  try {
    const core = getFlixorCore();
    return await core.plexTv.isInWatchlist(ratingKey);
  } catch (e) {
    console.log('[DetailsData] isInPlexWatchlist error:', e);
    return false;
  }
}

/**
 * Check if item is in Trakt watchlist
 */
export async function isInTraktWatchlist(ids: WatchlistIds): Promise<boolean> {
  try {
    const core = getFlixorCore();
    if (!core.isTraktAuthenticated) return false;

    const type = ids.mediaType === 'movie' ? 'movies' : 'shows';
    const watchlist = await core.trakt.getWatchlist(type);

    return watchlist.some((item: any) => {
      const mediaItem = ids.mediaType === 'movie' ? item.movie : item.show;
      if (!mediaItem?.ids) return false;

      if (ids.tmdbId && mediaItem.ids.tmdb === ids.tmdbId) return true;
      if (ids.imdbId && mediaItem.ids.imdb === ids.imdbId) return true;
      return false;
    });
  } catch (e) {
    console.log('[DetailsData] isInTraktWatchlist error:', e);
    return false;
  }
}

/**
 * Add item to Plex watchlist
 */
export async function addToPlexWatchlist(ratingKey: string): Promise<boolean> {
  try {
    const core = getFlixorCore();
    await core.plexTv.addToWatchlist(ratingKey);
    return true;
  } catch (e) {
    console.log('[DetailsData] addToPlexWatchlist error:', e);
    return false;
  }
}

/**
 * Remove item from Plex watchlist
 */
export async function removeFromPlexWatchlist(ratingKey: string): Promise<boolean> {
  try {
    const core = getFlixorCore();
    await core.plexTv.removeFromWatchlist(ratingKey);
    return true;
  } catch (e) {
    console.log('[DetailsData] removeFromPlexWatchlist error:', e);
    return false;
  }
}

/**
 * Add item to Trakt watchlist
 */
export async function addToTraktWatchlist(ids: WatchlistIds): Promise<boolean> {
  try {
    const core = getFlixorCore();
    if (!core.isTraktAuthenticated) return false;

    const idsObj: { tmdb?: number; imdb?: string } = {};
    if (ids.tmdbId) idsObj.tmdb = ids.tmdbId;
    if (ids.imdbId) idsObj.imdb = ids.imdbId;

    if (ids.mediaType === 'movie') {
      await core.trakt.addMovieToWatchlist({ ids: idsObj });
    } else {
      await core.trakt.addShowToWatchlist({ ids: idsObj });
    }
    return true;
  } catch (e) {
    console.log('[DetailsData] addToTraktWatchlist error:', e);
    return false;
  }
}

/**
 * Remove item from Trakt watchlist
 */
export async function removeFromTraktWatchlist(ids: WatchlistIds): Promise<boolean> {
  try {
    const core = getFlixorCore();
    if (!core.isTraktAuthenticated) return false;

    const idsObj: { tmdb?: number; imdb?: string } = {};
    if (ids.tmdbId) idsObj.tmdb = ids.tmdbId;
    if (ids.imdbId) idsObj.imdb = ids.imdbId;

    if (ids.mediaType === 'movie') {
      await core.trakt.removeMovieFromWatchlist({ ids: idsObj });
    } else {
      await core.trakt.removeShowFromWatchlist({ ids: idsObj });
    }
    return true;
  } catch (e) {
    console.log('[DetailsData] removeFromTraktWatchlist error:', e);
    return false;
  }
}

/**
 * Toggle watchlist status (add or remove based on current state)
 *
 * ADD behavior (respects user preference):
 * - If Trakt is NOT authenticated → always saves to Plex
 * - If Trakt IS authenticated → uses watchlistProvider setting (default: 'trakt')
 *
 * REMOVE behavior (keeps providers in sync):
 * - Always removes from BOTH Plex and Trakt to prevent orphaned entries
 */
export async function toggleWatchlist(
  ids: WatchlistIds,
  _provider: 'plex' | 'trakt' | 'both' = 'both'
): Promise<{ inWatchlist: boolean; success: boolean }> {
  try {
    const core = getFlixorCore();
    const { getAppSettings } = await import('./SettingsData');
    const settings = getAppSettings();

    let isInWatchlist = false;

    // Check current watchlist status from BOTH providers
    if (ids.plexRatingKey) {
      isInWatchlist = await isInPlexWatchlist(ids.plexRatingKey);
    }

    if (!isInWatchlist && core.isTraktAuthenticated && (ids.tmdbId || ids.imdbId)) {
      isInWatchlist = await isInTraktWatchlist(ids);
    }

    // Toggle
    if (isInWatchlist) {
      // REMOVE: Always remove from BOTH providers to keep them in sync
      let success = true;

      if (ids.plexRatingKey) {
        success = await removeFromPlexWatchlist(ids.plexRatingKey) && success;
      }

      if (core.isTraktAuthenticated && (ids.tmdbId || ids.imdbId)) {
        success = await removeFromTraktWatchlist(ids) && success;
      }

      return { inWatchlist: false, success };
    } else {
      // ADD: Save to determined provider only based on settings
      let targetProvider: 'plex' | 'trakt';

      if (!core.isTraktAuthenticated) {
        // Trakt not enabled, always use Plex
        targetProvider = 'plex';
      } else {
        // Trakt is enabled - use user preference (default: 'trakt')
        targetProvider = settings.watchlistProvider || 'trakt';
      }

      let success = false;

      if (targetProvider === 'trakt') {
        if (ids.tmdbId || ids.imdbId) {
          success = await addToTraktWatchlist(ids);
        } else {
          // Fallback to Plex if we don't have TMDB/IMDB IDs for Trakt
          console.log('[DetailsData] No TMDB/IMDB IDs for Trakt, falling back to Plex');
          if (ids.plexRatingKey) {
            success = await addToPlexWatchlist(ids.plexRatingKey);
          }
        }
      } else {
        // targetProvider === 'plex'
        if (ids.plexRatingKey) {
          success = await addToPlexWatchlist(ids.plexRatingKey);
        } else {
          // Fallback to Trakt if we don't have Plex rating key
          console.log('[DetailsData] No Plex rating key, falling back to Trakt');
          if (core.isTraktAuthenticated && (ids.tmdbId || ids.imdbId)) {
            success = await addToTraktWatchlist(ids);
          }
        }
      }

      return { inWatchlist: success, success };
    }
  } catch (e) {
    console.log('[DetailsData] toggleWatchlist error:', e);
    return { inWatchlist: false, success: false };
  }
}

/**
 * Check if item is in watchlist (either Plex or Trakt)
 */
export async function checkWatchlistStatus(ids: WatchlistIds): Promise<boolean> {
  try {
    const core = getFlixorCore();

    // Check Plex first
    if (ids.plexRatingKey) {
      const inPlex = await isInPlexWatchlist(ids.plexRatingKey);
      if (inPlex) return true;
    }

    // Check Trakt
    if (core.isTraktAuthenticated && (ids.tmdbId || ids.imdbId)) {
      const inTrakt = await isInTraktWatchlist(ids);
      if (inTrakt) return true;
    }

    return false;
  } catch (e) {
    console.log('[DetailsData] checkWatchlistStatus error:', e);
    return false;
  }
}
