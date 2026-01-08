/**
 * EmbyAuthService
 * 
 * Handles authentication with Emby servers.
 * Emby's API is very similar to Jellyfin's (Jellyfin was forked from Emby),
 * so this extends the Jellyfin implementation with Emby-specific adjustments.
 * 
 * Key differences:
 * - Uses "Emby" instead of "MediaBrowser" in auth headers
 * - Some endpoints may have different paths
 * - Emby Connect cloud authentication (optional)
 */

import type {
  JellyfinAuthResult,
  JellyfinUser,
  JellyfinPublicInfo,
  JellyfinServer,
} from '../models/jellyfin';
import type {
  IMediaServerAuth,
  MediaServerAuth,
  MediaServerInfo,
} from '../models/mediaserver';

export interface EmbyAuthConfig {
  clientName?: string;
  clientVersion?: string;
  deviceName?: string;
  deviceId: string;
}

// Emby Connect types
export interface EmbyConnectUser {
  Id: string;
  Name: string;
  Email: string;
  IsActive: boolean;
  ImageUrl?: string;
}

export interface EmbyConnectResponse {
  AccessToken: string;
  User: EmbyConnectUser;
}

export interface EmbyServer extends JellyfinServer {
  productName: 'Emby';
}

export class EmbyAuthService implements IMediaServerAuth {
  readonly serverType = 'emby' as const;
  
  private clientName: string;
  private clientVersion: string;
  private deviceName: string;
  private deviceId: string;

  constructor(config: EmbyAuthConfig) {
    this.clientName = config.clientName || 'Flixor';
    this.clientVersion = config.clientVersion || '1.0.0';
    this.deviceName = config.deviceName || 'Flixor Device';
    this.deviceId = config.deviceId;
  }

  /**
   * Get authorization header for Emby API requests
   * Note: Emby uses "Emby" prefix instead of "MediaBrowser"
   */
  private getAuthHeader(accessToken?: string): string {
    const parts = [
      `Emby UserId=""`,
      `Client="${this.clientName}"`,
      `Device="${this.deviceName}"`,
      `DeviceId="${this.deviceId}"`,
      `Version="${this.clientVersion}"`,
    ];

    if (accessToken) {
      parts.push(`Token="${accessToken}"`);
    }

    return parts.join(', ');
  }

  /**
   * Get standard headers for API requests
   */
  private getHeaders(accessToken?: string): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'X-Emby-Authorization': this.getAuthHeader(accessToken),
    };

    if (accessToken) {
      headers['X-Emby-Token'] = accessToken;
    }

    return headers;
  }

  /**
   * Normalize server address
   */
  private normalizeAddress(address: string): string {
    let normalized = address.trim();
    
    if (!normalized.startsWith('http://') && !normalized.startsWith('https://')) {
      normalized = `http://${normalized}`;
    }
    
    normalized = normalized.replace(/\/+$/, '');
    
    return normalized;
  }

  /**
   * Test connection to an Emby server
   */
  async testConnection(address: string): Promise<MediaServerInfo | null> {
    const normalizedAddress = this.normalizeAddress(address);

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);

      const response = await fetch(`${normalizedAddress}/System/Info/Public`, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        return null;
      }

      const info: JellyfinPublicInfo = await response.json();

      // Verify it's an Emby server (not Jellyfin)
      const isEmby = info.ProductName?.toLowerCase().includes('emby');
      if (!isEmby) {
        console.log('[EmbyAuthService] Server is not Emby:', info.ProductName);
        // Still return info but note it might be Jellyfin
      }

      return {
        id: info.Id,
        type: 'emby',
        name: info.ServerName,
        address: normalizedAddress,
        version: info.Version,
        accessToken: '',
        isOnline: true,
      };
    } catch {
      return null;
    }
  }

  /**
   * Authenticate with username and password
   */
  async authenticate(options: {
    address: string;
    username: string;
    password: string;
  }): Promise<MediaServerAuth> {
    const normalizedAddress = this.normalizeAddress(options.address);

    const response = await fetch(`${normalizedAddress}/Users/AuthenticateByName`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({
        Username: options.username,
        Pw: options.password,
      }),
    });

    if (!response.ok) {
      if (response.status === 401) {
        throw new Error('Invalid username or password');
      }
      throw new Error(`Authentication failed: ${response.status}`);
    }

    const result: JellyfinAuthResult = await response.json();

    return {
      type: 'emby',
      userId: result.User.Id,
      username: result.User.Name,
      accessToken: result.AccessToken,
      serverId: result.ServerId,
      serverName: '',
      serverAddress: normalizedAddress,
      avatarUrl: result.User.PrimaryImageTag
        ? `${normalizedAddress}/Users/${result.User.Id}/Images/Primary?tag=${result.User.PrimaryImageTag}`
        : undefined,
    };
  }

  /**
   * Authenticate with API key
   */
  async authenticateWithApiKey(options: {
    address: string;
    apiKey: string;
  }): Promise<MediaServerAuth> {
    const normalizedAddress = this.normalizeAddress(options.address);

    // Verify API key by getting server info
    const response = await fetch(`${normalizedAddress}/System/Info`, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'X-Emby-Token': options.apiKey,
      },
    });

    if (!response.ok) {
      throw new Error('Invalid API key');
    }

    const serverInfo = await response.json();

    // Get admin user
    const usersResponse = await fetch(`${normalizedAddress}/Users`, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'X-Emby-Token': options.apiKey,
      },
    });

    let userId = 'apikey';
    let username = 'API Key';

    if (usersResponse.ok) {
      const users: JellyfinUser[] = await usersResponse.json();
      const adminUser = users.find((u) => u.Policy?.IsAdministrator);
      if (adminUser) {
        userId = adminUser.Id;
        username = adminUser.Name;
      }
    }

    return {
      type: 'emby',
      userId,
      username,
      accessToken: options.apiKey,
      serverId: serverInfo.Id,
      serverName: serverInfo.ServerName,
      serverAddress: normalizedAddress,
    };
  }

  /**
   * Authenticate with Emby Connect
   * This allows users to sign in with their Emby Connect account
   */
  async authenticateWithEmbyConnect(options: {
    username: string;
    password: string;
  }): Promise<EmbyConnectResponse> {
    const response = await fetch('https://connect.emby.media/service/user/authenticate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'X-Application': `${this.clientName}/${this.clientVersion}`,
      },
      body: JSON.stringify({
        nameOrEmail: options.username,
        rawpw: options.password,
      }),
    });

    if (!response.ok) {
      throw new Error('Emby Connect authentication failed');
    }

    return response.json();
  }

  /**
   * Get servers linked to an Emby Connect account
   */
  async getEmbyConnectServers(connectToken: string): Promise<Array<{
    Id: string;
    Name: string;
    SystemId: string;
    Url: string;
    LocalAddress?: string;
  }>> {
    const response = await fetch('https://connect.emby.media/service/servers', {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'X-Connect-UserToken': connectToken,
        'X-Application': `${this.clientName}/${this.clientVersion}`,
      },
    });

    if (!response.ok) {
      throw new Error('Failed to get Emby Connect servers');
    }

    return response.json();
  }

  /**
   * Exchange Emby Connect token for local server access
   */
  async exchangeConnectToken(options: {
    serverAddress: string;
    connectToken: string;
    connectUserId: string;
  }): Promise<MediaServerAuth> {
    const normalizedAddress = this.normalizeAddress(options.serverAddress);

    const response = await fetch(`${normalizedAddress}/Connect/Exchange`, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'X-Emby-Authorization': this.getAuthHeader(),
        'X-Connect-UserToken': options.connectToken,
      },
    });

    if (!response.ok) {
      throw new Error('Failed to exchange Emby Connect token');
    }

    const result = await response.json();

    return {
      type: 'emby',
      userId: result.LocalUserId,
      username: result.LocalUsername || 'Emby Connect User',
      accessToken: result.AccessToken,
      serverId: result.ServerId || '',
      serverName: '',
      serverAddress: normalizedAddress,
    };
  }

  /**
   * Validate existing authentication
   */
  async validateAuth(auth: MediaServerAuth): Promise<boolean> {
    try {
      const response = await fetch(`${auth.serverAddress}/Users/${auth.userId}`, {
        method: 'GET',
        headers: this.getHeaders(auth.accessToken),
      });

      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Sign out
   */
  async signOut(auth: MediaServerAuth): Promise<void> {
    try {
      await fetch(`${auth.serverAddress}/Sessions/Logout`, {
        method: 'POST',
        headers: this.getHeaders(auth.accessToken),
      });
    } catch {
      // Ignore errors during sign out
    }
  }

  /**
   * Get user information
   */
  async getUser(auth: MediaServerAuth): Promise<JellyfinUser> {
    const response = await fetch(`${auth.serverAddress}/Users/${auth.userId}`, {
      method: 'GET',
      headers: this.getHeaders(auth.accessToken),
    });

    if (!response.ok) {
      throw new Error(`Failed to get user: ${response.status}`);
    }

    return response.json();
  }

  /**
   * Get public users for login screen
   */
  async getPublicUsers(address: string): Promise<JellyfinUser[]> {
    const normalizedAddress = this.normalizeAddress(address);

    const response = await fetch(`${normalizedAddress}/Users/Public`, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      return [];
    }

    return response.json();
  }

  /**
   * Create server object from auth
   */
  createServerFromAuth(auth: MediaServerAuth): EmbyServer {
    return {
      id: auth.serverId,
      name: auth.serverName,
      address: auth.serverAddress,
      accessToken: auth.accessToken,
      userId: auth.userId,
      productName: 'Emby',
    };
  }
}
