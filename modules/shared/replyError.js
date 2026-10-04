const logger = require('../observability/logger');

async function replyError(interaction, content, originalError) {
  try {
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply({ content });
    } else {
      await interaction.reply({ content, ephemeral: true });
    }
  } catch (replyError) {
    logger.error('Failed to send final error message', { originalError, replyError });
  }
}
module.exports = replyError;
