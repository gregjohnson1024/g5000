/**
 * EmporiaClient — Cognito SRP authentication + token cache + REST endpoints.
 *
 * Node compat: amazon-cognito-identity-js@6 loads cleanly under Node 22+;
 * no browser-global shims needed (verified on Node 26, NotAuthorizedException
 * is raised correctly, no navigator/window/document errors).
 */

import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { EmporiaScale } from '@g5000/core';

// amazon-cognito-identity-js is CJS-only (no ESM export map), so we require()
// it from an ESM context via createRequire.
const require = createRequire(import.meta.url);
const {
  CognitoUserPool,
  CognitoUser,
  AuthenticationDetails,
  CognitoRefreshToken,
}: {
  CognitoUserPool: new (cfg: { UserPoolId: string; ClientId: string }) => CognitoUserPoolInstance;
  CognitoUser: new (cfg: {
    Username: string;
    Pool: CognitoUserPoolInstance;
  }) => CognitoUserInstance;
  AuthenticationDetails: new (cfg: { Username: string; Password: string }) => AuthDetailsInstance;
  CognitoRefreshToken: new (cfg: { RefreshToken: string }) => RefreshTokenInstance;
} = require('amazon-cognito-identity-js');

// ── Minimal SDK shapes (enough to call the API; not exhaustive) ───────────────

interface CognitoUserPoolInstance {
  getUserPoolId(): string;
}

interface CognitoSessionResult {
  getIdToken(): { getJwtToken(): string; getExpiration(): number };
  getRefreshToken(): { getToken(): string };
}

interface CognitoUserInstance {
  authenticateUser(
    authDetails: AuthDetailsInstance,
    callbacks: {
      onSuccess: (session: CognitoSessionResult) => void;
      onFailure: (err: Error) => void;
      newPasswordRequired?: (userAttributes: unknown) => void;
    },
  ): void;
  refreshSession(
    refreshToken: RefreshTokenInstance,
    callback: (err: Error | null, session: CognitoSessionResult | null) => void,
  ): void;
}

interface AuthDetailsInstance {}
interface RefreshTokenInstance {}

// ── Constants ─────────────────────────────────────────────────────────────────

const USER_POOL_ID = 'us-east-2_ghlOXVLi1';
const CLIENT_ID = '4qte47jbstod8apnfic0bunmrq';
const API_BASE = 'https://api.emporiaenergy.com';
const TOKEN_REFRESH_BUFFER_MS = 60_000;

// ── Public types ──────────────────────────────────────────────────────────────

export interface EmporiaClient {
  getDevices(): Promise<unknown>;
  getDeviceListUsages(gids: number[], scale: EmporiaScale): Promise<unknown>;
  getChartUsage(
    gid: number,
    channel: string,
    scale: EmporiaScale,
    startIso: string,
    endIso: string,
  ): Promise<{ firstUsageInstant: string; usageList: Array<number | null> }>;
}

// ── Pure URL builders (tested) ────────────────────────────────────────────────

export function buildUsagesUrl(gids: number[], scale: EmporiaScale, instantIso: string): string {
  const p = new URLSearchParams({
    apiMethod: 'getDeviceListUsages',
    deviceGids: gids.join(','),
    instant: instantIso,
    scale,
    energyUnit: 'KilowattHours',
  });
  return `${API_BASE}/AppAPI?${p.toString()}`;
}

export function buildChartUrl(
  gid: number,
  channel: string,
  scale: EmporiaScale,
  startIso: string,
  endIso: string,
): string {
  const p = new URLSearchParams({
    apiMethod: 'getChartUsage',
    deviceGid: String(gid),
    channel,
    start: startIso,
    end: endIso,
    scale,
    energyUnit: 'KilowattHours',
  });
  return `${API_BASE}/AppAPI?${p.toString()}`;
}

// ── Token cache ───────────────────────────────────────────────────────────────

interface TokenCache {
  idToken: string;
  refreshToken: string;
  expMs: number;
}

function defaultCachePath(): string {
  return `${homedir()}/.g5000-router/emporia-token.json`;
}

function loadCache(path: string): TokenCache | null {
  try {
    const raw = readFileSync(path, 'utf8');
    const obj = JSON.parse(raw) as TokenCache;
    if (typeof obj.idToken === 'string' && typeof obj.expMs === 'number') return obj;
    return null;
  } catch {
    return null;
  }
}

function saveCache(path: string, cache: TokenCache): void {
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(cache), 'utf8');
  } catch {
    // best-effort; don't crash the client if the cache directory isn't writable
  }
}

// ── Auth helpers (promise wrappers around SDK callbacks) ──────────────────────

function authenticateSrp(
  user: CognitoUserInstance,
  authDetails: AuthDetailsInstance,
): Promise<CognitoSessionResult> {
  return new Promise((resolve, reject) => {
    user.authenticateUser(authDetails, {
      onSuccess: resolve,
      onFailure: reject,
      newPasswordRequired: () =>
        reject(new Error('Emporia account requires a password change before API use')),
    });
  });
}

function refreshCognitoSession(
  user: CognitoUserInstance,
  token: RefreshTokenInstance,
): Promise<CognitoSessionResult> {
  return new Promise((resolve, reject) => {
    user.refreshSession(token, (err, session) => {
      if (err || !session) reject(err ?? new Error('Refresh returned no session'));
      else resolve(session);
    });
  });
}

// ── Factory ───────────────────────────────────────────────────────────────────

export function createEmporiaClient(
  email: string,
  password: string,
  tokenCachePath?: string,
): EmporiaClient {
  const cachePath = tokenCachePath ?? defaultCachePath();

  const pool: CognitoUserPoolInstance = new CognitoUserPool({
    UserPoolId: USER_POOL_ID,
    ClientId: CLIENT_ID,
  });

  const cognitoUser: CognitoUserInstance = new CognitoUser({
    Username: email,
    Pool: pool,
  });

  let cachedToken: TokenCache | null = null;

  async function ensureToken(): Promise<string> {
    // 1. Check in-memory cache
    if (cachedToken && cachedToken.expMs - Date.now() > TOKEN_REFRESH_BUFFER_MS) {
      return cachedToken.idToken;
    }

    // 2. Load from disk if nothing in memory
    if (!cachedToken) {
      cachedToken = loadCache(cachePath);
    }

    // 3. Reuse if still fresh
    if (cachedToken && cachedToken.expMs - Date.now() > TOKEN_REFRESH_BUFFER_MS) {
      return cachedToken.idToken;
    }

    // 4. Refresh via refresh token if we have one
    if (cachedToken?.refreshToken) {
      try {
        const refreshToken = new CognitoRefreshToken({ RefreshToken: cachedToken.refreshToken });
        const session = await refreshCognitoSession(cognitoUser, refreshToken);
        const idTok = session.getIdToken();
        cachedToken = {
          idToken: idTok.getJwtToken(),
          refreshToken: cachedToken.refreshToken,
          expMs: idTok.getExpiration() * 1000,
        };
        saveCache(cachePath, cachedToken);
        return cachedToken.idToken;
      } catch {
        // refresh failed — fall through to full SRP
      }
    }

    // 5. Full SRP authentication
    const authDetails = new AuthenticationDetails({ Username: email, Password: password });
    const session = await authenticateSrp(cognitoUser, authDetails);
    const idTok = session.getIdToken();
    cachedToken = {
      idToken: idTok.getJwtToken(),
      refreshToken: session.getRefreshToken().getToken(),
      expMs: idTok.getExpiration() * 1000,
    };
    saveCache(cachePath, cachedToken);
    return cachedToken.idToken;
  }

  async function apiFetch(url: string, forceRefresh = false): Promise<unknown> {
    if (forceRefresh) cachedToken = null;
    const idToken = await ensureToken();
    const resp = await fetch(url, { headers: { authtoken: idToken } });
    if (resp.status === 401 && !forceRefresh) {
      // Force a full token refresh and retry once
      return apiFetch(url, true);
    }
    if (!resp.ok) {
      throw new Error(`Emporia API ${resp.status} ${resp.statusText}: ${url}`);
    }
    return resp.json() as Promise<unknown>;
  }

  return {
    getDevices(): Promise<unknown> {
      return apiFetch(`${API_BASE}/customers/devices`);
    },

    getDeviceListUsages(gids: number[], scale: EmporiaScale): Promise<unknown> {
      const url = buildUsagesUrl(gids, scale, new Date().toISOString());
      return apiFetch(url);
    },

    async getChartUsage(
      gid: number,
      channel: string,
      scale: EmporiaScale,
      startIso: string,
      endIso: string,
    ): Promise<{ firstUsageInstant: string; usageList: Array<number | null> }> {
      const url = buildChartUrl(gid, channel, scale, startIso, endIso);
      const raw = (await apiFetch(url)) as {
        firstUsageInstant: string;
        usageList: Array<number | null>;
      };
      return { firstUsageInstant: raw.firstUsageInstant, usageList: raw.usageList };
    },
  };
}
