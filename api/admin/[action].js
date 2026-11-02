// Router for /api/admin/* — one Vercel function for the whole group.
const handlers = {
  stats: require('../_handlers/admin/stats'),
  queue: require('../_handlers/admin/queue'),
  confirm: require('../_handlers/admin/confirm'),
  reject: require('../_handlers/admin/reject'),
  users: require('../_handlers/admin/users'),
  block: require('../_handlers/admin/block'),
  matches: require('../_handlers/admin/matches'),
  settle: require('../_handlers/admin/settle'),
  support: require('../_handlers/admin/support'),
  'espn-sync': require('../_handlers/admin/espn-sync'),
  promote: require('../_handlers/admin/promote'),
};
module.exports = (req, res) => {
  const action = (req.query && req.query.action) || String(req.url || '').split('?')[0].split('/').pop();
  const handler = handlers[action];
  if (!handler) { res.statusCode = 404; res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify({ error: 'not_found' })); }
  return handler(req, res);
};
