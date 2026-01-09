/**
 * FlixorMobile - Mobile API wrapper around FlixorCore
 *
 * This provides a similar interface to the old MobileApi class for easier migration,
 * while using the new standalone FlixorCore under the hood.
 */

import { FlixorCore, type PlexMediaItem, type TMDBMedia } from '@flixor/core';
import { getFlixorCore, initializeFlixorCore } from './index';

export type ServerType = 'plex' | 'jellyfin' | 'emby' | null;

export interface MobileHomeData {
  continueWatching: PlexMediaItem[];
  recentlyAdded: PlexMediaItem[];
  onDeck: PlexMediaItem[];
  trending: TMDBMedia[];
}

export interface LibraryItemsResult {
  items: PlexMediaItem[];
  totalSize: number;
  page: number;
  pageSize: number;
}

/**
 * Compatibility layer for the mobile app
 * Wraps FlixorCore to provide similar API to the old backend-based MobileApi
 */
export class FlixorMobile {
  private core: FlixorCore;

  constructor(core: FlixorCore) {
    this.core = core;
  }

  static async initialize(): Promise<FlixorMobile> {
    const core = await initializeFlixorCore();
    return new FlixorMobile(core);
  }

  // ============================================
  // Server Type Detection
  // ============================================

  get serverType(): ServerType {
    return this.core.activeServerType;
  }

  get isAuthenticated(): boolean {
    return this.core.isPlexAuthenticated || this.core.isJellyfinAuthenticated || this.core.isEmbyAuthenticated;
  }

  // ============================================
  // Plex Authentication
  // ============================================

  get isPlexAuthenticated(): boolean {
    return this.core.isPlexAuthenticated;
  }

  get isTraktAuthenticated(): boolean {
    return this.core.isTraktAuthenticated;
  }

  get isConnected(): boolean {
    return this.core.isPlexServerConnected || this.core.isJellyfinServerConnected || this.core.isEmbyServerConnected;
  }

  async createPlexPin() {
    return this.core.createPlexPin();
  }

  async waitForPlexPin(
    pinId: number,
    onPoll?: () => void
  ): Promise<string> {
    return this.core.waitForPlexPin(pinId, { onPoll });
  }

  async getServers() {
    return this.core.getPlexServers();
  }

  async connectToServer(server: Awaited<ReturnType<typeof this.getServers>>[0]) {
    return this.core.connectToPlexServer(server);
  }

  // ============================================
  // Jellyfin Authentication
  // ============================================

  get isJellyfinAuthenticated(): boolean {
    return this.core.isJellyfinAuthenticated;
  }

  /**
   * Test connection to a Jellyfin server
   */
  async testJellyfinConnection(address: string) {
    return this.core.testJellyfinConnection(address);
  }

  /**
   * Login to a Jellyfin server with username/password
   */
  async loginToJellyfin(serverUrl: string, username: string, password: string): Promise<void> {
    await this.core.authenticateJellyfin({ address: serverUrl, username, password });
  }

  /**
   * Get Jellyfin user info
   */
  async getJellyfinUser() {
    if (!this.core.isJellyfinAuthenticated) return null;
    return (this.core as any).jellyfinAuth;
  }

  async logoutJellyfin() {
    await this.core.signOutJellyfin();
  }

  // ============================================
  // Emby Authentication
  // ============================================

  get isEmbyAuthenticated(): boolean {
    return this.core.isEmbyAuthenticated;
  }

  /**
   * Test connection to an Emby server
   */
  async testEmbyConnection(address: string) {
    return this.core.testEmbyConnection(address);
  }

  /**
   * Login to an Emby server with username/password
   */
  async loginToEmby(serverUrl: string, username: string, password: string): Promise<void> {
    await this.core.authenticateEmby({ address: serverUrl, username, password });
  }

  /**
   * Get Emby user info
   */
  async getEmbyUser() {
    if (!this.core.isEmbyAuthenticated) return null;
    return (this.core as any).embyAuth;
  }

  async logoutEmby() {
    await this.core.signOutEmby();
  }

  // ============================================
  // Unified Logout
  // ============================================

  async logoutAll() {
    const type = this.serverType;
    if (type === 'plex') {
      await this.core.signOutPlex();
    } else if (type === 'jellyfin') {
      await this.core.signOutJellyfin();
    } else if (type === 'emby') {
      await this.core.signOutEmby();
    }
    await this.core.signOutTrakt();
  }

  /**
   * Test if a server connection/endpoint is reachable
   */
  async testConnection(
    connection: { uri: string; protocol?: string; local?: boolean; relay?: boolean },
    accessToken: string
  ): Promise<boolean> {
    return this.core.plexAuth.testConnection(
      {
        uri: connection.uri,
        protocol: connection.protocol || 'https',
        local: connection.local ?? false,
        relay: connection.relay ?? false,
        IPv6: false,
      },
      accessToken
    );
  }

  /**
   * Connect to a server using a specific URI (custom endpoint)
   */
  async connectToServerWithUri(
    server: Awaited<ReturnType<typeof this.getServers>>[0],
    uri: string
  ): Promise<void> {
    // Create a custom connection object
    const customConnection = {
      uri,
      protocol: uri.startsWith('https') ? 'https' : 'http',
      local: false,
      relay: false,
      IPv6: false,
    };

    // Test the connection first
    const isValid = await this.core.plexAuth.testConnection(customConnection, server.accessToken);
    if (!isValid) {
      throw new Error('Could not connect to this endpoint');
    }

    // Use internal core method to set up the connection
    // We need to directly manipulate the core state
    const PlexServerService = (await import('@flixor/core')).PlexServerService;

    // Store state
    (this.core as any).currentServer = server;
    (this.core as any).currentConnection = customConnection;

    // Initialize server service with custom URI
    (this.core as any)._plexServer = new PlexServerService({
      baseUrl: uri,
      token: server.accessToken,
      clientId: (this.core as any).config.clientId,
      cache: (this.core as any).config.cache,
    });

    // Persist to secure storage
    const plexToken = (this.core as any).plexToken;
    await (this.core as any).config.secureStorage.set('plex_auth', {
      token: plexToken,
      server,
      connection: customConnection,
    });
  }

  async getPlexUser() {
    if (!this.core.isPlexAuthenticated) return null;
    // User info is embedded in the token verification
    // We can get it from the auth service
    const token = (this.core as any).plexToken;
    if (!token) return null;
    return this.core.plexAuth.getUser(token);
  }

  async logout() {
    await this.core.signOutPlex();
  }

  // ============================================
  // Trakt Authentication
  // ============================================

  async createTraktDeviceCode() {
    return this.core.createTraktDeviceCode();
  }

  async waitForTraktDeviceCode(
    deviceCode: Awaited<ReturnType<typeof this.createTraktDeviceCode>>,
    onPoll?: () => void
  ) {
    return this.core.waitForTraktDeviceCode(deviceCode, { onPoll });
  }

  async getTraktProfile() {
    return this.core.trakt.getProfile();
  }

  async logoutTrakt() {
    await this.core.signOutTrakt();
  }

  // ============================================
  // Home Screen Data
  // ============================================

  /**
   * Get home data - unified across all server types
   */
  async getHomeData(): Promise<MobileHomeData> {
    const serverType = this.serverType;
    
    let continueWatching: PlexMediaItem[] = [];
    let recentlyAdded: PlexMediaItem[] = [];
    let onDeck: PlexMediaItem[] = [];
    
    if (serverType === 'jellyfin' && this.core.isJellyfinServerConnected) {
      const service = this.core.jellyfinServerService;
      const [cw, recent, next] = await Promise.all([
        service.getContinueWatching().catch(() => []),
        service.getRecentlyAdded().catch(() => []),
        service.getNextUp().catch(() => []),
      ]);
      // Convert MediaItem to PlexMediaItem-compatible format
      continueWatching = cw.map(this.convertToPlexMediaItem);
      recentlyAdded = recent.map(this.convertToPlexMediaItem);
      onDeck = next.map(this.convertToPlexMediaItem);
    } else if (serverType === 'emby' && this.core.isEmbyServerConnected) {
      const service = this.core.embyServerService;
      const [cw, recent, next] = await Promise.all([
        service.getContinueWatching().catch(() => []),
        service.getRecentlyAdded().catch(() => []),
        service.getNextUp().catch(() => []),
      ]);
      continueWatching = cw.map(this.convertToPlexMediaItem);
      recentlyAdded = recent.map(this.convertToPlexMediaItem);
      onDeck = next.map(this.convertToPlexMediaItem);
    } else if (serverType === 'plex' && this.core.isPlexServerConnected) {
      [continueWatching, recentlyAdded, onDeck] = await Promise.all([
        this.core.plexServer.getContinueWatching().catch(() => []),
        this.core.plexServer.getRecentlyAdded().catch(() => []),
        this.core.plexServer.getOnDeck().catch(() => []),
      ]);
    }

    const [trendingMovies, trendingShows] = await Promise.all([
      this.core.tmdb.getTrendingMovies('week', 1).catch(() => ({ results: [] })),
      this.core.tmdb.getTrendingTV('week', 1).catch(() => ({ results: [] })),
    ]);

    const trending = [
      ...trendingMovies.results.slice(0, 10),
      ...trendingShows.results.slice(0, 10),
    ];

    return {
      continueWatching,
      recentlyAdded,
      onDeck,
      trending,
    };
  }

  /**
   * Convert MediaItem (Jellyfin/Emby) to PlexMediaItem format for UI compatibility
   */
  private convertToPlexMediaItem(item: any): PlexMediaItem {
    const serverType = this.serverType;
    return {
      ratingKey: item.id,
      key: item.id,
      type: item.type === 'episode' ? 'episode' : item.type === 'series' ? 'show' : item.type,
      title: item.name || item.title,
      grandparentTitle: item.seriesName,
      grandparentThumb: item.seriesThumb,
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
      // Mark source for routing
      _source: serverType,
      _originalItem: item,
    } as any;
  }

  // ============================================
  // Unified Library Methods
  // ============================================

  /**
   * Get continue watching - works for all server types
   */
  async getContinueWatching(): Promise<PlexMediaItem[]> {
    const serverType = this.serverType;
    
    if (serverType === 'jellyfin' && this.core.isJellyfinServerConnected) {
      const items = await this.core.jellyfinServerService.getContinueWatching();
      return items.map(item => this.convertToPlexMediaItem(item));
    } else if (serverType === 'emby' && this.core.isEmbyServerConnected) {
      const items = await this.core.embyServerService.getContinueWatching();
      return items.map(item => this.convertToPlexMediaItem(item));
    } else if (serverType === 'plex' && this.core.isPlexServerConnected) {
      return this.core.plexServer.getContinueWatching();
    }
    return [];
  }

  /**
   * Get recently added - works for all server types
   */
  async getRecentlyAdded(): Promise<PlexMediaItem[]> {
    const serverType = this.serverType;
    
    if (serverType === 'jellyfin' && this.core.isJellyfinServerConnected) {
      const items = await this.core.jellyfinServerService.getRecentlyAdded();
      return items.map(item => this.convertToPlexMediaItem(item));
    } else if (serverType === 'emby' && this.core.isEmbyServerConnected) {
      const items = await this.core.embyServerService.getRecentlyAdded();
      return items.map(item => this.convertToPlexMediaItem(item));
    } else if (serverType === 'plex' && this.core.isPlexServerConnected) {
      return this.core.plexServer.getRecentlyAdded();
    }
    return [];
  }

  /**
   * Get image URL - unified for all server types
   */
  getImageUrl(item: PlexMediaItem, width: number = 300): string {
    const serverType = this.serverType;
    const source = (item as any)._source || serverType;
    
    if (source === 'jellyfin' && this.core.isJellyfinServerConnected) {
      const originalItem = (item as any)._originalItem;
      if (originalItem) {
        return this.core.jellyfinServerService.getImageUrl(originalItem.id, 'poster', { width });
      }
      // Fallback: use ratingKey as the ID
      return this.core.jellyfinServerService.getImageUrl(item.ratingKey, 'poster', { width });
    } else if (source === 'emby' && this.core.isEmbyServerConnected) {
      const originalItem = (item as any)._originalItem;
      if (originalItem) {
        return this.core.embyServerService.getImageUrl(originalItem.id, 'poster', { width });
      }
      return this.core.embyServerService.getImageUrl(item.ratingKey, 'poster', { width });
    } else {
      // Plex or fallback
      const path = item.thumb || item.art;
      if (!path) return '';
      try {
        return this.core.plexServer.getImageUrl(path, width);
      } catch {
        return '';
      }
    }
  }

  // ============================================
  // Library
  // ============================================

  async getLibraries() {
    const serverType = this.serverType;
    
    if (serverType === 'jellyfin' && this.core.isJellyfinServerConnected) {
      return this.core.jellyfinServerService.getLibraries();
    } else if (serverType === 'emby' && this.core.isEmbyServerConnected) {
      return this.core.embyServerService.getLibraries();
    }
    return this.core.plexServer.getLibraries();
  }

  async getLibraryItems(opts: {
    libraryKey: string;
    type?: number;
    sort?: string;
    page?: number;
    pageSize?: number;
  }): Promise<LibraryItemsResult> {
    const { libraryKey, type, sort, page = 1, pageSize = 30 } = opts;

    const offset = (page - 1) * pageSize;
    const items = await this.core.plexServer.getLibraryItems(libraryKey, {
      type,
      sort,
      limit: pageSize,
      offset,
    });

    // Note: Plex doesn't return total count in all endpoints
    // We estimate based on whether we got a full page
    return {
      items,
      totalSize: items.length === pageSize ? -1 : offset + items.length,
      page,
      pageSize,
    };
  }

  async search(query: string, type?: number) {
    return this.core.plexServer.search(query, type);
  }

  // ============================================
  // Details
  // ============================================

  async getMetadata(ratingKey: string) {
    return this.core.plexServer.getMetadata(ratingKey);
  }

  async getChildren(ratingKey: string) {
    return this.core.plexServer.getChildren(ratingKey);
  }

  async getRelated(ratingKey: string) {
    return this.core.plexServer.getRelated(ratingKey);
  }

  // ============================================
  // TMDB Enrichment
  // ============================================

  async getTMDBMovieDetails(tmdbId: number) {
    return this.core.tmdb.getMovieDetails(tmdbId);
  }

  async getTMDBTVDetails(tmdbId: number) {
    return this.core.tmdb.getTVDetails(tmdbId);
  }

  async getTMDBMovieCredits(tmdbId: number) {
    return this.core.tmdb.getMovieCredits(tmdbId);
  }

  async getTMDBTVCredits(tmdbId: number) {
    return this.core.tmdb.getTVCredits(tmdbId);
  }

  async getTMDBMovieVideos(tmdbId: number) {
    return this.core.tmdb.getMovieVideos(tmdbId);
  }

  async getTMDBTVVideos(tmdbId: number) {
    return this.core.tmdb.getTVVideos(tmdbId);
  }

  async getTMDBSimilar(tmdbId: number, type: 'movie' | 'tv') {
    if (type === 'movie') {
      return this.core.tmdb.getSimilarMovies(tmdbId);
    }
    return this.core.tmdb.getSimilarTV(tmdbId);
  }

  async getTMDBRecommendations(tmdbId: number, type: 'movie' | 'tv') {
    if (type === 'movie') {
      return this.core.tmdb.getMovieRecommendations(tmdbId);
    }
    return this.core.tmdb.getTVRecommendations(tmdbId);
  }

  // ============================================
  // Playback
  // ============================================

  async getStreamUrl(ratingKey: string) {
    return this.core.plexServer.getStreamUrl(ratingKey);
  }

  getTranscodeUrl(ratingKey: string, options?: {
    maxVideoBitrate?: number;
    videoResolution?: string;
    directStream?: boolean;
  }) {
    return this.core.plexServer.getTranscodeUrl(ratingKey, options);
  }

  async updateTimeline(
    ratingKey: string,
    state: 'playing' | 'paused' | 'stopped',
    timeMs: number,
    durationMs: number
  ) {
    return this.core.plexServer.updateTimeline(ratingKey, state, timeMs, durationMs);
  }

  async getMarkers(ratingKey: string) {
    return this.core.plexServer.getMarkers(ratingKey);
  }

  // ============================================
  // Images
  // ============================================

  getPlexImageUrl(path: string | null | undefined, width?: number) {
    return this.core.plexServer.getImageUrl(path, width);
  }

  getTMDBPosterUrl(path: string | null | undefined) {
    return this.core.tmdb.getPosterUrl(path);
  }

  getTMDBBackdropUrl(path: string | null | undefined) {
    return this.core.tmdb.getBackdropUrl(path);
  }

  // ============================================
  // Watchlist (Plex.tv)
  // ============================================

  async getWatchlist() {
    return this.core.plexTv.getWatchlist();
  }

  async addToWatchlist(ratingKey: string) {
    return this.core.plexTv.addToWatchlist(ratingKey);
  }

  async removeFromWatchlist(ratingKey: string) {
    return this.core.plexTv.removeFromWatchlist(ratingKey);
  }

  async isInWatchlist(ratingKey: string) {
    return this.core.plexTv.isInWatchlist(ratingKey);
  }

  // ============================================
  // Trakt Sync
  // ============================================

  async getTraktWatchlist(type?: 'movies' | 'shows') {
    return this.core.trakt.getWatchlist(type);
  }

  async addToTraktWatchlist(item: { tmdbId: number; type: 'movie' | 'show' }) {
    if (item.type === 'movie') {
      return this.core.trakt.addMovieToWatchlist({ ids: { tmdb: item.tmdbId } });
    }
    return this.core.trakt.addShowToWatchlist({ ids: { tmdb: item.tmdbId } });
  }

  async removeFromTraktWatchlist(item: { tmdbId: number; type: 'movie' | 'show' }) {
    if (item.type === 'movie') {
      return this.core.trakt.removeMovieFromWatchlist({ ids: { tmdb: item.tmdbId } });
    }
    return this.core.trakt.removeShowFromWatchlist({ ids: { tmdb: item.tmdbId } });
  }

  async getTraktHistory(type?: 'movies' | 'shows' | 'episodes') {
    return this.core.trakt.getHistory(type);
  }

  async markWatched(item: {
    tmdbId: number;
    type: 'movie' | 'episode';
    showTmdbId?: number;
    season?: number;
    episode?: number;
  }) {
    if (item.type === 'movie') {
      return this.core.trakt.markMovieWatched({ ids: { tmdb: item.tmdbId } });
    }
    if (item.showTmdbId && item.season !== undefined && item.episode !== undefined) {
      return this.core.trakt.markEpisodeWatched(
        { ids: { tmdb: item.showTmdbId } },
        item.season,
        item.episode
      );
    }
    throw new Error('Missing show/season/episode info for episode watch');
  }

  async getTraktRecommendedMovies() {
    return this.core.trakt.getRecommendedMovies();
  }

  async getTraktRecommendedShows() {
    return this.core.trakt.getRecommendedShows();
  }

  // ============================================
  // Cache Management
  // ============================================

  async clearCache() {
    return this.core.clearAllCaches();
  }

  async clearPlexCache() {
    return this.core.clearPlexCache();
  }

  async clearTmdbCache() {
    return this.core.clearTmdbCache();
  }

  async clearTraktCache() {
    return this.core.clearTraktCache();
  }
}

// Singleton instance
let flixorMobileInstance: FlixorMobile | null = null;

export async function initializeFlixorMobile(): Promise<FlixorMobile> {
  if (!flixorMobileInstance) {
    flixorMobileInstance = await FlixorMobile.initialize();
  }
  return flixorMobileInstance;
}

export function getFlixorMobile(): FlixorMobile {
  if (!flixorMobileInstance) {
    throw new Error('FlixorMobile not initialized. Call initializeFlixorMobile first.');
  }
  return flixorMobileInstance;
}
