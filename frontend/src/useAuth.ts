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

        // Close login overlay if open
        document.getElementById('gsi-login-backdrop')?.remove();
        document.getElementById('gsi-login-overlay')?.remove();
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
      console.log('[useAuth] GSI loaded, google.accounts:', !!google?.accounts);
      if (!google?.accounts?.id) {
        console.error('[useAuth] google.accounts.id not available');
        return;
      }

      google.accounts.id.initialize({
        client_id: CLIENT_ID,
        callback: handleCredential,
        auto_select: false,
        use_fedcm_for_prompt: false,
      });
      console.log('[useAuth] GSI initialized');
    }).catch(err => {
      console.error('[useAuth] GSI script load failed:', err);
    });
  }, [handleCredential]);

  const login = useCallback(() => {
    const google = (window as any).google;
    if (!google?.accounts?.id) return;

    // Create a temporary container for the Google button
    const container = document.createElement('div');
    container.style.position = 'fixed';
    container.style.top = '50%';
    container.style.left = '50%';
    container.style.transform = 'translate(-50%, -50%)';
    container.style.zIndex = '99999';
    container.style.background = 'white';
    container.style.padding = '32px';
    container.style.borderRadius = '16px';
    container.style.boxShadow = '0 25px 50px rgba(0,0,0,0.25)';
    container.id = 'gsi-login-overlay';

    // Add backdrop
    const backdrop = document.createElement('div');
    backdrop.style.position = 'fixed';
    backdrop.style.inset = '0';
    backdrop.style.background = 'rgba(0,0,0,0.4)';
    backdrop.style.zIndex = '99998';
    backdrop.id = 'gsi-login-backdrop';
    backdrop.onclick = () => {
      backdrop.remove();
      container.remove();
    };

    // Add title
    const title = document.createElement('div');
    title.textContent = '使用 Google 帳號登入';
    title.style.marginBottom = '16px';
    title.style.fontSize = '16px';
    title.style.fontWeight = '600';
    title.style.textAlign = 'center';
    container.appendChild(title);

    // Render Google button
    const btnDiv = document.createElement('div');
    container.appendChild(btnDiv);

    document.body.appendChild(backdrop);
    document.body.appendChild(container);

    google.accounts.id.renderButton(btnDiv, {
      type: 'standard',
      theme: 'outline',
      size: 'large',
      width: 280,
      text: 'signin_with',
      locale: 'zh-TW',
    });
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
