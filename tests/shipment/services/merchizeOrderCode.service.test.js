jest.mock('../../../src/modules/shipment/services/vendorTrackingAdapters/requestJson', () => jest.fn());
const request = require('../../../src/modules/shipment/services/vendorTrackingAdapters/requestJson');
const adapter = require('../../../src/modules/shipment/services/vendorTrackingAdapters/merchize.adapter');
const credential = { baseUrl: 'https://vendor.test', accessToken: 'test', metadata: { identifier: 'lng' } };
const receipt = '6b093405301a4a52eca850a7';
beforeEach(() => jest.resetAllMocks());
test('does not send receipt ID as code and captures real code from exact reference', async () => {
  request.mockResolvedValue({statusCode:200,json:{success:true,data:[{external_number:'AMZ-R2',code:'RY-123',tracking_number:'9400',tracking_company:'USPS'}]}});
  const result=await adapter.fetchTrackingByExternalOrderId(receipt,{credential,orderExternalOrderId:'AMZ-R2'});
  expect(request.mock.calls[0][1].body.orders).toEqual([{code:'',external_number:'AMZ-R2',identifier:'lng'}]);
  expect(result).toMatchObject({vendorOrderCode:'RY-123',trackingNumber:'9400'});
});
test('unrelated or prefix retry rows never supply tracking', () => {
  expect(adapter.normalizeMerchizeTracking('AMZ',{data:[{external_number:'OTHER',tracking_number:'bad'},{name:'AMZ-R2',tracking_number:'bad2'}]}).trackingNumber).toBe('');
  expect(adapter.normalizeMerchizeOrderDetail('AMZ',{data:[{_id:receipt,shipment_statuses:[{tracking_number:'bad'}]}]}).trackingNumber).toBe('');
});
test('ambiguous matched rows fail closed', () => {
  expect(()=>adapter.normalizeMerchizeTracking('AMZ',{data:[{external_number:'AMZ',code:'RY-1',tracking_number:'1'},{external_number:'AMZ',code:'RY-2',tracking_number:'2'}]})).toThrow(/ambiguous/i);
});
test('detail captures code before tracking exists', async () => {
  request.mockResolvedValueOnce({statusCode:200,json:{success:true,data:[]}})
    .mockResolvedValueOnce({statusCode:200,json:{success:true,data:[{external_number:'AMZ',code:'RY-123',order_status:'in_production',shipment_statuses:[]}]}});
  expect(await adapter.fetchTrackingByExternalOrderId(receipt,{credential,orderExternalOrderId:'AMZ'})).toMatchObject({vendorOrderCode:'RY-123',trackingNumber:''});
});

test('legacy actual code remains queryable without an external reference', async () => {
  request.mockResolvedValue({statusCode:200,json:{success:true,data:[{external_number:'AMZ',code:'RY-123',tracking_number:'9400'}]}});
  expect(await adapter.fetchTrackingByExternalOrderId('RY-123',{credential})).toMatchObject({vendorOrderCode:'RY-123',trackingNumber:'9400'});
  expect(request.mock.calls[0][1].body.orders).toEqual([{code:'RY-123',external_number:'',identifier:''}]);
});
test('code lookup cannot accept a contradictory external reference', () => {
  expect(adapter.normalizeMerchizeTracking('AMZ-R2',{data:[{external_number:'AMZ',code:'RY-123',tracking_number:'bad'}]},'RY-123').trackingNumber).toBe('');
});
test('keeps verified tracking when optional code lookup fails', async () => {
  request.mockResolvedValueOnce({statusCode:200,json:{success:true,data:[{external_number:'AMZ',tracking_number:'9400',tracking_company:'USPS'}]}}).mockRejectedValueOnce(Error('timeout'));
  expect(await adapter.fetchTrackingByExternalOrderId(receipt,{credential,orderExternalOrderId:'AMZ'})).toMatchObject({trackingNumber:'9400'});
});
