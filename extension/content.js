// extension/content.js — Advanced Physical Cursor & Robust DOM Interaction Engine

// ──────────────────────────────────────────────────
// VISIBILITY & DOM INSPECTION HELPERS
// ──────────────────────────────────────────────────

function isStrictlyVisible(element) {
  if (!element || !element.getBoundingClientRect) return false;
  const rect = element.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return false;

  const style = window.getComputedStyle(element);
  if (
    style.display === 'none' ||
    style.visibility === 'hidden' ||
    style.opacity === '0' ||
    style.pointerEvents === 'none'
  ) {
    return false;
  }
  return true;
}

// ──────────────────────────────────────────────────
// VIRTUAL CURSOR SYSTEM
// ──────────────────────────────────────────────────

let cursorX = Math.round(window.innerWidth / 2);
let cursorY = Math.round(window.innerHeight / 2);
let cursorEl = null;

function ensureVirtualCursor() {
  if (cursorEl && document.body && document.body.contains(cursorEl)) {
    return cursorEl;
  }

  cursorEl = document.createElement('div');
  cursorEl.id = 'hermes-virtual-cursor';
  cursorEl.innerHTML = `
    <div id="hermes-cursor-wrapper" style="position:relative; width:44px; height:44px;">
      <!-- Glowing Arrow Cursor -->
      <svg width="34" height="34" viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg" style="display:block; filter: drop-shadow(0 2px 8px rgba(0, 255, 136, 0.7));">
        <path d="M4 2L4 23.5L9.5 18L15.5 26.5L18.5 24.5L12.5 16.5L20 15.5L4 2Z"
              fill="#00FF88" stroke="#064E3B" stroke-width="1.8" stroke-linejoin="round"/>
        <path d="M6 5.5L6 19.5L10 15.5L15 22.5L16.5 21.5L11.5 14.5L17 14L6 5.5Z"
              fill="#A7F3D0"/>
      </svg>

      <!-- Click Ripple Wave -->
      <div id="hermes-cursor-ripple" style="
        position: absolute;
        left: 2px;
        top: 2px;
        width: 24px;
        height: 24px;
        border-radius: 50%;
        border: 2px solid #00FF88;
        background: rgba(0, 255, 136, 0.25);
        opacity: 0;
        transform: scale(0.4);
        pointer-events: none;
      "></div>

      <!-- Action Status Pill Badge -->
      <div id="hermes-cursor-label" style="
        position: absolute;
        left: 26px;
        top: 8px;
        background: rgba(10, 15, 29, 0.95);
        color: #34d399;
        font-size: 11px;
        font-weight: 700;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        padding: 4px 10px;
        border-radius: 20px;
        border: 1px solid rgba(16, 185, 129, 0.6);
        box-shadow: 0 4px 14px rgba(0, 0, 0, 0.5), 0 0 10px rgba(0, 255, 136, 0.3);
        white-space: nowrap;
        opacity: 0;
        transform: translateY(2px);
        transition: opacity 0.2s ease, transform 0.2s ease;
        pointer-events: none;
      "></div>
    </div>
  `;

  Object.assign(cursorEl.style, {
    position: 'fixed',
    left: `${cursorX}px`,
    top: `${cursorY}px`,
    width: '44px',
    height: '44px',
    pointerEvents: 'none',
    zIndex: '2147483647',
    transform: 'translate(-2px, -2px)',
    transition: 'none',
    willChange: 'left, top'
  });

  if (document.body) {
    document.body.appendChild(cursorEl);
  }
  return cursorEl;
}

/**
 * Natural cubic-bezier motion for the virtual cursor.
 */
function glideCursorTo(targetX, targetY, durationMs = 220) {
  return new Promise((resolve) => {
    const cursor = ensureVirtualCursor();
    const startX = cursorX;
    const startY = cursorY;
    const startTime = performance.now();

    // Natural ease-out cubic curve
    function easeOutCubic(t) {
      return 1 - Math.pow(1 - t, 3);
    }

    function step(now) {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / durationMs, 1);
      const ease = easeOutCubic(progress);

      cursorX = startX + (targetX - startX) * ease;
      cursorY = startY + (targetY - startY) * ease;

      cursor.style.left = `${Math.round(cursorX)}px`;
      cursor.style.top = `${Math.round(cursorY)}px`;

      if (progress < 1) {
        requestAnimationFrame(step);
      } else {
        cursorX = targetX;
        cursorY = targetY;
        cursor.style.left = `${targetX}px`;
        cursor.style.top = `${targetY}px`;
        resolve();
      }
    }

    requestAnimationFrame(step);
  });
}

function showCursorLabel(text, durationMs = 1500) {
  const cursor = ensureVirtualCursor();
  const label = cursor.querySelector('#hermes-cursor-label');
  if (label) {
    label.textContent = text;
    label.style.opacity = '1';
    label.style.transform = 'translateY(0)';
    setTimeout(() => {
      label.style.opacity = '0';
      label.style.transform = 'translateY(2px)';
    }, durationMs);
  }
}

function fireCursorRipple() {
  const cursor = ensureVirtualCursor();
  const ripple = cursor.querySelector('#hermes-cursor-ripple');
  if (!ripple) return;

  ripple.style.transition = 'none';
  ripple.style.opacity = '0.9';
  ripple.style.transform = 'scale(0.3)';

  requestAnimationFrame(() => {
    ripple.style.transition = 'transform 0.4s cubic-bezier(0.2, 0.8, 0.2, 1), opacity 0.4s ease-out';
    ripple.style.transform = 'scale(3.2)';
    ripple.style.opacity = '0';
  });
}

// ──────────────────────────────────────────────────
// TARGET HIGHLIGHT BOX
// ──────────────────────────────────────────────────

function showHighlightTarget(element) {
  if (!element || !element.getBoundingClientRect) return;
  const rect = element.getBoundingClientRect();

  const highlight = document.createElement('div');
  highlight.className = 'hermes-target-highlight';
  Object.assign(highlight.style, {
    position: 'fixed',
    left: `${Math.round(rect.left - 3)}px`,
    top: `${Math.round(rect.top - 3)}px`,
    width: `${Math.round(rect.width + 6)}px`,
    height: `${Math.round(rect.height + 6)}px`,
    borderRadius: '8px',
    border: '2px solid #00FF88',
    boxShadow: '0 0 16px rgba(0, 255, 136, 0.6), inset 0 0 10px rgba(0, 255, 136, 0.2)',
    backgroundColor: 'rgba(0, 255, 136, 0.08)',
    pointerEvents: 'none',
    zIndex: '2147483646',
    opacity: '0',
    transform: 'scale(0.96)',
    transition: 'transform 0.2s cubic-bezier(0.2, 0.8, 0.2, 1), opacity 0.2s ease-out'
  });

  document.body.appendChild(highlight);

  requestAnimationFrame(() => {
    highlight.style.transform = 'scale(1)';
    highlight.style.opacity = '1';
  });

  setTimeout(() => {
    highlight.style.opacity = '0';
    highlight.style.transform = 'scale(1.04)';
    setTimeout(() => highlight.remove(), 250);
  }, 1000);
}

// ──────────────────────────────────────────────────
// DOM EXTRACTION & TAGGING
// ──────────────────────────────────────────────────

function extractAndTagInteractiveElements() {
  // Clear previous agent IDs
  document.querySelectorAll('[data-agent-id]').forEach(el => {
    el.removeAttribute('data-agent-id');
  });

  const selector = [
    'button',
    'input:not([type="hidden"])',
    'textarea',
    'select',
    'a[href]',
    '[role="button"]',
    '[role="link"]',
    '[role="tab"]',
    '[role="menuitem"]',
    '[role="checkbox"]',
    '[role="radio"]',
    '[role="switch"]',
    '[role="option"]',
    '[role="textbox"]',
    '[role="searchbox"]',
    '[role="combobox"]',
    '[tabindex="0"]',
    '[contenteditable="true"]',
    '[contenteditable=""]',
    'label[for]'
  ].join(', ');

  const matched = Array.from(document.querySelectorAll(selector));

  // Also include custom clickable cards / items styled with cursor:pointer that have direct text
  const pointerElements = Array.from(document.querySelectorAll('div, span, li, tr')).filter(el => {
    if (matched.includes(el)) return false;
    const style = window.getComputedStyle(el);
    if (style.cursor === 'pointer' && el.childElementCount <= 2) {
      const text = (el.innerText || '').trim();
      return text.length > 0 && text.length < 80;
    }
    return false;
  });

  const allCandidates = [...matched, ...pointerElements];

  // Filter out internal agent UI and non-visible elements
  const visibleElements = allCandidates.filter(el => {
    if (el.closest('#hermes-virtual-cursor') || el.closest('#agent-action-hud') || el.closest('.hermes-target-highlight')) {
      return false;
    }
    return isStrictlyVisible(el);
  });

  // Deduplicate nested elements where parent is already interactive
  const uniqueElements = [];
  for (const el of visibleElements) {
    const parentInteractive = uniqueElements.find(parent => parent.contains(el));
    if (!parentInteractive) {
      uniqueElements.push(el);
    }
  }

  // Prioritize elements inside the current viewport and interactive form controls
  const vh = window.innerHeight;
  const vw = window.innerWidth;
  uniqueElements.sort((a, b) => {
    const rA = a.getBoundingClientRect();
    const rB = b.getBoundingClientRect();
    const inViewA = rA.top >= -30 && rA.top <= vh && rA.left >= 0 && rA.left <= vw;
    const inViewB = rB.top >= -30 && rB.top <= vh && rB.left >= 0 && rB.left <= vw;
    if (inViewA && !inViewB) return -1;
    if (!inViewA && inViewB) return 1;

    // Inputs, textareas, and buttons get precedence
    const isFormA = ['input', 'button', 'textarea', 'select'].includes(a.tagName.toLowerCase());
    const isFormB = ['input', 'button', 'textarea', 'select'].includes(b.tagName.toLowerCase());
    if (isFormA && !isFormB) return -1;
    if (!isFormA && isFormB) return 1;

    return rA.top - rB.top;
  });

  // Deduplicate elements with identical tag and text (e.g. repetitive video card links)
  const seenSignatures = new Set();
  const prioritized = [];
  for (const el of uniqueElements) {
    const tag = el.tagName.toLowerCase();
    const text = (el.innerText || el.textContent || el.getAttribute('aria-label') || '').trim().toLowerCase();
    const sig = `${tag}:${text}`;
    if (text.length > 0 && seenSignatures.has(sig) && tag !== 'input' && tag !== 'textarea') {
      continue;
    }
    seenSignatures.add(sig);
    prioritized.push(el);
    if (prioritized.length >= 45) break;
  }

  const elements = prioritized.map((el, index) => {
    el.setAttribute('data-agent-id', String(index));

    const tag = el.tagName.toLowerCase();
    const type = el.getAttribute('type') || (tag === 'input' ? 'text' : null);

    let value = null;
    let text = '';

    const isEditable = el.isContentEditable || el.getAttribute('contenteditable') === 'true' || el.getAttribute('role') === 'textbox';

    if (tag === 'input' || tag === 'textarea') {
      value = el.value !== undefined && el.value !== '' ? String(el.value).trim() : null;
      text = el.placeholder ? el.placeholder.trim() : '';
    } else if (isEditable) {
      value = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim() || null;
      text = el.getAttribute('placeholder') || el.getAttribute('data-placeholder') || el.getAttribute('aria-placeholder') || value || '';
    } else {
      text = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
    }

    const ariaLabel = el.getAttribute('aria-label') || el.getAttribute('title') || null;
    if (!text && ariaLabel) {
      text = ariaLabel.trim();
    }

    const name = el.getAttribute('name') || el.getAttribute('id') || null;
    let href = el.getAttribute('href') || (tag === 'a' ? el.href : null);
    const isDisabled = el.disabled === true ||
      el.getAttribute('aria-disabled') === 'true' ||
      el.classList.contains('disabled');
    const isInteracted = el.hasAttribute('data-agent-interacted');

    return {
      id: index,
      tag,
      type,
      text: text || null,
      name,
      value,
      href,
      aria_label: ariaLabel,
      disabled: isDisabled ? true : null,
      interacted: isInteracted ? true : null
    };
  });

  // Extract visible page status or notification alerts
  let pageStatus = null;
  const statusSelectors = [
    '.status-card.visible',
    '[role="alert"]',
    '.alert-success',
    '.alert-info',
    '.toast.visible',
    '.notification.visible',
    '#status-message'
  ];
  for (const sel of statusSelectors) {
    const statusEl = document.querySelector(sel);
    if (statusEl && isStrictlyVisible(statusEl)) {
      const statusText = (statusEl.innerText || '').trim();
      if (statusText) {
        pageStatus = statusText;
        break;
      }
    }
  }

  return { elements, pageStatus };
}

// ──────────────────────────────────────────────────
// HUD BANNER
// ──────────────────────────────────────────────────

function showAgentHUD(thought, action, step) {
  let hud = document.getElementById('agent-action-hud');
  if (!hud) {
    hud = document.createElement('div');
    hud.id = 'agent-action-hud';
    Object.assign(hud.style, {
      position: 'fixed',
      top: '14px',
      left: '50%',
      transform: 'translateX(-50%)',
      backgroundColor: 'rgba(10, 15, 29, 0.96)',
      color: '#f8fafc',
      padding: '8px 20px',
      borderRadius: '24px',
      border: '1px solid #10b981',
      boxShadow: '0 8px 30px rgba(0,0,0,0.6), 0 0 16px rgba(16, 185, 129, 0.4)',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      fontSize: '13px',
      fontWeight: '500',
      zIndex: '2147483646',
      display: 'flex',
      alignItems: 'center',
      gap: '10px',
      maxWidth: '85vw',
      pointerEvents: 'none',
      transition: 'opacity 0.3s ease, transform 0.3s ease'
    });
    document.body.appendChild(hud);
  }

  let icon = '🤖';
  if (action === 'click') icon = '🎯';
  else if (action === 'type') icon = '⌨️';
  else if (action === 'hover') icon = '👁️';
  else if (action === 'navigate') icon = '🚀';
  else if (action === 'scroll') icon = '📜';
  else if (action === 'done') icon = '🎉';

  const stepTag = step ? `<span style="color:#34d399;font-weight:700;">Step ${step}</span> · ` : '';
  const cleanThought = (thought || action || 'Processing').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  hud.innerHTML = `<span>${icon}</span><span>${stepTag}<strong>Agent:</strong> ${cleanThought}</span>`;
  hud.style.opacity = '1';

  if (action === 'done') {
    setTimeout(() => {
      hud.style.opacity = '0';
      setTimeout(() => hud.remove(), 400);
    }, 4000);
  }
}

// ──────────────────────────────────────────────────
// ROBUST W3C CLICK EXECUTION
// ──────────────────────────────────────────────────

async function performRobustClick(targetElement, clickX, clickY) {
  // 1. Scroll into view instantly so layout coordinates are exact
  targetElement.scrollIntoView({ behavior: 'auto', block: 'center', inline: 'center' });
  await new Promise(r => requestAnimationFrame(r));

  // Re-calculate after scroll
  const rect = targetElement.getBoundingClientRect();
  const finalX = Math.round(rect.left + rect.width / 2);
  const finalY = Math.round(rect.top + rect.height / 2);

  // 2. Identify the topmost element at that point (e.g. inner span, svg, or target)
  const elementAtPoint = document.elementFromPoint(finalX, finalY);
  const dispatchTarget = (elementAtPoint && targetElement.contains(elementAtPoint))
    ? elementAtPoint
    : targetElement;

  // 3. Build comprehensive Mouse & Pointer Event descriptors
  const commonInit = {
    bubbles: true,
    cancelable: true,
    composed: true,
    view: window,
    detail: 1,
    clientX: finalX,
    clientY: finalY,
    screenX: (window.screenX || 0) + finalX,
    screenY: (window.screenY || 0) + finalY,
    pageX: window.scrollX + finalX,
    pageY: window.scrollY + finalY
  };

  const pointerDownInit = {
    ...commonInit,
    button: 0,
    buttons: 1,
    pointerId: 1,
    pointerType: 'mouse',
    isPrimary: true,
    pressure: 0.5
  };

  const pointerUpInit = {
    ...commonInit,
    button: 0,
    buttons: 0,
    pointerId: 1,
    pointerType: 'mouse',
    isPrimary: true,
    pressure: 0
  };

  const mouseDownInit = { ...commonInit, button: 0, buttons: 1, which: 1 };
  const mouseUpInit = { ...commonInit, button: 0, buttons: 0, which: 1 };
  const clickInit = { ...commonInit, button: 0, buttons: 0, which: 1 };

  // 4. Dispatch the exact W3C user interaction sequence
  dispatchTarget.dispatchEvent(new PointerEvent('pointermove', pointerDownInit));
  dispatchTarget.dispatchEvent(new MouseEvent('mousemove', mouseDownInit));

  dispatchTarget.dispatchEvent(new PointerEvent('pointerdown', pointerDownInit));
  dispatchTarget.dispatchEvent(new MouseEvent('mousedown', mouseDownInit));

  if (typeof targetElement.focus === 'function') {
    targetElement.focus({ preventScroll: true });
  }

  // Realistic micro-delay between down and up
  await new Promise(r => setTimeout(r, 40));

  dispatchTarget.dispatchEvent(new PointerEvent('pointerup', pointerUpInit));
  dispatchTarget.dispatchEvent(new MouseEvent('mouseup', mouseUpInit));
  dispatchTarget.dispatchEvent(new MouseEvent('click', clickInit));

  // 5. Handle native click triggers (Links, buttons, checkboxes)
  const anchor = targetElement.closest('a');
  if (anchor && anchor.href) {
    console.log(`[son-ion] Triggering native navigation on link: ${anchor.href}`);
    anchor.click();
  } else if (typeof targetElement.click === 'function') {
    targetElement.click();
  } else if (dispatchTarget !== targetElement && typeof dispatchTarget.click === 'function') {
    dispatchTarget.click();
  }

  // 6. Handle Checkbox and Radio buttons
  if (targetElement.tagName === 'INPUT' && (targetElement.type === 'checkbox' || targetElement.type === 'radio')) {
    targetElement.dispatchEvent(new Event('input', { bubbles: true }));
    targetElement.dispatchEvent(new Event('change', { bubbles: true }));
  }

  // 7. Form submission fallback
  if (targetElement.type === 'submit' && targetElement.form) {
    if (typeof targetElement.form.requestSubmit === 'function') {
      targetElement.form.requestSubmit(targetElement);
    } else {
      targetElement.form.submit();
    }
  }

  // Mark element as interacted in this session
  targetElement.setAttribute('data-agent-interacted', 'true');
}

// ──────────────────────────────────────────────────
// ROBUST REACT / VUE / ANGULAR TYPING
// ──────────────────────────────────────────────────

async function performRobustType(element, text) {
  element.focus({ preventScroll: true });

  const isEditable = element.isContentEditable || element.getAttribute('contenteditable') === 'true' || element.getAttribute('role') === 'textbox';

  // 1. Handle rich contenteditable editors (Claude, Gemini, Monday.com, Notion)
  if (isEditable) {
    try {
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(element);
      selection.removeAllRanges();
      selection.addRange(range);
      document.execCommand('delete', false, null);
      document.execCommand('insertText', false, text);
    } catch (e) {
      element.innerText = text;
    }
    element.dispatchEvent(new InputEvent('input', {
      bubbles: true,
      composed: true,
      data: text,
      inputType: 'insertText'
    }));
    element.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
    element.setAttribute('data-agent-interacted', 'true');
    return;
  }

  // 2. Standard HTMLInputElement / HTMLTextAreaElement (React / Vue prototype setter)
  const tag = element.tagName.toLowerCase();
  const proto = tag === 'textarea' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
  const protoSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;

  function setVal(val) {
    if (protoSetter) {
      protoSetter.call(element, val);
    } else {
      element.value = val;
    }
  }

  // Clear existing content
  setVal('');
  element.dispatchEvent(new Event('input', { bubbles: true, composed: true }));

  let currentVal = '';
  for (const char of text) {
    currentVal += char;
    setVal(currentVal);

    const keyOpts = {
      key: char,
      code: `Key${char.toUpperCase()}`,
      bubbles: true,
      cancelable: true,
      composed: true
    };

    element.dispatchEvent(new KeyboardEvent('keydown', keyOpts));
    element.dispatchEvent(new KeyboardEvent('keypress', keyOpts));
    element.dispatchEvent(new InputEvent('input', {
      bubbles: true,
      composed: true,
      data: char,
      inputType: 'insertText'
    }));
    element.dispatchEvent(new KeyboardEvent('keyup', keyOpts));

    await new Promise(r => setTimeout(r, 12)); // Snappy 12ms typing speed
  }

  element.dispatchEvent(new Event('change', { bubbles: true, composed: true }));

  // For search inputs (Google Maps, YouTube, Google), trigger Enter key
  const isSearchInput = (element.getAttribute('type') === 'search') ||
    (element.getAttribute('name') === 'q') ||
    (element.getAttribute('id') || '').toLowerCase().includes('search') ||
    (element.getAttribute('placeholder') || '').toLowerCase().includes('search');

  if (isSearchInput) {
    const enterOpts = {
      key: 'Enter',
      code: 'Enter',
      keyCode: 13,
      which: 13,
      bubbles: true,
      cancelable: true,
      composed: true
    };
    element.dispatchEvent(new KeyboardEvent('keydown', enterOpts));
    element.dispatchEvent(new KeyboardEvent('keypress', enterOpts));
    element.dispatchEvent(new KeyboardEvent('keyup', enterOpts));
  }

  element.setAttribute('data-agent-interacted', 'true');
}

// ──────────────────────────────────────────────────
// ROBUST HOVER
// ──────────────────────────────────────────────────

function performRobustHover(targetElement, cx, cy) {
  const commonInit = {
    bubbles: true,
    cancelable: true,
    composed: true,
    view: window,
    clientX: cx,
    clientY: cy,
    screenX: (window.screenX || 0) + cx,
    screenY: (window.screenY || 0) + cy
  };

  targetElement.dispatchEvent(new PointerEvent('pointerover', { ...commonInit, pointerType: 'mouse' }));
  targetElement.dispatchEvent(new MouseEvent('mouseover', commonInit));
  targetElement.dispatchEvent(new PointerEvent('pointerenter', { ...commonInit, bubbles: false, pointerType: 'mouse' }));
  targetElement.dispatchEvent(new MouseEvent('mouseenter', { ...commonInit, bubbles: false }));
  targetElement.dispatchEvent(new PointerEvent('pointermove', { ...commonInit, pointerType: 'mouse' }));
  targetElement.dispatchEvent(new MouseEvent('mousemove', commonInit));
}

// ──────────────────────────────────────────────────
// ACTION DISPATCHER
// ──────────────────────────────────────────────────

async function executeAction(payload) {
  const { action, target_id, value, thought, step } = payload;
  console.log(`[son-ion] Executing step ${step || '?'}: "${action}" on ID #${target_id}`, payload);

  showAgentHUD(thought, action, step);
  ensureVirtualCursor();

  let targetElement = null;
  if (target_id !== null && target_id !== undefined) {
    targetElement = document.querySelector(`[data-agent-id="${target_id}"]`);
  }

  let cx = cursorX;
  let cy = cursorY;

  if (targetElement) {
    // Scroll element into view first
    targetElement.scrollIntoView({ behavior: 'auto', block: 'center', inline: 'center' });
    await new Promise(r => requestAnimationFrame(r));

    const rect = targetElement.getBoundingClientRect();
    cx = Math.round(rect.left + rect.width / 2);
    cy = Math.round(rect.top + rect.height / 2);

    // Keep within visible viewport
    cx = Math.max(10, Math.min(cx, window.innerWidth - 10));
    cy = Math.max(10, Math.min(cy, window.innerHeight - 10));

    // Smoothly glide virtual cursor to element
    await glideCursorTo(cx, cy, 220);
    showHighlightTarget(targetElement);
  }

  switch (action) {
    case 'click':
      if (targetElement) {
        showCursorLabel('🎯 Clicking...', 1200);
        fireCursorRipple();
        await performRobustClick(targetElement, cx, cy);
        return { success: true, message: `Clicked element #${target_id}` };
      }
      return { success: false, error: `Element #${target_id} not found.` };

    case 'hover':
      if (targetElement) {
        showCursorLabel('👁️ Hovering', 1500);
        performRobustHover(targetElement, cx, cy);
        return { success: true, message: `Hovered over element #${target_id}` };
      }
      return { success: false, error: `Element #${target_id} not found.` };

    case 'type':
      if (targetElement) {
        const textToType = value !== null && value !== undefined ? String(value) : '';
        showCursorLabel(`⌨️ Typing: "${textToType.slice(0, 15)}"`, 1500);
        fireCursorRipple();
        await performRobustType(targetElement, textToType);
        return { success: true, message: `Typed "${textToType}" into element #${target_id}` };
      }
      return { success: false, error: `Element #${target_id} not found.` };

    case 'scroll':
      const direction = String(value).toLowerCase().includes('up') ? 'up' : 'down';
      showCursorLabel(direction === 'up' ? '📜 Scrolling Up' : '📜 Scrolling Down', 1200);
      const scrollY = direction === 'up' ? -window.innerHeight * 0.6 : window.innerHeight * 0.6;
      window.scrollBy({ top: scrollY, behavior: 'smooth' });
      return { success: true, message: `Scrolled page ${direction}` };

    case 'navigate':
      if (value) {
        let url = String(value).trim();
        if (!url.startsWith('http://') && !url.startsWith('https://')) {
          url = 'https://' + url;
        }
        showCursorLabel(`🚀 Navigating to ${url.slice(0, 25)}...`, 2000);
        window.location.href = url;
        return { success: true, message: `Navigating to ${url}` };
      }
      return { success: false, error: 'No URL provided for navigate action.' };

    case 'done':
      showCursorLabel('✓ Done', 2500);
      return { success: true, message: 'Task marked as complete' };

    default:
      return { success: false, error: `Unknown action: ${action}` };
  }
}

// ──────────────────────────────────────────────────
// MESSAGE LISTENER
// ──────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'EXTRACT_DOM') {
    cleanupAnyDOMRedaction();
    const { elements, pageStatus } = extractAndTagInteractiveElements();
    const sensitive = detectSensitiveElements(extractDOM());

    // Extract bounding boxes for AI screenshot black-box masking (user's browser is NEVER blurred)
    const sensitiveBoxes = sensitive.map(item => {
      const rect = item.element ? item.element.getBoundingClientRect() : (item.position || { x: 0, y: 0, width: 0, height: 0 });
      return {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        reasons: item.reasons || ["sensitive"]
      };
    }).filter(b => b.width > 0 && b.height > 0);

    // Sanitize DOM element text/value sent to AI model only
    for (const el of elements) {
      if (el.type === 'password') {
        el.text = '[REDACTED PASSWORD]';
        el.value = '[REDACTED PASSWORD]';
      }
    }

    console.log(`[son-ion] Extracted ${elements.length} elements. ${sensitiveBoxes.length} sensitive zones marked for AI black-box masking.`);
    sendResponse({
      elements,
      pageStatus,
      sensitiveBoxes,
      redactedCount: sensitiveBoxes.length,
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight,
        devicePixelRatio: window.devicePixelRatio || 1
      }
    });
    return false;
  } else if (request.type === 'EXECUTE_ACTION') {
    executeAction(request.payload || {}).then(result => {
      sendResponse(result);
    });
    return true; // Keep channel open for async response
  } else if (request.type === 'CLEAR_AGENT_STATE') {
    document.querySelectorAll('[data-agent-interacted]').forEach(el => {
      el.removeAttribute('data-agent-interacted');
    });
    const cursor = document.getElementById('hermes-virtual-cursor');
    if (cursor) cursor.remove();
    cursorEl = null;
    const hud = document.getElementById('agent-action-hud');
    if (hud) hud.remove();
    sendResponse({ cleared: true });
    return false;
  }
  return false;
});

// ──────────────────────────────────────────────────
// PII REDACTION
// ──────────────────────────────────────────────────

const SENSITIVE_PATTERNS = {
  email: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
  phone: /(?<!\d)(?:\+91[\s-]?)?[6-9]\d{9}(?!\d)/g,
  aadhaar: /(?<!\d)\d{4}[\s-]?\d{4}[\s-]?\d{4}(?!\d)/g,
  pan: /\b[A-Z]{5}\d{4}[A-Z]\b/gi,
  creditCard: /(?<!\d)(?:\d[ -]?){13,19}(?!\d)/g,
  ifsc: /\b[A-Z]{4}0[A-Z0-9]{6}\b/gi,
  passport: /\b[A-Z][0-9]{7}\b/gi
};

function detectPII(text) {
  const detections = [];
  for (const [type, regex] of Object.entries(SENSITIVE_PATTERNS)) {
    regex.lastIndex = 0;
    let match;
    while ((match = regex.exec(text)) !== null) {
      detections.push({ type: type });
    }
  }
  return detections;
}

function detectSensitiveElements(domElements) {
  const sensitiveElements = [];
  for (const item of domElements) {
    if (item.tag === "input" && item.type === "password") {
      sensitiveElements.push({ ...item, reasons: ["password"] });
      continue;
    }
    if (item.tag === "input" && item.type === "text" && (item.name === "login" || item.name === "login_field" || item.name === "email")) {
      sensitiveElements.push({ ...item, reasons: ["email"] });
      continue;
    }
    const text = [item.text, item.value, item.name, item.id].filter(Boolean).join(" ");
    const detections = detectPII(text);
    if (detections.length > 0) {
      sensitiveElements.push({
        ...item,
        reasons: [...new Set(detections.map(detection => detection.type))]
      });
    }
  }
  return sensitiveElements;
}

function isVisible(element) {
  const rect = element.getBoundingClientRect();
  const style = window.getComputedStyle(element);
  return (
    rect.width > 0 &&
    rect.height > 0 &&
    style.display !== "none" &&
    style.visibility !== "hidden" &&
    style.opacity !== "0"
  );
}

function extractElement(element) {
  const rect = element.getBoundingClientRect();
  return {
    element: element,
    tag: element.tagName.toLowerCase(),
    type: element.type || null,
    text: element.innerText || "",
    value: element.value || "",
    name: element.name || "",
    id: element.id || "",
    position: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
  };
}

function extractDOM() {
  const elements = Array.from(
    document.querySelectorAll(
      "button, input, textarea, select, a, label, " +
      "h1, h2, h3, h4, h5, h6, p, span, li"
    )
  ).filter(isVisible);
  return elements.map(extractElement);
}

function getChangedElements(mutations) {
  const elements = new Set();
  for (const mutation of mutations) {
    if (mutation.type === "characterData") {
      if (mutation.target.parentElement) {
        elements.add(mutation.target.parentElement);
      }
    }
    if (mutation.type === "attributes") {
      elements.add(mutation.target);
    }
    if (mutation.type === "childList") {
      mutation.addedNodes.forEach(node => {
        if (node.nodeType === Node.ELEMENT_NODE) {
          elements.add(node);
        }
      });
    }
  }
  return [...elements];
}

function cleanupAnyDOMRedaction() {
  try {
    document.querySelectorAll('[data-redacted]').forEach(el => {
      el.style.filter = '';
      el.style.color = '';
      el.style.textShadow = '';
      el.removeAttribute('data-redacted');
      if (el.getAttribute('data-original-type')) {
        el.type = el.getAttribute('data-original-type');
        el.removeAttribute('data-original-type');
      }
    });
  } catch (e) { }
}

// Clean up any previously applied blur immediately so user's browser is completely crisp and unaltered
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", cleanupAnyDOMRedaction);
} else {
  cleanupAnyDOMRedaction();
}
