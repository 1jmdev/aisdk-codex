import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs/promises';

export interface AuthDotJson {
  tokens?: {
    id_token: string;
    access_token: string;
    refresh_token: string;
    account_id?: string;
  };
  api_key?: string;
  last_refresh?: string;
}

export interface IdTokenInfo {
  email?: string;
  name?: string;
  exp?: number;
  iat?: number;
  account_id?: string;
}

interface NodeError extends Error {
  code?: string;
}

const CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
const TOKEN_ENDPOINT = 'https://auth.openai.com/oauth/token';

export class CodexAuth {
  private static cachedAuth: AuthDotJson | null = null;
  private static cachedTokenInfo: IdTokenInfo | null = null;
  private static refreshPromise: Promise<void> | null = null;

  static getAuthFilePath(): string {
    return path.join(os.homedir(), '.codex', 'auth.json');
  }

  static async loadAuthJson(): Promise<AuthDotJson> {
    if (this.cachedAuth) {
      return this.cachedAuth;
    }

    const authPath = this.getAuthFilePath();
    try {
      const content = await fs.readFile(authPath, 'utf-8');
      this.cachedAuth = JSON.parse(content) as AuthDotJson;
      return this.cachedAuth;
    } catch (error) {
      const nodeError = error as NodeError;
      if (nodeError.code === 'ENOENT') {
        throw new Error(
          `Authentication not found. Please run 'codex login' first.\nExpected auth file at: ${authPath}`,
        );
      }
      throw new Error(`Failed to read auth.json: ${error}`);
    }
  }

  static parseIdToken(idToken: string): IdTokenInfo {
    if (this.cachedTokenInfo) {
      return this.cachedTokenInfo;
    }

    try {
      const parts = idToken.split('.');
      if (parts.length !== 3) {
        throw new Error('Invalid JWT token format');
      }

      const payload = parts[1]!;
      const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
      const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
      const decoded = Buffer.from(padded, 'base64').toString('utf-8');
      const tokenData = JSON.parse(decoded) as Record<string, unknown>;

      this.cachedTokenInfo = {
        email: tokenData['email'] as string | undefined,
        name: tokenData['name'] as string | undefined,
        exp: tokenData['exp'] as number | undefined,
        iat: tokenData['iat'] as number | undefined,
        account_id:
          (tokenData['https://labs.openai.com/account_id'] as string | undefined) ??
          (tokenData['account_id'] as string | undefined),
      };

      return this.cachedTokenInfo;
    } catch (error) {
      throw new Error(`Failed to parse ID token: ${error}`);
    }
  }

  static isTokenExpired(tokenInfo: IdTokenInfo): boolean {
    if (!tokenInfo.exp) return true;
    const oneHour = 60 * 60 * 1000;
    return tokenInfo.exp * 1000 - Date.now() < oneHour;
  }

  static async getAccessToken(): Promise<string> {
    const auth = await this.loadAuthJson();

    if (auth.tokens?.id_token) {
      const tokenInfo = this.parseIdToken(auth.tokens.id_token);
      if (this.isTokenExpired(tokenInfo) && auth.tokens.refresh_token) {
        await this.refreshAccessToken();
        const refreshed = await this.loadAuthJson();
        if (refreshed.tokens?.access_token) {
          return refreshed.tokens.access_token;
        }
      }
    }

    if (auth.tokens?.access_token) {
      return auth.tokens.access_token;
    }

    if (auth.api_key) {
      return auth.api_key;
    }

    throw new Error('No access token or API key found in auth.json');
  }

  static async getAccountId(): Promise<string> {
    const auth = await this.loadAuthJson();

    if (auth.tokens?.account_id) {
      return auth.tokens.account_id;
    }

    if (auth.tokens?.id_token) {
      const tokenInfo = this.parseIdToken(auth.tokens.id_token);
      if (tokenInfo.account_id) {
        return tokenInfo.account_id;
      }
    }

    throw new Error('No account ID found in auth.json');
  }

  static async getHeaders(): Promise<Record<string, string>> {
    const accessToken = await this.getAccessToken();
    const accountId = await this.getAccountId();

    return {
      Authorization: `Bearer ${accessToken}`,
      'chatgpt-account-id': accountId,
      'Content-Type': 'application/json',
    };
  }

  static async refreshAccessToken(): Promise<string> {
    if (this.refreshPromise) {
      await this.refreshPromise;
      const auth = await this.loadAuthJson();
      if (auth.tokens?.access_token) return auth.tokens.access_token;
      throw new Error('No access token after refresh');
    }

    this.refreshPromise = this.doRefreshToken();
    try {
      await this.refreshPromise;
    } finally {
      this.refreshPromise = null;
    }

    const auth = await this.loadAuthJson();
    if (auth.tokens?.access_token) return auth.tokens.access_token;
    throw new Error('No access token after refresh');
  }

  private static async doRefreshToken(): Promise<void> {
    const auth = await this.loadAuthJson();

    if (!auth.tokens?.refresh_token) {
      throw new Error(
        'No refresh token available. Please run "codex login" to authenticate.',
      );
    }

    const response = await fetch(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: CLIENT_ID,
        grant_type: 'refresh_token',
        refresh_token: auth.tokens.refresh_token,
        scope: 'openid profile email',
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Token refresh failed: ${errorText}`);
    }

    const tokenResponse = (await response.json()) as {
      id_token: string;
      access_token: string;
      refresh_token?: string;
    };

    auth.tokens = {
      id_token: tokenResponse.id_token,
      access_token: tokenResponse.access_token,
      refresh_token: tokenResponse.refresh_token ?? auth.tokens.refresh_token,
      account_id: auth.tokens.account_id,
    };
    auth.last_refresh = new Date().toISOString();

    await fs.writeFile(this.getAuthFilePath(), JSON.stringify(auth, null, 2));
    this.clearCache();
  }

  static clearCache(): void {
    this.cachedAuth = null;
    this.cachedTokenInfo = null;
  }
}
