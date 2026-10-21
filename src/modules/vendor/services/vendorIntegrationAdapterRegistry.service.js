const shipmentPublic = require('../../shipment/public');

const CONNECTION_PROBE_ORDER_ID = '__connection_test__';

async function fetchLenfulCatalog({ credential, query = {} } = {}) {
  const baseUrl = String(credential?.baseUrl || '').replace(/\/+$/, '');
  const token = credential?.accessToken;
  if (!baseUrl || !token) throw new Error('LENFUL catalog credentials are not configured');

  const url = new URL(`${baseUrl}/product`);
  url.searchParams.set('page', String(query.page || 1));
  url.searchParams.set('limit', String(query.limit || 50));
  if (query.q) url.searchParams.set('keyword', query.q);
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.success === false) throw new Error('LENFUL catalog request failed');
  return {
    items: Array.isArray(body.data) ? body.data : [],
    pagination: body.pagination || { page: Number(query.page || 1), limit: Number(query.limit || 50) },
  };
}

async function fetchLenfulOrder({ credential, orderNumber } = {}) {
  const token = credential?.accessToken;
  if (!token) throw new Error('LENFUL order credentials are not configured');

  const orderEndpointUrl = String(credential?.orderEndpointUrl || '').replace(/\/+$/, '');
  if (!orderEndpointUrl) throw new Error('LENFUL order endpoint is not configured');
  const url = new URL(orderEndpointUrl);
  url.searchParams.set('page', '1');
  url.searchParams.set('limit', '1');
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ keyword: orderNumber, keywordType: 'order' }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.success === false) throw new Error('LENFUL order request failed');
  const order = (Array.isArray(body.data) ? body.data : [])
    .find((item) => String(item?.order_number || '') === orderNumber);
  return order || null;
}

function getAdapter(adapterKey) {
  const provider = String(adapterKey || '').trim().toUpperCase();
  if (!provider) return null;
  if (provider === 'LNG_GROUP') return Object.freeze({
    provider,
    async testConnection({ credential } = {}) {
      const baseUrl = String(credential?.baseUrl || '').replace(/\/+$/, '');
      const token = credential?.accessToken;
      if (!baseUrl || !token) throw new Error('LNG Group credentials are not configured');

      const response = await fetch(`${baseUrl}/api/portal/orders/${CONNECTION_PROBE_ORDER_ID}`, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok && !(response.status === 404 && body?.error?.code === 'NOT_FOUND')) {
        throw new Error('LNG Group connection request failed');
      }
      return { provider };
    },
  });
  if (provider === 'MERCHFOX') return Object.freeze({
    provider,
    async testConnection({ credential } = {}) {
      const baseUrl = String(credential?.baseUrl || '').replace(/\/+$/, '');
      if (!baseUrl || !credential?.apiKey || !credential?.apiSecret) throw new Error('MERCHFOX credentials are not configured');
      const url = new URL(`${baseUrl}/api/v1/orders`);
      url.searchParams.set('limit', '1');
      const response = await fetch(url, { headers: { Accept: 'application/json', 'X-Mfx-App-Key': credential.apiKey, 'X-Mfx-App-Secret': credential.apiSecret } });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || body.code !== 0) throw new Error('MERCHFOX connection request failed');
      return { provider };
    },
  });
  const trackingAdapter = shipmentPublic.getVendorTrackingAdapter(provider);
  if (!trackingAdapter
    || typeof trackingAdapter.fetchTrackingByExternalOrderId !== 'function') return null;

  return Object.freeze({
    provider,
    async fetchCatalog({ credential, query } = {}) {
      if (provider !== 'LENFUL') throw new Error(`Catalog read is not supported for ${provider}`);
      return fetchLenfulCatalog({ credential, query });
    },
    async fetchOrder({ credential, orderNumber } = {}) {
      if (provider !== 'LENFUL') throw new Error(`Order read is not supported for ${provider}`);
      return fetchLenfulOrder({ credential, orderNumber });
    },
    async fetchTracking({ credential, externalOrderId } = {}) {
      return trackingAdapter.fetchTrackingByExternalOrderId(externalOrderId, { credential });
    },
    async testConnection({ credential } = {}) {
      try {
        await trackingAdapter.fetchTrackingByExternalOrderId(CONNECTION_PROBE_ORDER_ID, { credential });
      } catch (error) {
        const orderWasNotFound = error?.vendorHttpStatus === 200
          && String(error?.vendorMessage || '').trim().toLowerCase() === 'order not found.';
        if (provider !== 'MERCHIZE' || (error?.vendorHttpStatus !== 404 && !orderWasNotFound)) {
          throw error;
        }
      }
      return { provider };
    },
  });
}

module.exports = { fetchLenfulCatalog, fetchLenfulOrder, getAdapter };
