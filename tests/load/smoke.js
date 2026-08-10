import http from 'k6/http';
import { check, sleep } from 'k6';
import { requestParams, thresholds, url } from './lib/config.js';

export const options = {
  vus: 1,
  duration: __ENV.K6_SMOKE_DURATION || '10s',
  thresholds,
};

export default function () {
  const response = http.get(url, requestParams);
  check(response, { 'response is successful': (result) => result.status >= 200 && result.status < 400 });
  sleep(1);
}
