/**
 * Google Sign-In hook using Google Identity Services.
 * Manages auth state, token, and user tier.
 */

import { useState, useEffect, useCallback } from 'react';
import type { Tier } from './types';

const CLIENT_ID = '985642192691-hgcmsi6ehm29jba26gjuip4d34p3eusn.apps.googleusercontent.com';
const API_BASE = 'https://insurance-kb-api.alan-chen75.workers.dev';

export interface AuthUser {
  readonly email: string;
  readonly name: string;
  readonly picture: string;
  readonly tier: Tier;
  readonly token: string;
}

export interface AuthStore {
  readonly user: AuthUser | null;
  readonly loading: boolean;
  readonly login: () => void;
  readonly logout: () => void;
  readonly tier: Tier;
  readonly apiFetch: (path: string, init?: RequestInit) => Promise<Response>;
}

/** Load the Google Identity Services script */
function loadGsiScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.getElementById('gsi-script')) {
      resolve();
      return;
    }
    const script = document.createElement('script');
    script.id = 'gsi-script';
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Failed to load Google Sign-In'));
    document.head.appendChild(script);
  });
}

export function useAuth(): AuthStore {
  const [user, setUser] = useState<AuthUser | null>(() => {
    const saved = localStorage.getItem('ikb_user');
    return saved ? JSON.parse(saved) : null;
  });
  const [loading, setLoading] = useState(false);

  // Verify saved token on mount
  useEffect(() => {
    if (!user?.token) return;
    fetch(`${API_BASE}/api/auth/me`, {
      headers: { Authorization: `Bearer ${user.token}` },
    })
      .then(r => r.json())
      .then(data => {
        if (data.tier && data.tier !== 'guest') {
          const updated = { ...user, tier: data.tier as Tier };
          setUser(updated);
          localStorage.setItem('ikb_user', JSON.stringify(updated));
        } else {
          // Token expired
          setUser(null);
          localStorage.removeItem('ikb_user');
        }
      })
      .catch(() => {
        setUser(null);
        localStorage.removeItem('ikb_user');
      });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Handle Google credential response
  const handleCredential = useCallback(async (response: any) => {
    const token = response.credential;
    setLoading(true);

    try {
      const res = await fetch(`${API_BASE}/api/auth/me`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();

      if (data.email) {
        const authUser: AuthUser = {
          email: data.email,
          name: data.name || data.email.split('@')[0],
          picture: data.picture || '',
          tier: data.tier || 'member',
          token,
        };
        setUser(authUser);
        localStorage.setItem('ikb_user', JSON.stringify(authUser));
      }
    } catch (err) {
      console.error('Auth verify failed:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  // Initialize Google Sign-In
  useEffect(() => {
    loadGsiScript().then(() => {
      const google = (window as any).google;
      if (!google?.accounts?.id) return;

      google.accounts.id.initialize({
        client_id: CLIENT_ID,
        callback: handleCredential,
        auto_select: true,
        use_fedcm_for_prompt: false,
      });
    });
  }, [handleCredential]);

  const login = useCallback(() => {
    const google = (window as any).google;
    if (google?.accounts?.id) {
      google.accounts.id.prompt();
    }
  }, []);

  const logout = useCallback(() => {
    const google = (window as any).google;
    if (google?.accounts?.id) {
      google.accounts.id.disableAutoSelect();
    }
    setUser(null);
    localStorage.removeItem('ikb_user');
  }, []);

  const apiFetch = useCallback(
    (path: string, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      if (user?.token) {
        headers.set('Authorization', `Bearer ${user.token}`);
      }
      return fetch(`${API_BASE}${path}`, { ...init, headers });
    },
    [user?.token],
  );

  return {
    user,
    loading,
    login,
    logout,
    tier: user?.tier || 'guest',
    apiFetch,
  };
}
