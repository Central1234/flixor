import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiClient, checkAuth } from '@/services/api';

type ServerType = 'plex' | 'jellyfin' | 'emby';

export default function Login() {
  const nav = useNavigate();
  const [serverType, setServerType] = useState<ServerType>('plex');
  const [status, setStatus] = useState('Initializing...');
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [pinId, setPinId] = useState<number | null>(null);
  const [clientId, setClientId] = useState<string | null>(null);
  const [authUrl, setAuthUrl] = useState<string | null>(null);

  // Jellyfin/Emby form state
  const [serverAddress, setServerAddress] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    checkExistingAuth();
  }, []);

  async function checkExistingAuth() {
    try {
      // Check if already authenticated
      const isAuthenticated = await checkAuth();
      if (isAuthenticated) {
        nav('/');
        return;
      }

      setStatus('Ready to sign in');
    } catch (err) {
      console.error('Auth check failed:', err);
      setStatus('Ready to sign in');
    }
  }

  async function startPlexAuth() {
    try {
      // Open a placeholder window immediately to satisfy mobile popup blockers
      const placeholder = window.open('about:blank', '_blank');

      setIsAuthenticating(true);
      setStatus('Creating authentication request...');

      // Create PIN with backend
      const pinData = await apiClient.createPlexPin();
      setPinId(pinData.id);
      setClientId(pinData.clientId);
      setAuthUrl(pinData.authUrl);

      // Navigate placeholder to Plex auth if available
      if (placeholder) {
        setStatus('Opening Plex sign-in window...');
        try {
          placeholder.location.href = pinData.authUrl;
        } catch {
          try { placeholder.close(); } catch {}
          setStatus('Popup blocked. Tap “Open Plex sign‑in”.');
        }
      } else {
        setStatus('Popup blocked. Tap “Open Plex sign‑in”.');
      }

      // Start polling for authentication
      setStatus('Waiting for Plex authorization...');
      const pollInterval = setInterval(async () => {
        try {
          const result = await apiClient.checkPlexPin(pinData.id, pinData.clientId);

          if (result.authenticated) {
            clearInterval(pollInterval);
            setStatus('Authentication successful! Redirecting...');

            // Wait a moment for session to be established
            setTimeout(() => {
              nav('/');
            }, 1000);
          }
        } catch (err) {
          console.error('Poll error:', err);
        }
      }, 2000);

      // Stop polling after 2 minutes
      setTimeout(() => {
        clearInterval(pollInterval);
        if (isAuthenticating) {
          setStatus('Authentication timed out. Please try again.');
          setIsAuthenticating(false);
        }
      }, 120000);

    } catch (err) {
      console.error('Failed to start Plex auth:', err);
      setStatus('Failed to start authentication. Please try again.');
      setIsAuthenticating(false);
    }
  }

  async function handleJellyfinEmbyAuth(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setIsAuthenticating(true);
    setStatus(`Connecting to ${serverType === 'jellyfin' ? 'Jellyfin' : 'Emby'} server...`);

    try {
      // Normalize server address
      let normalizedAddress = serverAddress.trim();
      if (!normalizedAddress.startsWith('http://') && !normalizedAddress.startsWith('https://')) {
        normalizedAddress = 'http://' + normalizedAddress;
      }
      // Remove trailing slash
      normalizedAddress = normalizedAddress.replace(/\/$/, '');

      const result = await apiClient.authenticateMediaServer(
        serverType as 'jellyfin' | 'emby',
        normalizedAddress,
        username,
        password
      );

      if (result.success) {
        setStatus('Authentication successful! Redirecting...');
        setTimeout(() => {
          nav('/');
        }, 1000);
      } else {
        setError(result.error || 'Authentication failed');
        setStatus('Ready to sign in');
        setIsAuthenticating(false);
      }
    } catch (err) {
      console.error(`${serverType} auth failed:`, err);
      setError(err instanceof Error ? err.message : 'Connection failed');
      setStatus('Ready to sign in');
      setIsAuthenticating(false);
    }
  }

  const getServerDescription = () => {
    switch (serverType) {
      case 'plex':
        return 'Sign in with Plex to access your libraries, resume playback, and sync your watch activity. Secure OAuth via your Plex account.';
      case 'jellyfin':
        return 'Connect to your Jellyfin server to access your media libraries. Enter your server address and credentials below.';
      case 'emby':
        return 'Connect to your Emby server to access your media libraries. Enter your server address and credentials below.';
    }
  };

  return (
    <div className="min-h-screen relative flex items-center justify-center">
      {/* Branded background */}
      <div className="app-bg-fixed bg-home-gradient" />

      <div className="w-full max-w-6xl mx-auto px-6 py-12 grid grid-cols-1 md:grid-cols-2 gap-10 items-center">
        {/* Brand panel */}
        <div className="hidden md:block">
          <div className="relative">
            <div className="absolute -inset-6 rounded-3xl bg-gradient-to-br from-white/10 to-white/0 blur-2xl" />
            <div className="relative z-10">
              <div className="inline-flex items-baseline gap-2 mb-4">
                <span className="text-5xl font-extrabold tracking-tight text-brand">FLIXOR</span>
                <span className="text-sm px-2 py-1 rounded bg-white/10 text-white/80 align-middle">web</span>
              </div>
              <h2 className="text-2xl md:text-3xl text-white/90 font-semibold leading-tight mb-4">
                A Netflix‑quality media client
              </h2>
              <p className="text-neutral-300/90 text-sm leading-6 max-w-md">
                {getServerDescription()}
              </p>
            </div>
          </div>
        </div>

        {/* Auth card */}
        <div className="max-w-md w-full md:ml-auto">
          <div className="bg-neutral-900/50 rounded-2xl ring-1 ring-white/10 backdrop-blur-md p-8 shadow-2xl">
            {/* Logo/Title */}
            <div className="text-left mb-6">
              <div className="md:hidden mb-3">
                <span className="text-4xl font-extrabold tracking-tight text-brand">FLIXOR</span>
              </div>
              <h1 className="text-2xl font-semibold text-white">Sign in</h1>
              <p className="text-sm text-neutral-400">Choose your media server</p>
            </div>

            {/* Server Type Tabs */}
            <div className="flex gap-1 p-1 bg-neutral-800/50 rounded-lg mb-6">
              {(['plex', 'jellyfin', 'emby'] as ServerType[]).map((type) => (
                <button
                  key={type}
                  onClick={() => {
                    setServerType(type);
                    setError(null);
                    setIsAuthenticating(false);
                    setStatus('Ready to sign in');
                  }}
                  className={`flex-1 py-2 px-3 text-sm font-medium rounded-md transition-colors ${
                    serverType === type
                      ? 'bg-brand text-white'
                      : 'text-neutral-400 hover:text-white hover:bg-neutral-700/50'
                  }`}
                >
                  {type.charAt(0).toUpperCase() + type.slice(1)}
                </button>
              ))}
            </div>

            {/* Error Message */}
            {error && (
              <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 rounded-lg">
                <p className="text-sm text-red-400">{error}</p>
              </div>
            )}

            {/* Status Message */}
            <div className="mb-4">
              <p className="text-xs text-neutral-300/90">{status}</p>
            </div>

            {/* Plex Auth */}
            {serverType === 'plex' && (
              <>
                {!isAuthenticating ? (
                  <button
                    onClick={startPlexAuth}
                    className="w-full btn-primary h-11 px-6 rounded-lg font-semibold flex items-center justify-center gap-2 shadow-md"
                  >
                    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                      <path d="M4 2C2.9 2 2 2.9 2 4V20C2 21.1 2.9 22 4 22H20C21.1 22 22 21.1 22 20V4C22 2.9 21.1 2 20 2H4M8 8L16 12L8 16V8Z"/>
                    </svg>
                    Continue with Plex
                  </button>
                ) : (
                  <div className="space-y-3">
                    <div className="flex justify-center">
                      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand"></div>
                    </div>
                    {authUrl && (
                      <div className="text-center">
                        <a
                          href={authUrl}
                          target="_blank"
                          rel="noopener"
                          onClick={(e) => { e.preventDefault(); try { window.open(authUrl, '_blank'); } catch {} }}
                          className="inline-flex items-center justify-center text-sm text-brand hover:text-brand-400 underline"
                        >
                          Open Plex sign‑in
                        </a>
                      </div>
                    )}
                  </div>
                )}
                <div className="mt-6 text-center text-xs text-neutral-500">
                  <p>Don&apos;t have a Plex account?</p>
                  <a
                    href="https://www.plex.tv/sign-up"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-brand hover:text-brand-600 underline"
                  >
                    Create one for free
                  </a>
                </div>
              </>
            )}

            {/* Jellyfin/Emby Auth Form */}
            {(serverType === 'jellyfin' || serverType === 'emby') && (
              <form onSubmit={handleJellyfinEmbyAuth} className="space-y-4">
                <div>
                  <label htmlFor="serverAddress" className="block text-sm font-medium text-neutral-300 mb-1">
                    Server Address
                  </label>
                  <input
                    type="text"
                    id="serverAddress"
                    value={serverAddress}
                    onChange={(e) => setServerAddress(e.target.value)}
                    placeholder={`http://your-${serverType}-server:8096`}
                    className="w-full h-11 px-4 bg-neutral-800/50 border border-neutral-700 rounded-lg text-white placeholder-neutral-500 focus:outline-none focus:ring-2 focus:ring-brand focus:border-transparent"
                    required
                    disabled={isAuthenticating}
                  />
                </div>
                <div>
                  <label htmlFor="username" className="block text-sm font-medium text-neutral-300 mb-1">
                    Username
                  </label>
                  <input
                    type="text"
                    id="username"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="Enter your username"
                    className="w-full h-11 px-4 bg-neutral-800/50 border border-neutral-700 rounded-lg text-white placeholder-neutral-500 focus:outline-none focus:ring-2 focus:ring-brand focus:border-transparent"
                    required
                    disabled={isAuthenticating}
                  />
                </div>
                <div>
                  <label htmlFor="password" className="block text-sm font-medium text-neutral-300 mb-1">
                    Password
                  </label>
                  <input
                    type="password"
                    id="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter your password"
                    className="w-full h-11 px-4 bg-neutral-800/50 border border-neutral-700 rounded-lg text-white placeholder-neutral-500 focus:outline-none focus:ring-2 focus:ring-brand focus:border-transparent"
                    disabled={isAuthenticating}
                  />
                  <p className="mt-1 text-xs text-neutral-500">Leave blank if no password is set</p>
                </div>
                <button
                  type="submit"
                  disabled={isAuthenticating || !serverAddress || !username}
                  className="w-full btn-primary h-11 px-6 rounded-lg font-semibold flex items-center justify-center gap-2 shadow-md disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isAuthenticating ? (
                    <>
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                      Connecting...
                    </>
                  ) : (
                    <>
                      <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14m-7-7l7 7-7 7" />
                      </svg>
                      Connect to {serverType === 'jellyfin' ? 'Jellyfin' : 'Emby'}
                    </>
                  )}
                </button>
                <div className="mt-4 text-center text-xs text-neutral-500">
                  <p>
                    {serverType === 'jellyfin' ? (
                      <>
                        New to Jellyfin?{' '}
                        <a
                          href="https://jellyfin.org/"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-brand hover:text-brand-600 underline"
                        >
                          Learn more
                        </a>
                      </>
                    ) : (
                      <>
                        New to Emby?{' '}
                        <a
                          href="https://emby.media/"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-brand hover:text-brand-600 underline"
                        >
                          Learn more
                        </a>
                      </>
                    )}
                  </p>
                </div>
              </form>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
