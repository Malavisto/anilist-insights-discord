// Executed by Bun inside the bot container; no dependencies or credentials needed.
async function checkReadiness(request = fetch) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3000);
  try {
    const response = await request(`http://127.0.0.1:${process.env.METRICS_PORT || 9090}/readyz`, {
      signal: controller.signal,
    });
    return response.status === 200 ? 0 : 1;
  } catch {
    return 1;
  } finally {
    clearTimeout(timer);
  }
}
if (require.main === module) checkReadiness().then((code) => process.exit(code));
module.exports = checkReadiness;
