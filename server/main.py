import asyncio
import json
import logging
import re
from pathlib import Path
from typing import Any, List, Optional
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
import contextlib
import httpx
from openai import AsyncOpenAI
from pydantic import BaseModel, Field

# Setup logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("browser-agent-server")

OLLAMA_MODEL = "hermes-fast"
OLLAMA_VISION_MODEL = "moondream"
OLLAMA_BASE_URL = "http://localhost:11434"

# Master System Instructions loaded once and preserved across iterations in Ollama KV-cache
MASTER_SYSTEM_PROMPT = """You are an advanced, laser-focused browser automation agent equipped with visual perception and physical cursor/keyboard control.
Your purpose is to execute ONLY the specific task prompted by the user with surgical precision and ZERO deviation from the prescribed path.

================================================================================
CARDINAL RULES OF GOAL ADHERENCE & PATH INTEGRITY (DO NOT DEVIATE)
================================================================================
1. STRICT GOAL LOCK:
   - You are strictly bound to the USER GOAL.
   - Execute ONLY actions that directly and measurably advance the stated prompt.
   - NEVER execute tangential, exploratory, curious, or unprompted actions.

2. ZERO DEVIATION & NO WANDERING:
   - DO NOT click random navigation links, sidebars, headers, footers, promo banners, social icons, or explore feeds.
   - If an element does not directly contribute to fulfilling the exact USER GOAL, interacting with it is STRICTLY PROHIBITED.
   - Never deviate to "see what happens" or "explore the website".

3. SINGLE-ACTION TASK COMPLETION:
   - If the USER GOAL is a single action (such as "click Submit", "toggle dark mode", "enter name into input field"), once that single action has been performed, your task is FINISHED.
   - You MUST return action "done" immediately on the subsequent step. Do not linger, re-click, or click anything else.

4. IMMEDIATE TERMINATION ("done"):
   - As soon as the user's objective has been satisfied, return action "done" with target_id: null, value: null.
   - Never perform extra unrequested actions after the goal is reached.

5. RELEVANCE FILTER & NO-ACTION RECOVERY:
   - Before interacting with any element, verify: "Does this element directly fulfill the USER GOAL?" If not, DO NOT TOUCH IT.
   - If the required target is not currently visible on screen, use action "scroll" (value "down" or "up") to locate it.
   - If the requested task is already complete or impossible on this page, return action "done". Never click random buttons out of hesitation.

6. ANTI-LOOPING SAFEGUARD:
   - Inspect RECENT ACTIONS ALREADY TAKEN.
   - NEVER click the same element repeatedly or re-type identical text into an already filled field unless explicitly asked.
   - Respect elements marked 'disabled' or 'already_clicked=true'.

================================================================================
UNIVERSAL WORKFLOW PLAYBOOKS (TASK-FOCUSED)
================================================================================
1. SEARCH & INPUT TASKS:
   - Target the relevant input or textarea, type the exact requested query, and submit (press Enter or click search button). Stop when results load.

2. BUTTON & CONTROL TASKS:
   - Locate the target button matching the user's prompt (e.g., "Submit", "Approve", "Save", "Add to Cart"), click it, and evaluate if the task is complete.

3. WORKSPACE & QUEUE MONITORING:
   - In 24/7 continuous watch mode, only interact with pending items that match the user's prompt. When no items are pending, return "done" to idle cleanly.

================================================================================
ALLOWED ACTIONS & STRICT OUTPUT SCHEMA
================================================================================
- "click": Click an interactive element. target_id: <int>, value: null
- "hover": Hover over an element. target_id: <int>, value: null
- "type": Enter text into an input or textarea. target_id: <int>, value: <string>
- "scroll": Scroll the page viewport. target_id: null, value: "down" or "up"
- "navigate": Navigate directly to a target URL. target_id: null, value: <url string>
- "done": Goal complete or idle waiting for new items. target_id: null, value: null

Output MUST be strictly valid JSON matching this schema with no additional commentary:
{
  "thought": "1 sentence explaining how this action strictly advances the user goal without deviation",
  "action": "click" | "hover" | "type" | "scroll" | "navigate" | "done",
  "target_id": <int or null>,
  "value": <string or null>
}"""

async def get_ollama_gpu_status() -> dict:
    """Queries Ollama /api/ps to verify models loaded on GPU."""
    try:
        async with httpx.AsyncClient(timeout=2.0) as http_client:
            resp = await http_client.get(f"{OLLAMA_BASE_URL}/api/ps")
            if resp.status_code == 200:
                data = resp.json()
                models_info = []
                total_vram = 0
                for m in data.get("models", []):
                    size = m.get("size", 1)
                    vram = m.get("size_vram", 0)
                    pct = int((vram / size) * 100) if size else 0
                    total_vram += vram
                    models_info.append({
                        "name": m.get("name"),
                        "gpu_percent": pct,
                        "vram_mb": round(vram / (1024 * 1024), 1)
                    })
                return {
                    "loaded": len(models_info) > 0,
                    "models": models_info,
                    "is_gpu": any(m["gpu_percent"] > 50 for m in models_info),
                    "total_vram_mb": round(total_vram / (1024 * 1024), 1)
                }
    except Exception as e:
        logger.debug(f"Error querying Ollama GPU status: {e}")
    return {"loaded": False, "models": [], "is_gpu": False, "total_vram_mb": 0}

async def warm_gpu_model():
    """Warms the model(s) and pre-caches the MASTER_SYSTEM_PROMPT into GPU VRAM (keep_alive: -1)."""
    # 1. Warm text agent with Master System Prompt to pre-populate KV cache in VRAM
    try:
        async with httpx.AsyncClient(timeout=15.0) as http_client:
            resp = await http_client.post(
                f"{OLLAMA_BASE_URL}/api/chat",
                json={
                    "model": OLLAMA_MODEL,
                    "messages": [
                        {"role": "system", "content": MASTER_SYSTEM_PROMPT},
                        {"role": "user", "content": "Ready."}
                    ],
                    "keep_alive": -1,
                    "stream": False,
                    "options": {"num_predict": 1}
                }
            )
            if resp.status_code == 200:
                logger.info(f"Ollama model '{OLLAMA_MODEL}' + Master System Prompt successfully cached in GPU VRAM (keep_alive: -1).")
    except Exception as e:
        logger.warning(f"Could not pre-warm model '{OLLAMA_MODEL}' with master prompt: {e}")

    # 2. Warm vision model
    try:
        async with httpx.AsyncClient(timeout=10.0) as http_client:
            resp = await http_client.post(
                f"{OLLAMA_BASE_URL}/api/generate",
                json={"model": OLLAMA_VISION_MODEL, "keep_alive": -1}
            )
            if resp.status_code == 200:
                logger.info(f"Ollama vision model '{OLLAMA_VISION_MODEL}' successfully locked in GPU VRAM (keep_alive: -1).")
    except Exception as e:
        logger.warning(f"Could not pre-warm model '{OLLAMA_VISION_MODEL}' on Ollama: {e}")

@contextlib.asynccontextmanager
async def lifespan(app: FastAPI):
    # On startup: lock model into GPU VRAM
    await warm_gpu_model()
    yield

app = FastAPI(
    title="Vision Agent DOM Processing Server",
    description="Backend service hosting Llama 3.1 via Ollama for browser automation",
    version="1.0.0",
    lifespan=lifespan
)

# Enable CORS for browser extension requests
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Connect to Ollama local OpenAI-compatible endpoint
client = AsyncOpenAI(
    base_url=f"{OLLAMA_BASE_URL}/v1",
    api_key="ollama"  # Required by OpenAI SDK, not authenticated by Ollama
)


class DOMElement(BaseModel):
    id: int = Field(..., description="Unique sequential identifier assigned to DOM node")
    tag: str = Field(..., description="HTML tag name")
    type: Optional[str] = Field(None, description="Input type if applicable")
    text: Optional[str] = Field(None, description="Inner text or placeholder")
    name: Optional[str] = Field(None, description="Name or ID attribute of the element")
    value: Optional[str] = Field(None, description="Current value of input or textarea")
    href: Optional[str] = Field(None, description="URL for links and anchors")
    aria_label: Optional[str] = Field(None, description="Accessible aria-label")
    disabled: Optional[bool] = Field(None, description="Whether element is disabled")
    interacted: Optional[bool] = Field(None, description="Whether element was already clicked or typed in")


class ActionRecord(BaseModel):
    step: int = Field(..., description="Step number")
    action: str = Field(..., description="Action performed")
    target_id: Optional[int] = Field(None, description="Target element ID")
    target_text: Optional[str] = Field(None, description="Text of targeted element")
    value: Optional[str] = Field(None, description="Value passed if any")
    thought: Optional[str] = Field(None, description="Previous reasoning")


class ProcessDOMRequest(BaseModel):
    screenshot: Optional[str] = Field(None, description="Base64 encoded JPEG screenshot of the current page")
    elements: List[DOMElement] = Field(..., description="List of visible interactive DOM elements")
    user_goal: str = Field(..., description="The objective for the agent on this page")
    page_status: Optional[str] = Field(None, description="Any visible status text on the page")
    previous_actions: Optional[List[ActionRecord]] = Field(default=None, description="Recent actions already taken in this session")


class ActionResponse(BaseModel):
    thought: str = Field(..., description="Reasoning behind selecting the action")
    action: str = Field(..., description="'click' | 'hover' | 'type' | 'scroll' | 'navigate' | 'done'")
    target_id: Optional[int] = Field(None, description="DOM element agent ID to target")
    value: Optional[str] = Field(None, description="Text value for 'type', URL for 'navigate', 'down'/'up' for 'scroll'")


def clean_json_string(raw_text: str) -> str:
    """Strips markdown code blocks, backticks, and extraneous text to extract clean JSON."""
    text = raw_text.strip()
    
    # Remove markdown code fence if present
    match = re.search(r"```(?:json)?\s*([\s\S]*?)\s*```", text, re.IGNORECASE)
    if match:
        text = match.group(1).strip()
    else:
        # If no markdown block, locate the first '{' and last '}'
        start = text.find("{")
        end = text.rfind("}")
        if start != -1 and end != -1 and end > start:
            text = text[start : end + 1]
            
    return text


def extract_or_repair_action(raw_text: str, fallback_thought: str = "Progressing page state") -> ActionResponse:
    """Robustly extracts or repairs an ActionResponse from LLM output, preventing 502 errors."""
    cleaned = clean_json_string(raw_text)

    # 1. Try standard JSON parsing
    for candidate in [cleaned, cleaned + "}", cleaned + '"}', cleaned + '"}]}', cleaned + '"]}']:
        try:
            data = json.loads(candidate)
            if isinstance(data, dict):
                # Standard ActionResponse schema
                if "action" in data:
                    action_str = str(data.get("action", "done")).strip().lower()
                    target_id = data.get("target_id")
                    if target_id is not None:
                        try:
                            target_id = int(target_id)
                        except (ValueError, TypeError):
                            target_id = None
                    return ActionResponse(
                        thought=str(data.get("thought", fallback_thought)),
                        action=action_str,
                        target_id=target_id,
                        value=data.get("value")
                    )
                # If model returned {"items": [...]}, pick first element
                if "items" in data and isinstance(data["items"], list) and len(data["items"]) > 0:
                    first = data["items"][0]
                    target_id = first.get("id") if first.get("id") is not None else first.get("target_id")
                    try:
                        target_id = int(target_id) if target_id is not None else None
                    except (ValueError, TypeError):
                        target_id = None
                    return ActionResponse(
                        thought=f"Interacting with element #{target_id} from page items",
                        action="click" if target_id is not None else "scroll",
                        target_id=target_id,
                        value=None if target_id is not None else "down"
                    )
        except Exception:
            continue

    # 2. Regex fallback extraction
    action_match = re.search(r'"action"\s*:\s*"([a-zA-Z_]+)"', raw_text, re.IGNORECASE)
    target_match = re.search(r'"target_id"\s*:\s*(\d+)', raw_text, re.IGNORECASE)
    thought_match = re.search(r'"thought"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"', raw_text)
    value_match = re.search(r'"value"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"', raw_text)

    if action_match:
        action_val = action_match.group(1).lower()
        target_val = int(target_match.group(1)) if target_match else None
        thought_val = thought_match.group(1) if thought_match else fallback_thought
        value_val = value_match.group(1) if value_match else None
        return ActionResponse(
            thought=thought_val,
            action=action_val,
            target_id=target_val,
            value=value_val
        )

    # 3. Check for any ID mention in raw text
    id_match = re.search(r'"id"\s*:\s*(\d+)', raw_text)
    if id_match:
        target_id = int(id_match.group(1))
        return ActionResponse(
            thought=f"Interacting with element #{target_id} identified on page",
            action="click",
            target_id=target_id,
            value=None
        )

    # 4. Safe recovery fallback: scroll down to progress page instead of crashing
    logger.warning(f"Could not parse action from raw model text: {raw_text[:120]}. Emitting scroll progression.")
    return ActionResponse(
        thought="Scanning page and scrolling down to view additional content",
        action="scroll",
        target_id=None,
        value="down"
    )


def format_dom_for_prompt(elements: List[DOMElement], user_goal: str = "", max_elements: int = 50) -> str:
    """Creates a compact, goal-aligned prioritized representation of DOM elements for the LLM."""
    # Extract meaningful keywords from user goal for relevance matching
    goal_words = set(re.findall(r"\b[a-zA-Z0-9_-]{3,}\b", user_goal.lower())) if user_goal else set()
    stop_words = {"the", "and", "for", "with", "this", "that", "from", "page", "button", "click", "user", "goal", "please"}
    keywords = goal_words - stop_words

    def score_element(el: DOMElement) -> tuple:
        haystack = " ".join(filter(None, [el.text, el.name, el.aria_label, el.value, el.type])).lower()
        matches = sum(1 for kw in keywords if kw in haystack) if keywords else 0
        match_tier = 0 if matches > 0 else 1

        if el.tag in ["input", "textarea", "select"]:
            type_tier = 0
        elif el.tag == "button" or (el.type and el.type in ["button", "submit"]):
            type_tier = 1
        elif el.aria_label or el.text:
            type_tier = 2
        else:
            type_tier = 3

        return (match_tier, -matches, type_tier)

    prioritized = sorted(elements, key=score_element)
    lines = []
    for el in prioritized[:max_elements]:
        attrs = []
        if el.type:
            attrs.append(f"type=\"{el.type}\"")
        if el.name:
            attrs.append(f"name=\"{el.name}\"")
        if el.value:
            attrs.append(f"value=\"{el.value}\"")
        if el.disabled:
            attrs.append("disabled")
        if el.interacted:
            attrs.append("already_clicked=true")
        if el.href:
            cleaned_href = el.href if len(el.href) <= 40 else el.href[:37] + "..."
            attrs.append(f"href=\"{cleaned_href}\"")
        if el.aria_label:
            attrs.append(f"aria=\"{el.aria_label}\"")
        if el.text:
            cleaned_text = el.text.replace("\n", " ").strip()
            if len(cleaned_text) > 50:
                cleaned_text = cleaned_text[:47] + "..."
            attrs.append(f"text=\"{cleaned_text}\"")
            
        attr_str = " " + " ".join(attrs) if attrs else ""
        lines.append(f"- ID {el.id}: <{el.tag}{attr_str}>")
    return "\n".join(lines)


TEST_PAGE_PATH = Path(__file__).resolve().parent.parent / "test_page.html"


@app.get("/")
@app.get("/test")
async def get_test_page():
    if TEST_PAGE_PATH.exists():
        return FileResponse(TEST_PAGE_PATH, media_type="text/html")
    raise HTTPException(status_code=404, detail="test_page.html not found")


@app.get("/health")
async def health_check():
    gpu_info = await get_ollama_gpu_status()
    loaded_names = [m["name"] for m in gpu_info.get("models", [])]
    return {
        "status": "healthy",
        "model": OLLAMA_MODEL,
        "vision_model": OLLAMA_VISION_MODEL,
        "loaded_models": loaded_names,
        "gpu": gpu_info.get("is_gpu", False),
        "total_vram_mb": gpu_info.get("total_vram_mb", 0)
    }


@app.post("/process-dom", response_model=ActionResponse)
async def process_dom(payload: ProcessDOMRequest):
    logger.info(f"Received {len(payload.elements)} elements for goal: '{payload.user_goal}'")

    # Fast goal-completion detector for single-action instructions (e.g. "click submit", "find and click the submit button")
    goal_lower = payload.user_goal.lower().strip()
    single_action_match = re.search(r"\b(?:click|press|tap|hit)\s+(?:on\s+)?(?:the\s+)?['\"]?([\w\s-]+?)['\"]?(?:\s+button|\s+link|\s+tab|\s+pill|$)", goal_lower)
    if single_action_match and payload.previous_actions:
        target_keyword = single_action_match.group(1).strip()
        for past in payload.previous_actions:
            if past.action == "click" and past.target_text and target_keyword in past.target_text.lower():
                logger.info(f"Goal '{payload.user_goal}' satisfied by previous click on '{past.target_text}'. Emitting 'done'.")
                return ActionResponse(
                    thought=f"The requested target ('{past.target_text}') was already clicked. Goal is fully accomplished.",
                    action="done",
                    target_id=None,
                    value=None
                )
    
    compact_dom = format_dom_for_prompt(payload.elements, user_goal=payload.user_goal)

    page_status_info = f"\nPAGE STATUS / MESSAGES: {payload.page_status}\n" if payload.page_status else ""

    # Visual perception step using local vision model on GPU
    visual_perception_info = ""
    if payload.screenshot and len(payload.screenshot.strip()) > 50:
        try:
            clean_b64 = payload.screenshot.strip()
            if "," in clean_b64:
                clean_b64 = clean_b64.split(",", 1)[1]

            logger.info(f"Analyzing visual page screenshot with {OLLAMA_VISION_MODEL} ({len(clean_b64)} chars)...")
            async with httpx.AsyncClient(timeout=12.0) as http_client:
                vision_resp = await http_client.post(
                    f"{OLLAMA_BASE_URL}/api/generate",
                    json={
                        "model": OLLAMA_VISION_MODEL,
                        "prompt": "Describe what is visually displayed on this screen, noting any banners, highlighted buttons, popups, or status colors.",
                        "images": [clean_b64],
                        "stream": False,
                        "options": {
                            "temperature": 0.1,
                            "num_predict": 100
                        }
                    }
                )
                if vision_resp.status_code == 200:
                    vis_text = vision_resp.json().get("response", "").strip()
                    if vis_text:
                        logger.info(f"Visual perception result: {vis_text[:120]}...")
                        visual_perception_info = f"\nVISUAL SCREENSHOT PERCEPTION (CAMERA / VISION SENSOR):\n{vis_text}\n"
        except Exception as ve:
            logger.warning(f"Visual perception failed or timed out: {ve}")

    history_info = ""
    if payload.previous_actions and len(payload.previous_actions) > 0:
        history_lines = []
        for a in payload.previous_actions[-6:]:
            desc = f"- Step {a.step}: {a.action.upper()}"
            if a.target_id is not None:
                desc += f" on element #{a.target_id}"
            if a.target_text:
                clean_t = a.target_text.replace('\n', ' ').strip()
                desc += f" ('{clean_t[:40]}')"
            if a.value:
                clean_v = a.value.replace('\n', ' ').strip()
                desc += f" with value '{clean_v[:30]}'"
            history_lines.append(desc)
        history_info = (
            "\nRECENT ACTIONS ALREADY TAKEN IN THIS SESSION (DO NOT REPEAT):\n"
            + "\n".join(history_lines)
            + "\n"
        )

    # ────────────────────────────────────────────────────────────────────────
    # TASK REPETITION LOOP DETECTOR (>2 REPEATS) & 500ms HALT
    # ────────────────────────────────────────────────────────────────────────
    loop_detected = False
    loop_summary = ""
    repeated_target_ids = set()

    if payload.previous_actions and len(payload.previous_actions) >= 2:
        last_action = payload.previous_actions[-1]
        
        # 1. Consecutive identical action check
        consecutive_count = 0
        for past in reversed(payload.previous_actions):
            if past.action == last_action.action and past.target_id == last_action.target_id:
                consecutive_count += 1
            else:
                break

        if consecutive_count >= 2:
            loop_detected = True
            if last_action.target_id is not None:
                repeated_target_ids.add(last_action.target_id)
            loop_summary = f"{last_action.action.upper()} on element #{last_action.target_id} ('{last_action.target_text or ''}')"
        else:
            # 2. Windowed frequency check across recent actions
            action_freq = {}
            for past in payload.previous_actions[-5:]:
                key = (past.action, past.target_id)
                action_freq[key] = action_freq.get(key, 0) + 1
                if action_freq[key] >= 2 and past.action not in ("scroll", "done"):
                    loop_detected = True
                    if past.target_id is not None:
                        repeated_target_ids.add(past.target_id)
                    loop_summary = f"repeated {past.action.upper()} on #{past.target_id} ('{past.target_text or ''}')"
                    break

    loop_directive = ""
    if loop_detected:
        logger.warning(f"[Anti-Loop] Repetition loop detected (>2 attempts of {loop_summary}). Halting 500ms and forcing unique approach in prompt.")
        await asyncio.sleep(0.5)  # 500ms halt to settle DOM/network and break execution loop

        target_constraint = ", ".join(f"#{tid}" for tid in repeated_target_ids) if repeated_target_ids else "the repeated element"
        loop_directive = (
            f"\n🚨 LOOP ESCAPE DIRECTIVE (MANDATORY UNIQUE APPROACH):\n"
            f"- REPETITION DETECTED: The previous action ({loop_summary}) was attempted more than 2 times without progressing state.\n"
            f"- FORBIDDEN: Do NOT repeat action '{last_action.action}' and do NOT touch element {target_constraint}.\n"
            f"- MANDATORY UNIQUE ITERATION: You MUST adopt an entirely DIFFERENT approach in this step:\n"
            f"  * Select a completely different interactive element that advances the goal.\n"
            f"  * If you were trying to submit or confirm, look for alternative buttons, parent forms, or scroll to find another control.\n"
            f"  * If the action was already completed or no alternative element exists, return action 'done' immediately.\n"
            f"- ZERO REPETITION: Your action and target_id MUST differ from previous failed attempts.\n"
        )

    user_prompt = (
        f"USER GOAL: {payload.user_goal}\n\n"
        f"CRITICAL PATH DIRECTIVES (ZERO DEVIATION):\n"
        f"1. You must ONLY execute actions that directly and measurably advance the USER GOAL: '{payload.user_goal}'.\n"
        "2. ZERO WANDERING: DO NOT click navigation menus, sidebars, headers, footers, or unrelated links.\n"
        "3. If the user's goal has already been achieved, return action 'done' IMMEDIATELY.\n"
        "4. If the target element matching the goal is present, interact with it. Do NOT touch any other element.\n"
        "5. If no element matches the goal, either 'scroll' to bring it into view or return 'done'. NEVER click random elements.\n"
        f"{loop_directive}"
        f"{visual_perception_info}"
        f"{page_status_info}"
        f"{history_info}\n"
        f"INTERACTIVE ELEMENTS ON SCREEN:\n"
        f"{compact_dom}\n\n"
        "Respond ONLY with this exact JSON object:\n"
        "{\n"
        '  "thought": "1 sentence explaining how this action strictly advances the user goal without deviation",\n'
        '  "action": "click" | "hover" | "type" | "scroll" | "navigate" | "done",\n'
        '  "target_id": <int DOM ID or null>,\n'
        '  "value": <string or null>\n'
        "}"
    )

    try:
        response = await client.chat.completions.create(
            model=OLLAMA_MODEL,
            messages=[
                {"role": "system", "content": MASTER_SYSTEM_PROMPT},
                {"role": "user", "content": user_prompt}
            ],
            temperature=0.1,
            max_tokens=250,
            response_format={"type": "json_object"},
            extra_body={"keep_alive": -1}
        )
        
        raw_content = response.choices[0].message.content or ""
        logger.info(f"Ollama raw response: {raw_content[:200]}")
        
        # Robust action extraction preventing any 502 crashes
        action_result = extract_or_repair_action(
            raw_content,
            fallback_thought=f"Progressing goal: {payload.user_goal}"
        )
        return action_result

    except Exception as e:
        logger.error(f"Error communicating with Ollama: {str(e)}")
        # Safe fallback so agent can continue gracefully without 502
        return ActionResponse(
            thought="Encountered temporary latency, scrolling page to re-inspect elements",
            action="scroll",
            target_id=None,
            value="down"
        )
