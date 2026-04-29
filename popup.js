const statusText = document.getElementById("statusText");
const statusDot = document.getElementById("statusDot");
const messageText = document.getElementById("messageText");
const openButton = document.getElementById("openButton");
const driftButton = document.getElementById("driftButton");
const healButton = document.getElementById("healButton");

const STATUS_LOOKUP = {
  ready: { label: "Ready", tone: "ready" },
  normal: { label: "Normal", tone: "ready" },
  drifted: { label: "Drifted", tone: "drifted" },
  healed: { label: "Healed", tone: "healed" },
  unsupported: { label: "Unsupported Page", tone: "unsupported" },
  unavailable: { label: "No Response Found", tone: "unsupported" },
  error: { label: "Error", tone: "unsupported" }
};

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function setVisualState(stateKey, detailText) {
  const state = STATUS_LOOKUP[stateKey] || STATUS_LOOKUP.ready;

  statusText.textContent = state.label;
  statusDot.dataset.tone = state.tone;

  if (detailText) {
    messageText.textContent = detailText;
  }
}

async function sendAction(action) {
  try {
    const tab = await getActiveTab();

    if (!tab?.id) {
      setVisualState("error", "No active tab is available.");
      return;
    }

    // The content script owns page state; the popup is just the control surface.
    const response = await chrome.tabs.sendMessage(tab.id, { action });
    const stateKey = response?.state || "error";
    const detailText =
      response?.message || "Unable to communicate with the DriftX page layer.";

    setVisualState(stateKey, detailText);
  } catch (error) {
    setVisualState(
      "unsupported",
      "This page is not supported. Open ChatGPT and try again."
    );
  }
}

openButton.addEventListener("click", async () => {
  try {
    await chrome.tabs.create({ url: "https://chatgpt.com/" });
    setVisualState("ready", "ChatGPT opened in a new tab. Once a reply appears, use Drift or Heal.");
  } catch (error) {
    setVisualState("error", "Unable to open ChatGPT from the extension popup.");
  }
});

driftButton.addEventListener("click", () => {
  sendAction("drift");
});

healButton.addEventListener("click", () => {
  sendAction("heal");
});

sendAction("status");
