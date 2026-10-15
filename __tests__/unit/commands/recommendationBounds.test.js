const axios = require('axios');
const MockAdapter = require('axios-mock-adapter');
const Service = require('../../../modules/commands/AnimeRecommendationService');
jest.mock('../../../modules/observability/logger', () => ({
  error: jest.fn(),
  info: jest.fn(),
  debug: jest.fn(),
}));
jest.mock('../../../modules/observability/metrics', () => ({
  trackApiRequest: jest.fn(),
  trackCacheHit: jest.fn(),
  trackError: jest.fn(),
}));
const anime = (id, genres = ['Action']) => ({
  id,
  genres,
  title: { english: `Anime ${id}` },
  coverImage: { large: 'https://example.com/a.jpg' },
});
const entry = (id, score, genres) => ({ mediaId: id, score, media: anime(id, genres) });
describe('bounded recommendation search', () => {
  let service, http;
  beforeEach(() => {
    service = new Service();
    http = new MockAdapter(axios);
  });
  afterEach(() => {
    service.cache.destroy();
    http.restore();
    jest.useRealTimers();
  });
  const list = (http, entries) =>
    http.onPost().replyOnce(200, { data: { MediaListCollection: { lists: [{ entries }] } } });
  test('normalizes IDs, keeps highest scores, and excludes unrated listed titles', async () => {
    list(http, [
      entry(1, 9.5, ['Wrong']),
      entry('1', 10, ['Action']),
      entry(2, 9, ['Drama']),
      entry(3, 8, ['Comedy']),
      entry('4', 0),
    ]);
    http.onPost().reply((config) => {
      expect(JSON.parse(config.data).variables.genres).toEqual(['Action', 'Drama', 'Comedy']);
      return [
        200,
        { data: { Page: { media: [anime(4), anime(5)], pageInfo: { hasNextPage: false } } } },
      ];
    });
    expect((await service.fetchAnimeRecommendation('user')).id).toBe(5);
  });
  test('caps distinct pages at ten and caches partial candidates', async () => {
    list(
      http,
      Array.from({ length: 11 }, (_, i) => entry(i + 1, 9)),
    );
    let page = 0;
    http.onPost().reply((config) => {
      expect(JSON.parse(config.data).query).toContain('perPage: 25');
      page++;
      if (page > 11) throw new Error('request budget exceeded');
      return [
        200,
        {
          data: {
            Page: {
              media: [anime(page), ...(page === 1 ? [anime(99)] : [])],
              pageInfo: { hasNextPage: true },
            },
          },
        },
      ];
    });
    expect((await service.fetchAnimeRecommendation('user')).id).toBe(99);
    expect(http.history.post).toHaveLength(11);
    await service.fetchAnimeRecommendation('user');
    expect(http.history.post).toHaveLength(11);
  });
  test('stops repeated page contents irrespective of ordering', async () => {
    list(http, [entry(1, 9), entry(2, 8)]);
    let page = 0;
    http.onPost().reply(() => {
      if (page > 3) throw new Error('repeated page not bounded');
      return [
        200,
        {
          data: {
            Page: {
              media: ++page === 1 ? [anime(1), anime(2)] : [anime(2), anime(1)],
              pageInfo: { hasNextPage: true },
            },
          },
        },
      ];
    });
    await expect(service.fetchAnimeRecommendation('user')).rejects.toThrow(/bounded search/i);
    expect(http.history.post).toHaveLength(3);
  });
  test('retains the first entry when duplicate scores tie', async () => {
    list(http, [entry(1, 9, ['Action']), entry('1', 9, ['Wrong'])]);
    http.onPost().reply((config) => {
      expect(JSON.parse(config.data).variables.genres).toEqual(['Action']);
      return [200, { data: { Page: { media: [anime(2)], pageInfo: { hasNextPage: false } } } }];
    });
    await service.fetchAnimeRecommendation('user');
  });
  test('advances through distinct seen-only pages and stops on an empty page', async () => {
    list(http, [entry(1, 9), entry(2, 8)]);
    let page = 0;
    http.onPost().reply(() => [
      200,
      {
        data: {
          Page: { media: ++page < 3 ? [anime(page)] : [], pageInfo: { hasNextPage: true } },
        },
      },
    ]);
    await expect(service.fetchAnimeRecommendation('user')).rejects.toThrow(/bounded search/i);
    expect(http.history.post).toHaveLength(4);
  });
  test('HTTP errors discard partial results instead of caching them', async () => {
    list(http, [entry(1, 9)]);
    http
      .onPost()
      .replyOnce(200, { data: { Page: { media: [anime(2)], pageInfo: { hasNextPage: true } } } });
    http.onPost().reply(500);
    await expect(service.fetchAnimeRecommendation('user')).rejects.toThrow();
    expect(service.cache.get('recommendation_user')).toBeNull();
  });
  test('the list request is included in the operation deadline', async () => {
    jest.useFakeTimers();
    http.onPost().reply(
      (config) =>
        new Promise((_resolve, reject) => {
          config.signal.addEventListener('abort', () => reject(new axios.CanceledError()), {
            once: true,
          });
        }),
    );
    const result = expect(service.fetchAnimeRecommendation('user')).rejects.toThrow(
      /bounded search/i,
    );
    await jest.advanceTimersByTimeAsync(30000);
    await result;
    expect(http.history.post).toHaveLength(1);
  });
  test('deadline aborts an in-flight candidate request and preserves partial results', async () => {
    jest.useFakeTimers();
    list(http, [entry(1, 9)]);
    http
      .onPost()
      .replyOnce(200, { data: { Page: { media: [anime(2)], pageInfo: { hasNextPage: true } } } });
    http.onPost().reply(
      (config) =>
        new Promise((resolve, reject) => {
          config.signal.addEventListener('abort', () => reject(new axios.CanceledError()), {
            once: true,
          });
        }),
    );
    const result = service.fetchAnimeRecommendation('user');
    await jest.advanceTimersByTimeAsync(30000);
    expect((await result).id).toBe(2);
    expect(http.history.post).toHaveLength(3);
  });
});
