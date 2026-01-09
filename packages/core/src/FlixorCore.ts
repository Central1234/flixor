import type { IStorage } from './storage/IStorage';
import type { ISecureStorage } from './storage/ISecureStorage';
import type { ICache } from './storage/ICache';
import { PlexAuthService } from './services/PlexAuthService';
import { PlexServerService } from './services/PlexServerService';
import { PlexTvService } from './services/PlexTvService';
import { JellyfinAuthService } from './services/JellyfinAuthService';
import { JellyfinServerService } from './services/JellyfinServerService';
import { EmbyAuthService } from './services/EmbyAuthService';
import { EmbyServerService } from './services/EmbyServerService';
import { TMDBService } from './services/TMDBService';
import { TraktService } from './services/TraktService';
import type { PlexServer, PlexConnection } from './models/plex';
import type { JellyfinServer } from './models/jellyfin';
import type {
  MediaServerType,
  MediaServerAuth,
  MediaServerInfo,
  IMediaServerService,
} from './models/mediaserver';

export interface FlixorCoreConfig {
  // Platform bindings
  storage: IStorage;
  secureStorage: ISecureStorage;
  cache: ICache;

  // Client identification
  clientId: string;
  productName?: string;
  productVersion?: string;
  platform?: string;
  deviceName?: string;

  // API keys
  tmdbApiKey: string;
  traktClientId: string;
  traktClientSecret: string;

  // Optional settings
  language?: string;
}

interface StoredPlexAuth {
  token: string;
  server: PlexServer;
  connection: PlexConnection;
}

interface StoredJellyfinAuth {
  type: 'jellyfin' | 'emby';
  auth: MediaServerAuth;
  server: JellyfinServer;
}

interface StoredMediaServerAuth {
  type: MediaServerType;
  plex?: StoredPlexAuth;
  jellyfin?: StoredJellyfinAuth;
  emby?: StoredJellyfinAuth;
}

/**
 * Main entry point for Flixor Core
 * Initializes and manages all services with platform-specific storage bindings
 */
export class FlixorCore {
  private config: FlixorCoreConfig;
  private _plexAuth: PlexAuthService;
  private _plexServer: PlexServerService | null = null;
  private _plexTv: PlexTvService | null = null;
  private _jellyfinAuth: JellyfinAuthService;
  private _jellyfinServer: JellyfinServerService | null = null;
  private _embyAuth: EmbyAuthService;
  private _embyServer: EmbyServerService | null = null;
  private _tmdb: TMDBService;
  private _trakt: TraktService;

  // Current Plex state
  private plexToken: string | null = null;
  private currentServer: PlexServer | null = null;
  private currentConnection: PlexConnection | null = null;

  // Current Jellyfin/Emby state
  private jellyfinAuth: MediaServerAuth | null = null;
  private jellyfinServer: JellyfinServer | null = null;
  private embyAuth: MediaServerAuth | null = null;
  private embyServer: JellyfinServer | null = null;

  // Active media server type
  private _activeServerType: MediaServerType | null = null;

  constructor(config: FlixorCoreConfig) {
    this.config = config;

    // Initialize Plex Auth Service (always available)
    this._plexAuth = new PlexAuthService({
      clientId: config.clientId,
      productName: config.productName,
      productVersion: config.productVersion,
      platform: config.platform,
      deviceName: config.deviceName,
    });

    // Initialize Jellyfin Auth Service (always available)
    this._jellyfinAuth = new JellyfinAuthService({
      deviceId: config.clientId,
      clientName: config.productName,
      clientVersion: config.productVersion,
      deviceName: config.deviceName,
    });

    // Initialize Emby Auth Service (always available)
    this._embyAuth = new EmbyAuthService({
      deviceId: config.clientId,
      clientName: config.productName,
      clientVersion: config.productVersion,
      deviceName: config.deviceName,
    });

    // Initialize TMDB Service (always available)
    this._tmdb = new TMDBService({
      apiKey: config.tmdbApiKey,
      cache: config.cache,
      language: config.language,
    });

    // Initialize Trakt Service (always available)
    this._trakt = new TraktService({
      clientId: config.traktClientId,
      clientSecret: config.traktClientSecret,
      cache: config.cache,
      secureStorage: config.secureStorage,
    });
  }

  // ============================================
  // Service Accessors
  // ============================================

  /**
   * Get Plex Auth service (for PIN auth flow)
   */
  get plexAuth(): PlexAuthService {
    return this._plexAuth;
  }

  /**
   * Get Plex Server service (requires active connection)
   */
  get plexServer(): PlexServerService {
    if (!this._plexServer) {
      throw new Error('Plex server not connected. Call connectToServer first.');
    }
    return this._plexServer;
  }

  /**
   * Get Plex.tv service (requires authentication)
   */
  get plexTv(): PlexTvService {
    if (!this._plexTv) {
      throw new Error('Plex not authenticated. Call authenticate or restoreSession first.');
    }
    return this._plexTv;
  }

  /**
   * Get TMDB service (always available)
   */
  get tmdb(): TMDBService {
    return this._tmdb;
  }

  /**
   * Get Trakt service (always available, but some features require auth)
   */
  get trakt(): TraktService {
    return this._trakt;
  }

  /**
   * Get Jellyfin Auth service
   */
  get jellyfinAuthService(): JellyfinAuthService {
    return this._jellyfinAuth;
  }

  /**
   * Get Jellyfin Server service (requires active connection)
   */
  get jellyfinServerService(): JellyfinServerService {
    if (!this._jellyfinServer) {
      throw new Error('Jellyfin server not connected. Call connectToJellyfinServer first.');
    }
    return this._jellyfinServer;
  }

  /**
   * Get Emby Auth service
   */
  get embyAuthService(): EmbyAuthService {
    return this._embyAuth;
  }

  /**
   * Get Emby Server service (requires active connection)
   */
  get embyServerService(): EmbyServerService {
    if (!this._embyServer) {
      throw new Error('Emby server not connected. Call connectToEmbyServer first.');
    }
    return this._embyServer;
  }

  /**
   * Get the active media server type
   */
  get activeServerType(): MediaServerType | null {
    return this._activeServerType;
  }

  /**
   * Get the currently active media server service (unified interface)
   * Returns the service for Jellyfin/Emby servers that implement IMediaServerService.
   * For Plex, use the plexServer getter directly as it has a different API.
   */
  get activeMediaServer(): IMediaServerService | null {
    switch (this._activeServerType) {
      case 'jellyfin':
        return this._jellyfinServer;
      case 'emby':
        return this._embyServer;
      case 'plex':
        // PlexServerService has a different API, use plexServer getter instead
        return null;
      default:
        return null;
    }
  }

  /**
   * Check if any media server is connected
   */
  get isMediaServerConnected(): boolean {
    return this._plexServer !== null || 
           this._jellyfinServer !== null || 
           this._embyServer !== null;
  }

  // ============================================
  // Plex Authentication & Connection
  // ============================================

  /**
   * Check if Plex is authenticated
   */
  get isPlexAuthenticated(): boolean {
    return this.plexToken !== null && this._plexTv !== null;
  }

  /**
   * Check if connected to a Plex server
   */
  get isPlexServerConnected(): boolean {
    return this._plexServer !== null;
  }

  /**
   * Get current Plex server info
   */
  get server(): PlexServer | null {
    return this.currentServer;
  }

  /**
   * Get current Plex connection info
   */
  get connection(): PlexConnection | null {
    return this.currentConnection;
  }

  /**
   * Get the Plex auth token (for playback headers)
   */
  getPlexToken(): string | null {
    // Return server-specific token if connected, otherwise general token
    return this.currentServer?.accessToken || this.plexToken;
  }

  /**
   * Get the client ID
   */
  getClientId(): string {
    return this.config.clientId;
  }

  /**
   * Initialize - restore session from storage
   */
  async initialize(): Promise<boolean> {
    // Try to restore any media server session
    const plexRestored = await this.restorePlexSession();
    const jellyfinRestored = await this.restoreJellyfinSession();
    const embyRestored = await this.restoreEmbySession();

    // Initialize Trakt (restore tokens)
    await this._trakt.initialize();

    return plexRestored || jellyfinRestored || embyRestored;
  }

  /**
   * Restore Plex session from secure storage
   */
  private async restorePlexSession(): Promise<boolean> {
    try {
      const storedAuth = await this.config.secureStorage.get<StoredPlexAuth>('plex_auth');

      if (!storedAuth) {
        return false;
      }

      // Verify token is still valid
      try {
        await this._plexAuth.getUser(storedAuth.token);
      } catch {
        // Token invalid, clear stored auth
        await this.config.secureStorage.remove('plex_auth');
        return false;
      }

      // Restore state
      this.plexToken = storedAuth.token;
      this.currentServer = storedAuth.server;
      this.currentConnection = storedAuth.connection;

      // Initialize services
      this._plexTv = new PlexTvService({
        token: storedAuth.token,
        clientId: this.config.clientId,
        cache: this.config.cache,
      });

      this._plexServer = new PlexServerService({
        baseUrl: storedAuth.connection.uri,
        token: storedAuth.server.accessToken,
        clientId: this.config.clientId,
        cache: this.config.cache,
      });

      this._activeServerType = 'plex';
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Restore Jellyfin session from secure storage
   */
  private async restoreJellyfinSession(): Promise<boolean> {
    try {
      const stored = await this.config.secureStorage.get<StoredJellyfinAuth>('jellyfin_auth');

      if (!stored || stored.type !== 'jellyfin') {
        return false;
      }

      // Verify auth is still valid
      const isValid = await this._jellyfinAuth.validateAuth(stored.auth);
      if (!isValid) {
        await this.config.secureStorage.remove('jellyfin_auth');
        return false;
      }

      // Restore state
      this.jellyfinAuth = stored.auth;
      this.jellyfinServer = stored.server;

      // Initialize server service
      this._jellyfinServer = new JellyfinServerService({
        server: stored.server,
        deviceId: this.config.clientId,
        clientName: this.config.productName,
        clientVersion: this.config.productVersion,
        deviceName: this.config.deviceName,
        cache: this.config.cache,
      });

      this._activeServerType = 'jellyfin';
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Restore Emby session from secure storage
   */
  private async restoreEmbySession(): Promise<boolean> {
    try {
      const stored = await this.config.secureStorage.get<StoredJellyfinAuth>('emby_auth');

      if (!stored || stored.type !== 'emby') {
        return false;
      }

      // Verify auth is still valid
      const isValid = await this._embyAuth.validateAuth(stored.auth);
      if (!isValid) {
        await this.config.secureStorage.remove('emby_auth');
        return false;
      }

      // Restore state
      this.embyAuth = stored.auth;
      this.embyServer = stored.server;

      // Initialize server service
      this._embyServer = new EmbyServerService({
        server: stored.server,
        deviceId: this.config.clientId,
        clientName: this.config.productName,
        clientVersion: this.config.productVersion,
        deviceName: this.config.deviceName,
        cache: this.config.cache,
      });

      this._activeServerType = 'emby';
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Authenticate with Plex using PIN code
   * Returns the PIN info for user to enter at plex.tv/link
   */
  async createPlexPin(): Promise<{ id: number; code: string }> {
    return this._plexAuth.createPin();
  }

  /**
   * Wait for PIN authorization and complete auth
   */
  async waitForPlexPin(
    pinId: number,
    options?: { intervalMs?: number; timeoutMs?: number; onPoll?: () => void }
  ): Promise<string> {
    const token = await this._plexAuth.waitForPin(pinId, options);

    // Store token and initialize PlexTvService
    this.plexToken = token;
    this._plexTv = new PlexTvService({
      token,
      clientId: this.config.clientId,
      cache: this.config.cache,
    });

    return token;
  }

  /**
   * Get available Plex servers for authenticated user
   */
  async getPlexServers(): Promise<PlexServer[]> {
    if (!this.plexToken) {
      throw new Error('Plex not authenticated');
    }
    return this._plexAuth.getServers(this.plexToken);
  }

  /**
   * Connect to a specific Plex server
   */
  async connectToPlexServer(server: PlexServer): Promise<PlexConnection> {
    if (!this.plexToken) {
      throw new Error('Plex not authenticated');
    }

    // Find the best connection
    const connection = await this._plexAuth.findBestConnection(
      server,
      server.accessToken
    );

    if (!connection) {
      throw new Error(`Could not connect to server: ${server.name}`);
    }

    // Store state
    this.currentServer = server;
    this.currentConnection = connection;

    // Initialize server service
    this._plexServer = new PlexServerService({
      baseUrl: connection.uri,
      token: server.accessToken,
      clientId: this.config.clientId,
      cache: this.config.cache,
    });

    // Set as active server
    this._activeServerType = 'plex';

    // Persist to secure storage
    await this.config.secureStorage.set<StoredPlexAuth>('plex_auth', {
      token: this.plexToken,
      server,
      connection,
    });

    return connection;
  }

  /**
   * Sign out from Plex
   */
  async signOutPlex(): Promise<void> {
    if (this.plexToken) {
      await this._plexAuth.signOut(this.plexToken);
    }

    // Clear state
    this.plexToken = null;
    this.currentServer = null;
    this.currentConnection = null;
    this._plexTv = null;
    this._plexServer = null;

    if (this._activeServerType === 'plex') {
      this._activeServerType = null;
    }

    // Clear storage
    await this.config.secureStorage.remove('plex_auth');
    await this.config.cache.invalidatePattern('plex:*');
    await this.config.cache.invalidatePattern('plextv:*');
  }

  // ============================================
  // Jellyfin Authentication & Connection
  // ============================================

  /**
   * Check if Jellyfin is authenticated
   */
  get isJellyfinAuthenticated(): boolean {
    return this.jellyfinAuth !== null;
  }

  /**
   * Check if connected to a Jellyfin server
   */
  get isJellyfinServerConnected(): boolean {
    return this._jellyfinServer !== null;
  }

  /**
   * Test connection to a Jellyfin server
   */
  async testJellyfinConnection(address: string): Promise<MediaServerInfo | null> {
    return this._jellyfinAuth.testConnection(address);
  }

  /**
   * Authenticate with Jellyfin using username/password
   */
  async authenticateJellyfin(options: {
    address: string;
    username: string;
    password: string;
  }): Promise<MediaServerAuth> {
    const auth = await this._jellyfinAuth.authenticate(options);
    
    // Create server object
    const server: JellyfinServer = {
      id: auth.serverId,
      name: auth.serverName,
      address: auth.serverAddress,
      accessToken: auth.accessToken,
      userId: auth.userId,
    };

    // Store state
    this.jellyfinAuth = auth;
    this.jellyfinServer = server;

    // Initialize server service
    this._jellyfinServer = new JellyfinServerService({
      server,
      deviceId: this.config.clientId,
      clientName: this.config.productName,
      clientVersion: this.config.productVersion,
      deviceName: this.config.deviceName,
      cache: this.config.cache,
    });

    // Set as active server
    this._activeServerType = 'jellyfin';

    // Persist to secure storage
    await this.config.secureStorage.set<StoredJellyfinAuth>('jellyfin_auth', {
      type: 'jellyfin',
      auth,
      server,
    });

    return auth;
  }

  /**
   * Authenticate with Jellyfin using API key
   */
  async authenticateJellyfinWithApiKey(options: {
    address: string;
    apiKey: string;
  }): Promise<MediaServerAuth> {
    const auth = await this._jellyfinAuth.authenticateWithApiKey(options);
    
    const server: JellyfinServer = {
      id: auth.serverId,
      name: auth.serverName,
      address: auth.serverAddress,
      accessToken: auth.accessToken,
      userId: auth.userId,
    };

    this.jellyfinAuth = auth;
    this.jellyfinServer = server;

    this._jellyfinServer = new JellyfinServerService({
      server,
      deviceId: this.config.clientId,
      clientName: this.config.productName,
      clientVersion: this.config.productVersion,
      deviceName: this.config.deviceName,
      cache: this.config.cache,
    });

    this._activeServerType = 'jellyfin';

    await this.config.secureStorage.set<StoredJellyfinAuth>('jellyfin_auth', {
      type: 'jellyfin',
      auth,
      server,
    });

    return auth;
  }

  /**
   * Sign out from Jellyfin
   */
  async signOutJellyfin(): Promise<void> {
    if (this.jellyfinAuth) {
      await this._jellyfinAuth.signOut(this.jellyfinAuth);
    }

    // Clear state
    this.jellyfinAuth = null;
    this.jellyfinServer = null;
    this._jellyfinServer = null;

    if (this._activeServerType === 'jellyfin') {
      this._activeServerType = null;
    }

    // Clear storage
    await this.config.secureStorage.remove('jellyfin_auth');
    await this.config.cache.invalidatePattern('jellyfin:*');
  }

  // ============================================
  // Emby Authentication & Connection
  // ============================================

  /**
   * Check if Emby is authenticated
   */
  get isEmbyAuthenticated(): boolean {
    return this.embyAuth !== null;
  }

  /**
   * Check if connected to an Emby server
   */
  get isEmbyServerConnected(): boolean {
    return this._embyServer !== null;
  }

  /**
   * Test connection to an Emby server
   */
  async testEmbyConnection(address: string): Promise<MediaServerInfo | null> {
    return this._embyAuth.testConnection(address);
  }

  /**
   * Authenticate with Emby using username/password
   */
  async authenticateEmby(options: {
    address: string;
    username: string;
    password: string;
  }): Promise<MediaServerAuth> {
    const auth = await this._embyAuth.authenticate(options);
    
    const server: JellyfinServer = {
      id: auth.serverId,
      name: auth.serverName,
      address: auth.serverAddress,
      accessToken: auth.accessToken,
      userId: auth.userId,
      productName: 'Emby',
    };

    this.embyAuth = auth;
    this.embyServer = server;

    this._embyServer = new EmbyServerService({
      server,
      deviceId: this.config.clientId,
      clientName: this.config.productName,
      clientVersion: this.config.productVersion,
      deviceName: this.config.deviceName,
      cache: this.config.cache,
    });

    this._activeServerType = 'emby';

    await this.config.secureStorage.set<StoredJellyfinAuth>('emby_auth', {
      type: 'emby',
      auth,
      server,
    });

    return auth;
  }

  /**
   * Authenticate with Emby using API key
   */
  async authenticateEmbyWithApiKey(options: {
    address: string;
    apiKey: string;
  }): Promise<MediaServerAuth> {
    const auth = await this._embyAuth.authenticateWithApiKey(options);
    
    const server: JellyfinServer = {
      id: auth.serverId,
      name: auth.serverName,
      address: auth.serverAddress,
      accessToken: auth.accessToken,
      userId: auth.userId,
      productName: 'Emby',
    };

    this.embyAuth = auth;
    this.embyServer = server;

    this._embyServer = new EmbyServerService({
      server,
      deviceId: this.config.clientId,
      clientName: this.config.productName,
      clientVersion: this.config.productVersion,
      deviceName: this.config.deviceName,
      cache: this.config.cache,
    });

    this._activeServerType = 'emby';

    await this.config.secureStorage.set<StoredJellyfinAuth>('emby_auth', {
      type: 'emby',
      auth,
      server,
    });

    return auth;
  }

  /**
   * Sign out from Emby
   */
  async signOutEmby(): Promise<void> {
    if (this.embyAuth) {
      await this._embyAuth.signOut(this.embyAuth);
    }

    // Clear state
    this.embyAuth = null;
    this.embyServer = null;
    this._embyServer = null;

    if (this._activeServerType === 'emby') {
      this._activeServerType = null;
    }

    // Clear storage
    await this.config.secureStorage.remove('emby_auth');
    await this.config.cache.invalidatePattern('emby:*');
  }

  /**
   * Sign out from all media servers
   */
  async signOutAllMediaServers(): Promise<void> {
    await this.signOutPlex();
    await this.signOutJellyfin();
    await this.signOutEmby();
  }

  // ============================================
  // Trakt Authentication
  // ============================================

  /**
   * Check if Trakt is authenticated
   */
  get isTraktAuthenticated(): boolean {
    return this._trakt.isAuthenticated();
  }

  /**
   * Generate Trakt device code for authentication
   */
  async createTraktDeviceCode() {
    return this._trakt.generateDeviceCode();
  }

  /**
   * Wait for Trakt device code authorization
   */
  async waitForTraktDeviceCode(
    deviceCode: Awaited<ReturnType<TraktService['generateDeviceCode']>>,
    options?: { onPoll?: () => void }
  ) {
    return this._trakt.waitForDeviceCode(deviceCode, options);
  }

  /**
   * Sign out from Trakt
   */
  async signOutTrakt(): Promise<void> {
    await this._trakt.signOut();
  }

  // ============================================
  // Cache Management
  // ============================================

  /**
   * Clear all caches
   */
  async clearAllCaches(): Promise<void> {
    await this.config.cache.clear();
  }

  /**
   * Clear Plex caches
   */
  async clearPlexCache(): Promise<void> {
    await this.config.cache.invalidatePattern('plex:*');
    await this.config.cache.invalidatePattern('plextv:*');
  }

  /**
   * Clear Jellyfin cache
   */
  async clearJellyfinCache(): Promise<void> {
    await this.config.cache.invalidatePattern('jellyfin:*');
  }

  /**
   * Clear Emby cache
   */
  async clearEmbyCache(): Promise<void> {
    await this.config.cache.invalidatePattern('emby:*');
  }

  /**
   * Clear all media server caches
   */
  async clearMediaServerCaches(): Promise<void> {
    await this.clearPlexCache();
    await this.clearJellyfinCache();
    await this.clearEmbyCache();
  }

  /**
   * Clear TMDB cache
   */
  async clearTmdbCache(): Promise<void> {
    await this._tmdb.invalidateCache();
  }

  /**
   * Clear Trakt cache
   */
  async clearTraktCache(): Promise<void> {
    await this._trakt.invalidateCache();
  }
}
