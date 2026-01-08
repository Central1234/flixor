/**
 * JellyfinServerService
 * 
 * Service for communicating with a Jellyfin Media Server.
 * Provides methods for browsing libraries, fetching metadata,
 * searching, and managing playback state.
 */

import type { ICache } from '../storage/ICache';
import { CacheTTL } from '../storage/ICache';
import type {
  JellyfinServer,
  JellyfinLibrary,
  JellyfinMediaItem,
  JellyfinQueryResult,
  JellyfinLibraryOptions as JellyfinQueryOptions,
  JellyfinMediaSource,
  JellyfinMediaStream,
  JellyfinChapter,
  JellyfinMediaSegment,
} from '../models/jellyfin';
import type {
  IMediaServerService,
  MediaServerInfo,
  MediaLibrary,
  MediaItem,
  MediaMarker,
  MediaInfo,
  MediaPart,
  MediaStream,
  LibraryQueryOptions,
  LibraryQueryResult,
  PlaybackSession,
} from '../models/mediaserver';
import {
  ticksToMs,
  msToTicks,
  normalizeLibraryType,
  normalizeMediaItemType,
} from '../models/mediaserver';

export interface JellyfinServerConfig {
  server: JellyfinServer;
  clientName?: string;
  clientVersion?: string;
  deviceName?: string;
  deviceId: string;
  cache: ICache;
}

export class JellyfinServerService implements IMediaServerService {
  readonly serverType = 'jellyfin' as const;
  
  private server: JellyfinServer;
  private clientName: string;
  private clientVersion: string;
  private deviceName: string;
  private deviceId: string;
  private cache: ICache;
  private playSessionId?: string;

  constructor(config: JellyfinServerConfig) {
    this.server = config.server;
    this.clientName = config.clientName || 'Flixor';
    this.clientVersion = config.clientVersion || '1.0.0';
    this.deviceName = config.deviceName || 'Flixor Device';
    this.deviceId = config.deviceId;
    this.cache = config.cache;
  }

  get serverInfo(): MediaServerInfo {
    return {
      id: this.server.id,
      type: 'jellyfin',
      name: this.server.name,
      address: this.server.address,
      version: this.server.version,
      accessToken: this.server.accessToken,
      userId: this.server.userId,
      isOnline: true,
    };
  }

  /**
   * Get authorization header
   */
  private getAuthHeader(): string {
    const parts = [
      `MediaBrowser Client="${this.clientName}"`,
      `Device="${this.deviceName}"`,
      `DeviceId="${this.deviceId}"`,
      `Version="${this.clientVersion}"`,
      `Token="${this.server.accessToken}"`,
    ];
    return parts.join(', ');
  }

  /**
   * Get standard headers
   */
  getStreamHeaders(): Record<string, string> {
    return {
      'Authorization': this.getAuthHeader(),
    };
  }

  private getHeaders(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Authorization': this.getAuthHeader(),
    };
  }

  /**
   * Make a GET request with caching
   */
  private async get<T>(
    path: string,
    params?: Record<string, string | number | boolean | undefined>,
    ttl: number = CacheTTL.DYNAMIC
  ): Promise<T> {
    // Build query string
    const queryParams = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined) {
          queryParams.set(key, String(value));
        }
      });
    }
    const queryString = queryParams.toString();
    const fullPath = queryString ? `${path}?${queryString}` : path;

    const cacheKey = `jellyfin:${this.server.id}:${fullPath}`;

    // Check cache
    if (ttl > 0) {
      const cached = await this.cache.get<T>(cacheKey);
      if (cached) {
        return cached;
      }
    }

    const url = `${this.server.address}${fullPath}`;
    console.log('[JellyfinServerService] GET:', url);

    const response = await fetch(url, {
      method: 'GET',
      headers: this.getHeaders(),
    });

    if (!response.ok) {
      throw new Error(`Jellyfin API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();

    // Cache response
    if (ttl > 0) {
      await this.cache.set(cacheKey, data, ttl);
    }

    return data;
  }

  /**
   * Make a POST request
   */
  private async post<T>(
    path: string,
    body?: unknown
  ): Promise<T | void> {
    const url = `${this.server.address}${path}`;
    console.log('[JellyfinServerService] POST:', url);

    const response = await fetch(url, {
      method: 'POST',
      headers: this.getHeaders(),
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      throw new Error(`Jellyfin API error: ${response.status} ${response.statusText}`);
    }

    // Some endpoints return empty body
    const text = await response.text();
    if (text) {
      return JSON.parse(text);
    }
  }

  /**
   * Make a DELETE request
   */
  private async delete(path: string): Promise<void> {
    const url = `${this.server.address}${path}`;
    console.log('[JellyfinServerService] DELETE:', url);

    const response = await fetch(url, {
      method: 'DELETE',
      headers: this.getHeaders(),
    });

    if (!response.ok) {
      throw new Error(`Jellyfin API error: ${response.status} ${response.statusText}`);
    }
  }

  // ============================================
  // Libraries
  // ============================================

  async getLibraries(): Promise<MediaLibrary[]> {
    const data = await this.get<JellyfinQueryResult<JellyfinLibrary>>(
      `/Users/${this.server.userId}/Views`,
      undefined,
      CacheTTL.TRENDING
    );

    return data.Items.map((lib) => this.mapLibrary(lib));
  }

  async getLibraryItems(
    libraryId: string,
    options?: LibraryQueryOptions
  ): Promise<LibraryQueryResult> {
    const params: Record<string, string | number | boolean | undefined> = {
      ParentId: libraryId,
      Recursive: true,
      Fields: 'Overview,Genres,ProviderIds,MediaSources,UserData,PrimaryImageAspectRatio',
      EnableImageTypes: 'Primary,Backdrop,Thumb',
      ImageTypeLimit: 1,
      EnableTotalRecordCount: true,
      EnableUserData: true,
    };

    if (options?.types?.length) {
      params.IncludeItemTypes = this.mapItemTypesToJellyfin(options.types).join(',');
    }

    if (options?.sortBy) {
      params.SortBy = this.mapSortToJellyfin(options.sortBy);
      params.SortOrder = options.sortOrder === 'desc' ? 'Descending' : 'Ascending';
    }

    if (options?.offset !== undefined) {
      params.StartIndex = options.offset;
    }

    if (options?.limit !== undefined) {
      params.Limit = options.limit;
    }

    if (options?.searchTerm) {
      params.SearchTerm = options.searchTerm;
    }

    if (options?.isFavorite !== undefined) {
      params.IsFavorite = options.isFavorite;
    }

    if (options?.isPlayed !== undefined) {
      params.IsPlayed = options.isPlayed;
    }

    const data = await this.get<JellyfinQueryResult<JellyfinMediaItem>>(
      `/Users/${this.server.userId}/Items`,
      params,
      CacheTTL.SHORT
    );

    return {
      items: data.Items.map((item) => this.mapMediaItem(item)),
      totalCount: data.TotalRecordCount,
      offset: options?.offset || 0,
    };
  }

  // ============================================
  // Metadata
  // ============================================

  async getItem(itemId: string, includeMediaInfo = false): Promise<MediaItem | null> {
    const params: Record<string, string> = {
      Fields: 'Overview,Genres,ProviderIds,People,Studios,Tags,UserData,PrimaryImageAspectRatio',
    };

    if (includeMediaInfo) {
      params.Fields += ',MediaSources,MediaStreams,Chapters';
    }

    try {
      const item = await this.get<JellyfinMediaItem>(
        `/Users/${this.server.userId}/Items/${itemId}`,
        params,
        CacheTTL.TRENDING
      );

      return this.mapMediaItem(item);
    } catch {
      return null;
    }
  }

  async getChildren(
    itemId: string,
    options?: LibraryQueryOptions
  ): Promise<LibraryQueryResult> {
    const params: Record<string, string | number | boolean | undefined> = {
      ParentId: itemId,
      Fields: 'Overview,ProviderIds,MediaSources,UserData,PrimaryImageAspectRatio',
      EnableImageTypes: 'Primary,Backdrop,Thumb',
      ImageTypeLimit: 1,
      EnableTotalRecordCount: true,
      EnableUserData: true,
    };

    if (options?.offset !== undefined) {
      params.StartIndex = options.offset;
    }

    if (options?.limit !== undefined) {
      params.Limit = options.limit;
    }

    const data = await this.get<JellyfinQueryResult<JellyfinMediaItem>>(
      `/Users/${this.server.userId}/Items`,
      params,
      CacheTTL.DYNAMIC
    );

    return {
      items: data.Items.map((item) => this.mapMediaItem(item)),
      totalCount: data.TotalRecordCount,
      offset: options?.offset || 0,
    };
  }

  async getRelated(itemId: string): Promise<MediaItem[]> {
    const data = await this.get<JellyfinQueryResult<JellyfinMediaItem>>(
      `/Items/${itemId}/Similar`,
      {
        UserId: this.server.userId,
        Limit: 12,
        Fields: 'Overview,ProviderIds,UserData,PrimaryImageAspectRatio',
      },
      CacheTTL.TRENDING
    );

    return data.Items.map((item) => this.mapMediaItem(item));
  }

  // ============================================
  // Hubs/Collections
  // ============================================

  async getContinueWatching(): Promise<MediaItem[]> {
    const data = await this.get<JellyfinQueryResult<JellyfinMediaItem>>(
      `/Users/${this.server.userId}/Items/Resume`,
      {
        Limit: 20,
        Recursive: true,
        Fields: 'Overview,ProviderIds,MediaSources,UserData,PrimaryImageAspectRatio',
        EnableImageTypes: 'Primary,Backdrop,Thumb',
        ImageTypeLimit: 1,
        MediaTypes: 'Video',
      },
      CacheTTL.SHORT
    );

    return data.Items.map((item) => this.mapMediaItem(item));
  }

  async getRecentlyAdded(libraryId?: string): Promise<MediaItem[]> {
    const params: Record<string, string | number | boolean | undefined> = {
      Limit: 20,
      Recursive: true,
      Fields: 'Overview,ProviderIds,UserData,PrimaryImageAspectRatio',
      EnableImageTypes: 'Primary,Backdrop,Thumb',
      ImageTypeLimit: 1,
      SortBy: 'DateCreated',
      SortOrder: 'Descending',
      IncludeItemTypes: 'Movie,Episode',
    };

    if (libraryId) {
      params.ParentId = libraryId;
    }

    const data = await this.get<JellyfinQueryResult<JellyfinMediaItem>>(
      `/Users/${this.server.userId}/Items/Latest`,
      params,
      CacheTTL.DYNAMIC
    );

    // Latest endpoint returns array directly
    const items = Array.isArray(data) ? data : data.Items;
    return items.map((item: JellyfinMediaItem) => this.mapMediaItem(item));
  }

  async getNextUp(): Promise<MediaItem[]> {
    const data = await this.get<JellyfinQueryResult<JellyfinMediaItem>>(
      '/Shows/NextUp',
      {
        UserId: this.server.userId,
        Limit: 20,
        Fields: 'Overview,ProviderIds,MediaSources,UserData,PrimaryImageAspectRatio',
        EnableImageTypes: 'Primary,Backdrop,Thumb',
        ImageTypeLimit: 1,
      },
      CacheTTL.SHORT
    );

    return data.Items.map((item) => this.mapMediaItem(item));
  }

  // ============================================
  // Search
  // ============================================

  async search(query: string, options?: LibraryQueryOptions): Promise<MediaItem[]> {
    const params: Record<string, string | number | boolean | undefined> = {
      SearchTerm: query,
      Recursive: true,
      Fields: 'Overview,ProviderIds,UserData,PrimaryImageAspectRatio',
      EnableImageTypes: 'Primary,Backdrop,Thumb',
      ImageTypeLimit: 1,
      Limit: options?.limit || 50,
    };

    if (options?.types?.length) {
      params.IncludeItemTypes = this.mapItemTypesToJellyfin(options.types).join(',');
    } else {
      params.IncludeItemTypes = 'Movie,Series,Episode';
    }

    const data = await this.get<JellyfinQueryResult<JellyfinMediaItem>>(
      `/Users/${this.server.userId}/Items`,
      params,
      CacheTTL.SHORT
    );

    return data.Items.map((item) => this.mapMediaItem(item));
  }

  async findByExternalId(
    externalId: string,
    provider: 'tmdb' | 'imdb' | 'tvdb'
  ): Promise<MediaItem[]> {
    // Jellyfin uses a different approach - we need to search by provider ID
    const providerKey = provider === 'tmdb' ? 'Tmdb' : provider === 'imdb' ? 'Imdb' : 'Tvdb';

    // Search all items and filter by provider ID
    // This is less efficient but Jellyfin doesn't have a direct lookup API
    const params: Record<string, string | number | boolean | undefined> = {
      Recursive: true,
      Fields: 'ProviderIds,Overview,UserData,PrimaryImageAspectRatio',
      EnableImageTypes: 'Primary,Backdrop',
      ImageTypeLimit: 1,
      IncludeItemTypes: 'Movie,Series',
      AnyProviderIdEquals: `${providerKey}.${externalId}`,
    };

    try {
      const data = await this.get<JellyfinQueryResult<JellyfinMediaItem>>(
        `/Users/${this.server.userId}/Items`,
        params,
        CacheTTL.DYNAMIC
      );

      return data.Items
        .filter((item) => item.ProviderIds?.[providerKey] === externalId)
        .map((item) => this.mapMediaItem(item));
    } catch {
      return [];
    }
  }

  // ============================================
  // Playback
  // ============================================

  async getStreamUrl(itemId: string, mediaSourceId?: string): Promise<string> {
    // Generate a play session ID
    this.playSessionId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    const params = new URLSearchParams({
      Static: 'true',
      mediaSourceId: mediaSourceId || itemId,
      deviceId: this.deviceId,
      api_key: this.server.accessToken,
      PlaySessionId: this.playSessionId,
    });

    return `${this.server.address}/Videos/${itemId}/stream?${params.toString()}`;
  }

  async reportPlaybackStart(session: PlaybackSession): Promise<void> {
    await this.post('/Sessions/Playing', {
      ItemId: session.itemId,
      MediaSourceId: session.mediaSourceId || session.itemId,
      PositionTicks: msToTicks(session.positionMs),
      IsPaused: session.isPaused,
      PlayMethod: session.playMethod === 'direct' ? 'DirectPlay' : 
                  session.playMethod === 'directstream' ? 'DirectStream' : 'Transcode',
      AudioStreamIndex: session.audioStreamIndex,
      SubtitleStreamIndex: session.subtitleStreamIndex,
      PlaySessionId: this.playSessionId,
    });
  }

  async reportPlaybackProgress(session: PlaybackSession): Promise<void> {
    await this.post('/Sessions/Playing/Progress', {
      ItemId: session.itemId,
      MediaSourceId: session.mediaSourceId || session.itemId,
      PositionTicks: msToTicks(session.positionMs),
      IsPaused: session.isPaused,
      PlayMethod: session.playMethod === 'direct' ? 'DirectPlay' : 
                  session.playMethod === 'directstream' ? 'DirectStream' : 'Transcode',
      PlaySessionId: this.playSessionId,
    });
  }

  async reportPlaybackStop(session: PlaybackSession): Promise<void> {
    await this.post('/Sessions/Playing/Stopped', {
      ItemId: session.itemId,
      MediaSourceId: session.mediaSourceId || session.itemId,
      PositionTicks: msToTicks(session.positionMs),
      PlaySessionId: this.playSessionId,
    });
    this.playSessionId = undefined;
  }

  // ============================================
  // User Data
  // ============================================

  async markAsPlayed(itemId: string): Promise<void> {
    await this.post(`/Users/${this.server.userId}/PlayedItems/${itemId}`);
    await this.cache.invalidatePattern(`jellyfin:${this.server.id}:*${itemId}*`);
  }

  async markAsUnplayed(itemId: string): Promise<void> {
    await this.delete(`/Users/${this.server.userId}/PlayedItems/${itemId}`);
    await this.cache.invalidatePattern(`jellyfin:${this.server.id}:*${itemId}*`);
  }

  async toggleFavorite(itemId: string, isFavorite: boolean): Promise<void> {
    if (isFavorite) {
      await this.post(`/Users/${this.server.userId}/FavoriteItems/${itemId}`);
    } else {
      await this.delete(`/Users/${this.server.userId}/FavoriteItems/${itemId}`);
    }
    await this.cache.invalidatePattern(`jellyfin:${this.server.id}:*${itemId}*`);
  }

  // ============================================
  // Images
  // ============================================

  getImageUrl(
    itemId: string,
    imageType: 'poster' | 'backdrop' | 'thumb',
    options?: { width?: number; height?: number; quality?: number }
  ): string {
    const jellyfinImageType = imageType === 'poster' ? 'Primary' : 
                              imageType === 'backdrop' ? 'Backdrop' : 'Thumb';

    const params = new URLSearchParams();
    if (options?.width) params.set('maxWidth', String(options.width));
    if (options?.height) params.set('maxHeight', String(options.height));
    if (options?.quality) params.set('quality', String(options.quality));

    const queryString = params.toString();
    return `${this.server.address}/Items/${itemId}/Images/${jellyfinImageType}${queryString ? `?${queryString}` : ''}`;
  }

  // ============================================
  // Media Segments (Intro/Credits detection)
  // ============================================

  async getMediaSegments(itemId: string): Promise<MediaMarker[]> {
    try {
      // Try native Jellyfin 10.9+ media segments API
      const segments = await this.get<JellyfinMediaSegment[]>(
        `/MediaSegments/${itemId}`,
        undefined,
        CacheTTL.TRENDING
      );

      return segments.map((segment) => ({
        id: segment.Id,
        type: segment.Type === 'Intro' ? 'intro' as const :
              segment.Type === 'Outro' ? 'credits' as const :
              segment.Type === 'Recap' ? 'recap' as const :
              segment.Type === 'Commercial' ? 'commercial' as const : 'chapter' as const,
        startMs: ticksToMs(segment.StartTicks) || 0,
        endMs: ticksToMs(segment.EndTicks),
      }));
    } catch {
      // Fallback to chapters if media segments not available
      return [];
    }
  }

  // ============================================
  // Helpers
  // ============================================

  private mapLibrary(lib: JellyfinLibrary): MediaLibrary {
    return {
      id: lib.Id,
      name: lib.Name,
      type: normalizeLibraryType('jellyfin', lib.CollectionType || 'mixed'),
      primaryImageUrl: lib.PrimaryImageTag
        ? this.getImageUrl(lib.PrimaryImageItemId || lib.Id, 'poster')
        : undefined,
    };
  }

  private mapMediaItem(item: JellyfinMediaItem): MediaItem {
    const mapped: MediaItem = {
      id: item.Id,
      type: normalizeMediaItemType('jellyfin', item.Type),
      title: item.Name,
      originalTitle: item.OriginalTitle,
      overview: item.Overview,
      year: item.ProductionYear,

      // Images
      posterUrl: item.ImageTags?.Primary
        ? this.getImageUrl(item.Id, 'poster')
        : undefined,
      backdropUrl: item.BackdropImageTags?.length
        ? this.getImageUrl(item.Id, 'backdrop')
        : undefined,
      thumbUrl: item.ImageTags?.Thumb
        ? this.getImageUrl(item.Id, 'thumb')
        : undefined,

      // Duration
      durationMs: ticksToMs(item.RunTimeTicks),

      // Playback progress
      playbackPositionMs: ticksToMs(item.UserData?.PlaybackPositionTicks),
      playCount: item.UserData?.PlayCount,
      lastPlayedAt: item.UserData?.LastPlayedDate
        ? new Date(item.UserData.LastPlayedDate)
        : undefined,
      isPlayed: item.UserData?.Played,

      // Timestamps
      addedAt: undefined, // Jellyfin doesn't expose DateCreated in standard queries
      premiereDate: item.PremiereDate ? new Date(item.PremiereDate) : undefined,

      // Ratings
      communityRating: item.CommunityRating,
      criticRating: item.CriticRating,
      contentRating: item.OfficialRating,

      // TV Show specific
      seriesId: item.SeriesId,
      seriesName: item.SeriesName,
      seasonId: item.SeasonId,
      seasonNumber: item.ParentIndexNumber,
      episodeNumber: item.IndexNumber,

      // Season specific
      episodeCount: item.ChildCount,
      watchedEpisodeCount: item.UserData?.UnplayedItemCount !== undefined && item.ChildCount
        ? item.ChildCount - item.UserData.UnplayedItemCount
        : undefined,

      // External IDs
      externalIds: item.ProviderIds ? {
        tmdb: item.ProviderIds.Tmdb,
        imdb: item.ProviderIds.Imdb,
        tvdb: item.ProviderIds.Tvdb,
      } : undefined,

      // Media info
      mediaInfo: item.MediaSources?.map((source) => this.mapMediaSource(source)),

      // Markers
      markers: item.Chapters?.filter((ch) => ch.MarkerType)
        .map((ch) => this.mapChapter(ch)),

      // Source data
      sourceData: item,
    };

    return mapped;
  }

  private mapMediaSource(source: JellyfinMediaSource): MediaInfo {
    return {
      id: source.Id,
      container: source.Container,
      bitrate: source.Bitrate,
      durationMs: ticksToMs(source.RunTimeTicks),
      streamUrl: source.DirectStreamUrl,
      directPlaySupported: source.SupportsDirectPlay,
      directStreamSupported: source.SupportsDirectStream,
      transcodingSupported: source.SupportsTranscoding,
      parts: [{
        id: source.Id,
        key: source.Path || source.Id,
        filePath: source.Path,
        size: source.Size,
        container: source.Container,
        durationMs: ticksToMs(source.RunTimeTicks),
        streams: source.MediaStreams?.map((stream) => this.mapMediaStream(stream)),
      }],
    };
  }

  private mapMediaStream(stream: JellyfinMediaStream): MediaStream {
    return {
      id: String(stream.Index),
      type: stream.Type === 'Video' ? 'video' :
            stream.Type === 'Audio' ? 'audio' : 'subtitle',
      codec: stream.Codec,
      language: stream.Language,
      languageCode: stream.Language,
      title: stream.Title,
      displayTitle: stream.DisplayTitle,
      isDefault: stream.IsDefault,
      isForced: stream.IsForced,
      width: stream.Width,
      height: stream.Height,
      bitrate: stream.BitRate,
      channels: stream.Channels,
      sampleRate: stream.SampleRate,
      isExternal: stream.IsExternal,
      isTextBased: stream.IsTextSubtitleStream,
    };
  }

  private mapChapter(chapter: JellyfinChapter): MediaMarker {
    return {
      type: chapter.MarkerType === 'IntroStart' || chapter.MarkerType === 'IntroEnd' ? 'intro' :
            chapter.MarkerType === 'CreditsStart' ? 'credits' : 'chapter',
      name: chapter.Name,
      startMs: ticksToMs(chapter.StartPositionTicks) || 0,
    };
  }

  private mapItemTypesToJellyfin(types: string[]): string[] {
    return types.map((type) => {
      switch (type) {
        case 'movie': return 'Movie';
        case 'show': return 'Series';
        case 'season': return 'Season';
        case 'episode': return 'Episode';
        case 'album': return 'MusicAlbum';
        case 'track': return 'Audio';
        case 'photo': return 'Photo';
        default: return type;
      }
    });
  }

  private mapSortToJellyfin(sort: string): string {
    switch (sort) {
      case 'name': return 'SortName';
      case 'date_added': return 'DateCreated';
      case 'release_date': return 'PremiereDate';
      case 'rating': return 'CommunityRating';
      case 'random': return 'Random';
      default: return sort;
    }
  }
}
