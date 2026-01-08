// Jellyfin/Emby shared models
// Jellyfin is a fork of Emby, so they share most API structures

// Authentication
export interface JellyfinAuthResult {
  User: JellyfinUser;
  AccessToken: string;
  ServerId: string;
  SessionInfo?: JellyfinSessionInfo;
}

export interface JellyfinUser {
  Id: string;
  Name: string;
  ServerId?: string;
  PrimaryImageTag?: string;
  HasPassword?: boolean;
  HasConfiguredPassword?: boolean;
  HasConfiguredEasyPassword?: boolean;
  EnableAutoLogin?: boolean;
  LastLoginDate?: string;
  LastActivityDate?: string;
  Policy?: JellyfinUserPolicy;
  Configuration?: JellyfinUserConfiguration;
}

export interface JellyfinUserPolicy {
  IsAdministrator?: boolean;
  IsHidden?: boolean;
  IsDisabled?: boolean;
  EnableUserPreferenceAccess?: boolean;
  EnableRemoteAccess?: boolean;
  EnableLiveTvAccess?: boolean;
  EnableContentDeletion?: boolean;
  EnableSync?: boolean;
  EnableAllFolders?: boolean;
  EnabledFolders?: string[];
}

export interface JellyfinUserConfiguration {
  AudioLanguagePreference?: string;
  SubtitleLanguagePreference?: string;
  EnableLocalPassword?: boolean;
}

export interface JellyfinSessionInfo {
  Id: string;
  UserId: string;
  UserName: string;
  Client: string;
  DeviceId: string;
  DeviceName: string;
  ApplicationVersion?: string;
  LastActivityDate?: string;
  ServerId?: string;
  PlayState?: JellyfinPlayState;
  NowPlayingItem?: JellyfinMediaItem;
}

export interface JellyfinPlayState {
  PositionTicks?: number;
  CanSeek?: boolean;
  IsPaused?: boolean;
  IsMuted?: boolean;
  VolumeLevel?: number;
  PlayMethod?: 'DirectStream' | 'DirectPlay' | 'Transcode';
  RepeatMode?: string;
}

// Server info
export interface JellyfinServer {
  id: string;
  name: string;
  address: string;
  accessToken: string;
  userId: string;
  version?: string;
  productName?: string; // 'Jellyfin' or 'Emby'
}

export interface JellyfinServerInfo {
  Id: string;
  ServerName: string;
  Version: string;
  ProductName?: string; // 'Jellyfin Server' or 'Emby Server'
  OperatingSystem?: string;
  LocalAddress?: string;
  WanAddress?: string;
  HasUpdateAvailable?: boolean;
  StartupWizardCompleted?: boolean;
}

export interface JellyfinPublicInfo {
  LocalAddress?: string;
  ServerName: string;
  Version: string;
  ProductName?: string;
  OperatingSystem?: string;
  Id: string;
  StartupWizardCompleted?: boolean;
}

// Library
export interface JellyfinLibrary {
  Id: string;
  Name: string;
  CollectionType?: 'movies' | 'tvshows' | 'music' | 'photos' | 'books' | 'homevideos' | 'boxsets' | 'mixed';
  LibraryOptions?: JellyfinLibraryOptions;
  ImageTags?: Record<string, string>;
  PrimaryImageTag?: string;
  PrimaryImageItemId?: string;
}

export interface JellyfinLibraryOptions {
  EnableArchiveMediaFiles?: boolean;
  EnablePhotos?: boolean;
  EnableRealtimeMonitor?: boolean;
  ExtractChapterImagesDuringLibraryScan?: boolean;
  PathInfos?: Array<{
    Path: string;
    NetworkPath?: string;
  }>;
}

// Media Items
export interface JellyfinMediaItem {
  Id: string;
  Name: string;
  ServerId?: string;
  Type: JellyfinItemType;
  MediaType?: 'Video' | 'Audio' | 'Photo' | 'Book';
  
  // Common metadata
  Overview?: string;
  OriginalTitle?: string;
  SortName?: string;
  PremiereDate?: string;
  ProductionYear?: number;
  EndDate?: string;
  OfficialRating?: string;
  CommunityRating?: number;
  CriticRating?: number;
  RunTimeTicks?: number; // Duration in ticks (1 tick = 100 nanoseconds)
  
  // Images
  ImageTags?: Record<string, string>;
  BackdropImageTags?: string[];
  PrimaryImageTag?: string;
  PrimaryImageAspectRatio?: number;
  
  // Playback
  PlayAccess?: 'Full' | 'None';
  UserData?: JellyfinUserItemData;
  
  // TV Show specific
  SeriesId?: string;
  SeriesName?: string;
  SeriesPrimaryImageTag?: string;
  SeasonId?: string;
  SeasonName?: string;
  ParentIndexNumber?: number; // Season number
  IndexNumber?: number; // Episode number
  
  // Season specific
  ChildCount?: number; // Number of episodes
  
  // Media info
  MediaSources?: JellyfinMediaSource[];
  MediaStreams?: JellyfinMediaStream[];
  
  // External IDs
  ProviderIds?: {
    Tmdb?: string;
    Imdb?: string;
    Tvdb?: string;
    [key: string]: string | undefined;
  };
  
  // Chapters
  Chapters?: JellyfinChapter[];
  
  // People (cast/crew)
  People?: JellyfinPerson[];
  
  // Genres
  Genres?: string[];
  GenreItems?: Array<{ Id: string; Name: string }>;
  
  // Studios
  Studios?: Array<{ Id: string; Name: string }>;
  
  // Tags
  Tags?: string[];
  
  // Container
  Container?: string;
  
  // Path
  Path?: string;
}

export type JellyfinItemType = 
  | 'Movie'
  | 'Series'
  | 'Season'
  | 'Episode'
  | 'Audio'
  | 'MusicAlbum'
  | 'MusicArtist'
  | 'Photo'
  | 'PhotoAlbum'
  | 'Folder'
  | 'CollectionFolder'
  | 'BoxSet'
  | 'Playlist'
  | 'Video'
  | 'Book';

export interface JellyfinUserItemData {
  PlaybackPositionTicks?: number;
  PlayCount?: number;
  IsFavorite?: boolean;
  Played?: boolean;
  LastPlayedDate?: string;
  UnplayedItemCount?: number; // For series/seasons
}

export interface JellyfinMediaSource {
  Id: string;
  Name?: string;
  Path?: string;
  Protocol?: 'File' | 'Http' | 'Rtmp' | 'Rtsp' | 'Udp' | 'Rtp' | 'Ftp';
  Container?: string;
  Size?: number;
  Bitrate?: number;
  RunTimeTicks?: number;
  Type?: 'Default' | 'Grouping' | 'Placeholder';
  IsRemote?: boolean;
  SupportsDirectPlay?: boolean;
  SupportsDirectStream?: boolean;
  SupportsTranscoding?: boolean;
  RequiresOpening?: boolean;
  RequiresClosing?: boolean;
  MediaStreams?: JellyfinMediaStream[];
  DirectStreamUrl?: string;
  TranscodingUrl?: string;
}

export interface JellyfinMediaStream {
  Codec?: string;
  Language?: string;
  DisplayLanguage?: string;
  DisplayTitle?: string;
  Title?: string;
  Type: 'Video' | 'Audio' | 'Subtitle' | 'EmbeddedImage';
  Index: number;
  IsDefault?: boolean;
  IsForced?: boolean;
  IsExternal?: boolean;
  IsTextSubtitleStream?: boolean;
  
  // Video specific
  Width?: number;
  Height?: number;
  AspectRatio?: string;
  BitRate?: number;
  BitDepth?: number;
  VideoRange?: string;
  VideoRangeType?: string;
  
  // Audio specific
  Channels?: number;
  SampleRate?: number;
  ChannelLayout?: string;
}

export interface JellyfinChapter {
  StartPositionTicks: number;
  Name?: string;
  ImageTag?: string;
  MarkerType?: 'Chapter' | 'IntroStart' | 'IntroEnd' | 'CreditsStart';
}

export interface JellyfinPerson {
  Id: string;
  Name: string;
  Role?: string;
  Type: 'Actor' | 'Director' | 'Writer' | 'Producer' | 'Composer' | 'GuestStar';
  PrimaryImageTag?: string;
}

// Library query options
export interface JellyfinLibraryOptions {
  ParentId?: string;
  IncludeItemTypes?: JellyfinItemType[];
  ExcludeItemTypes?: JellyfinItemType[];
  Recursive?: boolean;
  SortBy?: string | string[];
  SortOrder?: 'Ascending' | 'Descending';
  StartIndex?: number;
  Limit?: number;
  Fields?: string[];
  Filters?: string[];
  SearchTerm?: string;
  IsFavorite?: boolean;
  IsPlayed?: boolean;
  EnableImages?: boolean;
  ImageTypeLimit?: number;
  EnableImageTypes?: string[];
  EnableUserData?: boolean;
}

// API Response wrappers
export interface JellyfinQueryResult<T> {
  Items: T[];
  TotalRecordCount: number;
  StartIndex?: number;
}

// Resume/Continue watching
export interface JellyfinResumeItem extends JellyfinMediaItem {
  // Inherits all properties from JellyfinMediaItem
}

// Image types
export type JellyfinImageType = 
  | 'Primary'
  | 'Art'
  | 'Backdrop'
  | 'Banner'
  | 'Logo'
  | 'Thumb'
  | 'Disc'
  | 'Box'
  | 'Screenshot'
  | 'Menu'
  | 'Chapter'
  | 'BoxRear'
  | 'Profile';

// Play session info (for progress reporting)
export interface JellyfinPlaybackStart {
  CanSeek: boolean;
  ItemId: string;
  MediaSourceId?: string;
  AudioStreamIndex?: number;
  SubtitleStreamIndex?: number;
  IsPaused: boolean;
  IsMuted?: boolean;
  PositionTicks?: number;
  PlaybackStartTimeTicks?: number;
  VolumeLevel?: number;
  PlayMethod?: 'DirectStream' | 'DirectPlay' | 'Transcode';
  PlaySessionId?: string;
  LiveStreamId?: string;
}

export interface JellyfinPlaybackProgress extends JellyfinPlaybackStart {
  EventName?: 'timeupdate' | 'pause' | 'unpause' | 'volumechange';
}

export interface JellyfinPlaybackStop {
  ItemId: string;
  MediaSourceId?: string;
  PositionTicks?: number;
  PlaySessionId?: string;
  LiveStreamId?: string;
  Failed?: boolean;
}

// Intro/Credits detection (Jellyfin Media Segments plugin or native)
export interface JellyfinMediaSegment {
  Id: string;
  ItemId: string;
  Type: 'Intro' | 'Outro' | 'Recap' | 'Preview' | 'Commercial';
  StartTicks: number;
  EndTicks: number;
}
