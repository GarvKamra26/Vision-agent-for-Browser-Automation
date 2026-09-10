// extension/background.js — 24/7 Continuous Agent with Autonomous, Watch, and Robust Navigation

const BACKEND_URL = "http://localhost:8000/process-dom";
const DEFAULT_USER_GOAL = "Complete the specified user task on the page and finish.";
const MAX_STEPS_NORMAL = 20;
const WATCH_POLL_INTERVAL_MS = 2500;   // Capture and pass vision screenshot every 2.5 seconds
const ACTION_DELAY_MS = 250;            // Settle delay between steps

let isRunning = false;
let shouldStop = false;
let globalStepCounter = 0;

// Configure Chrome side panel
if (chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })
    .catch((err) => console.warn("Failed to configure sidePanel behavior:", err));
}

function delay(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function broadcast(msg) {
  chrome.runtime.sendMessage(msg).catch(() => {});
}

function setBadge(tabId, text, color) {
  chrome.action.setBadgeText({ tabId, text }).catch(() => {});
  if (color) chrome.action.setBadgeBackgroundColor({ tabId, color }).catch(() => {});
}

/**
 * Waits for a tab to finish loading and settles dynamic frameworks.
 */
async function waitForTabReady(tabId, maxWaitMs = 8000) {
  const startTime = Date.now();
  await delay(120);

  while (Date.now() - startTime < maxWaitMs) {
    try {
      const tab = await chrome.tabs.get(tabId);
      if (tab.status === 'complete') {
        // Extra settle time for React/Vue dynamic re-rendering
        await delay(300);
        return true;
      }
    } catch (e) {
      // Tab may be transitioning
    }
    await delay(150);
  }
  return true;
}

/**
 * Ensures the content script is injected and responsive on the tab.
 */
async function ensureContentScriptInjected(tabId, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    await waitForTabReady(tabId, 5000);
    try {
      const res = await chrome.tabs.sendMessage(tabId, { type: 'EXTRACT_DOM' });
      if (res && res.elements) return res;
    } catch (err) {
      console.warn(`[Background] Attempt ${attempt}: Content script not responding on tab ${tabId}, injecting...`);
      try {
        await chrome.scripting.executeScript({
          target: { tabId },
          files: ['content.js']
        });
        await delay(250);
        const res = await chrome.tabs.sendMessage(tabId, { type: 'EXTRACT_DOM' });
        if (res && res.elements) return res;
      } catch (injectErr) {
        console.warn(`[Background] Script injection attempt ${attempt} failed:`, injectErr.message);
      }
    }
    await delay(300);
  }
  return { elements: [], pageStatus: null };
}

/**
 * Captures screenshot of the visible area of the tab as base64 JPEG.
 */
async function captureTabScreenshot(tabId) {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (!tab || tab.windowId === undefined) return null;

    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
      format: "jpeg",
      quality: 70
    });

    if (dataUrl) {
      // Strip 'data:image/jpeg;base64,' prefix for raw base64 string
      return dataUrl.replace(/^data:image\/\w+;base64,/, "");
    }
    return null;
  } catch (err) {
    console.warn("[son-ion] Screenshot capture warning:", err.message);
    return null;
  }
}

/**
 * Applies solid black boxes over sensitive bounding boxes on the screenshot
 * exclusively for the AI perception and QA preview, without ever altering the user's browser.
 */
async function applyBlackBoxRedaction(base64Image, sensitiveBoxes, viewport) {
  if (!base64Image || !sensitiveBoxes || sensitiveBoxes.length === 0) {
    return base64Image;
  }

  try {
    const binaryStr = atob(base64Image);
    const len = binaryStr.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binaryStr.charCodeAt(i);
    }
    const blob = new Blob([bytes], { type: "image/jpeg" });
    const imageBitmap = await createImageBitmap(blob);

    const canvas = new OffscreenCanvas(imageBitmap.width, imageBitmap.height);
    const ctx = canvas.getContext("2d");
    ctx.drawImage(imageBitmap, 0, 0);

    const viewW = (viewport && viewport.width) ? viewport.width : (imageBitmap.width / (viewport?.devicePixelRatio || 1));
    const viewH = (viewport && viewport.height) ? viewport.height : (imageBitmap.height / (viewport?.devicePixelRatio || 1));
    const scaleX = imageBitmap.width / viewW;
    const scaleY = imageBitmap.height / viewH;

    for (const box of sensitiveBoxes) {
      const bx = Math.max(0, Math.floor(box.x * scaleX));
      const by = Math.max(0, Math.floor(box.y * scaleY));
      const bw = Math.min(imageBitmap.width - bx, Math.ceil(box.width * scaleX));
      const bh = Math.min(imageBitmap.height - by, Math.ceil(box.height * scaleY));

      if (bw > 0 && bh > 0) {
        // Draw solid black box exclusively for the AI vision perception
        ctx.fillStyle = "#000000";
        ctx.fillRect(bx, by, bw, bh);

        // Subtle dark border for clean AI perception
        ctx.strokeStyle = "#18181b";
        ctx.lineWidth = 1;
        ctx.strokeRect(bx, by, bw, bh);
      }
    }

    const redactedBlob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.75 });
    const arrayBuffer = await redactedBlob.arrayBuffer();
    const redactedBytes = new Uint8Array(arrayBuffer);
    let binary = "";
    const chunkSz = 8192;
    for (let i = 0; i < redactedBytes.length; i += chunkSz) {
      binary += String.fromCharCode.apply(null, redactedBytes.subarray(i, i + chunkSz));
    }
    return btoa(binary);
  } catch (err) {
    console.warn("[son-ion] Black box redaction fallback:", err.message);
    return base64Image;
  }
}

let recentActions = [];

/**
 * Runs a single step of DOM extraction → LLM reasoning → action execution.
 */
async function runSingleStep(tabId, userGoal, stepNumber = 1) {
  // 1. Capture base64 screenshot of current page
  const rawScreenshot = await captureTabScreenshot(tabId);

  // 2. Extract DOM (for element IDs, coordinate bounds, and sensitive zones)
  const domState = await ensureContentScriptInjected(tabId);
  const elements = domState && domState.elements ? domState.elements : [];
  const sensitiveBoxes = (domState && domState.sensitiveBoxes) ? domState.sensitiveBoxes : [];
  const redactedCount = sensitiveBoxes.length;

  // 3. Black-box sensitive zones ON THE SCREENSHOT ONLY FOR THE AI (user's browser is untouched)
  const screenshot = await applyBlackBoxRedaction(rawScreenshot, sensitiveBoxes, domState ? domState.viewport : null);
  const payloadSizeKb = screenshot ? Math.round((screenshot.length * 0.75) / 1024) : 0;

  // Broadcast real-time QA stream event of the redacted image sent to the model
  broadcast({
    type: "QA_IMAGE_STREAM",
    step: stepNumber,
    image: screenshot ? `data:image/jpeg;base64,${screenshot}` : null,
    redactedCount: redactedCount,
    elementsCount: elements.length,
    payloadSizeKb: payloadSizeKb,
    timestamp: new Date().toLocaleTimeString(),
    status: "Sent to Model"
  });

  const serverResponse = await fetch(BACKEND_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      screenshot: screenshot, // Base64 visual capture
      elements: elements,
      page_status: domState ? domState.pageStatus : null,
      user_goal: userGoal || DEFAULT_USER_GOAL,
      previous_actions: recentActions.slice(-6)
    })
  });

  if (!serverResponse.ok) {
    const errText = await serverResponse.text();
    throw new Error(`Server ${serverResponse.status}: ${errText}`);
  }

  const actionData = await serverResponse.json();
  console.log(`[Background] Step ${stepNumber}:`, actionData);

  // Identify target element details for history and loop detection
  const targetEl = domState.elements.find(e => e.id === actionData.target_id);
  const targetText = targetEl ? (targetEl.text || targetEl.name || targetEl.tag) : null;

  // ──────────────────────────────────────────────────
  // ANTI-LOOPING SAFEGUARD
  // ──────────────────────────────────────────────────

  // 1. Consecutive identical action check on same target
  let consecutiveCount = 0;
  for (let i = recentActions.length - 1; i >= 0; i--) {
    const past = recentActions[i];
    if (past.action === actionData.action &&
        past.target_id === actionData.target_id &&
        past.value === actionData.value) {
      consecutiveCount++;
    } else {
      break;
    }
  }

  if (consecutiveCount >= 2 && actionData.action !== 'done' && actionData.action !== 'scroll') {
    console.warn(`[son-ion] Anti-looping: Detected 3 identical consecutive actions (${actionData.action} on #${actionData.target_id} "${targetText || ''}"). Intercepting loop.`);
    actionData.action = "done";
    actionData.thought = `Anti-looping safeguard: Element #${actionData.target_id} ("${targetText || ''}") was already acted upon ${consecutiveCount} times in succession. Halting repetitive loop.`;
    broadcast({
      type: "AGENT_STATUS_EVENT",
      status: "IDLE",
      message: `Anti-looping safeguard: Prevented repetitive loop on #${actionData.target_id}. Entering idle state.`
    });
  }

  // 2. Ping-pong / alternating oscillation check (A -> B -> A -> B)
  if (recentActions.length >= 3 && actionData.action !== 'done' && actionData.action !== 'scroll') {
    const a1 = recentActions[recentActions.length - 1];
    const a2 = recentActions[recentActions.length - 2];
    const a3 = recentActions[recentActions.length - 3];
    if (a1.target_id === a3.target_id &&
        a2.target_id === actionData.target_id &&
        a1.action === a3.action &&
        a2.action === actionData.action) {
      console.warn(`[son-ion] Anti-looping: Oscillation detected between #${a1.target_id} and #${a2.target_id}. Intercepting loop.`);
      actionData.action = "done";
      actionData.thought = `Anti-looping safeguard: Detected repetitive oscillation between #${a1.target_id} and #${a2.target_id}. Halting loop.`;
      broadcast({
        type: "AGENT_STATUS_EVENT",
        status: "IDLE",
        message: `Anti-looping safeguard: Detected alternating loop. Entering idle state.`
      });
    }
  }

  // Record action into session history
  recentActions.push({
    step: stepNumber,
    action: actionData.action,
    target_id: actionData.target_id,
    target_text: targetText,
    value: actionData.value,
    thought: actionData.thought
  });
  if (recentActions.length > 20) recentActions.shift();

  // Broadcast step event to sidepanel
  broadcast({ type: "AGENT_STEP_EVENT", step: stepNumber, actionData });

  if (actionData.action === "done") {
    return actionData;
  }

  // Handle direct navigation action in background worker
  if (actionData.action === "navigate" && actionData.value) {
    let url = String(actionData.value).trim();
    if (!url.startsWith("http://") && !url.startsWith("https://")) {
      url = "https://" + url;
    }
    console.log(`[Background] Navigating tab ${tabId} to ${url}`);
    await chrome.tabs.update(tabId, { url });
    await waitForTabReady(tabId, 12000);
    return actionData;
  }

  // Execute action in content script
  try {
    await chrome.tabs.sendMessage(tabId, {
      type: "EXECUTE_ACTION",
      payload: { ...actionData, step: stepNumber }
    });
  } catch (execErr) {
    console.warn(`[Background] Execute action error on tab ${tabId}:`, execErr.message);
  }

  // If action was a link click or navigation, wait for tab to settle
  await waitForTabReady(tabId, 6000);

  return actionData;
}

/**
 * Standard autonomous loop: runs up to MAX_STEPS or until 'done'.
 */
async function runAutonomousLoop(tabId, userGoal) {
  if (isRunning) return;
  isRunning = true;
  shouldStop = false;
  globalStepCounter = 0;
  recentActions = [];

  // Reset agent state on content tab
  chrome.tabs.sendMessage(tabId, { type: 'CLEAR_AGENT_STATE' }).catch(() => {});

  setBadge(tabId, "RUN", "#10b981");

  try {
    for (let step = 1; step <= MAX_STEPS_NORMAL; step++) {
      if (shouldStop) break;

      globalStepCounter = step;
      const actionData = await runSingleStep(tabId, userGoal, step);

      if (actionData.action === "done") {
        broadcast({ type: "AGENT_STATUS_EVENT", status: "DONE", message: `Goal accomplished in ${step} steps!` });
        setBadge(tabId, "DONE", "#3b82f6");
        return;
      }

      await delay(ACTION_DELAY_MS);
    }

    if (shouldStop) {
      broadcast({ type: "AGENT_STATUS_EVENT", status: "STOPPED", message: "Agent stopped by user." });
    } else {
      broadcast({ type: "AGENT_STATUS_EVENT", status: "DONE", message: `Reached step limit (${MAX_STEPS_NORMAL}). Task completed or paused.` });
    }
  } catch (error) {
    console.error("[Background] Autonomous loop error:", error);
    broadcast({ type: "AGENT_STATUS_EVENT", status: "ERROR", message: error.message });
    setBadge(tabId, "ERR", "#ef4444");
  } finally {
    isRunning = false;
    setTimeout(() => setBadge(tabId, "", ""), 4000);
  }
}

/**
 * 24/7 CONTINUOUS WATCH MODE
 */
async function runContinuousWatch(tabId, userGoal) {
  if (isRunning) return;
  isRunning = true;
  shouldStop = false;
  globalStepCounter = 0;
  recentActions = [];

  // Reset agent state on content tab
  chrome.tabs.sendMessage(tabId, { type: 'CLEAR_AGENT_STATE' }).catch(() => {});

  setBadge(tabId, "24/7", "#8b5cf6");
  broadcast({ type: "AGENT_STATUS_EVENT", status: "WATCHING", message: "Continuous watch mode active. Monitoring page..." });

  try {
    while (!shouldStop) {
      globalStepCounter++;
      const step = globalStepCounter;

      try {
        const actionData = await runSingleStep(tabId, userGoal, step);

        if (actionData.action === "done") {
          broadcast({
            type: "AGENT_STATUS_EVENT",
            status: "IDLE",
            message: `Step ${step}: System idle — watching for updates...`
          });
          setBadge(tabId, "IDLE", "#6366f1");
          await delay(WATCH_POLL_INTERVAL_MS * 2);
          setBadge(tabId, "24/7", "#8b5cf6");
        } else {
          await delay(ACTION_DELAY_MS);
        }
      } catch (stepError) {
        console.warn(`[Background] Watch step ${step} failed:`, stepError.message);
        broadcast({
          type: "AGENT_STATUS_EVENT",
          status: "RETRY",
          message: `Step ${step}: ${stepError.message}. Retrying...`
        });
        await delay(WATCH_POLL_INTERVAL_MS * 2);
      }
    }

    broadcast({ type: "AGENT_STATUS_EVENT", status: "STOPPED", message: "Continuous watch stopped by user." });
  } catch (fatalError) {
    console.error("[Background] Fatal continuous watch error:", fatalError);
    broadcast({ type: "AGENT_STATUS_EVENT", status: "ERROR", message: fatalError.message });
    setBadge(tabId, "ERR", "#ef4444");
  } finally {
    isRunning = false;
    setTimeout(() => setBadge(tabId, "", ""), 3000);
  }
}

// ──────────────────────────────────────────────────
// Message Router
// ──────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  switch (request.type) {
    case "START_AGENT":
      runAutonomousLoop(request.tabId, request.user_goal);
      sendResponse({ started: true });
      break;

    case "START_CONTINUOUS":
      runContinuousWatch(request.tabId, request.user_goal);
      sendResponse({ started: true });
      break;

    case "STEP_AGENT":
      runSingleStep(request.tabId, request.user_goal, globalStepCounter + 1)
        .then(action => sendResponse({ success: true, action }))
        .catch(err => sendResponse({ success: false, error: err.message }));
      return true;

    case "STOP_AGENT":
      shouldStop = true;
      isRunning = false;
      sendResponse({ stopped: true });
      break;

    case "REQUEST_QA_PREVIEW":
      (async () => {
        try {
          const dom = await ensureContentScriptInjected(request.tabId);
          const rawScreenshot = await captureTabScreenshot(request.tabId);
          const sensitiveBoxes = dom && dom.sensitiveBoxes ? dom.sensitiveBoxes : [];
          const screenshot = await applyBlackBoxRedaction(rawScreenshot, sensitiveBoxes, dom ? dom.viewport : null);
          const redactedCount = sensitiveBoxes.length;
          const payloadSizeKb = screenshot ? Math.round((screenshot.length * 0.75) / 1024) : 0;
          broadcast({
            type: "QA_IMAGE_STREAM",
            step: globalStepCounter || 0,
            image: screenshot ? `data:image/jpeg;base64,${screenshot}` : null,
            redactedCount,
            elementsCount: (dom && dom.elements) ? dom.elements.length : 0,
            payloadSizeKb,
            timestamp: new Date().toLocaleTimeString(),
            status: "Live Snapshot"
          });
        } catch (e) {
          console.warn("[son-ion] Preview error:", e);
        }
      })();
      sendResponse({ requested: true });
      break;
  }
});
