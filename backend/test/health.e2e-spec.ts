import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { HealthController } from '../src/health/health.controller';
import { PrismaService } from '../src/prisma/prisma.service';
import { configureApp } from '../src/setup';

describe('Health HTTP endpoints', () => {
  let app: INestApplication;
  const query = jest.fn();

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [{ provide: PrismaService, useValue: { $queryRaw: query } }],
    }).compile();
    app = module.createNestApplication();
    configureApp(app);
    await app.init();
  });
  afterAll(async () => { await app.close(); });

  it('serves liveness with the API prefix and CORS', async () => {
    await request(app.getHttpServer()).get('/api/health')
      .set('Origin', 'http://localhost:3000')
      .expect('Access-Control-Allow-Origin', 'http://localhost:3000')
      .expect(200, { status: 'ok', service: 'brewlite-api' });
  });
  it('reports database readiness', async () => {
    query.mockResolvedValueOnce([{ '?column?': 1 }]);
    await request(app.getHttpServer()).get('/api/health/ready')
      .expect(200, { status: 'ok', database: 'connected' });
  });
  it('returns 503 when the database is unavailable', async () => {
    query.mockRejectedValueOnce(new Error('connection failed'));
    await request(app.getHttpServer()).get('/api/health/ready').expect(503);
  });
});
