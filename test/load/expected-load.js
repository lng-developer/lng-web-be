import http from 'k6/http';
import { check, sleep } from 'k6';
import { requestParams, thresholds, url } from './lib/config.js';

const targetVus = Number(__ENV.K6_TARGET_VUS || 10);

export const options = {
  stages: [
    { duration: __ENV.K6_RAMP_UP || '15s', target: targetVus },
    { duration: __ENV.K6_STEADY || '30s', target: targetVus },
    { duration: __ENV.K6_RAMP_DOWN || '15s', target: 0 },
  ],
  thresholds,
};

export default function () {
  const response = http.get(url, requestParams);
  check(response, { 'response is successful': (result) => result.status >= 200 && result.status < 400 });
  sleep(1);
}
