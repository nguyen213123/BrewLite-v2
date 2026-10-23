import { randomUUID } from 'node:crypto';
import { PrismaService } from '../src/prisma/prisma.service';
import { AuthService } from '../src/modules/auth/auth.service';

const integration = process.env.RUN_DB_TESTS === '1' ? describe : describe.skip;

integration('Auth integration with real PostgreSQL', () => {
  let prisma: PrismaService;
  let authService: AuthService;

  beforeAll(() => {
    if (!process.env.DATABASE_URL) throw new Error('RUN_DB_TESTS requires DATABASE_URL');
    process.env.JWT_SECRET = 'ci-integration-test-secret-at-least-32-chars-long';
    prisma = new PrismaService();
    authService = new AuthService(prisma);
    authService.onModuleInit();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('registers and authenticates against real database', async () => {
    const email = `test-${randomUUID()}@example.com`;
    const password = 'RealPassword123!';

    const registered = await authService.register({ email, password });
    expect(registered.user.email).toBe(email);
    expect(registered.accessToken).toBeDefined();

    const loggedIn = await authService.login({ email, password });
    expect(loggedIn.user.id).toBe(registered.user.id);

    const verified = await authService.verifyAccessToken(loggedIn.accessToken);
    expect(verified.id).toBe(registered.user.id);
    expect(verified.email).toBe(email);

    const me = await authService.me(verified);
    expect(me.id).toBe(registered.user.id);

    // Clean up
    await prisma.user.delete({ where: { id: registered.user.id } });
  });
});
