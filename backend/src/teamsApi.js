'use strict';

function parseSupportUsers(supportContact) {
  return String(supportContact || '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
}

async function graphFetchJson(url, options, accessToken) {
  const method = (options && options.method) || 'GET';
  const headers = Object.assign(
    {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    options.headers || {}
  );

  const res = await fetch(url, { ...options, headers });
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const msg = body && body.error && body.error.message
      ? body.error.message
      : `Graph API error ${res.status}`;
    const err = new Error(`${msg} (${method} ${url})`);
    err.status = res.status;
    err.body = body;
    err.graphMethod = method;
    err.graphUrl = url;
    throw err;
  }
  return body;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getGraphAccessToken({ tenantId, clientId, clientSecret }) {
  const tokenUrl = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;
  const params = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: clientId,
    client_secret: clientSecret,
    scope: 'https://graph.microsoft.com/.default',
  });

  const res = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });

  const payload = await res.json();
  if (!res.ok || !payload.access_token) {
    const msg = payload && payload.error_description
      ? payload.error_description
      : `Token request failed with ${res.status}`;
    throw new Error(msg);
  }

  return payload.access_token;
}

function buildMember(userPrincipalName, tenantId) {
  const escaped = String(userPrincipalName).replace(/'/g, "''");
  return {
    '@odata.type': '#microsoft.graph.aadUserConversationMember',
    roles: ['owner'],
    'user@odata.bind': `https://graph.microsoft.com/v1.0/users('${escaped}')`,
    tenantId,
  };
}

function buildFallbackLink({ supportContact, caseNumber, summary }) {
  const message =
    `Need support on case ${caseNumber}.` +
    (summary ? ` Summary: ${summary}` : '');
  const params = new URLSearchParams({
    users: supportContact,
    message,
  });
  return `https://teams.microsoft.com/l/chat/0/0?${params.toString()}`;
}

function decodeJwtPayload(token) {
  try {
    const parts = String(token || '').split('.');
    if (parts.length < 2) return {};
    const raw = Buffer.from(parts[1], 'base64url').toString('utf8');
    return JSON.parse(raw);
  } catch (_) {
    return {};
  }
}

function hasAnyRole(roles, acceptedRoles) {
  return acceptedRoles.some((role) => roles.includes(role));
}

function createTeamsGraphStartupCheck(options = {}) {
  const tenantId = options.tenantId || '';
  const clientId = options.clientId || '';
  const clientSecret = options.clientSecret || '';
  const enabled = Boolean(options.enabled);

  if (!enabled || !tenantId || !clientId || !clientSecret) {
    return null;
  }

  return async function runTeamsGraphStartupCheck() {
    const createRoleCandidates = ['Chat.Create', 'Teamwork.Migrate.All'];
    const updateRoleCandidates = ['ChatSettings.ReadWrite.Chat', 'Chat.ReadWrite.All'];

    try {
      const token = await getGraphAccessToken({ tenantId, clientId, clientSecret });
      const payload = decodeJwtPayload(token);
      const roles = Array.isArray(payload.roles) ? payload.roles : [];

      const canCreateChat = hasAnyRole(roles, createRoleCandidates);
      const canUpdateChat = hasAnyRole(roles, updateRoleCandidates);

      if (canCreateChat && canUpdateChat) {
        // eslint-disable-next-line no-console
        console.log('[startup][teams] Graph role check OK:', roles.join(', '));
      } else {
        const required = [
          `create: ${createRoleCandidates.join(' or ')}`,
          `rename: ${updateRoleCandidates.join(' or ')}`,
        ].join(' | ');
        // eslint-disable-next-line no-console
        console.warn(
          '[startup][teams] Graph role check FAILED. token roles:',
          roles.length ? roles.join(', ') : '(none)',
          '| required:',
          required
        );
      }

      return {
        ok: canCreateChat && canUpdateChat,
        canCreateChat,
        canUpdateChat,
        roles,
      };
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[startup][teams] Graph role check failed:', err.message);
      return {
        ok: false,
        canCreateChat: false,
        canUpdateChat: false,
        roles: [],
        error: err.message,
      };
    }
  };
}

async function tryUpdateChatTopicWithRetry({ accessToken, chatId, topic }) {
  const maxAttempts = 3;
  let lastError = null;

  for (let i = 0; i < maxAttempts; i += 1) {
    try {
      await graphFetchJson(
        `https://graph.microsoft.com/v1.0/chats/${chatId}`,
        {
          method: 'PATCH',
          body: JSON.stringify({ topic }),
        },
        accessToken
      );
      return { ok: true };
    } catch (err) {
      lastError = err;
      // 404/409 can happen immediately after create due eventual consistency.
      if ([404, 409, 429].includes(err.status)) {
        await wait(250 * (i + 1));
        continue;
      }
      break;
    }
  }

  return {
    ok: false,
    error: lastError ? lastError.message : 'unknown_error',
    status: lastError ? lastError.status : undefined,
  };
}

async function resolveChatWebUrl(accessToken, chatId) {
  const chat = await graphFetchJson(
    `https://graph.microsoft.com/v1.0/chats/${chatId}?$select=id,webUrl,topic`,
    { method: 'GET' },
    accessToken
  );
  return chat && chat.webUrl ? chat.webUrl : '';
}

/**
 * Returns an async function that creates a Teams chat and renames it to
 * include the service request number.
 */
function createTeamsChatCreator(options = {}) {
  const tenantId = options.tenantId || '';
  const clientId = options.clientId || '';
  const clientSecret = options.clientSecret || '';
  const enabled = Boolean(options.enabled);

  if (!enabled || !tenantId || !clientId || !clientSecret) {
    return null;
  }

  return async function createTeamsChat({ supportContact, caseNumber, summary }) {
    const users = parseSupportUsers(supportContact);
    if (users.length === 0) {
      throw new Error('No support users configured for Teams chat creation');
    }

    const accessToken = await getGraphAccessToken({ tenantId, clientId, clientSecret });
    const chatType = users.length > 1 ? 'group' : 'oneOnOne';
    const topic = `Service Request ${caseNumber}`;
    const createBody = {
      chatType,
      members: users.map((upn) => buildMember(upn, tenantId)),
    };

    if (chatType === 'group') {
      createBody.topic = topic;
    }

    const chat = await graphFetchJson(
      'https://graph.microsoft.com/v1.0/chats',
      {
        method: 'POST',
        body: JSON.stringify(createBody),
      },
      accessToken
    );

    const chatId = chat.id;
    let webUrl = chat.webUrl || '';

    // Keep this explicit so future changes can reuse the same chat id variable.
    const createdChatId = chatId;

    const renameResult = await tryUpdateChatTopicWithRetry({
      accessToken,
      chatId: createdChatId,
      topic,
    });

    if (!webUrl) {
      try {
        webUrl = await resolveChatWebUrl(accessToken, createdChatId);
      } catch (_) {
        webUrl = '';
      }
    }

    if (!webUrl) {
      webUrl = buildFallbackLink({ supportContact, caseNumber, summary });
    }

    const topicUpdated = renameResult.ok;

    return {
      chatId: createdChatId,
      topic,
      topicUpdated,
      topicUpdateError: renameResult.ok ? null : renameResult.error,
      webUrl,
    };
  };
}

module.exports = {
  createTeamsChatCreator,
  createTeamsGraphStartupCheck,
};
