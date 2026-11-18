import { test, expect } from '@playwright/test';

test.describe('E2E Full Platform Lifecycle (Task 29)', () => {
  const timestamp = Date.now();
  const streamerUser = `streamer_${timestamp}`;
  const viewerUser = `viewer_${timestamp}`;
  const password = 'StrongPassword123!';

  test('complete streamer go-live, viewer playback, chat, moderation, and stream end', async ({
    browser,
  }) => {
    // -------------------------------------------------------------------------
    // 1. Register Streamer & Log In
    // -------------------------------------------------------------------------
    const streamerContext = await browser.newContext({
      permissions: ['camera', 'microphone'],
    });
    const streamerPage = await streamerContext.newPage();

    await streamerPage.goto('/register');
    await streamerPage.fill('input[type="email"]', `${streamerUser}@test.local`);
    await streamerPage.fill('input[placeholder="streamer_name"]', streamerUser);
    await streamerPage.fill('input[type="password"]', password);
    await streamerPage.click('button[type="submit"]');

    // Wait for redirect to home after registration
    await expect(streamerPage).toHaveURL('/', { timeout: 15000 });

    // -------------------------------------------------------------------------
    // 2. Streamer Navigates to Studio & Goes Live
    // -------------------------------------------------------------------------
    await streamerPage.goto('/studio');

    // Wait for Go Live button to become enabled
    const goLiveBtn = streamerPage.locator('button', { hasText: 'Go Live' });
    await expect(goLiveBtn).toBeVisible({ timeout: 15000 });
    await expect(goLiveBtn).toBeEnabled({ timeout: 15000 });
    await goLiveBtn.click();

    // Verify stream status becomes Live (End Stream button appears)
    const endStreamBtn = streamerPage.locator('button', { hasText: 'End Stream' });
    await expect(endStreamBtn).toBeVisible({ timeout: 20000 });

    // -------------------------------------------------------------------------
    // 3. Second Browser Context (Viewer) Registers & Watches Stream
    // -------------------------------------------------------------------------
    const viewerContext = await browser.newContext();
    const viewerPage = await viewerContext.newPage();

    // Register Viewer
    await viewerPage.goto('/register');
    await viewerPage.fill('input[type="email"]', `${viewerUser}@test.local`);
    await viewerPage.fill('input[placeholder="streamer_name"]', viewerUser);
    await viewerPage.fill('input[type="password"]', password);
    await viewerPage.click('button[type="submit"]');
    await expect(viewerPage).toHaveURL('/', { timeout: 15000 });

    // Viewer navigates to streamer's channel
    await viewerPage.goto(`/c/${streamerUser}`);

    // Assert video element is present and receiving real/fake video frames
    const videoLocator = viewerPage.locator('video');
    await expect(videoLocator).toBeVisible({ timeout: 20000 });

    // Assert video is playing: videoWidth > 0 and currentTime advances
    await expect
      .poll(
        async () => {
          return await viewerPage.evaluate(() => {
            const v = document.querySelector('video');
            if (!v) return false;
            return v.videoWidth > 0 && v.currentTime > 0;
          });
        },
        { timeout: 20000, intervals: [500, 1000] }
      )
      .toBe(true);

    // -------------------------------------------------------------------------
    // 4. Chat Message from Viewer Appears for Streamer
    // -------------------------------------------------------------------------
    const chatInput = viewerPage.locator('input[placeholder*="Send a message"]');
    await expect(chatInput).toBeVisible({ timeout: 10000 });
    const chatMsg = `Hello from E2E viewer! msg_${timestamp}`;
    await chatInput.fill(chatMsg);
    await chatInput.press('Enter');

    // Verify message appears in Viewer's chat panel
    await expect(viewerPage.locator(`text=${chatMsg}`)).toBeVisible({ timeout: 10000 });

    // Verify message appears in Streamer's chat panel
    await expect(streamerPage.locator(`text=${chatMsg}`)).toBeVisible({ timeout: 10000 });

    // -------------------------------------------------------------------------
    // 5. Moderator (Channel Owner) Deletes the Message
    // -------------------------------------------------------------------------
    // Hover over message in streamer's chat panel to reveal mod action buttons
    const streamerMsgLocator = streamerPage.locator(`div:has-text("${chatMsg}")`).last();
    await streamerMsgLocator.hover();

    const deleteBtn = streamerPage.locator('button[title*="Delete"], button[aria-label*="Delete"]').first();
    if (await deleteBtn.isVisible()) {
      await deleteBtn.click();
    } else {
      // Direct call or mod delete button trigger
      await streamerMsgLocator.locator('button').first().click();
    }

    // Message should be removed or marked deleted in viewer's chat
    await expect(viewerPage.locator(`text=${chatMsg}`)).not.toBeVisible({ timeout: 10000 });

    // -------------------------------------------------------------------------
    // 6. Streamer Ends Stream, Viewer Sees Offline State
    // -------------------------------------------------------------------------
    await endStreamBtn.click();
    await expect(goLiveBtn).toBeVisible({ timeout: 15000 });

    // Viewer should observe stream offline indicator
    await expect(
      viewerPage.locator('text=offline, text=Stream is offline, text=This channel is currently offline').first()
    ).toBeVisible({ timeout: 15000 });

    // Clean up contexts
    await viewerContext.close();
    await streamerContext.close();
  });
});
