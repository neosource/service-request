'use strict';

const { createTeamsChatCreator, createTeamsGraphStartupCheck } = require('../src/teamsApi');

function makeJwt(payload) {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${header}.${body}.`;
}

describe('createTeamsChatCreator', () => {
  const realFetch = global.fetch;

  afterEach(() => {
    global.fetch = realFetch;
    jest.restoreAllMocks();
  });

  test('returns null when not enabled', () => {
    const fn = createTeamsChatCreator({ enabled: false });
    expect(fn).toBeNull();
  });

  test('creates chat, stores chat id variable, and renames by chat id', async () => {
    const calls = [];
    global.fetch = jest.fn(async (url, options = {}) => {
      calls.push({ url, options });

      if (url.includes('/oauth2/v2.0/token')) {
        return {
          ok: true,
          json: async () => ({ access_token: 'graph-token' }),
        };
      }

      if (url.endsWith('/v1.0/chats') && options.method === 'POST') {
        return {
          ok: true,
          text: async () => JSON.stringify({ id: 'chat-123', webUrl: 'https://teams.microsoft.com/l/chat/0/0?foo=bar' }),
        };
      }

      if (url.includes('/v1.0/chats/chat-123') && options.method === 'PATCH') {
        return {
          ok: true,
          text: async () => '',
        };
      }

      throw new Error(`Unexpected fetch call: ${url}`);
    });

    const createTeamsChat = createTeamsChatCreator({
      enabled: true,
      tenantId: 'tenant-1',
      clientId: 'client-1',
      clientSecret: 'secret-1',
    });

    const result = await createTeamsChat({
      supportContact: 'support@contoso.com',
      caseNumber: 'SR-20260525-00001',
      summary: 'No power',
    });

    expect(result.chatId).toBe('chat-123');
    expect(result.topic).toBe('Service Request SR-20260525-00001');
    expect(result.topicUpdated).toBe(true);
    expect(result.topicUpdateError).toBeNull();

    const patchCall = calls.find(
      (c) => c.url.includes('/v1.0/chats/chat-123') && c.options.method === 'PATCH'
    );
    expect(patchCall).toBeTruthy();
    expect(JSON.parse(patchCall.options.body)).toEqual({
      topic: 'Service Request SR-20260525-00001',
    });
  });

  test('resolves chat webUrl after create when not present in create response', async () => {
    global.fetch = jest.fn(async (url, options = {}) => {
      if (url.includes('/oauth2/v2.0/token')) {
        return {
          ok: true,
          json: async () => ({ access_token: 'graph-token' }),
        };
      }
      if (url.endsWith('/v1.0/chats') && options.method === 'POST') {
        return {
          ok: true,
          text: async () => JSON.stringify({ id: 'chat-abc' }),
        };
      }
      if (url.includes('/v1.0/chats/chat-abc') && options.method === 'PATCH') {
        return {
          ok: true,
          text: async () => '',
        };
      }
      if (url.includes('/v1.0/chats/chat-abc?$select=id,webUrl,topic')) {
        return {
          ok: true,
          text: async () => JSON.stringify({ webUrl: 'https://teams.microsoft.com/l/chat/chat-abc/0' }),
        };
      }
      throw new Error(`Unexpected fetch call: ${url}`);
    });

    const createTeamsChat = createTeamsChatCreator({
      enabled: true,
      tenantId: 'tenant-1',
      clientId: 'client-1',
      clientSecret: 'secret-1',
    });

    const result = await createTeamsChat({
      supportContact: 'support@contoso.com',
      caseNumber: 'SR-20260525-00002',
      summary: 'Paper jam',
    });

    expect(result.webUrl).toBe('https://teams.microsoft.com/l/chat/chat-abc/0');
  });

  test('returns topic update error details when rename fails', async () => {
    global.fetch = jest.fn(async (url, options = {}) => {
      if (url.includes('/oauth2/v2.0/token')) {
        return {
          ok: true,
          json: async () => ({ access_token: 'graph-token' }),
        };
      }
      if (url.endsWith('/v1.0/chats') && options.method === 'POST') {
        return {
          ok: true,
          text: async () => JSON.stringify({ id: 'chat-err', webUrl: 'https://teams.microsoft.com/l/chat/chat-err/0' }),
        };
      }
      if (url.includes('/v1.0/chats/chat-err') && options.method === 'PATCH') {
        return {
          ok: false,
          status: 403,
          text: async () => JSON.stringify({ error: { message: 'Insufficient privileges' } }),
        };
      }
      throw new Error(`Unexpected fetch call: ${url}`);
    });

    const createTeamsChat = createTeamsChatCreator({
      enabled: true,
      tenantId: 'tenant-1',
      clientId: 'client-1',
      clientSecret: 'secret-1',
    });

    const result = await createTeamsChat({
      supportContact: 'support@contoso.com',
      caseNumber: 'SR-20260525-00003',
      summary: 'Scanner issue',
    });

    expect(result.topicUpdated).toBe(false);
    expect(result.topicUpdateError).toContain('Insufficient privileges');
  });
});

describe('createTeamsGraphStartupCheck', () => {
  const realFetch = global.fetch;

  beforeEach(() => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    global.fetch = realFetch;
    jest.restoreAllMocks();
  });

  test('returns null when disabled', () => {
    const fn = createTeamsGraphStartupCheck({ enabled: false });
    expect(fn).toBeNull();
  });

  test('reports ok when required roles are present', async () => {
    const token = makeJwt({
      roles: ['Chat.Create', 'ChatSettings.ReadWrite.Chat'],
    });

    global.fetch = jest.fn(async (url) => {
      if (url.includes('/oauth2/v2.0/token')) {
        return {
          ok: true,
          json: async () => ({ access_token: token }),
        };
      }
      throw new Error(`Unexpected fetch call: ${url}`);
    });

    const runCheck = createTeamsGraphStartupCheck({
      enabled: true,
      tenantId: 'tenant-1',
      clientId: 'client-1',
      clientSecret: 'secret-1',
    });

    const result = await runCheck();
    expect(result.ok).toBe(true);
    expect(result.canCreateChat).toBe(true);
    expect(result.canUpdateChat).toBe(true);
  });

  test('reports missing roles when token has no role claims', async () => {
    const token = makeJwt({ aud: 'https://graph.microsoft.com' });

    global.fetch = jest.fn(async (url) => {
      if (url.includes('/oauth2/v2.0/token')) {
        return {
          ok: true,
          json: async () => ({ access_token: token }),
        };
      }
      throw new Error(`Unexpected fetch call: ${url}`);
    });

    const runCheck = createTeamsGraphStartupCheck({
      enabled: true,
      tenantId: 'tenant-1',
      clientId: 'client-1',
      clientSecret: 'secret-1',
    });

    const result = await runCheck();
    expect(result.ok).toBe(false);
    expect(result.roles).toEqual([]);
    expect(result.canCreateChat).toBe(false);
    expect(result.canUpdateChat).toBe(false);
  });
});
