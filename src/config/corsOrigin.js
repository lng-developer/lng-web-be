const LOCAL_ORIGIN = /^https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/;

function createCorsOrigin({ env, allowedOrigins }) {
  return (origin, callback) => {
    const allowed = !origin
      || allowedOrigins.includes(origin)
      || (env !== 'production' && LOCAL_ORIGIN.test(origin));
    callback(allowed ? null : new Error('Origin not allowed by CORS'), allowed);
  };
}

module.exports = { createCorsOrigin };
