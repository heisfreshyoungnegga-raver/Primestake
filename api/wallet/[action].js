// Router for /api/wallet/* — one Vercel function for the whole group.
const handlers = {
  'deposit-manual': require('../_handlers/wallet/deposit-manual'),
  withdraw: require('../_handlers/wallet/withdraw'),
};
module.exports = (req, res) => {
  const action = (req.query && req.query.action) || String(req.url || '').split('?')[0].split('/').pop();
  const handler = handlers[action];
  if (!handler) { res.statusCode = 404; res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify({ error: 'not_found' })); }
  return handler(req, res);
};
