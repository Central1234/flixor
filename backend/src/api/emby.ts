import { Router, Request, Response, NextFunction } from 'express';
import axios from 'axios';
import { AppDataSource } from '../db/data-source';
import { User, UserSettings } from '../db/entities';
import { AppError } from '../middleware/errorHandler';
import { requireAuth, AuthenticatedRequest } from '../middleware/auth';
import { createLogger } from '../utils/logger';
import { encryptForUser, decryptForUser, isEncrypted } from '../utils/crypto';

const router = Router();
const logger = createLogger('emby');

// Helper to get Emby auth header
function getEmbyAuthHeader(clientId: string, deviceName: string = 'Flixor Web', token?: string): string {
  let auth = `Emby Client="Flixor", Device="${deviceName}", DeviceId="${clientId}", Version="1.0.0"`;
  if (token) {
    auth += `, Token="${token}"`;
  }
  return auth;
}

// Generate a client ID for this session
function generateClientId(): string {
  return 'flixor-' + Math.random().toString(36).substring(2, 15);
}

// Test connection to Emby server
router.post('/test', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { serverAddress } = req.body;

    if (!serverAddress) {
      return res.status(400).json({ success: false, error: 'Server address is required' });
    }

    // Normalize address
    let normalizedAddress = serverAddress.trim();
    if (!normalizedAddress.startsWith('http://') && !normalizedAddress.startsWith('https://')) {
      normalizedAddress = 'http://' + normalizedAddress;
    }
    normalizedAddress = normalizedAddress.replace(/\/$/, '');

    const clientId = generateClientId();

    // Try to get server info
    const response = await axios.get(`${normalizedAddress}/System/Info/Public`, {
      headers: {
        'Accept': 'application/json',
        'X-Emby-Authorization': getEmbyAuthHeader(clientId),
      },
      timeout: 10000,
    });

    if (response.data?.ServerName) {
      res.json({
        success: true,
        serverName: response.data.ServerName,
        serverId: response.data.Id,
        version: response.data.Version,
      });
    } else {
      res.json({ success: false, error: 'Invalid server response' });
    }
  } catch (error: any) {
    logger.error('Emby test connection failed:', error.message);
    res.json({
      success: false,
      error: error.code === 'ECONNREFUSED' 
        ? 'Could not connect to server' 
        : error.message || 'Connection failed',
    });
  }
});

// Authenticate with Emby server
router.post('/login', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { serverAddress, username, password } = req.body;

    if (!serverAddress || !username) {
      return res.status(400).json({ success: false, error: 'Server address and username are required' });
    }

    // Normalize address
    let normalizedAddress = serverAddress.trim();
    if (!normalizedAddress.startsWith('http://') && !normalizedAddress.startsWith('https://')) {
      normalizedAddress = 'http://' + normalizedAddress;
    }
    normalizedAddress = normalizedAddress.replace(/\/$/, '');

    const clientId = generateClientId();

    // Authenticate with Emby
    const response = await axios.post(
      `${normalizedAddress}/Users/AuthenticateByName`,
      {
        Username: username,
        Pw: password || '',
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'X-Emby-Authorization': getEmbyAuthHeader(clientId),
        },
        timeout: 15000,
      }
    );

    const authResult = response.data;

    if (!authResult.AccessToken || !authResult.User?.Id) {
      return res.status(401).json({ success: false, error: 'Authentication failed' });
    }

    // Create or update user in database
    const userRepository = AppDataSource.getRepository(User);
    const settingsRepository = AppDataSource.getRepository(UserSettings);

    // Use Emby user ID as external ID
    const externalId = `emby:${authResult.ServerId}:${authResult.User.Id}`;
    
    let user = await userRepository.findOne({ where: { plexId: externalId } });
    
    if (!user) {
      user = userRepository.create({
        plexId: externalId, // Reusing plexId field for external ID
        username: authResult.User.Name,
        email: undefined,
        plexToken: undefined, // Not used for Emby
        avatarUrl: authResult.User.PrimaryImageTag 
          ? `${normalizedAddress}/Users/${authResult.User.Id}/Images/Primary?tag=${authResult.User.PrimaryImageTag}`
          : undefined,
      });
      await userRepository.save(user);
    } else {
      // Update user info
      user.username = authResult.User.Name;
      user.avatarUrl = authResult.User.PrimaryImageTag 
        ? `${normalizedAddress}/Users/${authResult.User.Id}/Images/Primary?tag=${authResult.User.PrimaryImageTag}`
        : undefined;
      await userRepository.save(user);
    }

    // Store Emby server info in settings
    let settings = await settingsRepository.findOne({ where: { userId: user.id } });
    if (!settings) {
      settings = settingsRepository.create({ userId: user.id });
    }

    // Store Emby-specific settings
    settings.embyServers = [{
      id: authResult.ServerId,
      name: authResult.ServerName || 'Emby Server',
      address: normalizedAddress,
      userId: authResult.User.Id,
      accessToken: encryptForUser(user.id, authResult.AccessToken),
      clientId,
    }];
    settings.currentServerId = authResult.ServerId;
    settings.serverType = 'emby';

    await settingsRepository.save(settings);

    // Set session
    req.session.userId = user.id;
    req.session.username = user.username;
    req.session.serverType = 'emby';

    logger.info(`Emby user authenticated: ${user.username}`);

    res.json({
      success: true,
      user: {
        id: user.id,
        username: user.username,
        avatarUrl: user.avatarUrl,
      },
      server: {
        id: authResult.ServerId,
        name: authResult.ServerName,
      },
    });
  } catch (error: any) {
    logger.error('Emby authentication failed:', error.message);
    
    if (error.response?.status === 401) {
      return res.status(401).json({ success: false, error: 'Invalid username or password' });
    }
    
    res.status(500).json({
      success: false,
      error: error.code === 'ECONNREFUSED' 
        ? 'Could not connect to server' 
        : 'Authentication failed',
    });
  }
});

// Helper to get Emby client info for authenticated user
async function getEmbyClient(userId: string) {
  const settingsRepo = AppDataSource.getRepository(UserSettings);
  const settings = await settingsRepo.findOne({ where: { userId } });

  if (!settings?.embyServers?.length) {
    throw new AppError('No Emby server configured', 400);
  }

  const server = settings.embyServers[0];
  const accessToken = isEncrypted(server.accessToken)
    ? decryptForUser(userId, server.accessToken)
    : server.accessToken;

  return {
    baseUrl: server.address,
    userId: server.userId,
    accessToken,
    clientId: server.clientId,
    serverName: server.name,
  };
}

// Get libraries
router.get('/libraries', requireAuth, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const client = await getEmbyClient(req.user!.id);

    const response = await axios.get(`${client.baseUrl}/Users/${client.userId}/Views`, {
      headers: {
        'Accept': 'application/json',
        'X-Emby-Authorization': getEmbyAuthHeader(client.clientId, 'Flixor Web', client.accessToken),
      },
    });

    const libraries = (response.data.Items || []).map((lib: any) => ({
      id: lib.Id,
      key: lib.Id,
      title: lib.Name,
      type: lib.CollectionType === 'movies' ? 'movie' : lib.CollectionType === 'tvshows' ? 'show' : lib.CollectionType,
      thumb: lib.ImageTags?.Primary ? `${client.baseUrl}/Items/${lib.Id}/Images/Primary?tag=${lib.ImageTags.Primary}` : null,
    }));

    res.json(libraries);
  } catch (error: any) {
    logger.error('Failed to get Emby libraries:', error.message);
    next(new AppError('Failed to get libraries', 500));
  }
});

// Get library items
router.get('/libraries/:libraryId', requireAuth, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const { libraryId } = req.params;
    const { limit = 50, start = 0, sort = 'SortName' } = req.query;
    const client = await getEmbyClient(req.user!.id);

    const response = await axios.get(`${client.baseUrl}/Users/${client.userId}/Items`, {
      params: {
        ParentId: libraryId,
        Limit: limit,
        StartIndex: start,
        SortBy: sort,
        SortOrder: 'Ascending',
        Fields: 'Overview,Genres,CommunityRating,CriticRating,OfficialRating,RunTimeTicks,PremiereDate,ProductionYear',
        ImageTypeLimit: 1,
        EnableImageTypes: 'Primary,Backdrop,Thumb',
      },
      headers: {
        'Accept': 'application/json',
        'X-Emby-Authorization': getEmbyAuthHeader(client.clientId, 'Flixor Web', client.accessToken),
      },
    });

    const items = (response.data.Items || []).map((item: any) => normalizeEmbyItem(item, client.baseUrl));

    res.json({
      items,
      totalSize: response.data.TotalRecordCount || items.length,
    });
  } catch (error: any) {
    logger.error('Failed to get Emby library items:', error.message);
    next(new AppError('Failed to get library items', 500));
  }
});

// Get continue watching
router.get('/continue', requireAuth, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const client = await getEmbyClient(req.user!.id);

    const response = await axios.get(`${client.baseUrl}/Users/${client.userId}/Items/Resume`, {
      params: {
        Limit: 20,
        Fields: 'Overview,Genres,CommunityRating,RunTimeTicks,PremiereDate,ProductionYear',
        ImageTypeLimit: 1,
        EnableImageTypes: 'Primary,Backdrop,Thumb',
        MediaTypes: 'Video',
      },
      headers: {
        'Accept': 'application/json',
        'X-Emby-Authorization': getEmbyAuthHeader(client.clientId, 'Flixor Web', client.accessToken),
      },
    });

    logger.info('[Emby /continue] Raw items count:', response.data.Items?.length || 0);
    if (response.data.Items?.[0]) {
      logger.info('[Emby /continue] First raw item Id:', response.data.Items[0].Id, 'Name:', response.data.Items[0].Name, 'Type:', response.data.Items[0].Type);
    }

    const items = (response.data.Items || []).map((item: any) => normalizeEmbyItem(item, client.baseUrl));
    
    logger.info('[Emby /continue] Normalized items count:', items.length);
    if (items[0]) {
      logger.info('[Emby /continue] First normalized item ratingKey:', items[0].ratingKey, 'title:', items[0].title, 'type:', items[0].type);
    }

    res.json(items);
  } catch (error: any) {
    logger.error('Failed to get Emby continue watching:', error.message);
    next(new AppError('Failed to get continue watching', 500));
  }
});

// Get latest items
router.get('/latest', requireAuth, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const { libraryId } = req.query;
    const client = await getEmbyClient(req.user!.id);

    const params: any = {
      Limit: 20,
      Fields: 'Overview,Genres,CommunityRating,RunTimeTicks,PremiereDate,ProductionYear',
      ImageTypeLimit: 1,
      EnableImageTypes: 'Primary,Backdrop,Thumb',
    };
    if (libraryId) params.ParentId = libraryId;

    const response = await axios.get(`${client.baseUrl}/Users/${client.userId}/Items/Latest`, {
      params,
      headers: {
        'Accept': 'application/json',
        'X-Emby-Authorization': getEmbyAuthHeader(client.clientId, 'Flixor Web', client.accessToken),
      },
    });

    const items = (response.data || []).map((item: any) => normalizeEmbyItem(item, client.baseUrl));

    res.json(items);
  } catch (error: any) {
    logger.error('Failed to get Emby latest items:', error.message);
    next(new AppError('Failed to get latest items', 500));
  }
});

// Get item details
router.get('/items/:itemId', requireAuth, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const { itemId } = req.params;
    const client = await getEmbyClient(req.user!.id);

    const response = await axios.get(`${client.baseUrl}/Users/${client.userId}/Items/${itemId}`, {
      params: {
        Fields: 'Overview,Genres,People,Studios,CommunityRating,CriticRating,OfficialRating,RunTimeTicks,PremiereDate,ProductionYear,Taglines,ExternalUrls',
      },
      headers: {
        'Accept': 'application/json',
        'X-Emby-Authorization': getEmbyAuthHeader(client.clientId, 'Flixor Web', client.accessToken),
      },
    });

    const item = normalizeEmbyItem(response.data, client.baseUrl);
    res.json(item);
  } catch (error: any) {
    logger.error('Failed to get Emby item:', error.message);
    next(new AppError('Failed to get item', 500));
  }
});

// Search
router.get('/search', requireAuth, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const { query, limit = 20 } = req.query;
    if (!query) {
      return res.json([]);
    }

    const client = await getEmbyClient(req.user!.id);

    const response = await axios.get(`${client.baseUrl}/Users/${client.userId}/Items`, {
      params: {
        SearchTerm: query,
        Limit: limit,
        IncludeItemTypes: 'Movie,Series,Episode',
        Fields: 'Overview,Genres,CommunityRating,RunTimeTicks,PremiereDate,ProductionYear',
        ImageTypeLimit: 1,
        EnableImageTypes: 'Primary,Backdrop,Thumb',
        Recursive: true,
      },
      headers: {
        'Accept': 'application/json',
        'X-Emby-Authorization': getEmbyAuthHeader(client.clientId, 'Flixor Web', client.accessToken),
      },
    });

    const items = (response.data.Items || []).map((item: any) => normalizeEmbyItem(item, client.baseUrl));

    res.json(items);
  } catch (error: any) {
    logger.error('Failed to search Emby:', error.message);
    next(new AppError('Failed to search', 500));
  }
});

// Helper to normalize Emby items to Plex-like format
function normalizeEmbyItem(item: any, baseUrl: string) {
  const type = item.Type === 'Movie' ? 'movie' : item.Type === 'Series' ? 'show' : item.Type === 'Episode' ? 'episode' : item.Type?.toLowerCase();
  
  // Build Plex-compatible Media array from Emby MediaSources
  const mediaArray = (item.MediaSources || []).map((ms: any, idx: number) => {
    const videoStream = (ms.MediaStreams || []).find((s: any) => s.Type === 'Video');
    const audioStream = (ms.MediaStreams || []).find((s: any) => s.Type === 'Audio');
    
    return {
      id: ms.Id || item.Id,
      duration: ms.RunTimeTicks ? Math.round(ms.RunTimeTicks / 10000) : null,
      bitrate: ms.Bitrate ? Math.round(ms.Bitrate / 1000) : null,
      width: videoStream?.Width,
      height: videoStream?.Height,
      videoCodec: videoStream?.Codec,
      videoProfile: videoStream?.Profile,
      audioCodec: audioStream?.Codec,
      audioChannels: audioStream?.Channels,
      container: ms.Container,
      Part: [{
        id: ms.Id || item.Id, // Use MediaSource ID as Part ID
        key: `/Items/${item.Id}/stream`,
        duration: ms.RunTimeTicks ? Math.round(ms.RunTimeTicks / 10000) : null,
        size: ms.Size,
        container: ms.Container,
        Stream: (ms.MediaStreams || []).map((stream: any, sIdx: number) => ({
          id: stream.Index || sIdx,
          streamType: stream.Type === 'Video' ? 1 : stream.Type === 'Audio' ? 2 : stream.Type === 'Subtitle' ? 3 : 0,
          codec: stream.Codec,
          language: stream.Language,
          languageTag: stream.Language,
          displayTitle: stream.DisplayTitle || stream.Title || `${stream.Type} ${sIdx + 1}`,
          channels: stream.Channels,
          bitrate: stream.BitRate,
          width: stream.Width,
          height: stream.Height,
        })),
      }],
    };
  });

  return {
    ratingKey: item.Id,
    key: `/library/metadata/${item.Id}`,
    type,
    title: item.Name,
    originalTitle: item.OriginalTitle,
    summary: item.Overview,
    year: item.ProductionYear,
    thumb: item.ImageTags?.Primary ? `${baseUrl}/Items/${item.Id}/Images/Primary?tag=${item.ImageTags.Primary}` : null,
    art: item.BackdropImageTags?.length ? `${baseUrl}/Items/${item.Id}/Images/Backdrop?tag=${item.BackdropImageTags[0]}` : null,
    duration: item.RunTimeTicks ? Math.round(item.RunTimeTicks / 10000) : null,
    viewOffset: item.UserData?.PlaybackPositionTicks ? Math.round(item.UserData.PlaybackPositionTicks / 10000) : null,
    rating: item.CommunityRating,
    contentRating: item.OfficialRating,
    genres: item.Genres || [],
    addedAt: item.DateCreated ? new Date(item.DateCreated).getTime() / 1000 : null,
    parentTitle: item.SeriesName,
    grandparentTitle: item.SeriesName,
    parentIndex: item.ParentIndexNumber,
    index: item.IndexNumber,
    parentRatingKey: item.SeriesId,
    grandparentRatingKey: item.SeriesId,
    // Media info (Plex-compatible)
    Media: mediaArray.length > 0 ? mediaArray : undefined,
    _source: 'emby',
  };
}

// ============ Plex-compatible routes for frontend compatibility ============

// GET /ondeck - On deck / continue watching
router.get('/ondeck', requireAuth, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const client = await getEmbyClient(req.user!.id);

    const response = await axios.get(`${client.baseUrl}/Users/${client.userId}/Items/Resume`, {
      params: {
        Limit: 20,
        Fields: 'Overview,Genres,CommunityRating,RunTimeTicks,PremiereDate,ProductionYear',
        ImageTypeLimit: 1,
        EnableImageTypes: 'Primary,Backdrop,Thumb',
        MediaTypes: 'Video',
      },
      headers: {
        'Accept': 'application/json',
        'X-Emby-Authorization': getEmbyAuthHeader(client.clientId, 'Flixor Web', client.accessToken),
      },
    });

    const items = (response.data.Items || []).map((item: any) => normalizeEmbyItem(item, client.baseUrl));
    res.json(items);
  } catch (error: any) {
    logger.error('Failed to get Emby ondeck:', error.message);
    res.json([]);
  }
});

// GET /recent - Recently added
router.get('/recent', requireAuth, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const { library } = req.query;
    const client = await getEmbyClient(req.user!.id);

    const params: any = {
      Limit: 20,
      Fields: 'Overview,Genres,CommunityRating,RunTimeTicks,PremiereDate,ProductionYear',
      ImageTypeLimit: 1,
      EnableImageTypes: 'Primary,Backdrop,Thumb',
      SortBy: 'DateCreated',
      SortOrder: 'Descending',
    };
    if (library) params.ParentId = library;

    const response = await axios.get(`${client.baseUrl}/Users/${client.userId}/Items/Latest`, {
      params,
      headers: {
        'Accept': 'application/json',
        'X-Emby-Authorization': getEmbyAuthHeader(client.clientId, 'Flixor Web', client.accessToken),
      },
    });

    const items = (response.data || []).map((item: any) => normalizeEmbyItem(item, client.baseUrl));
    res.json(items);
  } catch (error: any) {
    logger.error('Failed to get Emby recent:', error.message);
    res.json([]);
  }
});

// GET /library/:sectionKey/all - Library items (Plex-style)
router.get('/library/:sectionKey/all', requireAuth, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const { sectionKey } = req.params;
    // Support both Plex-style headers and simple query params
    const start = req.query.offset || req.query['X-Plex-Container-Start'] || 0;
    const limit = req.query.limit || req.query['X-Plex-Container-Size'] || 100;
    const { sort } = req.query;
    const client = await getEmbyClient(req.user!.id);

    // Map Plex sort to Emby
    let embySort = 'SortName';
    let sortOrder = 'Ascending';
    if (sort) {
      const sortStr = String(sort);
      if (sortStr.includes('addedAt')) {
        embySort = 'DateCreated';
        sortOrder = sortStr.includes(':desc') ? 'Descending' : 'Ascending';
      } else if (sortStr.includes('title')) {
        embySort = 'SortName';
        sortOrder = sortStr.includes(':desc') ? 'Descending' : 'Ascending';
      } else if (sortStr.includes('year')) {
        embySort = 'ProductionYear';
        sortOrder = sortStr.includes(':desc') ? 'Descending' : 'Ascending';
      }
    }

    logger.info('[Emby /library/all] Fetching items for section:', sectionKey, 'start:', start, 'limit:', limit);

    const response = await axios.get(`${client.baseUrl}/Users/${client.userId}/Items`, {
      params: {
        ParentId: sectionKey,
        Limit: Number(limit),
        StartIndex: Number(start),
        SortBy: embySort,
        SortOrder: sortOrder,
        Fields: 'Overview,Genres,CommunityRating,CriticRating,OfficialRating,RunTimeTicks,PremiereDate,ProductionYear',
        ImageTypeLimit: 1,
        EnableImageTypes: 'Primary,Backdrop,Thumb',
        Recursive: true,
        IncludeItemTypes: 'Movie,Series',
      },
      headers: {
        'Accept': 'application/json',
        'X-Emby-Authorization': getEmbyAuthHeader(client.clientId, 'Flixor Web', client.accessToken),
      },
    });

    logger.info('[Emby /library/all] Got', response.data.Items?.length, 'items out of', response.data.TotalRecordCount, 'total');

    const items = (response.data.Items || []).map((item: any) => normalizeEmbyItem(item, client.baseUrl));

    // Return in Plex MediaContainer format
    res.json({
      MediaContainer: {
        size: items.length,
        totalSize: response.data.TotalRecordCount || items.length,
        offset: Number(start),
        Metadata: items,
      }
    });
  } catch (error: any) {
    logger.error('Failed to get Emby library items:', error.message);
    res.json({ MediaContainer: { size: 0, totalSize: 0, Metadata: [] } });
  }
});

// GET /metadata/:ratingKey - Get item metadata
router.get('/metadata/:ratingKey', requireAuth, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const { ratingKey } = req.params;
    const client = await getEmbyClient(req.user!.id);
    logger.info('[Emby /metadata] Fetching metadata for ratingKey:', ratingKey);

    // Fetch both item metadata and playback info for MediaSources
    const [metaResponse, playbackResponse] = await Promise.all([
      axios.get(`${client.baseUrl}/Users/${client.userId}/Items/${ratingKey}`, {
        params: {
          Fields: 'Overview,Genres,People,Studios,CommunityRating,CriticRating,OfficialRating,RunTimeTicks,PremiereDate,ProductionYear,Taglines,ExternalUrls,ChildCount,MediaSources,MediaStreams',
        },
        headers: {
          'Accept': 'application/json',
          'X-Emby-Authorization': getEmbyAuthHeader(client.clientId, 'Flixor Web', client.accessToken),
        },
      }),
      // Also fetch PlaybackInfo to get detailed MediaSources with streams
      axios.get(`${client.baseUrl}/Items/${ratingKey}/PlaybackInfo`, {
        params: {
          UserId: client.userId,
        },
        headers: {
          'Accept': 'application/json',
          'X-Emby-Authorization': getEmbyAuthHeader(client.clientId, 'Flixor Web', client.accessToken),
        },
      }).catch(() => ({ data: {} })), // Don't fail if PlaybackInfo errors (e.g., for Series)
    ]);

    logger.info('[Emby /metadata] Raw Emby response type:', metaResponse.data?.Type);
    logger.info('[Emby /metadata] Raw Emby response name:', metaResponse.data?.Name);
    logger.info('[Emby /metadata] Raw Emby response Id:', metaResponse.data?.Id);

    // Merge MediaSources from PlaybackInfo into item data
    const itemData = { ...metaResponse.data };
    if (playbackResponse.data.MediaSources?.length) {
      itemData.MediaSources = playbackResponse.data.MediaSources;
    }

    const item = normalizeEmbyItem(itemData, client.baseUrl);
    logger.info('[Emby /metadata] Normalized item ratingKey:', item.ratingKey, 'type:', item.type, 'title:', item.title);
    res.json(item);
  } catch (error: any) {
    logger.error('Failed to get Emby metadata:', error.message);
    next(new AppError('Failed to get metadata', 500));
  }
});

// GET /library/:sectionKey/:directory - Get secondary directory (genres, etc.)
router.get('/library/:sectionKey/:directory', requireAuth, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const { sectionKey, directory } = req.params;
    const client = await getEmbyClient(req.user!.id);

    let items: any[] = [];
    
    if (directory === 'genre') {
      const response = await axios.get(`${client.baseUrl}/Genres`, {
        params: {
          ParentId: sectionKey,
          UserId: client.userId,
        },
        headers: {
          'Accept': 'application/json',
          'X-Emby-Authorization': getEmbyAuthHeader(client.clientId, 'Flixor Web', client.accessToken),
        },
      });
      items = (response.data.Items || []).map((g: any) => ({
        key: g.Id,
        title: g.Name,
        type: 'genre',
      }));
    } else if (directory === 'year') {
      const response = await axios.get(`${client.baseUrl}/Years`, {
        params: {
          ParentId: sectionKey,
          UserId: client.userId,
        },
        headers: {
          'Accept': 'application/json',
          'X-Emby-Authorization': getEmbyAuthHeader(client.clientId, 'Flixor Web', client.accessToken),
        },
      });
      items = (response.data.Items || []).map((y: any) => ({
        key: y.Id,
        title: y.Name,
        type: 'year',
      }));
    }

    res.json({ Directory: items });
  } catch (error: any) {
    logger.error('Failed to get Emby secondary directory:', error.message);
    res.json({ Directory: [] });
  }
});

// GET /library/:sectionKey/collections - Get collections
router.get('/library/:sectionKey/collections', requireAuth, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const { sectionKey } = req.params;
    const client = await getEmbyClient(req.user!.id);

    const response = await axios.get(`${client.baseUrl}/Users/${client.userId}/Items`, {
      params: {
        ParentId: sectionKey,
        IncludeItemTypes: 'BoxSet',
        Recursive: true,
        Fields: 'Overview,PrimaryImageAspectRatio',
        ImageTypeLimit: 1,
        EnableImageTypes: 'Primary,Backdrop',
      },
      headers: {
        'Accept': 'application/json',
        'X-Emby-Authorization': getEmbyAuthHeader(client.clientId, 'Flixor Web', client.accessToken),
      },
    });

    const collections = (response.data.Items || []).map((c: any) => normalizeEmbyItem(c, client.baseUrl));
    res.json({ Metadata: collections });
  } catch (error: any) {
    logger.error('Failed to get Emby collections:', error.message);
    res.json({ Metadata: [] });
  }
});

// GET /dir/* - Directory browsing (for children, seasons, episodes, and genre/filter browsing)
router.get('/dir/*', requireAuth, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const path = req.params[0] || '';
    const client = await getEmbyClient(req.user!.id);
    logger.info('[Emby /dir] Request path:', path);

    // Pattern: /library/metadata/{id}/children - for seasons/episodes
    const childrenMatch = path.match(/library\/metadata\/([^/]+)\/children/);
    
    // Pattern: /library/sections/{sectionKey}/genre/{genreId} - for genre browsing
    const genreMatch = path.match(/library\/sections\/([^/]+)\/genre\/([^/]+)/);
    
    // Pattern: /library/sections/{sectionKey}/year/{year} - for year browsing  
    const yearMatch = path.match(/library\/sections\/([^/]+)\/year\/([^/]+)/);
    
    // Pattern: /library/sections/{sectionKey}/all - for all items in section
    const allMatch = path.match(/library\/sections\/([^/]+)\/all/);

    if (childrenMatch) {
      const parentId = childrenMatch[1];
      logger.info('[Emby /dir] Fetching children for parentId:', parentId);
      
      // First, fetch the parent item to determine its type
      const parentResponse = await axios.get(`${client.baseUrl}/Users/${client.userId}/Items/${parentId}`, {
        headers: {
          'Accept': 'application/json',
          'X-Emby-Authorization': getEmbyAuthHeader(client.clientId, 'Flixor Web', client.accessToken),
        },
      });

      const parentItem = parentResponse.data;
      const parentType = parentItem?.Type;
      logger.info('[Emby /dir] Parent item type:', parentType, 'Name:', parentItem?.Name);

      let response;

      if (parentType === 'Series') {
        // Use dedicated /Shows/{seriesId}/Seasons endpoint for TV series
        logger.info('[Emby /dir] Fetching seasons for series:', parentId);
        response = await axios.get(`${client.baseUrl}/Shows/${parentId}/Seasons`, {
          params: {
            UserId: client.userId,
            Fields: 'Overview,Genres,CommunityRating,RunTimeTicks,PremiereDate,ProductionYear,ItemCounts',
            ImageTypeLimit: 1,
            EnableImageTypes: 'Primary,Backdrop,Thumb',
          },
          headers: {
            'Accept': 'application/json',
            'X-Emby-Authorization': getEmbyAuthHeader(client.clientId, 'Flixor Web', client.accessToken),
          },
        });
        logger.info('[Emby /dir] Seasons response items count:', response.data.Items?.length || 0);
      } else if (parentType === 'Season') {
        // Use dedicated /Shows/{seriesId}/Episodes endpoint for TV seasons
        const seriesId = parentItem.SeriesId;
        logger.info('[Emby /dir] Fetching episodes for season:', parentId, 'seriesId:', seriesId);
        response = await axios.get(`${client.baseUrl}/Shows/${seriesId}/Episodes`, {
          params: {
            UserId: client.userId,
            SeasonId: parentId,
            Fields: 'Overview,Genres,CommunityRating,RunTimeTicks,PremiereDate,ProductionYear,MediaSources',
            ImageTypeLimit: 1,
            EnableImageTypes: 'Primary,Backdrop,Thumb,Screenshot',
          },
          headers: {
            'Accept': 'application/json',
            'X-Emby-Authorization': getEmbyAuthHeader(client.clientId, 'Flixor Web', client.accessToken),
          },
        });
        logger.info('[Emby /dir] Episodes response items count:', response.data.Items?.length || 0);
      } else {
        // Fallback to generic Items endpoint for other types (folders, etc.)
        logger.info('[Emby /dir] Using generic Items endpoint for type:', parentType);
        response = await axios.get(`${client.baseUrl}/Users/${client.userId}/Items`, {
          params: {
            ParentId: parentId,
            Fields: 'Overview,Genres,CommunityRating,RunTimeTicks,PremiereDate,ProductionYear',
            ImageTypeLimit: 1,
            EnableImageTypes: 'Primary,Backdrop,Thumb',
          },
          headers: {
            'Accept': 'application/json',
            'X-Emby-Authorization': getEmbyAuthHeader(client.clientId, 'Flixor Web', client.accessToken),
          },
        });
      }

      logger.info('[Emby /dir] Raw response items count:', response.data.Items?.length || 0);
      if (response.data.Items?.[0]) {
        logger.info('[Emby /dir] First raw item:', JSON.stringify(response.data.Items[0], null, 2));
      }

      const items = (response.data.Items || []).map((item: any) => normalizeEmbyItem(item, client.baseUrl));
      logger.info('[Emby /dir] Normalized items count:', items.length);
      if (items[0]) {
        logger.info('[Emby /dir] First normalized item:', JSON.stringify(items[0], null, 2));
      }
      
      res.json({ Metadata: items, Directory: [] });
    } else if (genreMatch) {
      // Handle genre browsing: /library/sections/{sectionKey}/genre/{genreId}
      const sectionKey = genreMatch[1];
      const genreId = genreMatch[2];
      logger.info('[Emby /dir] Fetching items by genre:', genreId, 'in section:', sectionKey);
      
      const response = await axios.get(`${client.baseUrl}/Users/${client.userId}/Items`, {
        params: {
          ParentId: sectionKey,
          GenreIds: genreId,
          Recursive: true,
          Fields: 'Overview,Genres,CommunityRating,RunTimeTicks,PremiereDate,ProductionYear',
          ImageTypeLimit: 1,
          EnableImageTypes: 'Primary,Backdrop,Thumb',
          Limit: 50,
        },
        headers: {
          'Accept': 'application/json',
          'X-Emby-Authorization': getEmbyAuthHeader(client.clientId, 'Flixor Web', client.accessToken),
        },
      });

      const items = (response.data.Items || []).map((item: any) => normalizeEmbyItem(item, client.baseUrl));
      logger.info('[Emby /dir] Genre items count:', items.length);
      res.json({ Metadata: items, Directory: [] });
    } else if (yearMatch) {
      // Handle year browsing: /library/sections/{sectionKey}/year/{year}
      const sectionKey = yearMatch[1];
      const year = yearMatch[2];
      logger.info('[Emby /dir] Fetching items by year:', year, 'in section:', sectionKey);
      
      const response = await axios.get(`${client.baseUrl}/Users/${client.userId}/Items`, {
        params: {
          ParentId: sectionKey,
          Years: year,
          Recursive: true,
          Fields: 'Overview,Genres,CommunityRating,RunTimeTicks,PremiereDate,ProductionYear',
          ImageTypeLimit: 1,
          EnableImageTypes: 'Primary,Backdrop,Thumb',
          Limit: 50,
        },
        headers: {
          'Accept': 'application/json',
          'X-Emby-Authorization': getEmbyAuthHeader(client.clientId, 'Flixor Web', client.accessToken),
        },
      });

      const items = (response.data.Items || []).map((item: any) => normalizeEmbyItem(item, client.baseUrl));
      logger.info('[Emby /dir] Year items count:', items.length);
      res.json({ Metadata: items, Directory: [] });
    } else if (allMatch) {
      // Handle all items: /library/sections/{sectionKey}/all
      const sectionKey = allMatch[1];
      logger.info('[Emby /dir] Fetching all items in section:', sectionKey);
      
      const response = await axios.get(`${client.baseUrl}/Users/${client.userId}/Items`, {
        params: {
          ParentId: sectionKey,
          Recursive: true,
          Fields: 'Overview,Genres,CommunityRating,RunTimeTicks,PremiereDate,ProductionYear',
          ImageTypeLimit: 1,
          EnableImageTypes: 'Primary,Backdrop,Thumb',
          Limit: 100,
        },
        headers: {
          'Accept': 'application/json',
          'X-Emby-Authorization': getEmbyAuthHeader(client.clientId, 'Flixor Web', client.accessToken),
        },
      });

      const items = (response.data.Items || []).map((item: any) => normalizeEmbyItem(item, client.baseUrl));
      logger.info('[Emby /dir] All items count:', items.length);
      res.json({ Metadata: items, Directory: [] });
    } else {
      logger.warn('[Emby /dir] Unhandled path pattern:', path);
      res.json({ Metadata: [], Directory: [] });
    }
  } catch (error: any) {
    logger.error('Failed to get Emby directory:', error.message);
    res.json({ Metadata: [], Directory: [] });
  }
});

// POST /scrobble - Mark item as watched
router.post('/scrobble', requireAuth, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const { ratingKey } = req.body;
    if (!ratingKey) {
      return res.status(400).json({ error: 'ratingKey is required' });
    }

    const client = await getEmbyClient(req.user!.id);

    await axios.post(`${client.baseUrl}/Users/${client.userId}/PlayedItems/${ratingKey}`, null, {
      headers: {
        'X-Emby-Authorization': getEmbyAuthHeader(client.clientId, 'Flixor Web', client.accessToken),
      },
    });

    res.json({ success: true });
  } catch (error: any) {
    logger.error('Failed to scrobble Emby item:', error.message);
    res.json({ success: false, error: error.message });
  }
});

// DELETE /scrobble - Mark item as unwatched
router.delete('/scrobble', requireAuth, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const { ratingKey } = req.body;
    if (!ratingKey) {
      return res.status(400).json({ error: 'ratingKey is required' });
    }

    const client = await getEmbyClient(req.user!.id);

    await axios.delete(`${client.baseUrl}/Users/${client.userId}/PlayedItems/${ratingKey}`, {
      headers: {
        'X-Emby-Authorization': getEmbyAuthHeader(client.clientId, 'Flixor Web', client.accessToken),
      },
    });

    res.json({ success: true });
  } catch (error: any) {
    logger.error('Failed to unscrobble Emby item:', error.message);
    res.json({ success: false, error: error.message });
  }
});

// POST /favorite - Toggle favorite status
router.post('/favorite', requireAuth, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const { ratingKey, favorite } = req.body;
    if (!ratingKey) {
      return res.status(400).json({ error: 'ratingKey is required' });
    }

    const client = await getEmbyClient(req.user!.id);

    if (favorite) {
      await axios.post(`${client.baseUrl}/Users/${client.userId}/FavoriteItems/${ratingKey}`, null, {
        headers: {
          'X-Emby-Authorization': getEmbyAuthHeader(client.clientId, 'Flixor Web', client.accessToken),
        },
      });
    } else {
      await axios.delete(`${client.baseUrl}/Users/${client.userId}/FavoriteItems/${ratingKey}`, {
        headers: {
          'X-Emby-Authorization': getEmbyAuthHeader(client.clientId, 'Flixor Web', client.accessToken),
        },
      });
    }

    res.json({ success: true });
  } catch (error: any) {
    logger.error('Failed to toggle Emby favorite:', error.message);
    res.json({ success: false, error: error.message });
  }
});

// GET /stream/:itemId - Get stream URL for playback
router.get('/stream/:itemId', requireAuth, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const { itemId } = req.params;
    const client = await getEmbyClient(req.user!.id);

    // Get playback info to find media sources
    const response = await axios.get(`${client.baseUrl}/Items/${itemId}/PlaybackInfo`, {
      params: {
        UserId: client.userId,
      },
      headers: {
        'Accept': 'application/json',
        'X-Emby-Authorization': getEmbyAuthHeader(client.clientId, 'Flixor Web', client.accessToken),
      },
    });

    const mediaSources = response.data.MediaSources || [];
    if (mediaSources.length === 0) {
      return res.status(404).json({ error: 'No media sources found' });
    }

    const source = mediaSources[0];
    const playSessionId = response.data.PlaySessionId;

    // Build direct stream URL
    const streamUrl = `${client.baseUrl}/Videos/${itemId}/stream?Static=true&mediaSourceId=${source.Id}&api_key=${client.accessToken}&PlaySessionId=${playSessionId}`;

    res.json({
      url: streamUrl,
      playSessionId,
      mediaSourceId: source.Id,
      container: source.Container,
      directPlay: source.SupportsDirectPlay,
      directStream: source.SupportsDirectStream,
    });
  } catch (error: any) {
    logger.error('Failed to get Emby stream URL:', error.message);
    next(new AppError('Failed to get stream URL', 500));
  }
});

// POST /progress - Report playback progress
router.post('/progress', requireAuth, async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    const { ratingKey, time, duration, state } = req.body;
    if (!ratingKey) {
      return res.status(400).json({ error: 'ratingKey is required' });
    }

    const client = await getEmbyClient(req.user!.id);
    const positionTicks = Math.floor((time || 0) * 10000); // ms to ticks

    const isPaused = state === 'paused';
    const isStopped = state === 'stopped';

    if (isStopped) {
      // Report playback stopped
      await axios.post(`${client.baseUrl}/Sessions/Playing/Stopped`, {
        ItemId: ratingKey,
        PositionTicks: positionTicks,
      }, {
        headers: {
          'Content-Type': 'application/json',
          'X-Emby-Authorization': getEmbyAuthHeader(client.clientId, 'Flixor Web', client.accessToken),
        },
      });
    } else {
      // Report playback progress
      await axios.post(`${client.baseUrl}/Sessions/Playing/Progress`, {
        ItemId: ratingKey,
        PositionTicks: positionTicks,
        IsPaused: isPaused,
        CanSeek: true,
      }, {
        headers: {
          'Content-Type': 'application/json',
          'X-Emby-Authorization': getEmbyAuthHeader(client.clientId, 'Flixor Web', client.accessToken),
        },
      });
    }

    res.json({ success: true });
  } catch (error: any) {
    logger.error('Failed to update Emby progress:', error.message);
    // Don't fail the request, just log the error
    res.json({ success: false, error: error.message });
  }
});

export { router as embyRouter };
export default router;
