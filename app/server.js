const express = require('express');
const app = express();
const PORT = process.env.PORT || 8080;

app.use(express.json());

const startTime = Date.now();

// In-memory "database" for demo purposes
const users = [
  { id: 1, name: 'Alice' },
  { id: 2, name: 'Bob' },
  { id: 3, name: 'Charlie' }
];

// Liveness/readiness probe target
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    uptimeSeconds: Math.floor((Date.now() - startTime) / 1000)
  });
});

app.get('/api/status', (req, res) => {
  res.status(200).json({
    service: 'devops-demo-app',
    env: process.env.APP_ENV || 'development',
    version: process.env.APP_VERSION || '1.0.0',
    pod: process.env.HOSTNAME || 'local'
  });
});

app.get('/api/users', (req, res) => {
  res.status(200).json(users);
});

app.get('/api/users/:id', (req, res) => {
  const user = users.find(u => u.id === parseInt(req.params.id, 10));
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.status(200).json(user);
});

// Only start listening if this file is run directly (not imported by tests)
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`devops-demo-app listening on port ${PORT}`);
  });
}

module.exports = app;
