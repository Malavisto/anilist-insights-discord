# Testing Documentation

This project uses a comprehensive three-tier testing strategy with Jest to ensure code quality and reliability.

## Test Tiers

### 1. Unit Tests
**Location:** `__tests__/unit/`

Unit tests focus on testing individual services and modules in isolation. They use mocked function dependencies to ensure each unit behaves correctly independently.

**What's Tested:**
- CacheService: TTL expiration, cache hits/misses, statistics
- RandomAnimeService: Anime fetching, caching, error handling
- AnimeRecommendationService: Recommendation logic, recommendations filtering
- AnimeStatsService: Stats calculation, statistics aggregation
- AnimeCoverService: Cover image retrieval, command handling

**Run unit tests:**
```bash
pnpm test:unit
```

### 2. Integration Tests
**Location:** `__tests__/integration/`

Integration tests verify that multiple services work correctly together. They test real interactions between services with mocked API calls.

**What's Tested:**
- Service interactions (e.g., RandomAnimeService with CacheService)
- Cache consistency across service boundaries
- Error propagation through service layers
- Concurrent service calls
- Service lifecycle management

**Run integration tests:**
```bash
pnpm test:integration
```

### 3. E2E Tests
**Location:** `__tests__/e2e/`

End-to-end tests simulate complete command execution flows, verifying that all components work together to produce correct bot responses.

**What's Tested:**
- `/random_anime` command flow
- `/anime_stats` command flow
- `/anime_recommend` command flow
- `/anime_cover` command flow
- Error scenarios and graceful handling

**Run E2E tests:**
```bash
pnpm test:e2e
```

## Running Tests Locally

### Run all tests
```bash
pnpm test
```

### Run tests in watch mode (recommended for development)
```bash
pnpm test:watch
```

### Generate coverage reports
```bash
pnpm test:coverage
```

Coverage reports are saved to `coverage/` directory. Thresholds:
- Branches: 60%
- Functions: 60%
- Lines: 70%
- Statements: 70%

## Test Environment Setup

### Prerequisites
- Node.js 18+ (tested on 18.x, 20.x, 23.x)
- pnpm 10.14.0+

### Install dependencies
```bash
pnpm install
```

All testing dependencies are included in `devDependencies`:
- **jest**: Test framework
- **@types/jest**: Jest TypeScript definitions
- **axios-mock-adapter**: Mock HTTP requests for testing

## GitHub Actions CI Pipeline

The project includes a complete GitHub Actions workflow (`.github/workflows/test.yml`) that runs on:
- **Triggers:** Push to `main`/`develop` branches, PRs to `main`/`develop`
- **Node versions:** 18.x, 20.x, 23.x (matrix strategy for cross-version compatibility)
- **Steps:**
  1. Install dependencies
  2. Run unit tests
  3. Run integration tests
  4. Run E2E tests
  5. Generate coverage reports
  6. Upload coverage to Codecov (optional)

### Coverage Upload to Codecov

To enable Codecov coverage tracking:
1. Set up Codecov at https://codecov.io
2. Add `CODECOV_TOKEN` to GitHub Secrets (repository settings)
3. The workflow will automatically upload coverage reports

## Test Data Strategy

### Mocking APIs
- **Unit Tests:** All external API calls are mocked using `axios-mock-adapter`
- **Integration Tests:** API calls are mocked, but service interactions are real
- **E2E Tests:** API calls are mocked to simulate real responses

Test data uses real AniList anime IDs for consistency:
- **Common test anime:** Cowboy Bebop (ID: 1), Fullmetal Alchemist (ID: 5)
- **Mock user:** `testuser`

## Debugging Tests

### Run a single test file
```bash
pnpm test -- CacheService.test.js
```

### Run a single test case
```bash
pnpm test -- CacheService.test.js -t "should store and retrieve a value"
```

### Enable verbose output
```bash
pnpm test -- --verbose
```

### Debug in VS Code
Add to `.vscode/launch.json`:
```json
{
  "type": "node",
  "request": "launch",
  "name": "Jest Debug",
  "program": "${workspaceFolder}/node_modules/jest/bin/jest.js",
  "args": ["--runInBand"],
  "console": "integratedTerminal"
}
```

## Adding New Tests

### Test File Structure
```
__tests__/
├── unit/
│   ├── CacheService.test.js
│   ├── RandomAnimeService.test.js
│   └── ...
├── integration/
│   └── services.integration.test.js
├── e2e/
│   └── commands.e2e.test.js
└── setup.js (global setup)
```

### Writing a New Unit Test
```javascript
// __tests__/unit/MyService.test.js
const MyService = require('../../modules/MyService');

jest.mock('../../logger');
jest.mock('../../metrics');

describe('MyService', () => {
  let service;

  beforeEach(() => {
    service = new MyService();
    jest.clearAllMocks();
  });

  test('should do something', () => {
    expect(service.method()).toBe(expectedResult);
  });
});
```

### Testing Async Operations
```javascript
test('should fetch data', async () => {
  const result = await service.fetchData();
  expect(result).toBeDefined();
});
```

### Mocking External Calls
```javascript
const MockAdapter = require('axios-mock-adapter');
const axios = require('axios');

const mockAdapter = new MockAdapter(axios);

mockAdapter.onPost('https://api.example.com').replyOnce(200, {
  data: { /* mocked response */ }
});
```

## Test Metrics

Current test coverage:
- **Total Tests:** 80
- **Unit Tests:** 59
- **Integration Tests:** 8
- **E2E Tests:** 13
- **All Passing:** ✅

## Performance

Typical test execution times:
- Unit tests: ~2.3 seconds
- Integration tests: ~1.3 seconds
- E2E tests: ~1.2 seconds
- **Total:** ~4.8 seconds

## Continuous Improvement

### Known Limitations
- E2E tests use mocked Discord interactions (real bot would require dedicated test environment)
- API responses are mocked (no actual AniList API calls in CI)

### Future Enhancements
- Add snapshot testing for embed outputs
- Implement performance benchmarks
- Add memory leak detection
- Implement accessibility testing for embeds
- Add security scanning for dependencies

## Troubleshooting

### Tests fail locally but pass in CI
- Ensure Node version matches CI matrix (18.x, 20.x, or 23.x)
- Clear cache: `rm -rf node_modules pnpm-lock.yaml && pnpm install`
- Check for hardcoded paths or platform-specific issues

### Mock not working
- Ensure mock declarations come before imports
- Check `jest.mock()` paths are correct
- Verify `jest.clearAllMocks()` is called in `beforeEach`

### Timeout errors
- Increase timeout in jest.config.js (`testTimeout`)
- Check for infinite loops or unresolved promises

## Best Practices

1. **Keep tests focused:** One assertion per test when possible
2. **Use descriptive names:** Test names should explain what is tested
3. **Mock external dependencies:** Isolate the code under test
4. **Test edge cases:** Include error scenarios, empty data, etc.
5. **DRY principle:** Extract common setup logic to `beforeEach`
6. **Don't test implementation details:** Test behavior, not internal state

## References

- [Jest Documentation](https://jestjs.io/)
- [Testing Library Guide](https://jestjs.io/docs/snapshot-testing)
- [AniList API Docs](https://anilist.gitbook.io/anilist-apiv2-docs/)
