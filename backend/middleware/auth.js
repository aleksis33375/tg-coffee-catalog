const jwt = require('jsonwebtoken')

function authMiddleware(role) {
  return (req, res, next) => {
    const header = req.headers.authorization
    if (!header || !header.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Нет токена' })
    }

    const token = header.slice(7)
    try {
      const payload = jwt.verify(token, process.env.JWT_SECRET)
      if (role && payload.role !== role) {
        return res.status(403).json({ error: 'Нет доступа' })
      }
      req.user = payload
      next()
    } catch {
      return res.status(401).json({ error: 'Токен недействителен' })
    }
  }
}

module.exports = authMiddleware
