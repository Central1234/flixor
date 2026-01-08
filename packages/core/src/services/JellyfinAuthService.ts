/**
 * JellyfinAuthService
 * 
 * Handles authentication with Jellyfin servers.
 * Jellyfin supports:
 * - Username/password authentication
 * - API key authentication (for automated access)
 * 
 * Unlike Plex, Jellyfin doesn't require cloud authentication - 
 * it authenticates directly with the server.
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

export interface JellyfinAuthConfig {
  clientName?: string;
  clientVersion?: string;
  deviceName?: string;
  deviceId: string;
}

export class JellyfinAuthService implements IMediaServerAuth {
  readonly serverType = 'jellyfin' as const;
  
  private clientName: string;
  private clientVersion: string;
  private deviceName: string;
  private deviceId: string;

  constructor(config: JellyfinAuthConfig) {
    this.clientName = config.clientName || 'Flixor';
    this.clientVersion = config.clientVersion || '1.0.0';
    this.deviceName = config.deviceName || 'Flixor Device';
    this.deviceId = config.deviceId;
  }

  /**
   * Get authorization header for Jellyfin API requests
   */
  private getAuthHeader(accessToken?: string): string {
    const parts = [
      `MediaBrowser Client="${this.clientName}"`,
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
    return {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Authorization': this.getAuthHeader(accessToken),
    };
  }

  /**
   * Normalize server address (ensure proper format)
   */
  private normalizeAddress(address: string): string {
    let normalized = address.trim();
    
    // Add protocol if missing
    if (!normalized.startsWith('http://') && !normalized.startsWith('https://')) {
      normalized = `http://${normalized}`;
    }
    
    // Remove trailing slash
    normalized = normalized.replace(/\/+$/, '');
    
    return normalized;
  }

  /**
   * Test connection to a Jellyfin server
   * Returns server info if successful, null otherwise
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

      return {
        id: info.Id,
        type: 'jellyfin',
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
      type: 'jellyfin',
      userId: result.User.Id,
      username: result.User.Name,
      accessToken: result.AccessToken,
      serverId: result.ServerId,
      serverName: '', // Will be filled from server info
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

    // Get admin user (API keys typically have admin access)
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
      type: 'jellyfin',
      userId,
      username,
      accessToken: options.apiKey,
      serverId: serverInfo.Id,
      serverName: serverInfo.ServerName,
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
   * Sign out (invalidate session)
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
   * Get all users (admin only)
   */
  async getUsers(auth: MediaServerAuth): Promise<JellyfinUser[]> {
    const response = await fetch(`${auth.serverAddress}/Users`, {
      method: 'GET',
      headers: this.getHeaders(auth.accessToken),
    });

    if (!response.ok) {
      throw new Error(`Failed to get users: ${response.status}`);
    }

    return response.json();
  }

  /**
   * Get public users (for login screen)
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
   * Quick connect - generate a code for authentication
   * (Jellyfin 10.8+ feature)
   */
  async initiateQuickConnect(address: string): Promise<{ Secret: string; Code: string } | null> {
    const normalizedAddress = this.normalizeAddress(address);

    try {
      // Check if Quick Connect is available
      const statusResponse = await fetch(`${normalizedAddress}/QuickConnect/Enabled`, {
        method: 'GET',
        headers: this.getHeaders(),
      });

      if (!statusResponse.ok) {
        return null;
      }

      const enabled = await statusResponse.json();
      if (!enabled) {
        return null;
      }

      // Initiate Quick Connect
      const response = await fetch(`${normalizedAddress}/QuickConnect/Initiate`, {
        method: 'POST',
        headers: this.getHeaders(),
      });

      if (!response.ok) {
        return null;
      }

      return response.json();
    } catch {
      return null;
    }
  }

  /**
   * Check Quick Connect status
   */
  async checkQuickConnect(
    address: string,
    secret: string
  ): Promise<{ Authenticated: boolean; AccessToken?: string } | null> {
    const normalizedAddress = this.normalizeAddress(address);

    try {
      const response = await fetch(
        `${normalizedAddress}/QuickConnect/Connect?secret=${encodeURIComponent(secret)}`,
        {
          method: 'GET',
          headers: this.getHeaders(),
        }
      );

      if (!response.ok) {
        return null;
      }

      return response.json();
    } catch {
      return null;
    }
  }

  /**
   * Create a JellyfinServer object from auth
   */
  createServerFromAuth(auth: MediaServerAuth): JellyfinServer {
    return {
      id: auth.serverId,
      name: auth.serverName,
      address: auth.serverAddress,
      accessToken: auth.accessToken,
      userId: auth.userId,
    };
  }
}
