/**
 * YouTube OAuth Service
 * Handles Google OAuth 2.0 authentication for YouTube uploads
 */

import { google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import * as fs from 'fs';
import * as path from 'path';
import { BrowserWindow } from 'electron';
import { app } from 'electron';

const SCOPES = ['https://www.googleapis.com/auth/youtube.upload'];
const TOKEN_PATH = path.join(app.getPath('userData'), 'youtube-token.json');
const CREDENTIALS_PATH = path.join(
  process.cwd(),
  'client_secret_235744043692-85hlp2prkgdp0bitbmh46gfbug5vfn2e.apps.googleusercontent.com.json',
);

let oauth2Client: OAuth2Client | null = null;

/**
 * Load client credentials from the JSON file
 */
function loadCredentials(): any {
  try {
    const content = fs.readFileSync(CREDENTIALS_PATH, 'utf-8');
    return JSON.parse(content);
  } catch (error) {
    console.error('Error loading credentials:', error);
    throw new Error('Could not load YouTube credentials file');
  }
}

/**
 * Create OAuth2 Client
 */
export function createOAuth2Client(): OAuth2Client {
  if (oauth2Client) {
    return oauth2Client;
  }

  const credentials = loadCredentials();
  const { client_id, client_secret, redirect_uris } = credentials.installed;

  const client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);
  oauth2Client = client;

  return client;
}

/**
 * Check if user has valid authentication token
 */
export function isAuthenticated(): boolean {
  try {
    if (fs.existsSync(TOKEN_PATH)) {
      const token = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf-8'));
      const client = createOAuth2Client();
      client.setCredentials(token);

      // Check if token is expired
      const expiry = token.expiry_date;
      if (expiry && expiry > Date.now()) {
        oauth2Client = client;
        return true;
      }
    }
    return false;
  } catch (error) {
    console.error('Error checking authentication:', error);
    return false;
  }
}

/**
 * Get authenticated OAuth2 client
 */
export function getAuthenticatedClient(): OAuth2Client | null {
  if (oauth2Client && oauth2Client.credentials.access_token) {
    return oauth2Client;
  }

  try {
    if (fs.existsSync(TOKEN_PATH)) {
      const token = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf-8'));
      const client = createOAuth2Client();
      client.setCredentials(token);
      oauth2Client = client;
      return oauth2Client;
    }
  } catch (error) {
    console.error('Error getting authenticated client:', error);
  }

  return null;
}

/**
 * Start OAuth flow in browser window
 */
export async function authenticateUser(mainWindow: BrowserWindow): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const client = createOAuth2Client();

    const authUrl = client.generateAuthUrl({
      access_type: 'offline',
      scope: SCOPES,
    });

    // Create auth window
    const authWindow = new BrowserWindow({
      width: 600,
      height: 700,
      show: true,
      parent: mainWindow,
      modal: true,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
      },
    });

    authWindow.loadURL(authUrl);

    // Listen for redirect with auth code
    authWindow.webContents.on('will-redirect', async (event, url) => {
      const urlObj = new URL(url);
      const code = urlObj.searchParams.get('code');

      if (code) {
        authWindow.close();

        try {
          const { tokens } = await client.getToken(code);
          client.setCredentials(tokens);
          oauth2Client = client;

          // Save token to file
          fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens));
          console.log('YouTube authentication successful');
          resolve(true);
        } catch (error) {
          console.error('Error getting tokens:', error);
          reject(error);
        }
      }
    });

    // Handle window close
    authWindow.on('closed', () => {
      if (!oauth2Client || !oauth2Client.credentials.access_token) {
        reject(new Error('Authentication cancelled'));
      }
    });
  });
}

/**
 * Logout user (remove saved token)
 */
export function logout(): boolean {
  try {
    if (fs.existsSync(TOKEN_PATH)) {
      fs.unlinkSync(TOKEN_PATH);
    }
    oauth2Client = null;
    console.log('YouTube logout successful');
    return true;
  } catch (error) {
    console.error('Error during logout:', error);
    return false;
  }
}

/**
 * Refresh access token if expired
 */
export async function refreshTokenIfNeeded(): Promise<void> {
  const client = getAuthenticatedClient();
  if (!client) {
    throw new Error('Not authenticated');
  }

  const expiry = client.credentials.expiry_date;
  if (expiry && expiry < Date.now() + 60000) {
    // Refresh if expires in less than 1 minute
    try {
      const { credentials } = await client.refreshAccessToken();
      client.setCredentials(credentials);
      fs.writeFileSync(TOKEN_PATH, JSON.stringify(credentials));
      console.log('Access token refreshed');
    } catch (error) {
      console.error('Error refreshing token:', error);
      throw error;
    }
  }
}
