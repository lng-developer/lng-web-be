const config = require('../../../../config');
const logger = require('../../../../shared/utils/logger');

const GRAPH_BASE_URL = 'https://graph.microsoft.com/v1.0';

let mockGraphHandler = null;

function setMockGraphHandler(handler) {
  mockGraphHandler = handler;
}

function clearMockGraphHandler() {
  mockGraphHandler = null;
}

async function request(endpoint, options = {}) {
  if (mockGraphHandler) {
    return mockGraphHandler(endpoint, options);
  }

  const url = endpoint.startsWith('http') ? endpoint : `${GRAPH_BASE_URL}${endpoint.startsWith('/') ? '' : '/'}${endpoint}`;
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };

  const response = await fetch(url, {
    method: options.method || 'GET',
    headers,
    body: options.body ? (typeof options.body === 'string' ? options.body : JSON.stringify(options.body)) : undefined,
  });

  if (!response.ok) {
    const errorBody = await response.text();
    let parsed;
    try {
      parsed = JSON.parse(errorBody);
    } catch (_e) {
      parsed = { message: errorBody };
    }
    const error = new Error(`Microsoft Graph request failed: ${response.status} ${response.statusText}`);
    error.status = response.status;
    error.graphError = parsed;
    throw error;
  }

  if (response.status === 204) return null;
  return response.json();
}

async function getAppToken() {
  if (mockGraphHandler) {
    return mockGraphHandler('/oauth/token/app', { method: 'POST' });
  }

  const tenant = config.teams.tenantId || 'common';
  const url = `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`;

  const params = new URLSearchParams({
    client_id: config.teams.clientId || '',
    client_secret: config.teams.clientSecret || '',
    scope: 'https://graph.microsoft.com/.default',
    grant_type: 'client_credentials',
  });

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to acquire Microsoft Graph app token: ${response.status} ${errorText}`);
  }

  const data = await response.json();
  return data.access_token;
}

async function refreshUserToken(refreshToken) {
  if (!refreshToken) throw new Error('Refresh token is required');

  if (mockGraphHandler) {
    return mockGraphHandler('/oauth/token/refresh', { method: 'POST', refreshToken });
  }

  const tenant = config.teams.tenantId || 'common';
  const url = `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`;

  const params = new URLSearchParams({
    client_id: config.teams.clientId || '',
    client_secret: config.teams.clientSecret || '',
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    scope: 'offline_access User.Read ChatMessage.Send Chat.ReadWrite',
  });

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to refresh Microsoft Graph user token: ${response.status} ${errorText}`);
  }

  return response.json();
}

async function getOrCreateOneOnOneChat(user1EntraId, user2EntraId, { token } = {}) {
  const authToken = token || (await getAppToken());
  return request('/chats', {
    method: 'POST',
    headers: { Authorization: `Bearer ${authToken}` },
    body: {
      chatType: 'oneOnOne',
      members: [
        {
          '@odata.type': '#microsoft.graph.aadUserConversationMember',
          roles: ['owner'],
          'user@odata.bind': `https://graph.microsoft.com/v1.0/users('${user1EntraId}')`,
        },
        {
          '@odata.type': '#microsoft.graph.aadUserConversationMember',
          roles: ['owner'],
          'user@odata.bind': `https://graph.microsoft.com/v1.0/users('${user2EntraId}')`,
        },
      ],
    },
  });
}

async function createGroupChat(entraUserIds = [], topic = null, { token } = {}) {
  const authToken = token || (await getAppToken());
  const uniqueEntraIds = [...new Set((entraUserIds || []).filter(Boolean))];
  return request('/chats', {
    method: 'POST',
    headers: { Authorization: `Bearer ${authToken}` },
    body: {
      chatType: 'group',
      ...(topic ? { topic } : {}),
      members: uniqueEntraIds.map((entraId) => ({
        '@odata.type': '#microsoft.graph.aadUserConversationMember',
        roles: ['owner'],
        'user@odata.bind': `https://graph.microsoft.com/v1.0/users('${entraId}')`,
      })),
    },
  });
}

async function addMemberToChat(teamsChatId, entraUserId, { token } = {}) {
  const authToken = token || (await getAppToken());
  return request(`/chats/${encodeURIComponent(teamsChatId)}/members`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${authToken}` },
    body: {
      '@odata.type': '#microsoft.graph.aadUserConversationMember',
      roles: ['owner'],
      'user@odata.bind': `https://graph.microsoft.com/v1.0/users('${entraUserId}')`,
      visibleHistoryStartDateTime: '2020-01-01T00:00:00Z',
    },
  });
}

async function sendChatMessage(teamsChatId, { content, contentType = 'text' }, { token } = {}) {
  const authToken = token || (await getAppToken());
  return request(`/chats/${encodeURIComponent(teamsChatId)}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${authToken}` },
    body: {
      body: {
        contentType,
        content: content || '',
      },
    },
  });
}

async function getChatMessage(teamsChatId, teamsMessageId, { token } = {}) {
  const authToken = token || (await getAppToken());
  return request(`/chats/${encodeURIComponent(teamsChatId)}/messages/${encodeURIComponent(teamsMessageId)}`, {
    headers: { Authorization: `Bearer ${authToken}` },
  });
}

async function getChat(teamsChatId, { token } = {}) {
  const authToken = token || (await getAppToken());
  return request(`/chats/${encodeURIComponent(teamsChatId)}?$expand=members`, {
    headers: { Authorization: `Bearer ${authToken}` },
  });
}

async function listChatMessages(teamsChatId, { top = 20, token } = {}) {
  const authToken = token || (await getAppToken());
  return request(`/chats/${encodeURIComponent(teamsChatId)}/messages?$top=${top}`, {
    headers: { Authorization: `Bearer ${authToken}` },
  });
}

async function createSubscription({ resource, notificationUrl, clientState, expirationDateTime }, { token } = {}) {
  const authToken = token || (await getAppToken());
  return request('/subscriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${authToken}` },
    body: {
      changeType: 'created',
      notificationUrl,
      resource,
      expirationDateTime,
      clientState,
    },
  });
}

async function renewSubscription(subscriptionId, { expirationDateTime }, { token } = {}) {
  const authToken = token || (await getAppToken());
  return request(`/subscriptions/${encodeURIComponent(subscriptionId)}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${authToken}` },
    body: { expirationDateTime },
  });
}

async function deleteSubscription(subscriptionId, { token } = {}) {
  const authToken = token || (await getAppToken());
  return request(`/subscriptions/${encodeURIComponent(subscriptionId)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${authToken}` },
  });
}

module.exports = {
  getAppToken,
  refreshUserToken,
  getOrCreateOneOnOneChat,
  createGroupChat,
  addMemberToChat,
  sendChatMessage,
  getChatMessage,
  listChatMessages,
  getChat,
  createSubscription,
  renewSubscription,
  deleteSubscription,
  setMockGraphHandler,
  clearMockGraphHandler,
};
