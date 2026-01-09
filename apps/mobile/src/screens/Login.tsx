import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  ActivityIndicator,
  Linking as RNLinking,
  Alert,
  AppState,
  AppStateStatus,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { getFlixorCore } from '../core';

// The URL where users enter their PIN code
const PLEX_LINK_URL = 'https://plex.tv/link';

type ServerType = 'plex' | 'jellyfin' | 'emby';

interface LoginProps {
  onAuthenticated: () => void;
}

export default function Login({ onAuthenticated }: LoginProps) {
  const [serverType, setServerType] = useState<ServerType>('plex');
  
  // Plex state
  const [pin, setPin] = useState<{ id: number; code: string } | null>(null);
  const [polling, setPolling] = useState(false);
  
  // Jellyfin/Emby state
  const [serverUrl, setServerUrl] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  
  // Shared state
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef(false);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      abortRef.current = true;
    };
  }, []);

  // When app returns to foreground during Plex auth
  useEffect(() => {
    const subscription = AppState.addEventListener('change', async (state: AppStateStatus) => {
      if (state === 'active' && pin && polling) {
        console.log('[Login] App foreground, polling continues...');
      }
    });
    return () => subscription.remove();
  }, [pin, polling]);

  // Reset state when switching server types
  const switchServerType = (type: ServerType) => {
    setServerType(type);
    setPin(null);
    setPolling(false);
    setError(null);
    setServerUrl('');
    setUsername('');
    setPassword('');
    abortRef.current = true;
  };

  // ===== Plex Authentication =====
  const startPlexAuth = async () => {
    try {
      console.log('[Login] Starting Plex PIN auth flow');
      setBusy(true);
      setError(null);
      abortRef.current = false;

      const core = getFlixorCore();
      const pinData = await core.createPlexPin();
      setPin(pinData);

      console.log('[Login] PIN created:', pinData.code, 'ID:', pinData.id);

      // Open plex.tv/link where user enters the code
      try {
        const WebBrowser = await import('expo-web-browser');
        await WebBrowser.openBrowserAsync(PLEX_LINK_URL);
      } catch {
        await RNLinking.openURL(PLEX_LINK_URL);
      }

      // Start polling for authorization
      setPolling(true);
      setBusy(false);

      try {
        await core.waitForPlexPin(pinData.id, {
          onPoll: () => {
            if (abortRef.current) {
              throw new Error('Aborted');
            }
          },
        });

        setPolling(false);
        console.log('[Login] Plex authentication successful!');
        onAuthenticated();
      } catch (e: any) {
        setPolling(false);
        if (e.message !== 'Aborted') {
          Alert.alert('Timeout', 'Authentication timed out. Please try again.');
        }
      }

    } catch (e: any) {
      setError(e?.message || 'Failed to start Plex authentication');
      setBusy(false);
      setPolling(false);
    }
  };

  // ===== Jellyfin/Emby Authentication =====
  const startJellyfinEmbyAuth = async () => {
    if (!serverUrl.trim()) {
      setError('Please enter your server URL');
      return;
    }
    if (!username.trim()) {
      setError('Please enter your username');
      return;
    }

    try {
      setBusy(true);
      setError(null);

      const core = getFlixorCore();
      
      // Normalize URL
      let url = serverUrl.trim();
      if (!url.startsWith('http://') && !url.startsWith('https://')) {
        url = 'https://' + url;
      }
      url = url.replace(/\/$/, ''); // Remove trailing slash

      console.log(`[Login] Authenticating with ${serverType}:`, url);

      if (serverType === 'jellyfin') {
        await core.authenticateJellyfin({
          address: url,
          username: username.trim(),
          password: password,
        });
      } else {
        await core.authenticateEmby({
          address: url,
          username: username.trim(),
          password: password,
        });
      }

      console.log(`[Login] ${serverType} authentication successful!`);
      onAuthenticated();

    } catch (e: any) {
      console.log(`[Login] ${serverType} auth error:`, e?.message);
      setError(e?.message || `Failed to connect to ${serverType} server`);
      setBusy(false);
    }
  };

  const openPlexLink = () => {
    RNLinking.openURL(PLEX_LINK_URL);
  };

  return (
    <KeyboardAvoidingView 
      style={{ flex: 1, backgroundColor: '#000' }}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView 
        contentContainerStyle={{ flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={{ color: '#fff', fontSize: 32, fontWeight: '800', marginBottom: 8 }}>
          Flixor
        </Text>
        <Text style={{ color: '#999', fontSize: 14, textAlign: 'center', marginBottom: 32 }}>
          Connect to your media server
        </Text>

        {/* Server Type Tabs */}
        <View style={{ flexDirection: 'row', marginBottom: 24, borderRadius: 8, overflow: 'hidden' }}>
          <Pressable
            onPress={() => switchServerType('plex')}
            style={{
              paddingHorizontal: 20,
              paddingVertical: 12,
              backgroundColor: serverType === 'plex' ? '#e5a00d' : '#222',
            }}
          >
            <Text style={{ color: serverType === 'plex' ? '#000' : '#888', fontWeight: '600' }}>
              Plex
            </Text>
          </Pressable>
          <Pressable
            onPress={() => switchServerType('jellyfin')}
            style={{
              paddingHorizontal: 20,
              paddingVertical: 12,
              backgroundColor: serverType === 'jellyfin' ? '#a45ee5' : '#222',
            }}
          >
            <Text style={{ color: serverType === 'jellyfin' ? '#fff' : '#888', fontWeight: '600' }}>
              Jellyfin
            </Text>
          </Pressable>
          <Pressable
            onPress={() => switchServerType('emby')}
            style={{
              paddingHorizontal: 20,
              paddingVertical: 12,
              backgroundColor: serverType === 'emby' ? '#52b54b' : '#222',
            }}
          >
            <Text style={{ color: serverType === 'emby' ? '#fff' : '#888', fontWeight: '600' }}>
              Emby
            </Text>
          </Pressable>
        </View>

        {/* Plex Login UI */}
        {serverType === 'plex' && (
          <View style={{ alignItems: 'center', width: '100%', maxWidth: 320 }}>
            {pin && (
              <View style={{ marginBottom: 24, alignItems: 'center' }}>
                <Text style={{ color: '#bbb', fontSize: 14, marginBottom: 4 }}>
                  Go to plex.tv/link and enter:
                </Text>
                <Text style={{ color: '#fff', fontSize: 36, fontWeight: '800', letterSpacing: 6, marginVertical: 12 }}>
                  {pin.code.toUpperCase()}
                </Text>
                {polling && (
                  <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 8 }}>
                    <ActivityIndicator color="#e5a00d" size="small" />
                    <Text style={{ color: '#999', marginLeft: 8, fontSize: 12 }}>
                      Waiting for authorization...
                    </Text>
                  </View>
                )}
              </View>
            )}

            <Pressable
              onPress={startPlexAuth}
              disabled={busy || polling}
              style={{
                backgroundColor: busy || polling ? '#666' : '#e5a00d',
                paddingHorizontal: 24,
                paddingVertical: 14,
                borderRadius: 8,
                minWidth: 200,
                alignItems: 'center',
              }}
            >
              {busy ? (
                <ActivityIndicator color="#000" />
              ) : (
                <Text style={{ color: '#000', fontWeight: '700', fontSize: 16 }}>
                  {pin ? 'Get New Code' : 'Continue with Plex'}
                </Text>
              )}
            </Pressable>

            {pin && (
              <Pressable onPress={openPlexLink} style={{ marginTop: 16 }}>
                <Text style={{ color: '#e5a00d', textDecorationLine: 'underline', fontWeight: '600' }}>
                  Open plex.tv/link
                </Text>
              </Pressable>
            )}

            {!pin && (
              <Text style={{ color: '#666', fontSize: 12, marginTop: 24, textAlign: 'center' }}>
                You'll be asked to enter a code at plex.tv/link to authorize this app.
              </Text>
            )}
          </View>
        )}

        {/* Jellyfin/Emby Login UI */}
        {(serverType === 'jellyfin' || serverType === 'emby') && (
          <View style={{ width: '100%', maxWidth: 320 }}>
            <TextInput
              placeholder="Server URL (e.g., https://jellyfin.example.com)"
              placeholderTextColor="#666"
              value={serverUrl}
              onChangeText={setServerUrl}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              style={{
                backgroundColor: '#1a1a1a',
                borderRadius: 8,
                paddingHorizontal: 16,
                paddingVertical: 14,
                color: '#fff',
                marginBottom: 12,
                borderWidth: 1,
                borderColor: '#333',
              }}
            />
            <TextInput
              placeholder="Username"
              placeholderTextColor="#666"
              value={username}
              onChangeText={setUsername}
              autoCapitalize="none"
              autoCorrect={false}
              style={{
                backgroundColor: '#1a1a1a',
                borderRadius: 8,
                paddingHorizontal: 16,
                paddingVertical: 14,
                color: '#fff',
                marginBottom: 12,
                borderWidth: 1,
                borderColor: '#333',
              }}
            />
            <TextInput
              placeholder="Password"
              placeholderTextColor="#666"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              style={{
                backgroundColor: '#1a1a1a',
                borderRadius: 8,
                paddingHorizontal: 16,
                paddingVertical: 14,
                color: '#fff',
                marginBottom: 20,
                borderWidth: 1,
                borderColor: '#333',
              }}
            />

            <Pressable
              onPress={startJellyfinEmbyAuth}
              disabled={busy}
              style={{
                backgroundColor: busy ? '#666' : (serverType === 'jellyfin' ? '#a45ee5' : '#52b54b'),
                paddingHorizontal: 24,
                paddingVertical: 14,
                borderRadius: 8,
                alignItems: 'center',
              }}
            >
              {busy ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={{ color: '#fff', fontWeight: '700', fontSize: 16 }}>
                  Sign In to {serverType === 'jellyfin' ? 'Jellyfin' : 'Emby'}
                </Text>
              )}
            </Pressable>

            <Text style={{ color: '#666', fontSize: 12, marginTop: 20, textAlign: 'center' }}>
              Enter your {serverType === 'jellyfin' ? 'Jellyfin' : 'Emby'} server address and credentials.
            </Text>
          </View>
        )}

        {/* Error Message */}
        {error && (
          <View style={{ marginTop: 20, padding: 12, backgroundColor: '#3a1a1a', borderRadius: 8, maxWidth: 320 }}>
            <Text style={{ color: '#ff6b6b', fontSize: 13, textAlign: 'center' }}>
              {error}
            </Text>
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
