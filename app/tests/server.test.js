const request = require('supertest');
const app = require('../server');

describe('GET /health', () => {
  it('returns 200 and status ok', async () => {
    const res = await request(app).get('/health');
    expect(res.statusCode).toBe(200);
    expect(res.body.status).toBe('ok');
  });
});

describe('GET /api/status', () => {
  it('returns service metadata', async () => {
    const res = await request(app).get('/api/status');
    expect(res.statusCode).toBe(200);
    expect(res.body.service).toBe('devops-demo-app');
  });
});

describe('GET /api/users', () => {
  it('returns a list of users', async () => {
    const res = await request(app).get('/api/users');
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
  });
});

describe('GET /api/users/:id', () => {
  it('returns a single user for a valid id', async () => {
    const res = await request(app).get('/api/users/1');
    expect(res.statusCode).toBe(200);
    expect(res.body.name).toBe('Alice');
  });

  it('returns 404 for an unknown id', async () => {
    const res = await request(app).get('/api/users/999');
    expect(res.statusCode).toBe(404);
  });
});
