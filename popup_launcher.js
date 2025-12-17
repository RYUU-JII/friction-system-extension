function getHostname(url) {
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

function tabsQuery(queryInfo) {
  return new Promise((resolve) => chrome.tabs.query(queryInfo, resolve));
}

function storageGet(defaults) {
  return new Promise((resolve) => chrome.storage.local.get(defaults, resolve));
}

function storageSet(value) {
  return new Promise((resolve) => chrome.storage.local.set(value, resolve));
}

function sendMessage(message) {
  return new Promise((resolve) => chrome.runtime.sendMessage(message, resolve));
}

function setMsg(el, text, tone = "muted") {
  if (!el) return;
  el.textContent = text || "";
  el.classList.remove("is-success", "is-error");
  if (tone === "success") el.classList.add("is-success");
  if (tone === "error") el.classList.add("is-error");
}

function setBlockedButtonState(button, blocked) {
  if (!button) return;
  button.classList.toggle("is-blocked", blocked);
  button.disabled = blocked;
  button.textContent = blocked ? "차단 중" : "현재 사이트 차단";
}

function setStatusPill(el, blocked, hostname) {
  if (!el) return;
  el.classList.remove("is-ok", "is-blocked");
  if (!hostname) {
    el.textContent = "차단 불가";
    return;
  }
  if (blocked) {
    el.classList.add("is-blocked");
    el.textContent = "차단됨";
  } else {
    el.classList.add("is-ok");
    el.textContent = "차단 가능";
  }
}

async function init() {
  const openDashboardBtn = document.getElementById("openDashboard");
  const quickBlockBtn = document.getElementById("quickBlockBtn");
  const msgEl = document.getElementById("msg");
  const siteDomainEl = document.getElementById("siteDomain");
  const siteHintEl = document.getElementById("siteHint");
  const siteStatusEl = document.getElementById("siteStatus");
  const siteFaviconEl = document.getElementById("siteFavicon");

  if (!openDashboardBtn || !quickBlockBtn || !msgEl || !siteDomainEl || !siteHintEl || !siteStatusEl) {
    return;
  }

  openDashboardBtn.addEventListener("click", () => chrome.runtime.openOptionsPage());

  setMsg(msgEl, "");

  const [tab] = await tabsQuery({ active: true, currentWindow: true });
  const hostname = tab?.url ? getHostname(tab.url) : null;
  const favIconUrl = tab?.favIconUrl || "";

  siteDomainEl.textContent = hostname || "지원되지 않는 페이지";
  siteHintEl.textContent = hostname ? "" : "chrome://, 확장 페이지 등은 차단할 수 없어요.";
  if (siteFaviconEl) {
    if (favIconUrl) {
      siteFaviconEl.src = favIconUrl;
      siteFaviconEl.style.opacity = "1";
    } else {
      siteFaviconEl.removeAttribute("src");
      siteFaviconEl.style.opacity = "0";
    }
  }

  const { blockedUrls } = await storageGet({ blockedUrls: [] });
  const isBlocked = !!hostname && blockedUrls.includes(hostname);

  setStatusPill(siteStatusEl, isBlocked, hostname);
  setBlockedButtonState(quickBlockBtn, isBlocked || !hostname);

  if (!hostname) {
    setMsg(msgEl, "현재 페이지는 차단할 수 없어요.", "error");
    return;
  }

  if (isBlocked) {
    setMsg(msgEl, "", "muted");
    return;
  }

  quickBlockBtn.addEventListener("click", async () => {
    try {
      const latest = await storageGet({ blockedUrls: [] });
      const next = Array.isArray(latest.blockedUrls) ? [...latest.blockedUrls] : [];
      if (next.includes(hostname)) {
        setMsg(msgEl, "이미 차단된 사이트야.", "muted");
        setBlockedButtonState(quickBlockBtn, true);
        setStatusPill(siteStatusEl, true, hostname);
        return;
      }

      next.push(hostname);
      await storageSet({ blockedUrls: next });
      await sendMessage({ action: "SETTINGS_UPDATED" });

      setMsg(msgEl, `${hostname} 차단 완료`, "success");
      setBlockedButtonState(quickBlockBtn, true);
      setStatusPill(siteStatusEl, true, hostname);
    } catch {
      setMsg(msgEl, "차단 처리 중 오류가 발생했어.", "error");
    }
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
