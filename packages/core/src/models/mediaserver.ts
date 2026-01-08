/**
 * Unified Media Server Types
 * 
 * This module provides a common interface that abstracts differences between
 * Plex, Jellyfin, and Emby media servers.
 */

// Supported media server types
export type MediaServerType = 'plex' | 'jellyfin' | 'emby';

// Common authentication result
export interface MediaServerAuth {
  type: MediaServerType;
  userId: string;
  username: string;
  accessToken: string;
  serverId: string;
  serverName: string;
  serverAddress: string;
  email?: string;
  avatarUrl?: string;
}

// Common server info
export interface MediaServerInfo {
  id: string;
  type: MediaServerType;
  name: string;
  address: string;
  version?: string;
  accessToken: string;
  userId?: string;
  isOnline?: boolean;
}

// Common library type
export type MediaLibraryType = 'movies' | 'shows' | 'music' | 'photos' | 'other';

// Common library
export interface MediaLibrary {
  id: string;
  name: string;
  type: MediaLibraryType;
  itemCount?: number;
  primaryImageUrl?: string;
}

// Common media item type
export type MediaItemType = 'movie' | 'show' | 'season' | 'episode' | 'album' | 'track' | 'photo';

// Common media item
export interface MediaItem {
  id: string;
  type: MediaItemType;
  title: string;
  originalTitle?: string;
  overview?: string;
  year?: number;
  
  // Images (URLs or paths)
  posterUrl?: string;
  backdropUrl?: string;
  thumbUrl?: string;
  
  // Duration in milliseconds
  durationMs?: number;
  
  // Playback progress
  playbackPositionMs?: number;
  playCount?: number;
  lastPlayedAt?: Date;
  isPlayed?: boolean;
  
  // Timestamps
  addedAt?: Date;
  updatedAt?: Date;
  premiereDate?: Date;
  
  // Ratings
  communityRating?: number; // 0-10 scale
  criticRating?: number; // 0-100 scale
  contentRating?: string; // e.g., "PG-13", "TV-MA"
  
  // TV Show specific
  seriesId?: string;
  seriesName?: string;
  seasonId?: string;
  seasonNumber?: number;
  episodeNumber?: number;
  
  // Season specific
  episodeCount?: number;
  watchedEpisodeCount?: number;
  
  // External IDs
  externalIds?: {
    tmdb?: string;
    imdb?: string;
    tvdb?: string;
    [key: string]: string | undefined;
  };
  
  // Media info
  mediaInfo?: MediaInfo[];
  
  // Markers/Chapters
  markers?: MediaMarker[];
  
  // Source-specific data (for accessing original API data)
  sourceData?: unknown;
}

// Common media info
export interface MediaInfo {
  id: string;
  container?: string;
  bitrate?: number;
  durationMs?: number;
  width?: number;
  height?: number;
  aspectRatio?: number;
  videoCodec?: string;
  videoProfile?: string;
  audioCodec?: string;
  audioChannels?: number;
  streamUrl?: string;
  directPlaySupported?: boolean;
  directStreamSupported?: boolean;
  transcodingSupported?: boolean;
  parts?: MediaPart[];
}

// Common media part
export interface MediaPart {
  id: string;
  key: string;
  filePath?: string;
  size?: number;
  container?: string;
  durationMs?: number;
  streams?: MediaStream[];
}

// Common media stream
export interface MediaStream {
  id: string;
  type: 'video' | 'audio' | 'subtitle';
  codec?: string;
  language?: string;
  languageCode?: string;
  title?: string;
  displayTitle?: string;
  isDefault?: boolean;
  isForced?: boolean;
  isSelected?: boolean;
  
  // Video specific
  width?: number;
  height?: number;
  bitrate?: number;
  
  // Audio specific
  channels?: number;
  sampleRate?: number;
  
  // Subtitle specific
  isExternal?: boolean;
  isTextBased?: boolean;
}

// Common marker (intro/credits/chapter)
export interface MediaMarker {
  id?: string;
  type: 'intro' | 'credits' | 'chapter' | 'commercial' | 'recap';
  name?: string;
  startMs: number;
  endMs?: number;
}

// Library query options
export interface LibraryQueryOptions {
  parentId?: string;
  types?: MediaItemType[];
  sortBy?: 'name' | 'date_added' | 'release_date' | 'rating' | 'random';
  sortOrder?: 'asc' | 'desc';
  offset?: number;
  limit?: number;
  searchTerm?: string;
  isFavorite?: boolean;
  isPlayed?: boolean;
  includeMediaInfo?: boolean;
  includeExternalIds?: boolean;
}

// Query result
export interface LibraryQueryResult {
  items: MediaItem[];
  totalCount: number;
  offset: number;
}

// Playback session info
export interface PlaybackSession {
  itemId: string;
  mediaSourceId?: string;
  positionMs: number;
  isPaused: boolean;
  playMethod: 'direct' | 'directstream' | 'transcode';
  audioStreamIndex?: number;
  subtitleStreamIndex?: number;
}

// Interface for media server service implementations
export interface IMediaServerService {
  readonly serverType: MediaServerType;
  readonly serverInfo: MediaServerInfo;
  
  // Libraries
  getLibraries(): Promise<MediaLibrary[]>;
  getLibraryItems(libraryId: string, options?: LibraryQueryOptions): Promise<LibraryQueryResult>;
  
  // Metadata
  getItem(itemId: string, includeMediaInfo?: boolean): Promise<MediaItem | null>;
  getChildren(itemId: string, options?: LibraryQueryOptions): Promise<LibraryQueryResult>;
  getRelated(itemId: string): Promise<MediaItem[]>;
  
  // Hubs/Collections
  getContinueWatching(): Promise<MediaItem[]>;
  getRecentlyAdded(libraryId?: string): Promise<MediaItem[]>;
  getNextUp(): Promise<MediaItem[]>; // For TV shows
  
  // Search
  search(query: string, options?: LibraryQueryOptions): Promise<MediaItem[]>;
  findByExternalId(externalId: string, provider: 'tmdb' | 'imdb' | 'tvdb'): Promise<MediaItem[]>;
  
  // Playback
  getStreamUrl(itemId: string, mediaSourceId?: string): Promise<string>;
  getStreamHeaders(): Record<string, string>;
  reportPlaybackStart(session: PlaybackSession): Promise<void>;
  reportPlaybackProgress(session: PlaybackSession): Promise<void>;
  reportPlaybackStop(session: PlaybackSession): Promise<void>;
  
  // User data
  markAsPlayed(itemId: string): Promise<void>;
  markAsUnplayed(itemId: string): Promise<void>;
  toggleFavorite(itemId: string, isFavorite: boolean): Promise<void>;
  
  // Images
  getImageUrl(itemId: string, imageType: 'poster' | 'backdrop' | 'thumb', options?: {
    width?: number;
    height?: number;
    quality?: number;
  }): string;
}

// Interface for media server authentication
export interface IMediaServerAuth {
  readonly serverType: MediaServerType;
  
  // Server discovery
  testConnection(address: string): Promise<MediaServerInfo | null>;
  
  // Authentication
  authenticate(options: {
    address: string;
    username: string;
    password: string;
  }): Promise<MediaServerAuth>;
  
  // For servers that support API key auth (Jellyfin/Emby)
  authenticateWithApiKey?(options: {
    address: string;
    apiKey: string;
  }): Promise<MediaServerAuth>;
  
  // Validate existing auth
  validateAuth(auth: MediaServerAuth): Promise<boolean>;
  
  // Sign out
  signOut(auth: MediaServerAuth): Promise<void>;
}

/**
 * Helper to convert ticks to milliseconds
 * Jellyfin/Emby use ticks (1 tick = 100 nanoseconds = 0.0001 milliseconds)
 */
export function ticksToMs(ticks: number | undefined): number | undefined {
  if (ticks === undefined) return undefined;
  return Math.floor(ticks / 10000);
}

/**
 * Helper to convert milliseconds to ticks
 */
export function msToTicks(ms: number | undefined): number | undefined {
  if (ms === undefined) return undefined;
  return ms * 10000;
}

/**
 * Helper to map library types between different server formats
 */
export function normalizeLibraryType(
  serverType: MediaServerType,
  type: string
): MediaLibraryType {
  if (serverType === 'plex') {
    switch (type) {
      case 'movie': return 'movies';
      case 'show': return 'shows';
      case 'artist': return 'music';
      case 'photo': return 'photos';
      default: return 'other';
    }
  } else {
    // Jellyfin/Emby
    switch (type?.toLowerCase()) {
      case 'movies': return 'movies';
      case 'tvshows': return 'shows';
      case 'music': return 'music';
      case 'photos':
      case 'homevideos': return 'photos';
      default: return 'other';
    }
  }
}

/**
 * Helper to map media item types between different server formats
 */
export function normalizeMediaItemType(
  serverType: MediaServerType,
  type: string
): MediaItemType {
  if (serverType === 'plex') {
    switch (type) {
      case 'movie': return 'movie';
      case 'show': return 'show';
      case 'season': return 'season';
      case 'episode': return 'episode';
      default: return 'movie';
    }
  } else {
    // Jellyfin/Emby
    switch (type) {
      case 'Movie': return 'movie';
      case 'Series': return 'show';
      case 'Season': return 'season';
      case 'Episode': return 'episode';
      case 'MusicAlbum': return 'album';
      case 'Audio': return 'track';
      case 'Photo': return 'photo';
      default: return 'movie';
    }
  }
}
