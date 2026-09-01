/**
 * Factory for mock Discord chat-input interactions.
 *
 * Returns the full shape the service handlers touch, including the
 * `replied`/`deferred`/`reply` fields the fallback error branches guard on
 * (the inline literals used previously omitted these, making those
 * branches unreachable in tests).
 *
 * A default (non-overridden) `deferReply` flips `deferred` to true when it
 * resolves, mirroring discord.js; override `deferReply` to simulate a
 * failed defer while `deferred` stays false.
 *
 * Overrides are shallow-spread: to customise `getString`, pass a whole
 * `options` object, e.g. createMockInteraction({ options: { getString: jest.fn() } }).
 */
function createMockInteraction(overrides = {}) {
    const interaction = {
        commandName: 'animerandom',
        guildId: 'guild-123',
        user: { username: 'testuser', id: 'user-123' },
        options: {
            getString: jest.fn().mockReturnValue('testuser')
        },
        deferred: false,
        replied: false,
        deferReply: jest.fn(),
        editReply: jest.fn().mockResolvedValue(undefined),
        reply: jest.fn().mockResolvedValue(undefined),
        isChatInputCommand: jest.fn().mockReturnValue(true),
        ...overrides
    };

    if (!overrides.deferReply) {
        interaction.deferReply.mockImplementation(() => {
            interaction.deferred = true;
            return Promise.resolve();
        });
    }

    return interaction;
}

module.exports = { createMockInteraction };
