const shipmentPublic = require('../../shipment/public');

const CONNECTION_PROBE_ORDER_ID = '__connection_test__';

async function fetchMangoteeProductionLines({ credential } = {}) {
  const baseUrl = String(credential?.baseUrl || 'https://v3.mangoteeprints.com/api/public/v1').replace(/\/+$/, '');
  const apiKey = credential?.accessToken;
  if (!apiKey) throw new Error('MANGOTEE API key is not configured');
  const response = await fetch(`${baseUrl}/production-lines`, {
    headers: { Accept: 'application/json', 'X-API-Key': apiKey },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.status === false) throw new Error('MANGOTEE production lines request failed');
  return {
    items: (body.data?.items || []).map((line) => ({
      id: line.id,
      name: line.name,
      isActive: Boolean(line.is_active),
      supportedShippingMethods: line.supported_shipping_methods || [],
      supportedFacilities: line.supported_facilities || [],
      supportsLabelUrl: Boolean(line.supports_label_url),
    })),
  };
}

async function fetchMangoteeCatalog({ credential, query = {} } = {}) {
  const baseUrl = String(credential?.baseUrl || 'https://v3.mangoteeprints.com/api/public/v1').replace(/\/+$/, '');
  const apiKey = credential?.accessToken || credential?.apiKey;
  if (!baseUrl || !apiKey) throw new Error('MANGOTEE catalog credentials are not configured');

  const url = new URL(`${baseUrl}/products`);
  url.searchParams.set('page', String(query.page || 1));
  url.searchParams.set('limit', String(query.limit || 50));
  if (query.q || query.search || query.name) {
    url.searchParams.set('name', String(query.q || query.search || query.name).trim());
  }
  if (query.catalog_id) {
    url.searchParams.set('catalog_id', String(query.catalog_id).trim());
  }

  const response = await fetch(url, {
    headers: { Accept: 'application/json', 'X-API-Key': apiKey },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.status === false) {
    throw new Error(body.message || body.error || 'MANGOTEE catalog request failed');
  }

  const data = body.data || body || {};
  const items = Array.isArray(data.items) ? data.items : Array.isArray(data) ? data : [];
  const pagination = data.pagination || body.pagination || {};
  return {
    items,
    pagination: {
      page: Number(pagination.page ?? query.page ?? 1),
      limit: Number(pagination.limit ?? query.limit ?? 50),
      total: Number(pagination.total ?? items.length),
      pages: Number(pagination.pages ?? 1),
    },
  };
}

async function fetchMangoteeVariations({ credential, productId, productName, page = 1, limit = 200 } = {}) {
  const baseUrl = String(credential?.baseUrl || 'https://v3.mangoteeprints.com/api/public/v1').replace(/\/+$/, '');
  const apiKey = credential?.accessToken || credential?.apiKey;
  const targetId = productId || productName;
  if (!baseUrl || !apiKey || !targetId) throw new Error('MANGOTEE catalog credentials are not configured');

  let resolvedProductId = productId;
  if (!resolvedProductId && productName) {
    const productsUrl = new URL(`${baseUrl}/products`);
    productsUrl.searchParams.set('page', '1');
    productsUrl.searchParams.set('limit', '50');
    productsUrl.searchParams.set('name', String(productName).trim());
    const productsResponse = await fetch(productsUrl, { headers: { Accept: 'application/json', 'X-API-Key': apiKey } });
    const productsBody = await productsResponse.json().catch(() => ({}));
    const pData = productsBody.data || productsBody || {};
    const productList = Array.isArray(pData.items) ? pData.items : Array.isArray(pData) ? pData : [];
    const product = productList[0];
    if (!productsResponse.ok || !product?.id) throw new Error('MANGOTEE product was not found for variations sync');
    resolvedProductId = product.id;
  }

  const url = new URL(`${baseUrl}/products/${encodeURIComponent(resolvedProductId)}/variations`);
  url.searchParams.set('page', String(page));
  url.searchParams.set('limit', String(limit));
  const response = await fetch(url, { headers: { Accept: 'application/json', 'X-API-Key': apiKey } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.status === false) throw new Error('MANGOTEE variations request failed');
  const vData = body.data || body || {};
  const items = Array.isArray(vData.items) ? vData.items : Array.isArray(vData) ? vData : [];
  return {
    items,
    pagination: vData.pagination || { page, limit, pages: page },
  };
}

async function fetchMerchizeCatalog({ credential, query = {} } = {}) {
  const baseUrl = String(credential?.baseUrl || '').replace(/\/+$/, '');
  const token = credential?.accessToken;
  const apiKey = credential?.apiKey;
  if (!baseUrl || (!token && !apiKey)) throw new Error('MERCHIZE catalog credentials are not configured');

  const url = new URL(`${baseUrl}/product/catalog`);
  url.searchParams.set('page', String(query.page || 1));
  url.searchParams.set('limit', String(query.limit || 50));
  if (query.q || query.search) {
    url.searchParams.set('search', String(query.q || query.search).trim());
  }

  const headers = { Accept: 'application/json', 'Content-Type': 'application/json' };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  } else if (apiKey) {
    headers['x-api-key'] = apiKey;
  }

  const response = await fetch(url, { headers });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.success === false) {
    throw new Error(body.message || body.error || 'MERCHIZE catalog request failed');
  }

  const data = body.data || {};
  return {
    items: Array.isArray(data.products) ? data.products : [],
    pagination: {
      page: Number(data.page ?? query.page ?? 1),
      limit: Number(query.limit ?? data.limit ?? 50),
      total: Number(data.total ?? 0),
    },
  };
}

function normalizePrintwayBaseUrl(rawBaseUrl) {
  const base = String(rawBaseUrl || 'https://apis.printway.io').trim().replace(/\/+$/, '');
  return base.endsWith('/v3') ? base : `${base}/v3`;
}

function buildPrintwayHeaders(accessToken) {
  return {
    'pw-access-token': accessToken,
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
}

async function fetchPrintwayCatalog({ credential, query = {} } = {}) {
  const baseUrl = normalizePrintwayBaseUrl(credential?.baseUrl);
  const token = credential?.accessToken;
  if (!baseUrl || !token) throw new Error('PRINTWAY catalog credentials are not configured');

  const page = Number(query.page || 1);
  const limit = Math.min(Number(query.limit || 50), 100);
  const search = String(query.q || query.search || '').trim();

  const url = `${baseUrl}/products/list`;
  const response = await fetch(url, {
    method: 'POST',
    headers: buildPrintwayHeaders(token),
    body: JSON.stringify({ page, limit, search }),
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.success === false) {
    throw new Error(body.message || body.error || 'PRINTWAY catalog request failed');
  }

  const items = Array.isArray(body.data) ? body.data : [];
  return {
    items,
    pagination: {
      page: Number(body.page ?? page),
      limit: Number(body.limit ?? limit),
      total: Number(body.length ?? items.length),
      pages: Number(body.totalPage ?? 1),
    },
  };
}

async function fetchPrintwayShippingMethods({ credential, variantIds = [], skus = [] } = {}) {
  const baseUrl = normalizePrintwayBaseUrl(credential?.baseUrl);
  const token = credential?.accessToken;
  if (!baseUrl || !token || (variantIds.length === 0 && skus.length === 0)) return [];

  const url = `${baseUrl}/products/retrieved-shipping-methods`;
  const response = await fetch(url, {
    method: 'POST',
    headers: buildPrintwayHeaders(token),
    body: JSON.stringify({ variant_id: variantIds, sku: skus }),
  });
  const body = await response.json().catch(() => ({}));
  return body.data?.product_data || [];
}

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
  if (provider === 'MANGOTEE') return Object.freeze({
    provider,
    fetchCatalog: fetchMangoteeCatalog,
    fetchProductionLines: fetchMangoteeProductionLines,
    fetchVariations: fetchMangoteeVariations,
    async testConnection({ credential } = {}) {
      await fetchMangoteeProductionLines({ credential });
      return { provider };
    },
  });
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
      if (provider === 'LENFUL') return fetchLenfulCatalog({ credential, query });
      if (provider === 'MERCHIZE') return fetchMerchizeCatalog({ credential, query });
      if (provider === 'PRINTWAY') return fetchPrintwayCatalog({ credential, query });
      throw new Error(`Catalog read is not supported for ${provider}`);
    },
    ...(provider === 'PRINTWAY' ? { fetchShippingMethods: fetchPrintwayShippingMethods } : {}),
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

module.exports = {
  fetchLenfulCatalog,
  fetchLenfulOrder,
  fetchMangoteeCatalog,
  fetchMangoteeProductionLines,
  fetchMangoteeVariations,
  fetchMerchizeCatalog,
  fetchPrintwayCatalog,
  fetchPrintwayShippingMethods,
  getAdapter,
};
