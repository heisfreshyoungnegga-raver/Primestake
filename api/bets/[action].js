// Router for /api/bets/* — one Vercel function for the whole group.
const handlers = {
  place: require('../_handlers/bets/place'),
  mine: require('../_handlers/bets/mine'),
  verify: require('../_handlers/bets/verify'),
  cashout: require('../_handlers/bets/cashout'),
  'booking-resolve': require('../_handlers/bets/booking-resolve'),
  'create-booking-code': require('../_handlers/bets/create-booking-code'),
  'winners-ticker': require('../_handlers/bets/winners-ticker'),
};
module.exports = (req, res) => {
  const action = (req.query && req.query.action) || String(req.url || '').split('?')[0].split('/').pop();
  const handler = handlers[action];
  if (!handler) { res.statusCode = 404; res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify({ error: 'not_found' })); }
  return handler(req, res);
};
