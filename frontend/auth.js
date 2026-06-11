/* eslint-disable no-undef */
/**
 * Auth module — wraps MSAL.js for Entra ID.
 *
 * Configure these constants for your tenant:
 *   - tenantId: your Entra tenant GUID (or "common" / "organizations")
 *   - clientId: app registration (SPA) client ID
 *   - apiScope: the scope exposed by your API app registration,
 *               typically `api://<API_APP_ID>/access_as_user`
 */

window.AppAuth = (function () {
  // ----- CONFIGURE -----
  const CONFIG = {
    tenantId: '28825646-ef41-4c9b-b69e-305d76fc24e5',
    clientId: '25ad7b8a-b980-4b2c-8df0-ba2d77eb9199',
    apiScope: 'api://25ad7b8a-b980-4b2c-8df0-ba2d77eb9199/access_as_user',
  };
  // ---------------------

  // Allow override from query string for dev convenience
  const params = new URLSearchParams(location.search);
  if (params.get('tenantId')) CONFIG.tenantId = params.get('tenantId');
  if (params.get('clientId')) CONFIG.clientId = params.get('clientId');
  if (params.get('apiScope')) CONFIG.apiScope = params.get('apiScope');

  let pca = null;
  let account = null;

  async function waitForMsal(timeoutMs = 5000) {
    const start = Date.now();
    while (!window.msal && Date.now() - start < timeoutMs) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    if (!window.msal) {
      throw new Error('MSAL library failed to load from CDN');
    }
  }

  async function init() {
    await waitForMsal();
    pca = new msal.PublicClientApplication({
      auth: {
        clientId: CONFIG.clientId,
        authority: `https://login.microsoftonline.com/${CONFIG.tenantId}`,
        redirectUri: window.location.origin + window.location.pathname,
      },
      cache: {
        cacheLocation: 'sessionStorage',
        storeAuthStateInCookie: false,
      },
    });
    return pca.initialize().then(() => {
      const accounts = pca.getAllAccounts();
      if (accounts.length > 0) {
        account = accounts[0];
        pca.setActiveAccount(account);
      }
    });
  }

  async function signIn() {
    const result = await pca.loginPopup({
      scopes: ['openid', 'profile', CONFIG.apiScope],
      prompt: 'select_account',
    });
    account = result.account;
    pca.setActiveAccount(account);
    return account;
  }

  async function signOut() {
    if (!account) return;
    await pca.logoutPopup({ account });
    account = null;
  }

  function getAccount() { return account; }

  async function getAccessToken() {
    if (!account) throw new Error('Not signed in');
    try {
      const result = await pca.acquireTokenSilent({
        account,
        scopes: [CONFIG.apiScope],
      });
      return result.accessToken;
    } catch (err) {
      // Silent token acquisition failed — fall back to interactive
      const result = await pca.acquireTokenPopup({
        scopes: [CONFIG.apiScope],
      });
      return result.accessToken;
    }
  }

  return { init, signIn, signOut, getAccount, getAccessToken, CONFIG };
})();
