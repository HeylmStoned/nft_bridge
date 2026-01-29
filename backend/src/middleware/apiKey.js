import { config } from '../config/index.js';

function isAllowedOrigin(req) {
  const allowed = config.api.allowedOrigins || [];
  if (allowed.length === 0) return false;
  const origin = (req.get('origin') || '').toLowerCase();
  const referer = (req.get('referer') || '').toLowerCase();
  return allowed.some(
    (base) => origin === base || origin.startsWith(base + '/') || referer === base || referer.startsWith(base + '/')
  );
}

export function requireApiKey(req, res, next) {
  if (!config.api.key) {
    return next();
  }

  const suppliedKey = req.header('x-api-key');
  if (suppliedKey === config.api.key) {
    return next();
  }
  if (isAllowedOrigin(req)) {
    return next();
  }

  return res.status(401).json({
    error: {
      message: 'Invalid or missing API key',
      status: 401,
    },
  });
}

export default { requireApiKey };
