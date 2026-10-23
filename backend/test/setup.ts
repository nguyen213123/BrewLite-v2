// Test bootstrap: provide a dummy test secret if not set, so tests don't depend on developer .env files.
process.env.JWT_SECRET =
  process.env.JWT_SECRET || 'test-jwt-secret-with-at-least-32-characters-long-1234567890';
