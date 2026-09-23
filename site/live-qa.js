(() => {
if (!["localhost", "127.0.0.1", "[::1]"].includes(location.hostname)) return;
const state = { env: "Lab-S" };
const el = Object.fromEntries(["liveQaCard", "liveModel", "liveEnvironment", "liveSuggestions", "liveQuestion", "liveAsk", "liveStatus", "liveAnswer"].map(id => [id, document.getElementById(id)]));
let liveRequestController = null;
el.liveQaCard.hidden = false;
const LIVE_QUESTIONS = {
  "Lab-S": [
    "Which object moved most frequently?",
    "What happened to the blue totebag after it disappeared?",
    "Which objects never moved?",
    "Where was the robot dog last observed?",
  ],
  "Lab-L": [
    "Which object moved most frequently?",
    "When did the green chair disappear and reappear?",
    "Which objects never moved?",
    "Where was the robot dog last observed?",
  ],
};

function resetLiveQa() {
  liveRequestController?.abort();
  liveRequestController = null;
  el.liveAsk.disabled = false;
  if (!el.liveAnswer) return;
  el.liveStatus.textContent = "Ready";
  el.liveStatus.classList.remove("thinking", "error");
  el.liveAnswer.textContent = "Choose a suggested question or type your own. Gemini will answer from the saved 10-session memory currently shown above.";
}

function renderLiveSuggestions() {
  if (!el.liveSuggestions) return;
  el.liveEnvironment.textContent = state.env;
  el.liveSuggestions.innerHTML = "";
  LIVE_QUESTIONS[state.env].forEach((question) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = question;
    button.addEventListener("click", () => {
      el.liveQuestion.value = question;
      el.liveQuestion.focus();
    });
    el.liveSuggestions.append(button);
  });
}

async function askGemini() {
  if (liveRequestController) return;
  const question = el.liveQuestion.value.trim();
  const model = el.liveModel.value.trim();
  if (!question) {
    el.liveQuestion.focus();
    return;
  }
  if (!model) {
    el.liveModel.focus();
    return;
  }
  liveRequestController?.abort();
  const controller = new AbortController();
  liveRequestController = controller;
  const timeout = setTimeout(() => controller.abort(), 80000);
  el.liveAsk.disabled = true;
  el.liveStatus.textContent = `Asking ${model}…`;
  el.liveStatus.className = "thinking";
  el.liveAnswer.innerHTML = '<span class="live-thinking"><i></i><i></i><i></i></span>';
  const started = performance.now();

  try {
    const response = await fetch("/api/ask", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ environment: state.env, model, question }),
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Local API returned ${response.status}`);
    if (liveRequestController !== controller) return;
    const answer = payload.answer?.trim();
    if (!answer) throw new Error("Gemini returned no answer.");
    el.liveAnswer.textContent = answer;
    el.liveStatus.textContent = `${model} · ${((performance.now() - started) / 1000).toFixed(1)} s`;
    el.liveStatus.className = "";
  } catch (error) {
    if (liveRequestController !== controller) return;
    el.liveAnswer.textContent = `Could not reach Gemini: ${error.message}`;
    el.liveStatus.textContent = "Request failed";
    el.liveStatus.className = "error";
  } finally {
    clearTimeout(timeout);
    if (liveRequestController === controller) {
      liveRequestController = null;
      el.liveAsk.disabled = false;
    }
  }
}

el.liveAsk.addEventListener("click", askGemini);
el.liveQuestion.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    askGemini();
  }
});

document.querySelectorAll(".env-button").forEach(button => {
  button.addEventListener("click", () => {
    resetLiveQa();
    state.env = button.dataset.env;
    renderLiveSuggestions();
  });
});
renderLiveSuggestions();
})();
