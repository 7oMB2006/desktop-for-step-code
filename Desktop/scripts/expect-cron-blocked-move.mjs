// A cron-hosting worker can still be draining its navigation or status reads when
// the move is attempted; the guard then reports the transient operation instead of
// the Cron ownership. The Cron rejection must remain the final reason, so retry
// only that transient race and never accept a different outcome.
const cronRejection = /MOVE_CRON_HOST|MOVE_CRON_ASSOCIATED|MOVE_CRON_UNAVAILABLE|Cron|scheduled/i;
const transientOperation = /(?:^|Error: )Session operation in progress$/;

// The page is an explicit parameter so the assertion stays importable and testable:
// the Electron fixture declares its page inside a try block, which a module-level
// helper cannot close over.
export const expectCronBlockedMove = async (page, sessionId, destination) => {
  for (let attempt = 0; ; attempt++) {
    try {
      await page.evaluate(({ id, destination }) => window.desktop.moveSessionToProject(id, destination),
        { id: sessionId, destination });
    } catch (error) {
      const failure = String(error instanceof Error ? error.message : error);
      if (cronRejection.test(failure)) return;
      if (attempt >= 5 || !transientOperation.test(failure)) throw error;
      await page.waitForTimeout(500);
      continue;
    }
    throw new Error(`Moving session ${sessionId} unexpectedly succeeded`);
  }
};
