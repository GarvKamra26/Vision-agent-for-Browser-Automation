// extension/sidepanel.js — son-ion Controller (Pure Monochrome Dark Mode)

const BACKEND_HEALTH_URL = "http://localhost:8000/health";

let attachedTabId = null;
let isRunning = false;
let stepCounter = 0;
let lastStreamImage = null;

// DOM Elements
const tabTitleEl = document.getElementById('tabTitle');
const tabUrlEl = document.getElementById('tabUrl');
const refreshTabBtn = document.getElementById('refreshTabBtn');
const goalInput = document.getElementById('goalInput');
const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const continuousToggle = document.getElementById('continuousToggle');
const activityStream = document.getElementById('activityStream');
const clearStreamBtn = document.getElementById('clearStreamBtn');
const stepCountLabel = document.getElementById('stepCountLabel');

// QA Stream Elements
const qaStreamImg = document.getElementById('qaStreamImg');
const qaPlaceholder = document.getElementById('qaPlaceholder');
const qaStreamOverlay = document.getElementById('qaStreamOverlay');
const qaFrameNum = document.getElementById('qaFrameNum');
const qaPayloadSize = document.getElementById('qaPayloadSize');
const qaTimestamp = document.getElementById('qaTimestamp');
const qaRedactedCount = document.getElementById('qaRedactedCount');
const qaTelemetryFrame = document.getElementById('qaTelemetryFrame');
const qaElementsCount = document.getElementById('qaElementsCount');
const qaStatusPill = document.getElementById('qaStatusPill');
const qaPreviewRefreshBtn = document.getElementById('qaPreviewRefreshBtn');
const qaExpandBtn = document.getElementById('qaExpandBtn');

// Modal Elements
const qaImageModal = document.getElementById('qaImageModal');
const qaModalImg = document.getElementById('qaModalImg');
const qaModalCloseBtn = document.getElementById('qaModalCloseBtn');
const qaModalMeta = document.getElementById('qaModalMeta');

// ──────────────────────────────────────────────────
// Tab Tracking
// ──────────────────────────────────────────────────

async function updateActiveTab() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.id) {
      attachedTabId = tab.id;
      tabTitleEl.textContent = tab.title || "Untitled Tab";
      tabUrlEl.textContent = tab.url || "about:blank";
      tabTitleEl.title = tab.title || "";
      tabUrlEl.title = tab.url || "";
    }
  } catch (e) {
    console.error("Failed to query active tab:", e);
  }
}

// ──────────────────────────────────────────────────
// Stream: Live Frame Display
// ──────────────────────────────────────────────────

function updateQAStreamData(data) {
  const { image, step, redactedCount, elementsCount, payloadSizeKb, timestamp, status } = data;

  if (image) {
    lastStreamImage = image;
    qaStreamImg.src = image;
    qaStreamImg.classList.remove('hidden');
    if (qaPlaceholder) qaPlaceholder.classList.add('hidden');
    if (qaStreamOverlay) qaStreamOverlay.classList.remove('hidden');
    if (qaExpandBtn) qaExpandBtn.classList.remove('hidden');
  }

  if (step !== undefined) {
    if (qaFrameNum) qaFrameNum.textContent = `Frame #${step}`;
    if (qaTelemetryFrame) qaTelemetryFrame.textContent = `#${step}`;
  }
  if (payloadSizeKb !== undefined && qaPayloadSize) {
    qaPayloadSize.textContent = `${payloadSizeKb} KB`;
  }
  if (timestamp && qaTimestamp) {
    qaTimestamp.textContent = timestamp;
  }
  if (redactedCount !== undefined && qaRedactedCount) {
    qaRedactedCount.textContent = `${redactedCount} elements`;
  }
  if (elementsCount !== undefined && qaElementsCount) {
    qaElementsCount.textContent = `${elementsCount} nodes`;
  }
  if (status && qaStatusPill) {
    qaStatusPill.textContent = status;
  }
}

// Open Stream Image Modal
function openImageModal() {
  if (!lastStreamImage) return;
  qaModalImg.src = lastStreamImage;
  qaModalMeta.textContent = `Frame #${stepCounter} • Live Stream`;
  qaImageModal.classList.remove('hidden');
}

function closeImageModal() {
  qaImageModal.classList.add('hidden');
}

if (qaStreamImg) qaStreamImg.addEventListener('click', openImageModal);
if (qaExpandBtn) qaExpandBtn.addEventListener('click', openImageModal);
if (qaModalCloseBtn) qaModalCloseBtn.addEventListener('click', closeImageModal);
if (qaImageModal) {
  qaImageModal.addEventListener('click', (e) => {
    if (e.target === qaImageModal) closeImageModal();
  });
}

// Trigger Manual QA Snapshot
if (qaPreviewRefreshBtn) {
  qaPreviewRefreshBtn.addEventListener('click', async () => {
    await updateActiveTab();
    if (!attachedTabId) return;
    qaStatusPill.textContent = "Capturing...";
    chrome.runtime.sendMessage({
      type: "REQUEST_QA_PREVIEW",
      tabId: attachedTabId
    });
  });
}

// ──────────────────────────────────────────────────
// Activity Step Stream (Pure Monochrome)
// ──────────────────────────────────────────────────

function appendActivityStep(step, actionData) {
  const placeholder = activityStream.querySelector('.stream-placeholder');
  if (placeholder) placeholder.remove();

  const { action, target_id, value, thought } = actionData;
  const item = document.createElement('div');
  item.className = 'bg-[#0c0c0c] rounded-lg p-2.5 border border-neutral-800/80 space-y-1.5 transition-all';

  const actionName = (action || 'action').toUpperCase();
  const targetDesc = target_id !== null && target_id !== undefined ? `#${target_id}` : 'Page';
  const valDesc = value ? `"${escapeHtml(value)}"` : '';
  const time = new Date().toLocaleTimeString();

  // Pure monochrome action badge
  const badgeColor = "bg-neutral-800 text-neutral-200 border-neutral-700";

  item.innerHTML = `
    <div class="flex items-center justify-between text-[11px]">
      <div class="flex items-center gap-1.5">
        <span class="font-mono font-medium text-neutral-300">Step ${step}</span>
        <span class="px-1.5 py-0.5 rounded font-mono text-[10px] font-semibold border ${badgeColor}">${actionName}</span>
      </div>
      <span class="font-mono text-[10px] text-neutral-500">${time}</span>
    </div>
    <div class="text-xs text-neutral-300 leading-relaxed font-sans bg-black rounded-md p-2 border border-neutral-800/80">
      ${escapeHtml(thought || 'Executing next action...')}
    </div>
    <div class="flex items-center gap-1.5 text-[10px] font-mono text-neutral-400 pt-0.5">
      <span class="text-neutral-500">Target:</span>
      <span class="text-neutral-200 font-semibold">${targetDesc}</span>
      ${valDesc ? `<span class="text-neutral-600">•</span> <span class="text-white">${valDesc}</span>` : ''}
    </div>
  `;

  activityStream.appendChild(item);
  activityStream.scrollTop = activityStream.scrollHeight;

  // Trim overflow
  while (activityStream.children.length > 75) {
    activityStream.removeChild(activityStream.firstChild);
  }

  stepCounter++;
  stepCountLabel.textContent = `${stepCounter} steps`;
}

function appendNotification(message, type = 'info') {
  const placeholder = activityStream.querySelector('.stream-placeholder');
  if (placeholder) placeholder.remove();

  const time = new Date().toLocaleTimeString();

  const div = document.createElement('div');
  div.className = 'rounded-lg p-2.5 border border-neutral-800 bg-neutral-900/60 text-xs space-y-1';
  div.innerHTML = `
    <div class="flex items-center justify-between">
      <span class="font-medium text-neutral-300 text-[11px] uppercase tracking-wider">
        ${escapeHtml(type)}
      </span>
      <span class="font-mono text-[10px] text-neutral-500">${time}</span>
    </div>
    <div class="text-neutral-300 text-[11px] leading-relaxed">${escapeHtml(message)}</div>
  `;

  activityStream.appendChild(div);
  activityStream.scrollTop = activityStream.scrollHeight;
}

// ──────────────────────────────────────────────────
// UI State Management
// ──────────────────────────────────────────────────

function setRunningState(running) {
  isRunning = running;
  startBtn.disabled = running;
  stopBtn.disabled = !running;
  continuousToggle.disabled = running;

  if (running) {
    const label = startBtn.querySelector('span');
    label.textContent = continuousToggle.checked ? 'Watching...' : 'Running...';
  } else {
    updateStartButtonLabel();
  }
}

function updateStartButtonLabel() {
  const label = startBtn.querySelector('span');
  if (continuousToggle.checked) {
    label.textContent = '24/7 Watch';
    startBtn.title = 'Continuous mode — agent monitors indefinitely';
  } else {
    label.textContent = 'Start Agent';
    startBtn.title = 'Run autonomous agent until objective is reached';
  }
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, function(m) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m];
  });
}

// ──────────────────────────────────────────────────
// Event Handlers
// ──────────────────────────────────────────────────

continuousToggle.addEventListener('change', updateStartButtonLabel);

// Preset Chips
document.querySelectorAll('.preset-chip').forEach(chip => {
  chip.addEventListener('click', () => {
    const preset = chip.getAttribute('data-preset');
    if (preset) {
      goalInput.value = preset;
      goalInput.focus();

      if (preset.toLowerCase().includes('monitor') || preset.toLowerCase().includes('continue watching')) {
        continuousToggle.checked = true;
        updateStartButtonLabel();
      }
    }
  });
});

// Start button
startBtn.addEventListener('click', async () => {
  if (isRunning) return;
  await updateActiveTab();
  if (!attachedTabId) {
    alert("Please select a valid tab to attach.");
    return;
  }

  const goal = goalInput.value.trim();
  if (!goal) {
    alert("Please enter an objective for son-ion.");
    return;
  }

  stepCounter = 0;
  stepCountLabel.textContent = '0 steps';
  setRunningState(true);

  const messageType = continuousToggle.checked ? "START_CONTINUOUS" : "START_AGENT";
  chrome.runtime.sendMessage({
    type: messageType,
    tabId: attachedTabId,
    user_goal: goal
  });
});

// Stop button
stopBtn.addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: "STOP_AGENT" });
  setRunningState(false);
  appendNotification("Agent execution halted.", 'stopped');
});

// Refresh tab
refreshTabBtn.addEventListener('click', async () => {
  await updateActiveTab();
  if (attachedTabId) {
    chrome.runtime.sendMessage({
      type: "REQUEST_QA_PREVIEW",
      tabId: attachedTabId
    });
  }
});

// Clear stream
clearStreamBtn.addEventListener('click', () => {
  stepCounter = 0;
  stepCountLabel.textContent = '0 steps';
  activityStream.innerHTML = `
    <div class="stream-placeholder flex flex-col items-center justify-center py-7 text-center text-neutral-500">
      <div class="text-xs font-medium text-neutral-400">Stream cleared</div>
      <div class="text-[11px] text-neutral-600 mt-0.5">Ready for next run.</div>
    </div>
  `;
});

// ──────────────────────────────────────────────────
// Message Listener from background.js
// ──────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'AGENT_STEP_EVENT') {
    appendActivityStep(msg.step, msg.actionData);
  } else if (msg.type === 'QA_IMAGE_STREAM') {
    updateQAStreamData(msg);
  } else if (msg.type === 'AGENT_STATUS_EVENT') {
    switch (msg.status) {
      case 'DONE':
        appendNotification(msg.message || "Goal accomplished!", 'done');
        setRunningState(false);
        break;
      case 'ERROR':
        appendNotification(msg.message || "An error occurred.", 'error');
        setRunningState(false);
        break;
      case 'STOPPED':
        setRunningState(false);
        break;
      case 'IDLE':
        appendNotification(msg.message || "Watching for state changes...", 'idle');
        break;
      case 'RETRY':
        appendNotification(msg.message || "Retrying action...", 'retry');
        break;
      case 'WATCHING':
        appendNotification(msg.message || "Continuous watch mode started.", 'watching');
        break;
    }
  }
});

// ──────────────────────────────────────────────────
// Tab Events & Init
// ──────────────────────────────────────────────────

chrome.tabs.onActivated.addListener(updateActiveTab);
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'complete') updateActiveTab();
});

updateActiveTab();
updateStartButtonLabel();
