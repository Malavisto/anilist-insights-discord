// Smoke test for the real winston configuration - no log calls are made,
// so the file transports stay empty; close() releases the streams.
const logger = require('../../logger');

describe('logger', () => {
  test('exports a winston logger at info level', () => {
    expect(logger.level).toBe('info');
  });

  test('configures console plus two rotating file transports', () => {
    const fileTransports = logger.transports.filter(t => t.filename);

    expect(logger.transports.length).toBe(3);
    // winston File transports expose dirname + basename separately
    const paths = fileTransports.map(t => `${t.dirname}/${t.filename}`);
    expect(paths).toEqual(
      expect.arrayContaining([
        expect.stringContaining('logs/info.log'),
        expect.stringContaining('logs/error.log')
      ])
    );
    fileTransports.forEach(t => {
      expect(t.maxsize).toBe(5242880); // 5MB
      expect(t.maxFiles).toBe(5);
    });
  });

  test('tags records with the service defaultMeta', () => {
    expect(logger.defaultMeta).toEqual({ service: 'anilist-discord-bot' });
  });

  afterAll(() => {
    logger.close();
  });
});
