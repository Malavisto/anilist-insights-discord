const axios = require('axios');
const MockAdapter = require('axios-mock-adapter');
const request = require('../../modules/shared/anilistRequest');
const metrics = require('../../modules/observability/metrics');

jest.mock('../../modules/observability/metrics', () => ({ trackApiRequest: jest.fn() }));

describe('AniList HTTP requests', () => {
  let adapter;
  beforeEach(() => {
    adapter = new MockAdapter(axios);
    jest.clearAllMocks();
  });
  afterEach(() => adapter.restore());

  test.each([
    { errors: [{ message: 'User not found' }], data: null },
    { errors: [{ message: 'Partial response' }], data: { User: null } },
    {},
  ])('rejects unsuccessful GraphQL responses: %j', async (body) => {
    adapter.onPost().reply(200, body);
    await expect(request('query { User { id } }', {}, 'anime_stats', 'user')).rejects.toThrow();
    expect(metrics.trackApiRequest.mock.calls.map((call) => call[1])).toEqual([
      'started',
      'failure',
    ]);
  });

  test('counts a successful HTTP request once', async () => {
    adapter.onPost().reply(200, { data: { User: { id: 1 } } });
    await request('query { User { id } }', {}, 'anime_stats', 'user');
    expect(metrics.trackApiRequest.mock.calls.map((call) => call[1])).toEqual([
      'started',
      'success',
    ]);
    const config = adapter.history.post[0];
    expect(config.signal).toBeDefined();
    expect(config.headers.Accept).toBe('application/json');
  });
});
