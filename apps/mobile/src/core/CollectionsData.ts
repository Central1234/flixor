/**
 * Collections data fetchers using FlixorCore
 * Fetches collections for library browsing
 * Supports Plex, Jellyfin, and Emby servers
 */

import { getFlixorCore } from './index';
import type { PlexMediaItem } from '@flixor/core';

export type CollectionItem = {
  ratingKey: string;
  title: string;
  thumb?: string;
  art?: string;
  childCount?: number;
  type: string;
};

export type CollectionMediaItem = {
  ratingKey: string;
  title: string;
  type: 'movie' | 'show';
  thumb?: string;
  year?: number;
};

// ============================================
// Fetch Collections (Unified for all server types)
// ============================================

export async function fetchCollections(
  libraryType?: 'movie' | 'show'
): Promise<CollectionItem[]> {
  try {
    const core = getFlixorCore();
    const serverType = core.activeServerType;
    
    if (serverType === 'jellyfin' && core.isJellyfinServerConnected) {
      // Jellyfin collections
      const result = await core.jellyfinServerService.getCollections();
      return result.items.map((c: any) => ({
        ratingKey: String(c.id),
        title: c.name || 'Untitled',
        thumb: c.posterPath,
        art: c.backdropPath,
        childCount: c.childCount,
        type: 'collection',
      }));
    } else if (serverType === 'emby' && core.isEmbyServerConnected) {
      // Emby collections
      const result = await core.embyServerService.getCollections();
      return result.items.map((c: any) => ({
        ratingKey: String(c.id),
        title: c.name || 'Untitled',
        thumb: c.posterPath,
        art: c.backdropPath,
        childCount: c.childCount,
        type: 'collection',
      }));
    } else {
      // Plex collections
      const collections = await core.plexServer.getAllCollections(libraryType);

      return collections.map((c: PlexMediaItem) => ({
        ratingKey: String(c.ratingKey),
        title: c.title || 'Untitled',
        thumb: c.thumb,
        art: c.art,
        childCount: (c as any).childCount,
        type: c.type || 'collection',
      }));
    }
  } catch (e) {
    console.log('[CollectionsData] fetchCollections error:', e);
    return [];
  }
}

// ============================================
// Fetch Collection Items (Unified)
// ============================================

export async function fetchCollectionItems(
  collectionRatingKey: string,
  options?: {
    offset?: number;
    limit?: number;
  }
): Promise<{ items: CollectionMediaItem[]; hasMore: boolean }> {
  try {
    const core = getFlixorCore();
    const serverType = core.activeServerType;
    const { offset = 0, limit = 40 } = options || {};

    if (serverType === 'jellyfin' && core.isJellyfinServerConnected) {
      const result = await core.jellyfinServerService.getChildren(collectionRatingKey);
      const items = result.items.slice(offset, offset + limit);
      const mapped: CollectionMediaItem[] = items.map((m: any) => ({
        ratingKey: String(m.id),
        title: m.name || m.title || 'Untitled',
        type: m.type === 'series' ? 'show' : 'movie',
        thumb: m.posterPath,
        year: m.year,
      }));
      return {
        items: mapped,
        hasMore: offset + items.length < result.items.length,
      };
    } else if (serverType === 'emby' && core.isEmbyServerConnected) {
      const result = await core.embyServerService.getChildren(collectionRatingKey);
      const items = result.items.slice(offset, offset + limit);
      const mapped: CollectionMediaItem[] = items.map((m: any) => ({
        ratingKey: String(m.id),
        title: m.name || m.title || 'Untitled',
        type: m.type === 'series' ? 'show' : 'movie',
        thumb: m.posterPath,
        year: m.year,
      }));
      return {
        items: mapped,
        hasMore: offset + items.length < result.items.length,
      };
    } else {
      // Plex
      const items = await core.plexServer.getCollectionItems(collectionRatingKey, {
        start: offset,
        size: limit,
      });

      const mapped: CollectionMediaItem[] = items.map((m: PlexMediaItem) => ({
        ratingKey: String(m.ratingKey),
        title: m.title || 'Untitled',
        type: m.type as 'movie' | 'show',
        thumb: m.thumb,
        year: m.year,
      }));

      return {
        items: mapped,
        hasMore: mapped.length === limit,
      };
    }
  } catch (e) {
    console.log('[CollectionsData] fetchCollectionItems error:', e);
    return { items: [], hasMore: false };
  }
}

// ============================================
// Image URLs (Unified)
// ============================================

export function getCollectionImageUrl(
  thumb: string | undefined,
  width: number = 300,
  itemId?: string
): string {
  if (!thumb && !itemId) return '';
  try {
    const core = getFlixorCore();
    const serverType = core.activeServerType;
    
    if (serverType === 'jellyfin' && core.isJellyfinServerConnected && itemId) {
      return core.jellyfinServerService.getImageUrl(itemId, 'poster', { width });
    } else if (serverType === 'emby' && core.isEmbyServerConnected && itemId) {
      return core.embyServerService.getImageUrl(itemId, 'poster', { width });
    } else if (thumb) {
      return core.plexServer.getImageUrl(thumb, width);
    }
    return '';
  } catch {
    return '';
  }
}
