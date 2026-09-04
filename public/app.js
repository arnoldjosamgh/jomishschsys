const BASE_URL =
  window.location.protocol === "file:" ||
  window.location.hostname === "127.0.0.1" ||
  window.location.hostname === "localhost"
    ? "http://localhost:3005"
    : window.location.hostname.includes("github.io")
      ? "https://jomish-business-suite.onrender.com"
      : "";
window.API_URL = `${BASE_URL}/api`;
const API_URL = window.API_URL;

// ── Offline-First Init ────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", async () => {
  // Initialise IndexedDB + request persistent storage
  if (window.OfflineDB) await window.OfflineDB.initOfflineDB();
  updateSyncBadge();

  // ── Fix Modal Positioning ──
  // Move all modals directly into body so position:fixed works perfectly
  // and doesn't get trapped by container scrolling/transforms.
  document
    .querySelectorAll(
      ".modal, .receipt-overlay, .print-overlay, .label-overlay",
    )
    .forEach((el) => {
      document.body.appendChild(el);
    });

  // Reconnect trigger: sync whenever we come back online
  window.addEventListener("online", () => {
    syncOfflineSales();
  });

  // Register Background Sync with the Service Worker
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.ready.then((sw) => {
      if ("sync" in sw) {
        sw.sync.register("sync-offline-sales").catch(() => {});
      }
    });
    // Listen for SW messages (e.g., triggered by Background Sync)
    navigator.serviceWorker.addEventListener("message", (event) => {
      if (event.data && event.data.type === "TRIGGER_SYNC") syncOfflineSales();
    });
  }
});

let USER_ROLE = "";
let USER_NAME = "";
window.USER_PERMISSIONS = {
  can_see_dashboard: 0,
  can_see_hr: 0,
  can_see_attendance: 1,
  can_see_sme: 0,
  can_see_pos: 0,
  can_see_secretary: 0,
  can_see_transport: 0,
};
let USER_PERMISSIONS = window.USER_PERMISSIONS;
let ENABLED_TABS = {
  dashboard: true,
  hr: true,
  attendance: true,
  sme: true,
  pos: true,
  secretary: true,
  transport: true,
  schedules: true,
  hardware: true,
  system_users: true,
};
let barcodeBuffer = "";
let lastKeyTime = Date.now();
let soldBarcodes = new Set();
let isPrinting = false;
let GLOBAL_SHIFTS = [
  {
    id: "morning",
    label: "Morning",
    icon: "fa-solid fa-sun",
    color: "#F59E0B",
    start_time: "08:00",
    end_time: "16:00",
  },
  {
    id: "afternoon",
    label: "Afternoon",
    icon: "fa-solid fa-cloud-sun",
    color: "#6366F1",
    start_time: "16:00",
    end_time: "23:59",
  },
];
let GLOBAL_OPERATIONAL_DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"];

// Dark mode
(function applyTheme() {
  const t = localStorage.getItem("jomish_theme") || "light";
  document.documentElement.setAttribute("data-theme", t);
})();

function toggleTheme() {
  const current =
    document.documentElement.getAttribute("data-theme") || "light";
  const next = current === "dark" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", next);
  localStorage.setItem("jomish_theme", next);
}

// ---- Global Modal Helpers ----
// These are defined at top-level so inline onclick attributes in HTML can call them directly.
function openCalModal() {
  const m = document.getElementById("cal-event-modal");
  if (!m) {
    alert("ERROR: Modal element #cal-event-modal not found!");
    return;
  }
  m.classList.remove("hidden");
  m.style.display = "flex";
  m.style.position = "fixed";
  m.style.inset = "0";
  m.style.zIndex = "99999";
  m.style.backgroundColor = "rgba(0,0,0,0.6)";
  m.style.justifyContent = "center";
  m.style.alignItems = "center";
}

function closeCalModal() {
  const m = document.getElementById("cal-event-modal");
  if (!m) return;
  m.style.cssText = "";
  m.classList.add("hidden");
}
window.openCalModal = openCalModal;
window.closeCalModal = closeCalModal;

// window.onerror override removed to allow index.html's visual error handler to catch errors.;

window.addEventListener("unhandledrejection", function (event) {
  console.error("[Jomish Promise Error]", event.reason);
});

// Utility to safely format dates — handles ISO, SQLite space format, and legacy locale strings
function formatDisplayDate(dateStr, showTime = true) {
  if (!dateStr) return "—";
  const s = String(dateStr).trim();
  if (!s || s === "null" || s === "undefined" || s === "CURRENT_DATETIME")
    return "—";

  let d;

  // Strategy 1: Direct parse — works for ISO 8601 strings with or without Z
  d = new Date(s);

  // Strategy 2: SQLite CURRENT_TIMESTAMP format "YYYY-MM-DD HH:MM:SS" → replace space with T
  if (isNaN(d.getTime()) && s.includes(" ") && !s.includes(",")) {
    d = new Date(s.replace(" ", "T"));
  }

  // Strategy 3: Try appending Z to treat as UTC (some SQLite drivers omit timezone)
  if (isNaN(d.getTime())) {
    d = new Date(s.replace(" ", "T") + "Z");
  }

  // Give up — show a dash rather than the raw ugly string
  if (isNaN(d.getTime())) return "—";

  const options = {
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "Africa/Kampala", // Always display in Uganda local time
  };
  if (showTime) {
    options.hour = "2-digit";
    options.minute = "2-digit";
  }

  return d.toLocaleString("en-US", options);
}

document.addEventListener("DOMContentLoaded", () => {
  const token = localStorage.getItem("jomish_token");
  USER_ROLE = localStorage.getItem("jomish_role");
  USER_NAME = localStorage.getItem("jomish_name") || "";

  // Reveal the page now that DOM is ready (was hidden by inline auth guard in <head>)
  document.documentElement.style.visibility = "";

  try {
    const raw = localStorage.getItem("jomish_permissions");
    if (raw) USER_PERMISSIONS = JSON.parse(raw);
  } catch (e) {
    console.error("Permission parse err", e);
  }

  if (!token) {
    // Belt-and-suspenders: inline guard already redirected, but just in case
    window.location.replace("login.html");
    return;
  }

  // Set UI based on Role
  document.querySelector(".user-info p").innerText =
    `Logged in as: ${localStorage.getItem("jomish_name")} (${USER_ROLE})`;
  initNavigation();

  // Show Documents tab for privileged roles only
  if (["CEO", "HR"].includes(USER_ROLE)) {
    const docsBtn = document.getElementById("btn-hr-documents");
    if (docsBtn) docsBtn.style.display = "";
  }


  // ── Request Notification Permission (Android / Web) ────────────────────
  // Without this call the browser permission stays 'default' forever and
  // push_notification events received via socket can never show a popup.
  // Electron doesn't use the browser Notification API so we skip it there.
  if (
    !window.electronAPI &&
    "Notification" in window &&
    Notification.permission === "default"
  ) {
    Notification.requestPermission().then((perm) => {
    });
  }

  // ── Offline Mode Banner ──────────────────────────────────────────────────
  if (localStorage.getItem("jomish_offline_mode") === "true") {
    const header = document.querySelector(".main-header");
    if (header) {
      const offlineBanner = document.createElement("div");
      offlineBanner.style.cssText =
        "background: #EF4444; color: white; text-align: center; padding: 5px; font-weight: bold; font-size: 0.85rem;";
      offlineBanner.innerHTML =
        '<i class="fa-solid fa-plane-slash"></i> Offline Mode — You are logged in with cached credentials. Some features may be unavailable.';
      header.parentNode.insertBefore(offlineBanner, header);
    }
    // Add offline indicator to user info
    const userInfo = document.querySelector(".user-info p");
    if (userInfo) {
      userInfo.innerHTML +=
        ' <span style="color:#EF4444; font-weight:bold;">[OFFLINE]</span>';
    }
  }
  enforceRBAC();
  autoRedirect();

  // Fade out & remove the skeleton loader once the real app is ready
  const skeleton = document.getElementById("app-skeleton");
  if (skeleton) {
    skeleton.classList.add("fade-out");
    setTimeout(() => {
      if (skeleton.parentNode) skeleton.remove();
    }, 450);
  }

  // Load system printers into dropdown (Electron only)
  // Initialize Printer Selection Input
  setTimeout(() => {
    const input = document.getElementById("system-printer-select");
    const dataList = document.getElementById("printer-list");
    if (!input) return;

    const saved = localStorage.getItem("jomish_system_printer");
    if (saved) input.value = saved;

    input.addEventListener("change", (e) => {
      localStorage.setItem("jomish_system_printer", e.target.value.trim());
      showToast("System printer updated", "success");
    });

    if (window.electronAPI && window.electronAPI.getPrinters && dataList) {
      window.electronAPI
        .getPrinters()
        .then((printers) => {
          printers.forEach((p) => {
            const opt = document.createElement("option");
            opt.value = p.name;
            dataList.appendChild(opt);
          });
        })
        .catch((e) => console.error("Failed to load printers:", e));
    }

    // Restore saved network printer settings
    const savedIp = localStorage.getItem("jomish_printer_ip");
    const savedPort = localStorage.getItem("jomish_printer_port");
    const ipInput = document.getElementById("network-printer-ip");
    const portInput = document.getElementById("network-printer-port");
    if (ipInput && savedIp) {
      ipInput.value = savedIp;
      updateNetworkPrinterStatus(savedIp);
    }
    if (portInput && savedPort) portInput.value = savedPort;
  }, 2000);

  // Ultimate DOM-level Webview Tamer:
  // When ANY host input gets focus (cursor placed inside), we completely strip pointer-events and focus from all webviews.
  // This physically blocks them from fighting back for the keyboard.
  document.addEventListener("focusin", (e) => {
    if (
      e.target.tagName === "INPUT" ||
      e.target.tagName === "TEXTAREA" ||
      e.target.tagName === "SELECT"
    ) {
      document.querySelectorAll("webview").forEach((wv) => {
        wv.style.pointerEvents = "none";
        wv.blur();
      });
      if (window.electronAPI && window.electronAPI.forceFocus) {
        window.electronAPI.forceFocus();
      }
      // Double enforce the focus on the input to override any race conditions
      setTimeout(() => {
        if (document.activeElement !== e.target) e.target.focus();
      }, 10);
    }
  });

  // Webview Tamer - mousedown edition:
  // ONLY enable pointer-events when user clicks directly on the [data-webview-zone] wrapper div.
  // Clicking the header bar, reload button, or anywhere outside does NOT activate the webview.
  // This prevents the webview from permanently stealing keyboard input.
  document.addEventListener("mousedown", (e) => {
    const zone = e.target.closest("[data-webview-zone]");
    if (zone) {
      // User clicked inside the actual webview rendering area — allow interaction
      const wv = zone.querySelector("webview");
      if (wv) wv.style.pointerEvents = "auto";
    } else {
      // Clicked anywhere outside the webview zone — kill all webview pointer-events
      document.querySelectorAll("webview").forEach((wv) => {
        wv.style.pointerEvents = "none";
        wv.blur();
      });
      if (window.electronAPI && window.electronAPI.forceFocus) {
        window.electronAPI.forceFocus();
      } else {
        window.focus();
        document.body.focus();
      }
    }
  });

  initSockets();
  loadDashboard();
  registerDevice();
  loadBrandLogo();
  loadBusinessConfig();
  loadSystemStatus();
  checkDataLossWarning();
  // Clock is handled by startLiveClock() called from loadDashboard()
  validateSession();
  initBarcodeAutoCalc();
  loadSoldBarcodes();
  // Scanner will start when the Attendance tab is clicked

  // Employee Handlers
  document
    .getElementById("btn-add-employee")
    ?.addEventListener("click", async () => {
      await loadRolesIntoSelect("emp-role");
      document.getElementById("add-employee-modal").classList.remove("hidden");
    });

  // Calendar Event Modal via addEventListener (required because contextIsolation=true blocks onclick)
  const _calBtn = document.getElementById("btn-add-calendar-event");
  const _calModal = document.getElementById("cal-event-modal");
  const _calCloseBtn = document.getElementById("btn-close-cal-event");

  // Log what we found so we can see in DevTools (F12)

  if (_calBtn && _calModal) {
    _calBtn.addEventListener("click", () => {
      _calModal.style.setProperty("display", "flex", "important");
      _calModal.style.setProperty("position", "fixed", "important");
      _calModal.style.setProperty("top", "0", "important");
      _calModal.style.setProperty("left", "0", "important");
      _calModal.style.setProperty("width", "100%", "important");
      _calModal.style.setProperty("height", "100%", "important");
      _calModal.style.setProperty("z-index", "99999", "important");
      _calModal.style.setProperty(
        "background-color",
        "rgba(0,0,0,0.7)",
        "important",
      );
      _calModal.style.setProperty("justify-content", "center", "important");
      _calModal.style.setProperty("align-items", "center", "important");
      _calModal.classList.remove("hidden");
    });
  } else {
    console.error(
      "[CAL ERROR] Could not find: btn=" + !!_calBtn + " modal=" + !!_calModal,
    );
  }

  if (_calCloseBtn && _calModal) {
    _calCloseBtn.addEventListener("click", () => {
      _calModal.removeAttribute("style");
      _calModal.classList.add("hidden");
    });
  }

  const formCalEvent = document.getElementById("form-cal-event");
  if (formCalEvent) {
    formCalEvent.addEventListener("submit", handleCalEventSubmit);
  }
  document
    .getElementById("btn-close-emp-modal")
    ?.addEventListener("click", () => {
      document.getElementById("add-employee-modal").classList.add("hidden");
    });
  document
    .getElementById("form-add-employee")
    ?.addEventListener("submit", handleAddEmployee);
  document
    .getElementById("btn-add-schedule")
    ?.addEventListener("click", handleAddSchedule);

  // TX Handlers
  document.getElementById("btn-add-tx")?.addEventListener("click", () => {
    document.getElementById("add-tx-modal").classList.remove("hidden");
  });
  document
    .getElementById("btn-close-tx-modal")
    ?.addEventListener("click", () => {
      document.getElementById("add-tx-modal").classList.add("hidden");
    });
  document
    .getElementById("form-add-tx")
    ?.addEventListener("submit", handleAddTx);

  // Attendance Scan Simulation
  document
    .getElementById("btn-simulate-scan")
    ?.addEventListener("click", handleScan);

  // New Feature Handlers
  document
    .getElementById("form-add-note")
    ?.addEventListener("submit", handleAddNote);

  // handleAddNotice was removed — notice board is no longer a feature
  document
    .getElementById("btn-auto-schedule")
    ?.addEventListener("click", handleAutoSchedule);

  // Branding Settings
  const btnUploadLogo = document.getElementById("btn-upload-logo");
  if (btnUploadLogo) {
    btnUploadLogo.addEventListener("click", handleLogoUpload);
  }

  const btnUploadSignature = document.getElementById("btn-upload-signature");
  if (btnUploadSignature) {
    btnUploadSignature.addEventListener("click", handleSignatureUpload);
  }

  initGlobalScanner();

  const btnSaveDetails = document.getElementById("btn-save-biz-details");
  if (btnSaveDetails) {
    btnSaveDetails.addEventListener("click", handleDetailsUpdate);
  }

  const btnSaveModules = document.getElementById("btn-save-modules");
  if (btnSaveModules) {
    btnSaveModules.addEventListener("click", handleSaveModulesUpdate);
  }

  const formEmailReply = document.getElementById("form-email-reply");
  if (formEmailReply) {
    formEmailReply.addEventListener("submit", handleEmailReplySubmit);
  }

  const btnDownloadAtt = document.getElementById("btn-download-attendance");
  if (btnDownloadAtt)
    btnDownloadAtt.addEventListener("click", downloadAttendancePDF);

  // User Management Modal Handlers
  const btnClosePassModal = document.getElementById("btn-close-pass-modal");
  if (btnClosePassModal)
    btnClosePassModal.addEventListener("click", () =>
      document.getElementById("set-password-modal").classList.add("hidden"),
    );

  const formSetPass = document.getElementById("form-set-password");
  if (formSetPass) formSetPass.addEventListener("submit", handleUpdateAccess);

  // Logout
  const btnLogout = document.getElementById("btn-logout");
  if (btnLogout) btnLogout.addEventListener("click", handleLogout);

  // Edit Product Modal Handlers
  const btnCloseEditProd = document.getElementById("btn-close-edit-prod");
  if (btnCloseEditProd)
    btnCloseEditProd.addEventListener("click", () => {
      document.getElementById("edit-product-modal").classList.add("hidden");
      document.getElementById("form-edit-product").reset();
      document.getElementById("edit-prod-preview").style.display = "none";
    });
  const formEditProd = document.getElementById("form-edit-product");
  if (formEditProd) formEditProd.addEventListener("submit", handleEditProduct);

  // Product Handlers
  const btnAddProd = document.getElementById("btn-add-product");
  if (btnAddProd)
    btnAddProd.addEventListener("click", () =>
      document.getElementById("add-product-modal").classList.remove("hidden"),
    );

  const btnCloseProd = document.getElementById("btn-close-prod-modal");
  if (btnCloseProd)
    btnCloseProd.addEventListener("click", () =>
      document.getElementById("add-product-modal").classList.add("hidden"),
    );

  const formAddProd = document.getElementById("form-add-product");
  if (formAddProd) formAddProd.addEventListener("submit", handleAddProduct);

  const btnGenerateBulk = document.getElementById("btn-generate-bulk");
  if (btnGenerateBulk)
    btnGenerateBulk.addEventListener("click", () =>
      window.generateBulkBarcodes(),
    );

  const btnIgnoreBarcodes = document.getElementById("btn-ignore-barcodes");
  if (btnIgnoreBarcodes)
    btnIgnoreBarcodes.addEventListener("click", () =>
      window.ignoreRemainingBarcodes(),
    );

  const btnCloseScan = document.getElementById("btn-close-scan-session");
  if (btnCloseScan)
    btnCloseScan.addEventListener("click", () => window.closeScanSession());

  // POS Search

  // SME Finance Search
  const smeSearch = document.getElementById("sme-search");
  if (smeSearch)
    smeSearch.addEventListener("input", () => renderSMETransactions());

  // Global barcode scanning is handled by initGlobalScanner() — no duplicate listener needed
  // POS Checkout Handler — opens payment panel with numpad
  const btnCheckout = document.getElementById("btn-checkout");
  if (btnCheckout) {
    btnCheckout.addEventListener("click", () => {
      if (posCart.length === 0) return alert("Cart is empty!");
      const total = parseFloat(btnCheckout.getAttribute("data-total"));
      document.getElementById("pay-total").textContent =
        "UGX " + Math.round(total).toLocaleString();
      document.getElementById("pay-amount").value = "0";
      document.getElementById("pay-change").textContent = "UGX 0";
      document.getElementById("pay-change").style.color = "var(--text-muted)";
      const panel = document.getElementById("payment-panel");
      panel.classList.remove("hidden");
      // Auto-scroll to cash payment panel
      setTimeout(() => {
        panel.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 100);
    });
  }
});

function initNavigation() {
  const navBtns = document.querySelectorAll(".sidebar nav .nav-btn");

  if (!navBtns || navBtns.length === 0) {
    console.error("[Jomish] initNavigation: no nav buttons found!");
    return;
  }

  navBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      try {
        const targetId = btn.getAttribute("data-target");
        if (!targetId) return; // skip buttons without data-target

        // Update active button
        navBtns.forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");

        // Dynamically fetch sections in case DOM changed
        const sections = document.querySelectorAll(
          ".main-content .view-section",
        );

        // Hide all sections, show target
        sections.forEach((sec) => sec.classList.remove("active"));
        const targetSection = document.getElementById(targetId);
        if (!targetSection) {
          console.error("[Jomish] Nav target section not found:", targetId);
          alert("ERROR: Section not found: " + targetId);
          return;
        }
        targetSection.classList.remove("hidden");
        targetSection.classList.add("active");

        // FIX for Electron <webview> swallowing keyboard input
        document.querySelectorAll("webview").forEach((wv) => wv.blur());
        if (window.electronAPI && window.electronAPI.forceFocus) {
          window.electronAPI.forceFocus();
        } else {
          window.focus();
          document.body.focus();
        }

        // Load specifics based on tab
        if (targetId === "dashboard") {
          loadDashboard();
        }
        if (targetId === "attendance") {
          loadAttendance();
        }
        if (targetId === "schedules") {
          if (typeof window.loadShiftTimetable === "function")
            window.loadShiftTimetable();
        }
        if (targetId === "supervision-hub") {
          setTimeout(() => switchSupervisionView("attendance"), 50);
        }
        if (targetId === "sme-business") {
          loadTransactions();
        }
          switchPOSView("register");
        }
        if (targetId === "hr-mgmt") {
          loadEmployees();
          loadRoles();
          loadInventory();
          loadUserAccounts();
        }
        if (targetId === "secretary-hub") {
          loadSecretaryHub();
        }
        if (targetId === "tech-hub") {
          checkAutoStart();
          loadBrandLogo();
          loadRoles();
        }
        if (targetId === "system-users") {
          loadSystemUsers();
        }
      } catch (e) {
        console.error("[Jomish] Nav click error:", e);
      }
    });
  });

  // POS Sub-view Navigation Listener
  const btnPosReg = document.getElementById("pos-nav-register");
  const btnPosStock = document.getElementById("pos-nav-stock");
  const btnPosExp = document.getElementById("pos-nav-expenses");
  if (btnPosReg)
    btnPosReg.addEventListener("click", (e) => {
      e.preventDefault();
      switchPOSView("register");
    });
  if (btnPosStock)
    btnPosStock.addEventListener("click", (e) => {
      e.preventDefault();
      switchPOSView("stock");
    });
  if (btnPosExp)
    btnPosExp.addEventListener("click", (e) => {
      e.preventDefault();
      switchPOSView("expenses");
    });
  const btnPosCredits = document.getElementById("pos-nav-credits");
  if (btnPosCredits)
    btnPosCredits.addEventListener("click", (e) => {
      e.preventDefault();
      switchPOSView("credits");
    });

  // POS Expense Form
  const formPosExp = document.getElementById("form-pos-expense");
  if (formPosExp) formPosExp.addEventListener("submit", handlePOSExpenseSubmit);
}

function switchPOSView(viewName) {
  // Hide all sub-views & reset nav button states
  document.querySelectorAll(".pos-sub-view").forEach((v) => {
    v.classList.add("hidden");
    v.style.display = "none";
  });
  // Reset nav button active style
  [
    "pos-nav-register",
    "pos-nav-stock",
    "pos-nav-expenses",
    "pos-nav-credits",
  ].forEach((id) => {
    const b = document.getElementById(id);
    if (b) b.classList.remove("active");
  });

  if (viewName === "terminal" || viewName === "register") {
    const el = document.getElementById("pos-register-view");
    if (el) {
      el.classList.remove("hidden");
      el.style.display = "block";
    }
    const b = document.getElementById("pos-nav-register");
    if (b) b.classList.add("active");
  } else if (viewName === "stock") {
    const el = document.getElementById("pos-stock-view");
    if (el) {
      el.classList.remove("hidden");
      el.style.display = "block";
    }
    const b = document.getElementById("pos-nav-stock");
    if (b) b.classList.add("active");
    loadInventory();
  } else if (viewName === "expenses") {
    const el = document.getElementById("pos-expenses-view");
    if (el) {
      el.classList.remove("hidden");
      el.style.display = "block";
    }
    const b = document.getElementById("pos-nav-expenses");
    if (b) b.classList.add("active");
  } else if (viewName === "credits") {
    const el = document.getElementById("pos-credits-view");
    if (el) {
      el.classList.remove("hidden");
      el.style.display = "block";
    }
    const b = document.getElementById("pos-nav-credits");
    if (b) b.classList.add("active");
    loadCredits();
  }
}

function switchHRView(viewName) {
  // Hide all HR sub-sections
  document
    .querySelectorAll(".hr-sub-view")
    .forEach((v) => v.classList.add("hidden"));

  // UI Toggle for buttons — scope to HR section only to avoid null-id crash
  const hrSection = document.getElementById("hr-mgmt");
  const hrBtns = hrSection
    ? hrSection.querySelectorAll(".tab-scroller .nav-btn")
    : [];
  hrBtns.forEach((b) => {
    b.classList.remove("active");
    const btnId = b.getAttribute("id") || "";
    if (btnId.includes(viewName)) b.classList.add("active");
  });

  if (viewName === "recruitment") {
    document.getElementById("hr-recruitment-view").classList.remove("hidden");
    loadEmployees();
  } else if (viewName === "payroll") {
    document.getElementById("hr-payroll-view").classList.remove("hidden");
    if (!document.getElementById("payroll-month").value) {
      const now = new Date();
      document.getElementById("payroll-month").value =
        `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    }
    loadPayrollStatus();
  } else if (viewName === "blueprint") {
    document.getElementById("hr-blueprint-view").classList.remove("hidden");
    loadBusinessConfig();
    loadUserAccounts();
    loadRoles();
    // Devices section: only HR and CEO can see company devices
    const devContainer = document.getElementById("connected-devices-container");
    if (["HR", "CEO"].includes(USER_ROLE)) {
      if (devContainer) devContainer.style.display = "";
      loadDevices();
      startDevicesAutoRefresh();
    } else {
      if (devContainer) devContainer.style.display = "none";
    }
  } else if (viewName === "permissions") {
    document.getElementById("hr-permissions-view").classList.remove("hidden");
    loadEmployeePermissions();
  } else if (viewName === "documents") {
    document.getElementById("hr-documents-view").classList.remove("hidden");
  }
}

// ─── Customer Reviews System ──────────────────────────────────────────────────

let currentReviewToken = "";

async function generateReviewLink() {
  try {
    const res = await fetchAuth(`${API_URL}/reviews/generate-link`, {
      method: "POST",
    });
    if (!res.ok) throw new Error("Failed to generate link");
    const data = await res.json();
    currentReviewToken = data.token;

    const reviewUrl = `${window.location.origin}/review.html?token=${currentReviewToken}`;

    // Show QR
    document.getElementById("review-qr-container").style.display = "block";
    document.getElementById("btn-copy-review-link").style.display =
      "inline-block";
    document.getElementById("btn-print-review-qr").style.display =
      "inline-block";
    document.getElementById("review-link-text").textContent = reviewUrl;

    // Render QR
    const qrContainer = document.getElementById("review-qr-code");
    qrContainer.innerHTML = ""; // clear

    // Use QRCodeStyling if available
    if (typeof QRCodeStyling !== 'undefined') {
      let logoUrl = "/favicon.png"; // Default to Jomish logo
      const navLogo = document.getElementById("nav-company-logo");
      const srcAttr = navLogo ? navLogo.getAttribute("src") : "";
      if (srcAttr && srcAttr.trim() !== "" && !srcAttr.includes("undefined")) {
        logoUrl = navLogo.src;
      }
      
      const qrOptions = {
        width: 250,
        height: 250,
        type: "svg",
        data: reviewUrl,
        dotsOptions: {
          color: "#4f46e5", // Primary dark color
          type: "rounded"
        },
        backgroundOptions: {
          color: "#ffffff",
        },
        cornersSquareOptions: {
          type: "extra-rounded",
          color: "#6366f1"
        },
        cornersDotOptions: {
          type: "dot",
          color: "#8b5cf6"
        }
      };

      if (logoUrl) {
        qrOptions.image = logoUrl;
        qrOptions.imageOptions = {
          crossOrigin: "anonymous",
          margin: 10,
          imageSize: 0.4
        };
      }

      const qrCode = new QRCodeStyling(qrOptions);
      qrCode.append(qrContainer);
    } else {
      // Fallback
      qrContainer.innerHTML = `<img src="https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(reviewUrl)}" alt="Review QR" style="width:200px; height:200px;">`;
    }

    if (!data.existing) {
      showToast("New unique review link generated!", "success");
    }
  } catch (e) {
    showToast("Error getting review link.", "danger");
    console.error(e);
  }
}

function copyReviewLink() {
  const url = document.getElementById("review-link-text").textContent;
  if (!url) return;
  navigator.clipboard.writeText(url).then(() => {
    showToast("Review link copied to clipboard", "info");
  });
}

function printReviewQR() {
  if (!currentReviewToken) return;

  // Get business name — try sidebar element, then localStorage
  const bizName = (document.getElementById("sidebar-brand-name")?.innerText?.trim()) ||
                  localStorage.getItem("jomish_biz_name") ||
                  "Our Business";
  const bizColor = localStorage.getItem("jomish_biz_color") || "#6366f1";

  // Get logo src
  const navLogo = document.getElementById("nav-company-logo");
  const srcAttr = navLogo ? navLogo.getAttribute("src") : "";
  const logoSrc = (srcAttr && srcAttr.trim() !== "" && !srcAttr.includes("undefined") && navLogo.complete && navLogo.naturalWidth > 0)
    ? navLogo.src
    : (window.location.origin + "/favicon.png");

  const reviewUrl = `${window.location.origin}/review.html?token=${currentReviewToken}`;
  const libUrl = `${window.location.origin}/lib/qr-code-styling.js`;

  const printWindow = window.open("", "_blank");
  printWindow.document.write(`<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Review QR \u2014 ${bizName}</title>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@700;900&display=swap" rel="stylesheet">
  <style>
    @page { margin: 8mm; size: auto; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body { width: 100%; background: #fff; font-family: 'Inter','Segoe UI',sans-serif; }
    body { padding: 5mm; text-align: center; }
    .page {
      border: 3px solid ${bizColor};
      border-radius: 10mm;
      padding: 8mm;
      display: inline-block;
      width: 100%;
      text-align: center;
    }
    .brand-row {
      display: flex; align-items: center; justify-content: center;
      gap: 4mm; margin-bottom: 6mm;
    }
    .brand-logo {
      width: 14mm; height: 14mm; border-radius: 50%;
      object-fit: cover; border: 2px solid ${bizColor};
    }
    .biz-name { font-size: 10mm; font-weight: 900; color: ${bizColor}; }
    .cta-h { font-size: 7mm; font-weight: 900; color: #111; margin-bottom: 3mm; }
    .cta-s { font-size: 3.5mm; color: #555; line-height: 1.5; margin-bottom: 6mm; }
    #qr-box { margin: 0 auto 5mm; width: 100%; display: flex; justify-content: center; align-items: center; }
    #qr-box > * { margin: 0 auto !important; max-width: 70%; }
    #qr-box svg, #qr-box canvas { width: 100% !important; height: auto !important; display: block; margin: 0 auto; }
    .footer { font-size: 2.5mm; color: #bbb; }
  </style>
</head>
<body>
  <div class="page">
    <div class="brand-row">
      <img class="brand-logo" src="${logoSrc}" onerror="this.src='${window.location.origin}/favicon.png'" alt="">
      <div class="biz-name">${bizName}</div>
    </div>
    <div class="cta-h">How was your experience?</div>
    <div class="cta-s">Scan the QR code with your phone camera<br>and leave us a quick review \u2014 it only takes 30 seconds!</div>
    <div id="qr-box"></div>
    <div class="footer">Powered by Jomish Business Suite</div>
  </div>
  <script src="${libUrl}"></script>
  <script>
    function go() {
      var qr = new QRCodeStyling({
        width: 900, height: 900,
        type: "svg",
        data: "${reviewUrl.replace(/"/g, '\\"')}",
        image: "${logoSrc.replace(/"/g, '\\"')}",
        dotsOptions: { color: "#4f46e5", type: "rounded" },
        backgroundOptions: { color: "#ffffff" },
        imageOptions: { margin: 8, imageSize: 0.35 },
        cornersSquareOptions: { type: "extra-rounded", color: "#6366f1" },
        cornersDotOptions: { type: "dot", color: "#8b5cf6" }
      });
      qr.append(document.getElementById('qr-box'));
      setTimeout(function() { window.print(); }, 900);
    }
    if (typeof QRCodeStyling !== 'undefined') {
      go();
    } else {
      document.querySelector('script[src]').onload = go;
      setTimeout(go, 1500);
    }
  </script>
</body>
</html>`);
  printWindow.document.close();
}

function escapeHTML(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function loadReviews() {
  const container = document.getElementById("reviews-list");
  container.innerHTML =
    '<p style="text-align:center; color:var(--text-muted); padding:30px;"><i class="fa-solid fa-spinner fa-spin"></i> Loading reviews...</p>';

  try {
    const res = await fetchAuth(`${API_URL}/reviews`);
    if (!res.ok) {
      let errDetail = `HTTP ${res.status}`;
      try {
        const d = await res.json();
        errDetail += ": " + (d.error || JSON.stringify(d));
      } catch (_) {}
      console.error("[loadReviews]", errDetail);
      container.innerHTML = `<p style="text-align:center; color:var(--danger); padding:30px;"><i class="fa-solid fa-circle-exclamation"></i> Error loading reviews<br><code style="font-size:0.72rem;opacity:0.7;">${errDetail}</code></p>`;
      return;
    }
    const data = await res.json();

    if (!data.reviews || data.reviews.length === 0) {
      container.innerHTML =
        '<p style="text-align:center; color:var(--text-muted); padding:30px;">No reviews yet. Share the QR code for customers to leave feedback!</p>';
      return;
    }

    container.innerHTML = data.reviews
      .map(
        (r) => `
            <div style="background:rgba(255,255,255,0.02); border:1px solid var(--border); border-radius:10px; padding:16px; margin-bottom:12px;">
                <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:8px;">
                    <div>
                        <div style="color:#F59E0B; font-size:1.1rem;">${"\u2605".repeat(r.rating)}${"\u2606".repeat(5 - r.rating)}</div>
                        <div style="font-weight:600; margin-top:4px;">${r.reviewer_name || "Anonymous"}</div>
                        <div style="font-size:0.75rem; color:var(--text-muted);">${new Date(r.created_at).toLocaleString()}</div>
                    </div>
                    <button class="secondary-btn" style="font-size:0.8rem; padding:6px 12px; ${r.published ? "color:var(--success); border-color:var(--success);" : ""}" onclick="toggleReviewPublish(${r.id}, this)">
                        ${r.published ? '<i class="fa-solid fa-check"></i> Published' : "Publish to Dash"}
                    </button>
                </div>
                <p style="font-size:0.9rem; line-height:1.4; color:var(--text); white-space:pre-wrap;">${escapeHTML(r.review_text)}</p>
            </div>
        `,
      )
      .join("");
  } catch (e) {
    console.error("[loadReviews exception]", e);
    container.innerHTML = `<p style="text-align:center; color:var(--danger); padding:30px;"><i class="fa-solid fa-circle-exclamation"></i> Error loading reviews<br><code style="font-size:0.72rem;opacity:0.7;">${e.message}</code></p>`;
  }
}

async function toggleReviewPublish(id, btn) {
  const originalHtml = btn.innerHTML;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
  btn.disabled = true;

  try {
    const res = await fetchAuth(`${API_URL}/reviews/${id}/publish`, {
      method: "POST",
    });
    if (!res.ok) throw new Error("Failed");
    const data = await res.json();

    if (data.published) {
      btn.innerHTML = '<i class="fa-solid fa-check"></i> Published';
      btn.style.color = "var(--success)";
      btn.style.borderColor = "var(--success)";
    } else {
      btn.innerHTML = "Publish to Dash";
      btn.style.color = "";
      btn.style.borderColor = "";
    }
  } catch (e) {
    btn.innerHTML = originalHtml;
    showToast("Error updating status", "danger");
  } finally {
    btn.disabled = false;
  }
}

async function downloadCompanyArchive() {
  const btn = document.getElementById("btn-download-archive");
  const status = document.getElementById("archive-status");
  btn.disabled = true;
  btn.innerHTML =
    '<i class="fa-solid fa-spinner fa-spin"></i> Generating archive...';
  status.textContent = "Please wait, compiling records...";
  try {
    const res = await fetchAuth(`${API_URL}/documents/archive`);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      showToast(err.error || "Failed to generate archive.", "danger");
      status.textContent = "Error generating archive.";
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `company_archive_${new Date().toISOString().slice(0, 10)}.zip`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    status.textContent = "✅ Archive downloaded successfully!";
    showToast("Company archive downloaded!", "success");
  } catch (e) {
    console.error(e);
    showToast("Network error while generating archive.", "danger");
    status.textContent = "Network error.";
  } finally {
    btn.disabled = false;
    btn.innerHTML =
      '<i class="fa-solid fa-file-zipper"></i> Download Company Archive (.zip)';
  }
}

async function loadEmployeePermissions() {
  const tbody = document.getElementById("emp-permissions-tbody");
  if (!tbody) return;
  tbody.innerHTML =
    '<tr><td colspan="13" style="text-align:center;padding:20px;"><i class="fa-solid fa-spinner fa-spin"></i> Loading...</td></tr>';
  try {
    const res = await fetchAuth(`${API_URL}/employees`);
    const data = await res.json();
    const employees = data.employees || [];
    if (employees.length === 0) {
      tbody.innerHTML =
        '<tr><td colspan="13" style="text-align:center;color:var(--text-muted);">No employees found.</td></tr>';
      return;
    }
    tbody.innerHTML = "";
    const PERMS = [
      "can_see_dashboard",
      "can_see_hr",
      "can_see_attendance",
      "can_see_sme",
      "can_see_pos",
      "can_see_secretary",
      "can_see_transport",
      "can_see_hardware",
      "can_see_system_users",
      "can_see_schedules",
    ];
    employees.forEach((emp) => {
      const tr = document.createElement("tr");
      const checkboxes = PERMS.map(
        (p) => `
                <td style="text-align:center;">
                    <input type="checkbox" ${emp[p] ? "checked" : ""}
                        onchange="updateEmployeePermission(${emp.id}, '${p}', this.checked, this)"
                        title="${p.replace("can_see_", "").replace("_", " ")}">
                </td>
            `,
      ).join("");
      tr.innerHTML = `
                <td style="font-weight:600;font-size:0.85rem;">${emp.employee_code || emp.id}</td>
                <td>${emp.first_name} ${emp.last_name}</td>
                <td><span style="background:var(--primary);color:#fff;padding:2px 8px;border-radius:20px;font-size:0.75rem;">${emp.role || "-"}</span></td>
                ${checkboxes}
            `;
      tbody.appendChild(tr);
    });
  } catch (e) {
    tbody.innerHTML =
      '<tr><td colspan="13" style="color:red;text-align:center;">Failed to load employees.</td></tr>';
    console.error("loadEmployeePermissions error:", e);
  }
}

async function updateEmployeePermission(empId, permKey, isChecked, checkboxEl) {
  if (checkboxEl) checkboxEl.disabled = true;
  try {
    // Only send the single key that changed — server will update just that column
    const payload = {};
    payload[permKey] = isChecked ? 1 : 0;
    const res = await fetchAuth(`${API_URL}/employees/${empId}/permissions`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const result = await res.json();
    if (!res.ok) throw new Error(result.error || "Failed");
    showToast(
      `✅ Permission updated. Ask them to re-login to see changes.`,
      "success",
    );
  } catch (e) {
    showToast("Failed to update permission.", "error");
    if (checkboxEl) checkboxEl.checked = !isChecked; // Revert checkbox
    console.error("updateEmployeePermission error:", e);
  } finally {
    if (checkboxEl) checkboxEl.disabled = false;
  }
}

// ==== POS EXPENSES ====

async function handlePOSExpenseSubmit(e) {
  e.preventDefault();
  const btn = e.submitter || e.target.querySelector('[type="submit"]');
  if (btn) {
    btn.disabled = true;
    btn.textContent = "Saving...";
  }

  const amount = parseFloat(document.getElementById("pos-exp-amount").value);
  const category = document.getElementById("pos-exp-category").value;
  const desc = document.getElementById("pos-exp-desc").value.trim();

  if (!amount || amount <= 0) {
    showToast(`Please enter a valid amount.`, "danger");
    if (btn) {
      btn.disabled = false;
      btn.textContent = "Record Expense";
    }
    return;
  }

  try {
    const res = await fetchAuth(`${API_URL}/transactions`, {
      method: "POST",
      body: JSON.stringify({
        amount,
        type: "EXPENSE",
        description: `${category} | ${desc}`,
      }),
    });

    if (res.ok) {
      showToast(
        `Expense of UGX ${amount.toLocaleString()} recorded.`,
        "success",
      );
      e.target.reset();
      loadDashboard(); // Refresh financial intelligence cards
    } else {
      const data = await res.json();
      showToast(data.error || "Failed to save expense.", "danger");
    }
  } catch (err) {
    console.error("Expense Submit Error:", err);
    showToast("Network error. Please check server.", "danger");
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = "Record Expense";
    }
  }
}

async function saveBusinessConfig() {
  const config = {
    days: Array.from(
      document.querySelectorAll("#config-days input:checked"),
    ).map((i) => i.value),
    hoursPerShift: document.getElementById("config-shift-hours").value,
    openingTime: document.getElementById("config-open-time").value,
    staffing: {},
  };
  document.querySelectorAll(".staff-req").forEach((i) => {
    config.staffing[i.getAttribute("data-role")] = i.value;
  });

  try {
    const res = await fetchAuth(`${API_URL}/settings`, {
      method: "POST",
      body: JSON.stringify({ key: "BUSINESS_BLUEPRINT", data: config }),
    });
    if (res.ok) alert("Master Configuration Saved Successfully!");
    else alert("Failed to save configuration.");
  } catch (e) {
    console.error("Config Save Error:", e);
  }
}

async function loadBusinessConfig() {
  try {
    // First, fetch roles to build the dynamic staffing list
    const rolesRes = await fetchAuth(`${API_URL}/roles`);
    const rolesData = await rolesRes.json();
    const roles = rolesData.roles;

    const staffingContainer = document.getElementById(
      "config-staffing-dynamic",
    );
    if (staffingContainer) {
      staffingContainer.innerHTML = "";
      roles.forEach((r) => {
        const div = document.createElement("div");
        div.className = "form-group";
        div.style =
          "display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;";
        div.innerHTML = `
                    <div style="display:flex; align-items:center; gap:10px;">
                        <button class="sm-btn danger" onclick="deleteRoleBlueprint('${r.role_name}')" title="Delete Role"><i class="fa-solid fa-xmark"></i></button>
                        <label>${r.role_name}</label>
                    </div>
                    <input type="number" class="staff-req" data-role="${r.role_name}" value="0" style="width: 60px; background: var(--surface); border: 1px solid var(--border); color: var(--text); padding: 5px; border-radius: 4px;">
                `;
        staffingContainer.appendChild(div);
      });
    }

    // Now fetch actual settings
    const res = await fetchAuth(`${API_URL}/settings`);
    const data = await res.json();
    const config = data.settings ? data.settings["BUSINESS_BLUEPRINT"] : null;
    if (!config) return;

    // Populate days
    document.querySelectorAll("#config-days input").forEach((i) => {
      i.checked = config.days ? config.days.includes(i.value) : false;
    });
    // Populate hours/times
    if (document.getElementById("config-shift-hours"))
      document.getElementById("config-shift-hours").value =
        config.hoursPerShift || 8;
    if (document.getElementById("config-open-time"))
      document.getElementById("config-open-time").value =
        config.openingTime || "08:00";

    // Populate dynamic staffing counts
    document.querySelectorAll(".staff-req").forEach((i) => {
      const role = i.getAttribute("data-role");
      if (config.staffing && config.staffing[role])
        i.value = config.staffing[role];
    });
  } catch (e) {
    console.error("Config Load Error:", e);
  }
}

async function addNewRoleBlueprint() {
  const name = document.getElementById("new-role-name").value.trim();
  if (!name) return alert("Enter a role name");

  try {
    const res = await fetchAuth(`${API_URL}/roles`, {
      method: "POST",
      body: JSON.stringify({ name }),
    });
    if (res.ok) {
      alert("Role added successfully!");
      document.getElementById("new-role-name").value = "";
      loadBusinessConfig();
      loadRoles();
    } else {
      const data = await res.json();
      alert("Fail: " + (data.error || "Invalid request"));
    }
  } catch (e) {
    console.error("Role Add Error:", e);
  }
}

async function deleteRoleBlueprint(roleName) {
  if (
    !confirm(
      `Delete role "${roleName}"? This will affect all staff assigned to this role.`,
    )
  )
    return;
  try {
    const res = await fetchAuth(`${API_URL}/roles/${roleName}`, {
      method: "DELETE",
    });
    if (res.ok) {
      loadBusinessConfig();
      loadRoles();
    }
  } catch (e) {
    console.error("Role Delete Error:", e);
  }
}

// ==== DASHBOARD LOGIC ====
// Navigate to HR Payroll tab (called from Upcoming Pay names)
window.goToPayroll = function () {
  const hrBtn = document.querySelector('[data-target="hr-mgmt"]');
  if (hrBtn) hrBtn.click();
  setTimeout(() => {
    if (typeof switchHRView === "function") switchHRView("payroll");
  }, 200);
};

async function loadUpcomingPay() {
  try {
    const res = await fetch(`${API_URL}/employees/upcoming-pay`, {
      headers: {
        Authorization: `Bearer ${localStorage.getItem("jomish_token")}`,
      },
    });
    if (res.ok) {
      const data = await res.json();
      const countEl = document.getElementById("upcoming-pay-count");
      const panel = document.getElementById("upcoming-pay-panel");
      const itemsDiv = document.getElementById("upcoming-pay-items");
      if (countEl) countEl.textContent = data.length;
      if (data.length > 0) {
        if (panel) panel.classList.remove("hidden");
        if (itemsDiv)
          itemsDiv.innerHTML = data
            .map(
              (e) => `
                    <div style="background: white; padding: 12px; border-radius: 8px; border: 1px solid var(--border); flex: 1 1 200px; display:flex; justify-content:space-between; align-items:center; transition: all 0.2s; cursor: pointer; box-shadow: 0 2px 4px rgba(0,0,0,0.02);" onclick="goToPayroll()" onmouseover="this.style.borderColor='var(--primary)'; this.style.transform='translateY(-2px)';" onmouseout="this.style.borderColor='var(--border)'; this.style.transform='none';">
                        <div>
                            <div style="font-weight: bold; color: var(--text); font-size:0.95rem;">${e.first_name} ${e.last_name}</div>
                            <div style="font-size: 0.8rem; color: var(--text-muted); margin-top:3px;">${e.role} - Due: ${new Date(e.next_pay_date).toLocaleDateString()}</div>
                        </div>
                        <button class="primary-btn sm-btn" style="pointer-events:none;"><i class="fa-solid fa-money-check-dollar"></i> Pay</button>
                    </div>`,
            )
            .join("");
      } else {
        if (panel) panel.classList.add("hidden");
      }
    }
  } catch (e) {
    console.error("Upcoming pay error:", e);
  }
}

async function loadDashboard() {
  startLiveClock();

  // 1. Warm up the database with a single lightweight query to avoid connection storms (thundering herd)
  await loadPresenceSummary();

  // 2. Once the DB connection pool is warm, load the rest concurrently
  // NOTE: loadDayTimetable is assigned to window.loadDayTimetable by the IIFE at the bottom of this file.
  Promise.all([
    loadHardwareRadar(),
    loadFinanceIntelligence(),
    loadUpcomingPay(),
    loadLowStockAlerts(),
    loadDeskMessages(),
    loadPublishedReviews(),
  ]).catch((err) => console.error("Dashboard load error:", err));

  startRadarAutoRefresh(); // Start 30-second auto-refresh for the hardware radar
}

async function loadPublishedReviews() {
  const list = document.getElementById("dash-reviews-list");
  if (!list) return;
  try {
    const res = await fetch(`${API_URL}/reviews/published`);
    if (!res.ok) throw new Error("Failed to load dashboard reviews");
    const data = await res.json();
    if (!data.reviews || data.reviews.length === 0) {
      list.innerHTML =
        '<p style="color:var(--text-muted); font-size:0.85rem;">No reviews published yet.</p>';
      return;
    }

    list.innerHTML = data.reviews
      .map(
        (r) => `
            <div style="background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.1); border-radius:12px; padding:16px; min-width:280px; max-width:320px; flex-shrink:0; display:flex; flex-direction:column; gap:8px;">
                <div style="display:flex; justify-content:space-between; align-items:flex-start;">
                    <div style="color:#F59E0B; font-size:1.1rem; letter-spacing:2px;">${"★".repeat(r.rating)}${"☆".repeat(5 - r.rating)}</div>
                    <div style="font-size:0.7rem; color:var(--text-muted);">${new Date(r.created_at).toLocaleDateString()}</div>
                </div>
                <div style="font-weight:700; color:var(--text); font-size:0.95rem;">${r.reviewer_name || "Anonymous"}</div>
                <p style="font-size:0.85rem; line-height:1.4; color:var(--text-muted); white-space:pre-wrap; flex-grow:1; margin:0;">"${escapeHTML(r.review_text)}"</p>
            </div>
        `,
      )
      .join("");
  } catch (e) {
    list.innerHTML =
      '<p style="color:var(--danger); font-size:0.85rem;">Error loading reviews.</p>';
    console.error(e);
  }
}

async function loadPresenceSummary() {
  try {
    const res = await fetchAuth(`${API_URL}/attendance/summary`);
    const data = await res.json();
    document.getElementById("stat-present-count").innerText = data.present;
    document.getElementById("stat-sick-count").innerText = data.sick;
    document.getElementById("stat-total-count").innerText = data.total;
  } catch (e) {
    console.error("Presence intelligence failure", e);
  }
}

// ==== HARDWARE RADAR LOGIC ====
// Robustly parse a SQLite datetime string (with or without T/Z) into a JS Date.
function safeParseDate(str) {
  if (!str) return null;
  const s = String(str).trim();
  // Already valid ISO with Z or +offset — parse directly
  if (/Z$|[+-]\d{2}:\d{2}$/.test(s)) return new Date(s);
  // SQLite format: "YYYY-MM-DD HH:MM:SS" — treat as UTC
  const normalized = s.replace(" ", "T") + "Z";
  const d = new Date(normalized);
  return isNaN(d.getTime()) ? new Date(s) : d;
}
function registerDevice() {
  let devId = localStorage.getItem("jomish_device_id");
  if (!devId) {
    devId =
      "JOM-DEV-" + Math.random().toString(36).substring(2, 9).toUpperCase();
    localStorage.setItem("jomish_device_id", devId);
  }

  const devName =
    navigator.platform + " (" + (navigator.vendor || "Generic") + ")";
  const devType = /Mobile|Android|iPhone/i.test(navigator.userAgent)
    ? "MOBILE"
    : "TERMINAL";

  // Initial Ping
  pingDevice(devId, devName, devType);

  // Continuous Heartbeat (every 30s)
  setInterval(() => pingDevice(devId, devName, devType), 30000);
}

// ==== DEVICE MANAGEMENT ====
async function loadDevices() {
  const tbody = document.querySelector("#connected-devices-table tbody");
  if (!tbody) return;
  tbody.innerHTML =
    '<tr><td colspan="6" style="text-align:center; padding:20px; color:#94A3B8;">Loading devices...</td></tr>';

  try {
    const res = await fetchAuth(`${API_URL}/devices`);
    const data = await res.json();
    tbody.innerHTML = "";

    if (!data.devices || data.devices.length === 0) {
      tbody.innerHTML =
        '<tr><td colspan="6" style="text-align:center; padding:20px; color:#94A3B8;">No devices connected.</td></tr>';
      return;
    }

    data.devices.forEach((d) => {
      const lastSeen = safeParseDate(d.last_seen);
      const isOnline = lastSeen && new Date() - lastSeen < 120000;
      const lastSeenStr = lastSeen
        ? lastSeen.toLocaleString("en-UG", {
            day: "2-digit",
            month: "short",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
          })
        : "Never";
      const statusBadge = isOnline
        ? '<span style="background:var(--success);color:white;padding:3px 8px;border-radius:12px;font-size:0.75rem;">&#x25CF; ONLINE</span>'
        : '<span style="background:var(--danger);color:white;padding:3px 8px;border-radius:12px;font-size:0.75rem;">&#x25CF; OFFLINE</span>';

      const myDevId = localStorage.getItem("jomish_device_id");
      const isMe =
        d.device_id === myDevId
          ? ' <b style="color:var(--primary);">(This Device)</b>'
          : "";

      const tr = document.createElement("tr");
      tr.innerHTML = `
                <td>${d.device_name}${isMe}</td>
                <td>${d.device_type}</td>
                <td style="font-family:monospace;">${d.ip_address || "—"}</td>
                <td>${statusBadge}</td>
                <td>${lastSeenStr}</td>
                <td>
                    <button class='sm-btn danger' onclick="kickDevice('${d.device_id}')"><i class="fa-solid fa-right-from-bracket"></i> Force Logout</button>
                </td>
            `;
      tbody.appendChild(tr);
    });
  } catch (e) {
    console.error("Failed to load devices:", e);
    tbody.innerHTML =
      '<tr><td colspan="6" style="text-align:center; padding:20px; color:var(--danger);">Error loading devices</td></tr>';
  }
}

async function kickDevice(deviceId) {
  if (!confirm("Force this device to log out and disconnect?")) return;

  try {
    const res = await fetchAuth(`${API_URL}/devices/logout`, {
      method: "POST",
      body: JSON.stringify({ device_id: deviceId }),
    });
    if (res.ok) {
      showToast("Device logged out.", "success");
      loadDevices();
    } else {
      showToast("Failed to log out device.", "danger");
    }
  } catch (e) {
    console.error("Kick device error:", e);
  }
}

async function loadFinanceIntelligence() {
  const panel = document.querySelector(".finance-intel");
  // Only CEO, HR, Manager, Tech, Admin, and System Technician can see Financial Intelligence
  if (!["CEO", "HR", "Manager", "Tech", "Admin", "System Technician"].includes(USER_ROLE)) {
    if (panel) panel.style.display = "none";
    return;
  }
  if (panel) panel.style.display = "block";

  try {
    const res = await fetchAuth(`${API_URL}/finance/summary?t=${Date.now()}`);
    const data = await res.json();

    const updateCard = (prefix, values) => {
      const incomeEl = document.getElementById(`fi-${prefix}-income`);
      const expenseEl = document.getElementById(`fi-${prefix}-expense`);
      const profitEl = document.getElementById(`fi-${prefix}-profit`);

      if (incomeEl)
        incomeEl.innerText = `UGX ${(values.income || 0).toLocaleString()}`;
      if (expenseEl)
        expenseEl.innerText = `UGX ${(values.expense || 0).toLocaleString()}`;
      if (profitEl) {
        profitEl.innerText = `UGX ${(values.profit || 0).toLocaleString()}`;
        profitEl.style.color =
          (values.profit || 0) >= 0 ? "#10B981" : "#EF4444";
      }
    };

    updateCard("today", data.today);
    updateCard("week", data.week);
    updateCard("month", data.month);
    updateCard("total", data.allTime);

    // Show the "as of" timestamp so the user knows data is current
    const asOfEl = document.getElementById("fi-as-of");
    if (asOfEl && data.asOf) asOfEl.innerText = `Updated: ${data.asOf}`;

    if (data._debug) {
    }
  } catch (e) {
    console.error("Finance Intel Error:", e);
  }
}

async function loadLowStockAlerts() {
  try {
    const res = await fetchAuth(`${API_URL}/alerts/low-stock`);
    const data = await res.json();
    const panel = document.getElementById("low-stock-panel");
    const count = document.getElementById("low-stock-count");
    const list = document.getElementById("low-stock-items");

    if (!data.alerts || data.alerts.length === 0) {
      panel.classList.add("hidden");
      return;
    }

    panel.classList.remove("hidden");
    count.innerText = data.alerts.length;
    list.innerHTML = "";

    data.alerts.forEach((p) => {
      const badge = document.createElement("div");
      badge.style =
        "background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.2); padding: 5px 12px; border-radius: 6px; font-size: 0.8rem; display: flex; align-items: center; gap: 8px;";
      badge.innerHTML = `
                <span style="font-weight: bold; color: #EF4444;">${p.name}</span>
                <span style="color: #94A3B8;">Qty: ${p.stock}</span>
                <button class="sm-btn primary" onclick="const q=parseInt(prompt('How many units to add for ${p.name.replace(/'/g, "\\'")}?','10')); if(q>0) restockProduct(${p.id}, q);" style="padding: 2px 8px; font-size: 0.7rem;">Restock</button>
            `;
      list.appendChild(badge);
    });
  } catch (e) {
    console.error("Alerts Error:", e);
  }
}

// Try to get local LAN IP via WebRTC (best effort, may be blocked in some browsers)
async function getLocalIP() {
  return new Promise((resolve) => {
    try {
      const pc = new RTCPeerConnection({ iceServers: [] });
      pc.createDataChannel("");
      pc.createOffer().then((offer) => pc.setLocalDescription(offer));
      const timer = setTimeout(() => {
        pc.close();
        resolve(null);
      }, 2000);
      pc.onicecandidate = (e) => {
        if (!e.candidate) return;
        const match = /(\d{1,3}(?:\.\d{1,3}){3})/.exec(e.candidate.candidate);
        if (match && !match[1].startsWith("169.254")) {
          clearTimeout(timer);
          pc.close();
          resolve(match[1]);
        }
      };
    } catch {
      resolve(null);
    }
  });
}

async function pingDevice(device_id, device_name, device_type) {
  try {
    const prefix = localStorage.getItem("jomish_prefix");
    const company_schema = prefix ? "t_" + prefix.toLowerCase() : "public";
    const client_ip = await getLocalIP();
    await fetch(`${API_URL}/devices/ping`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        device_id,
        device_name,
        device_type,
        company_schema,
        client_ip,
      }),
    });
  } catch (e) {
    console.error("Radar Ping Error:", e);
  }
}

let _radarInterval = null;
async function loadHardwareRadar() {
  const tbody = document.querySelector("#dash-devices tbody");
  if (!tbody) return;

  try {
    const res = await fetchAuth(`${API_URL}/devices`);
    const data = await res.json();
    tbody.innerHTML = "";

    if (!data.devices || data.devices.length === 0) {
      tbody.innerHTML =
        '<tr><td colspan="5" style="text-align:center; padding:20px;">No hardware detected yet.</td></tr>';
      return;
    }

    data.devices.forEach((d) => {
      const lastActive = safeParseDate(d.last_seen);
      const isOnline = lastActive && new Date() - lastActive < 120000;
      const lastActiveStr = lastActive
        ? lastActive.toLocaleString("en-UG", {
            day: "2-digit",
            month: "short",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
          })
        : "Never";

      const tr = document.createElement("tr");
      tr.innerHTML = `
                <td><code style="background:var(--background); padding:4px 8px; border-radius:4px;">${d.device_id}</code></td>
                <td><strong>${d.device_name}</strong> <br><small style="color:#94A3B8;">${d.device_type}</small></td>
                <td>${d.ip_address || "—"}</td>
                <td>
                    <span class="badge" style="background:${isOnline ? "rgba(16, 185, 129, 0.1)" : "rgba(239, 68, 68, 0.1)"}; color:${isOnline ? "var(--success)" : "var(--danger)"};">
                        ${isOnline ? "&#x25CF; ONLINE" : "&#x25CF; OFFLINE"}
                    </span>
                </td>
                <td>${lastActiveStr}</td>
            `;
      tbody.appendChild(tr);
    });
  } catch (e) {
    console.error("Radar Fetch Error:", e);
  }
}

// Start 30-second auto-refresh for the dashboard radar AND HR Blueprint devices table.
// Guarded against stacking — safe to call from loadDashboard() on every tab switch.
let _devicesInterval = null;
function startRadarAutoRefresh() {
  // Polling removed — now driven purely by Socket.io 'db_updated' push events
}

function startDevicesAutoRefresh() {
  // Polling removed — now driven purely by Socket.io 'db_updated' push events
}

let _liveclockInterval = null;
function startLiveClock() {
  if (window._liveclockInterval) return; // Prevent stacking intervals
  // Tick immediately so clock shows current time right away (not blank for 1s)
  const tickClock = () => {
    const now = new Date().toLocaleTimeString("en-US", { hour12: false });
    const clock1 = document.getElementById("live-clock");
    const clock2 = document.getElementById("live-clock-dash");
    if (clock1) clock1.textContent = now;
    if (clock2) clock2.textContent = now;
  };
  tickClock();
  window._liveclockInterval = setInterval(tickClock, 1000);
}

// loadNotices, toggleNoticeEdit, and saveNotice have been removed and replaced by the Command Notice Board system.


// loadDayTimetable is now handled by the Smart Shift Timetable IIFE at the bottom of this file.
// It is exposed on window and called from initDashboard.

function initSockets() {
  if (typeof io === "undefined") {
    console.warn("Socket.io not loaded. Live sync will be disabled.");
    const statusEl = document.getElementById("live-sync-indicator");
    if (statusEl) {
      statusEl.style.color = "var(--danger)";
      statusEl.innerHTML =
        '<i class="fa-solid fa-circle" style="color: #EF4444;"></i> Offline Mode (No Sync)';
    }
    return;
  }
  // Dynamic connection: automatically use current host/port
  const socket = io({
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    timeout: 20000,
  });
  window._socket = socket; // Expose for sub-modules (Smart Timetable IIFE)

  socket.on("connect", () => {
    const statusEl = document.getElementById("live-sync-indicator");
    if (statusEl) {
      statusEl.style.color = "var(--success)";
      statusEl.innerHTML =
        '<i class="fa-solid fa-circle" style="color: #10B981;"></i> Live Sync Active';
    }

    // Tell the backend who we are so it can route push notifications here
    const userId = localStorage.getItem("jomish_user_id");
    const role = localStorage.getItem("jomish_role");
    const prefix = localStorage.getItem("jomish_prefix") || "public";
    const schema =
      prefix === "public" || prefix === "demo" ? prefix : "t_" + prefix;

    let permissions = {};
    try {
      permissions = JSON.parse(
        localStorage.getItem("jomish_permissions") || "{}",
      );
    } catch (e) {}

    if (userId && role) {
      socket.emit("register_device", {
        user_id: String(userId),
        role,
        schema,
        permissions,
      });
    }
  });

  socket.on("push_notification", (payload) => {
    const title = payload.title || "Jomish Suite";
    const body = payload.body || "New notification";

    // 1. Electron Native Notification
    if (window.electronAPI && window.electronAPI.showNotification) {
      window.electronAPI.showNotification(title, body);
      if (payload.url) {
        window.location.hash = payload.url.replace("/#", "");
      }
      return;
    }

    // 2. Web/Android Fallback Notification
    if ("Notification" in window && Notification.permission === "granted") {
      try {
        // Check for service worker to use persistent Android notification
        navigator.serviceWorker.ready
          .then((registration) => {
            registration.showNotification(title, {
              body: body,
              icon: "/favicon.png",
              data: { url: payload.url },
            });
          })
          .catch(() => {
            // Fallback to standard browser notification
            const n = new Notification(title, { body, icon: "/favicon.png" });
            n.onclick = () => {
              if (payload.url)
                window.location.hash = payload.url.replace("/#", "");
            };
          });
      } catch (e) {
        const n = new Notification(title, { body, icon: "/favicon.png" });
        n.onclick = () => {
          if (payload.url) window.location.hash = payload.url.replace("/#", "");
        };
      }
    }
  });

  socket.on("disconnect", () => {
    const statusEl = document.getElementById("live-sync-indicator");
    if (statusEl) {
      statusEl.style.color = "var(--danger)";
      statusEl.innerHTML =
        '<i class="fa-solid fa-circle" style="color: #EF4444;"></i> Disconnected';
    }
  });

  socket.on("db_updated", (data) => {
    if (data.module === "employees") {
      if (USER_PERMISSIONS.can_see_hr) loadEmployees();
      if (typeof loadUserAccounts === "function") loadUserAccounts();
      if (typeof loadSystemUsers === "function") loadSystemUsers();
    } else if (data.module === "attendance") {
      if (USER_PERMISSIONS.can_see_attendance) {
        loadAttendance();
        loadDashboard();
      }
    } else if (data.module === "transactions") {
      if (USER_PERMISSIONS.can_see_sme) {
        loadTransactions();
        loadDashboard();
      }
    } else if (
      data.module === "schedules" ||
      data.module === "shift_assignments"
    ) {
      // Refresh dashboard timetable always; full grid only if tab is active
      if (typeof window.loadDayTimetable === "function")
        window.loadDayTimetable();
      const section = document.getElementById("schedules");
      if (
        section &&
        section.classList.contains("active") &&
        typeof window.loadShiftTimetable === "function"
      ) {
        window.loadShiftTimetable();
      }
    } else if (data.module === "deliveries") {
      if (typeof loadDeliveries === "function") loadDeliveries();
      if (typeof loadPendingCOD === "function") loadPendingCOD();
    } else if (data.module === "products") {
      cachedProducts = []; // Bust cache so next POS scan fetches fresh data with additional_barcodes
      if (USER_PERMISSIONS.can_see_pos && !window._skipProductReload)
    } else if (data.module === "logo" || data.module === "settings") {
      loadBrandLogo();
      loadBusinessConfig();
    } else if (data.module === "roles") {
      loadRoles();
      loadBusinessConfig();
    } else if (data.module === "messages") {
      loadDeskMessages();
    } else if (data.module === "calendar") {
      if (typeof renderCalendar === "function") renderCalendar();
    } else if (data.module === "emails") {
      if (USER_PERMISSIONS.can_see_secretary) {
        if (typeof fetchGlobalUnreadEmails === "function")
          fetchGlobalUnreadEmails();
        loadEmails();
      }
    } else if (data.module === "reviews") {
      if (typeof loadReviews === "function") loadReviews();
      if (typeof loadPublishedReviews === "function") loadPublishedReviews();
    } else if (data.module === "devices") {
      // Refresh dashboard radar
      loadHardwareRadar();
      // Refresh HR Blueprint devices table if it's present in the DOM
      const devTable = document.querySelector("#connected-devices-table tbody");
      if (devTable) loadDevices();
    }
  });

  // Real-time message notification
  socket.on("new_message", (data) => {
    const myId = parseInt(localStorage.getItem("jomish_user_id"));
    if (data.to_id === myId) {
      showToast(`New message from ${data.from}`, "info");
      loadDeskMessages();
    }
  });

  socket.on("new_review", (data) => {
    if (typeof loadReviews === "function") loadReviews();
    showToast("⭐ New Customer Review received!", "info");
  });

  socket.on("force_logout", (data) => {
    const myDevId = localStorage.getItem("jomish_device_id");
    if (data.device_id === myDevId) {
      alert("Your session has been terminated by the administrator.");
      localStorage.clear();
      window.location.href = "login.html";
    }
  });
}

// Force explicit camera permission prompt before starting
async function requestCameraPermission() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    alert(
      "Camera Access Disabled!\n\nYour browser blocked camera access because this is not a secure (HTTPS) connection.\n\nTo fix on Android/Chrome: Go to chrome://flags, search for 'insecure origins treated as secure', and add this URL.",
    );
    return false;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "environment" },
    });
    // Stop stream immediately so the scanner library can take over
    stream.getTracks().forEach((track) => track.stop());
    return true;
  } catch (err) {
    alert("Camera Permission Denied or Unavailable:\n\n" + err.message);
    return false;
  }
}

async function stopScanner() {
  if (html5QrcodeScanner && isScannerRunning) {
    try {
      await html5QrcodeScanner.stop();
      isScannerRunning = false;
    } catch (e) {
      console.error("Stop error", e);
      // Forced reset if stop fails
      isScannerRunning = false;
    }
  }
}

async function handleAutomatedScan(id) {
  if (!id) return;

  // Visual feedback for successful scan
  const resultsEl = document.getElementById("qr-reader-results");
  resultsEl.innerHTML =
    `<i class="fa-solid fa-magnifying-glass"></i> Processing Code: ` + id;
  resultsEl.style.color = "var(--primary)";

  // Haptic feedback if supported
  if (navigator.vibrate) navigator.vibrate(100);

  try {
    const res = await fetchAuth(`${API_URL}/attendance/scan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identifier: id, scan_type: "AUTO" }),
    });
    const data = await res.json();
    if (res.ok) {
      resultsEl.innerHTML =
        `<i class="fa-solid fa-check"></i> Logged: ` + (data.name || id);
      resultsEl.style.color = "var(--success)";
      loadAttendance();

      // Temporary highlight effect
      const reader = document.getElementById("qr-reader");
      reader.style.borderColor = "var(--success)";
      setTimeout(() => (reader.style.borderColor = "var(--primary)"), 1000);
    } else {
      resultsEl.innerHTML =
        `<i class="fa-solid fa-xmark"></i> ` + (data.error || "Failed");
      resultsEl.style.color = "var(--danger)";
    }
  } catch (e) {
    console.error("Auto scan error:", e);
    resultsEl.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> Network Error`;
    resultsEl.style.color = "var(--danger)";
  }
}

// ==== POS CART STATE ====
let posCart = [];
window.posCart = posCart;
const TAX_RATE = 0.0;

function enforceRBAC() {
  const navDashboard = document.querySelector('[data-target="dashboard"]');
  const navHR = document.querySelector('[data-target="hr-mgmt"]');
  const navSupervision = document.querySelector(
    '[data-target="supervision-hub"]',
  );
  const navSME = document.querySelector('[data-target="sme-business"]');
  const navTransport = document.querySelector('[data-target="transport-hub"]');
  const navSecretary = document.querySelector('[data-target="secretary-hub"]');
  const navTechHub = document.querySelector('[data-target="tech-hub"]');

  const isTech = localStorage.getItem("jomish_name") === "System Technician" || USER_ROLE === "Tech" || USER_ROLE === "System Technician";
  const isDemo = localStorage.getItem("jomish_demo") === "true";

  // ── STRICT ROLE MAPS ─────────────────────────────────────────────────────
  // Each role sees ONLY the tabs listed here.
  // Tech (System Technician) sees everything.
  const ROLE_TAB_MAP = {
    HR: {
      dashboard: true,
      hr: true,
      qr: false,
      schedules: false,
      sme: false,
      pos: false,
      transport: false,
      secretary: false,
      tech: false,
    },
    Supervisor: {
      dashboard: false,
      hr: false,
      qr: true,
      schedules: true,
      sme: false,
      pos: false,
      transport: false,
      secretary: false,
      tech: false,
    },
    CEO: {
      dashboard: true,
      hr: false,
      qr: false,
      schedules: false,
      sme: true,
      pos: false,
      transport: false,
      secretary: false,
      tech: false,
    },
    Cashier: {
      dashboard: false,
      hr: false,
      qr: false,
      schedules: false,
      sme: false,
      pos: true,
      transport: true,
      secretary: false,
      tech: false,
    },
    Transport: {
      dashboard: false,
      hr: false,
      qr: false,
      schedules: false,
      sme: false,
      pos: false,
      transport: true,
      secretary: false,
      tech: false,
    },
    Secretary: {
      dashboard: false,
      hr: false,
      qr: false,
      schedules: false,
      sme: false,
      pos: false,
      transport: false,
      secretary: true,
      tech: false,
    },
    Admin: {
      dashboard: true,
      hr: true,
      qr: true,
      schedules: true,
      sme: true,
      pos: true,
      transport: true,
      secretary: true,
      tech: false,
    },
    Manager: {
      dashboard: true,
      hr: true,
      qr: true,
      schedules: true,
      sme: true,
      pos: true,
      transport: true,
      secretary: true,
      tech: false,
    },
    Tech: {
      dashboard: true,
      hr: true,
      qr: true,
      schedules: true,
      sme: true,
      pos: true,
      transport: true,
      secretary: true,
      tech: true,
    },
    "System Technician": {
      dashboard: true,
      hr: true,
      qr: true,
      schedules: true,
      sme: true,
      pos: true,
      transport: true,
      secretary: true,
      tech: true,
    },
  };

  if (isTech || isDemo) {
    // System Technician and Demo mode sees all tabs
    [
      navDashboard,
      navHR,
      navSupervision,
      navSME,
      navPOS,
      navTransport,
      navSecretary,
    ].forEach((n) => {
      if (n) n.style.display = "block";
    });
    if (navTechHub) navTechHub.style.display = "block";
    if (isDemo) {
      document
        .querySelectorAll(".tech-only")
        .forEach((el) => el.classList.add("hidden"));
    } else {
      document
        .querySelectorAll(".tech-only")
        .forEach((el) => el.classList.remove("hidden"));
    }
    document
      .querySelectorAll(".admin-only")
      .forEach((el) => el.classList.remove("hidden"));
  } else if (ROLE_TAB_MAP[USER_ROLE]) {
    // ── Use per-employee permissions from JWT (set at login from DB) ──────────
    // Fall back to ROLE_TAB_MAP only if no granular permissions exist yet
    const p = USER_PERMISSIONS || window.USER_PERMISSIONS || {};
    const hasPerms = Object.values(p).some(
      (v) => v !== 0 && v !== null && v !== undefined,
    );
    const perms = hasPerms
      ? {
          dashboard: p.can_see_dashboard,
          hr: p.can_see_hr,
          qr: p.can_see_attendance,
          schedules: p.can_see_schedules,
          sme: p.can_see_sme,
          pos: p.can_see_pos,
          transport: p.can_see_transport,
          secretary: p.can_see_secretary,
        }
      : ROLE_TAB_MAP[USER_ROLE]; // fallback to hardcoded map

    if (navDashboard)
      navDashboard.style.display = perms.dashboard ? "block" : "none";
    if (navHR) navHR.style.display = perms.hr ? "block" : "none";
    if (navSupervision)
      navSupervision.style.display =
        perms.qr || perms.schedules ? "block" : "none";
    if (navSME) navSME.style.display = perms.sme ? "block" : "none";
    if (navTransport)
      navTransport.style.display = perms.transport ? "block" : "none";
    if (navSecretary)
      navSecretary.style.display = perms.secretary ? "block" : "none";
    if (navTechHub) navTechHub.style.display = "none";
    document
      .querySelectorAll(".tech-only")
      .forEach((el) => el.classList.add("hidden"));
    // Admin UI elements (add employee button, role matrix) — only HR role can see these
    if (USER_ROLE === "HR") {
      document
        .querySelectorAll(".admin-only")
        .forEach((el) => el.classList.remove("hidden"));
    } else {
      document
        .querySelectorAll(".admin-only")
        .forEach((el) => el.classList.add("hidden"));
    }
  } else {
    // Unknown/fallback role — use USER_PERMISSIONS if available, else show only attendance
    const p = USER_PERMISSIONS;
    if (navDashboard)
      navDashboard.style.display = p.can_see_dashboard ? "block" : "none";
    if (navHR) navHR.style.display = p.can_see_hr ? "block" : "none";
    if (navSupervision)
      navSupervision.style.display =
        p.can_see_attendance || p.can_see_schedules ? "block" : "none";
    if (navSME) navSME.style.display = p.can_see_sme ? "block" : "none";
    if (navTransport)
      navTransport.style.display = p.can_see_transport ? "block" : "none";
    if (navSecretary)
      navSecretary.style.display = p.can_see_secretary ? "block" : "none";
    if (navTechHub) navTechHub.style.display = "none";
    document
      .querySelectorAll(".tech-only")
      .forEach((el) => el.classList.add("hidden"));
    document
      .querySelectorAll(".admin-only")
      .forEach((el) => el.classList.add("hidden"));
  }

  // Demo Mode override — always hide Tech Hub
  // (Handled above in the isTech || isDemo block)

  // Hide admin UI for non-HR/CEO roles
  if (!["CEO", "HR"].includes(USER_ROLE) && !isTech) {
    const roleMatrix = document.getElementById("role-matrix-container");
    const brandMatrix = document.getElementById("brand-settings-container");
    if (roleMatrix) roleMatrix.style.display = "none";
    if (brandMatrix) brandMatrix.style.display = "none";
    const btnAddEmp = document.getElementById("btn-add-employee");
    if (btnAddEmp) btnAddEmp.style.display = "none";
  }

  // Toggle Technician Control Panel
  const techPanel = document.getElementById("technician-panel");
  if (techPanel) {
    if (isTech) techPanel.classList.remove("hidden");
    else techPanel.classList.add("hidden");
  }

  // Auto-navigate to first visible tab if current tab is now hidden
  const firstVisible = [
    navDashboard,
    navHR,
    null,
    null,
    navSME,
    navPOS,
    navTransport,
    navSecretary,
    navTechHub,
  ].find((btn) => btn && btn.style.display !== "none");
  const activeSection = document.querySelector(".view-section.active");
  if (activeSection && firstVisible) {
    const activeId = activeSection.id;
    const activeBtn = document.querySelector(
      '[data-target="' + activeId + '"]',
    );
    if (!activeBtn || activeBtn.style.display === "none") {
      firstVisible.click();
    }
  } else if (firstVisible && !activeSection) {
    firstVisible.click();
  }

  // POS Specific RBAC
  const btnPosStock = document.getElementById("pos-nav-stock");
  if (btnPosStock) {
    const canSeeStock =
      ["CEO", "HR", "Supervisor", "Manager", "Cashier"].includes(USER_ROLE) ||
      isTech;
    btnPosStock.style.display = canSeeStock ? "block" : "none";
  }

  // Show/Hide buying price inputs (CEO and HR only)
  const canSeeAdminStuff = ["CEO", "HR"].includes(USER_ROLE) || isTech;
  const addBuyingPriceGroup =
    document.getElementById("prod-buying-price")?.parentElement;
  if (addBuyingPriceGroup)
    addBuyingPriceGroup.style.display = canSeeAdminStuff ? "block" : "none";
  const editBuyingPriceGroup = document.getElementById(
    "edit-prod-buying-price",
  )?.parentElement;
  if (editBuyingPriceGroup)
    editBuyingPriceGroup.style.display = canSeeAdminStuff ? "block" : "none";
}

async function fetchAuth(url, options = {}) {
  const token = localStorage.getItem("jomish_token");
  if (!options.headers) options.headers = {};

  // Only attach a real token — never send the offline sentinel to the server
  if (token && token !== "OFFLINE_MODE") {
    options.headers["Authorization"] = `Bearer ${token}`;
  }

  // Automatically add JSON header if there is a body and it's not already set
  if (options.body && !options.headers["Content-Type"]) {
    options.headers["Content-Type"] = "application/json";
  }

  if (
    localStorage.getItem("jomish_demo") === "true" &&
    options.method &&
    !["GET", "OPTIONS"].includes(options.method.toUpperCase())
  ) {
    // Silently mock success without throwing errors or toasts
    return new Response(
      JSON.stringify({
        success: true,
        message: "Demo mode simulated action",
        id: Date.now(),
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  const method = (options.method || "GET").toUpperCase();
  const isOfflineMode = !navigator.onLine || token === "OFFLINE_MODE";

  // --- OFFLINE LOGIC ---
  if (isOfflineMode && window.OfflineDB) {
    if (method === "GET") {
      const cachedData = await window.OfflineDB.getCachedApiResponse(url);
      if (cachedData) {
        return new Response(JSON.stringify(cachedData), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      throw new Error("Offline and no cached data available for " + url);
    } else if (["POST", "PUT", "PATCH", "DELETE"].includes(method)) {
      // Extract headers and serialized body from options so the mutation can be
      // replayed correctly by syncOfflineMutations() on reconnect.
      const qHeaders = options.headers || {};
      const qBody =
        options.body !== undefined
          ? typeof options.body === "string"
            ? options.body
            : JSON.stringify(options.body)
          : undefined;
      await window.OfflineDB.queueMutation(method, url, qHeaders, qBody);
      showToast(
        "Offline Mode: Action queued and will sync when online.",
        "info",
      );
      return new Response(
        JSON.stringify({
          success: true,
          message: "Offline queued action",
          offlineQueued: true,
          id: Date.now(),
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    }
  }

  try {
    const res = await fetch(url, options);
    if (res.status === 401) {
      // Don't redirect if we're in offline mode — the sentinel has no session to expire
      if (
        token === "OFFLINE_MODE" ||
        localStorage.getItem("jomish_offline_mode") === "true"
      ) {
        console.warn("[Auth] 401 ignored in offline mode.");
        return res;
      }
      try {
        await fetch(`${API_URL}/logout`, { method: "POST" });
      } catch (e) {}
      localStorage.clear();
      window.location.href = "login.html?reason=session_expired";
    }

    // If GET request is successful, clone and cache it
    if (method === "GET" && res.ok && window.OfflineDB) {
      const clone = res.clone();
      clone
        .json()
        .then((data) => {
          window.OfflineDB.cacheApiResponse(url, data);
        })
        .catch(() => {}); // Ignore parse errors for caching
    }

    return res;
  } catch (e) {
    console.error("[Offline/Network Error]", e.message, url);
    // Fallback for fetch failure even if navigator.onLine was technically true
    if (method === "GET" && window.OfflineDB) {
      const cachedData = await window.OfflineDB.getCachedApiResponse(url);
      if (cachedData) {
        return new Response(JSON.stringify(cachedData), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
    }
    throw e; // Re-throw so callers can handle with their own try/catch
  }
}
window.fetchAuth = fetchAuth;

async function loadEmployees() {
  if (USER_ROLE === "Security") return;
  try {
    const res = await fetchAuth(`${API_URL}/employees`);
    const data = await res.json();
    // Cache employees globally so shift modal can use them as fallback
    if (data.employees && data.employees.length > 0) {
      window.EMPLOYEES_CACHE = data.employees;
    }
    const tbody = document.querySelector("#employees-table tbody");
    tbody.innerHTML = "";
    data.employees.forEach((emp) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
                <td>ID-${emp.id}</td>
                <td>
                    <div style="display:flex; align-items:center; gap:10px;">
                        <div style="width:10px; height:10px; border-radius:50%; background:${emp.is_present ? "#10B981" : "#EF4444"};"></div>
                        <span>${emp.first_name} ${emp.last_name}</span>
                        ${emp.is_sick ? '<span style="font-size:0.6rem; background:#fee2e2; color:#ef4444; padding:2px 6px; border-radius:4px;">SICK</span>' : ""}
                        ${emp.is_suspended ? '<span style="font-size:0.6rem; background:var(--danger); color:white; padding:2px 6px; border-radius:4px;">SUSPENDED</span>' : ""}
                    </div>
                </td>
                <td>${emp.email || "-"}</td>
                <td>${emp.role}</td>
                <td>${emp.department || "-"}</td>
                <td>UGX ${emp.salary ? emp.salary.toLocaleString() : "0"}</td>
                <td>
                    <div style="display:flex; flex-wrap:wrap; gap:4px; min-width:160px;">
                        <button class="sm-btn success" onclick="generateIDCard(${JSON.stringify(emp).replace(/"/g, "&quot;")})">ID Card</button>
                        <button class="sm-btn secondary" onclick="openEmployeeNotes(${emp.id}, '${emp.first_name}')">Notes</button>
                        ${
                          [
                            "CEO",
                            "HR",
                            "Supervisor",
                            "Manager",
                            "System Technician",
                          ].includes(USER_ROLE)
                            ? `
                            <button class="sm-btn ${emp.is_sick ? "success" : "danger"}" onclick="toggleSick(${emp.id}, ${emp.is_sick ? 0 : 1})">
                                ${emp.is_sick ? "Mark Healthy" : "Report Sick"}
                            </button>
                            ${
                              ["CEO", "HR", "System Technician"].includes(
                                USER_ROLE,
                              )
                                ? `
                                <button class='sm-btn primary' onclick="openPassModal(${JSON.stringify(emp).replace(/"/g, "&quot;")})" title="Edit Access, Role, and Termination"><i class="fa-solid fa-key"></i> Edit Access</button>
                                <button class='sm-btn secondary' onclick="generatePasswordResetLink(${emp.id})" title="Generate Reset Link"><i class="fa-solid fa-link"></i> Password Reset</button>
                            `
                                : ""
                            }
                        `
                            : ""
                        }
                    </div>
                </td>
            `;
      tbody.appendChild(tr);
    });
  } catch (e) {
    console.error(e);
  }
}

async function deleteEmployee(id) {
  const confirmed = confirm(
    "  TERMINATION CONFIRMATION\n\n" +
      "This action will:\n" +
      "  • Deactivate the employee record\n" +
      "  • Permanently revoke their ID / QR access\n" +
      "  • DELETE their system login (username & password)\n\n" +
      "The fired employee will be IMMEDIATELY locked out.\n" +
      "This cannot be undone. Proceed?",
  );
  if (!confirmed) return;

  try {
    const res = await fetchAuth(`${API_URL}/employees/${id}`, {
      method: "DELETE",
    });
    const data = await res.json();
    if (res.ok) {
      showToast(
        `Employee terminated. ID revoked & login access permanently deleted.`,
        "success",
      );
      loadEmployees();
      loadDashboard();
      document.getElementById("set-password-modal").classList.add("hidden");
    } else {
      showToast(
        data.error || "Failed to terminate employee" || "An error occurred",
        "danger",
      );
    }
  } catch (e) {
    console.error(e);
    showToast(`Network error. Please check server connection.`, "danger");
  }
}

async function generatePasswordResetLink(empId) {
  try {
    const res = await fetchAuth(
      `${API_URL}/employees/${empId}/generate-reset-link`,
      { method: "POST" },
    );
    const data = await res.json();
    if (res.ok) {
      const link = window.location.origin + data.link;

      // Try native Share sheet first (great on mobile)
      if (navigator.share) {
        await navigator.share({
          title: "Password Reset Link",
          text: "Use this link to reset your Jomish login password (valid 24 hours):",
          url: link,
        });
        showToast("Reset link shared!", "success");
      } else {
        // Fallback: copy to clipboard
        await navigator.clipboard.writeText(link);
        showToast(
          "✅ Reset link copied to clipboard! Share it securely with the employee.",
          "success",
        );
      }
    } else {
      showToast(data.error || "Failed to generate link", "danger");
    }
  } catch (e) {
    if (e.name === "AbortError") return; // user dismissed share sheet — not an error
    console.error(e);
    showToast("Network error while generating reset link.", "danger");
  }
}

async function handleSuspendAccount() {
  const id = document.getElementById("pass-emp-id").value;
  if (!id) return;
  if (
    !confirm(
      "Suspend this account? The employee will be immediately locked out until restored.",
    )
  )
    return;

  try {
    const res = await fetchAuth(`${API_URL}/employees/${id}/suspend`, {
      method: "PATCH",
    });
    if (res.ok) {
      showToast("Account suspended successfully.", "success");
      document.getElementById("set-password-modal").classList.add("hidden");
      loadEmployees();
    } else {
      const err = await res.json();
      alert(err.error || "Failed to suspend account.");
    }
  } catch (e) {
    console.error(e);
  }
}

async function handleRestoreAccount() {
  const id = document.getElementById("pass-emp-id").value;
  if (!id) return;
  if (
    !confirm(
      "Restore this account? The employee will regain login access immediately.",
    )
  )
    return;

  try {
    const res = await fetchAuth(`${API_URL}/employees/${id}/unsuspend`, {
      method: "PATCH",
    });
    if (res.ok) {
      showToast("Account restored successfully.", "success");
      document.getElementById("set-password-modal").classList.add("hidden");
      loadEmployees();
    } else {
      const err = await res.json();
      alert(err.error || "Failed to restore account.");
    }
  } catch (e) {
    console.error(e);
  }
}

async function handleDeleteAccount() {
  const id = document.getElementById("pass-emp-id").value;
  if (id) deleteEmployee(id);
}

// ―――― Toast Notification Helper ―――――――――――――――――――――――――――――――――――――――――――――――――――――――
function showToast(message, type = "success") {
  // Remove any existing toast
  const old = document.getElementById("jomish-toast");
  if (old) old.remove();

  const colors = {
    success: {
      bg: "rgba(16,185,129,0.15)",
      border: "#10B981",
      text: "#6EE7B7",
    },
    danger: { bg: "rgba(239,68,68,0.15)", border: "#EF4444", text: "#FCA5A5" },
    warning: {
      bg: "rgba(245,158,11,0.15)",
      border: "#F59E0B",
      text: "#FCD34D",
    },
    info: { bg: "rgba(99,102,241,0.15)", border: "#6366F1", text: "#A5B4FC" },
  };
  const c = colors[type] || colors.info;

  const toast = document.createElement("div");
  toast.id = "jomish-toast";
  toast.style.cssText = `
        position: fixed; bottom: 28px; right: 28px; z-index: 99999;
        background: ${c.bg}; border: 1px solid ${c.border}; color: ${c.text};
        padding: 14px 22px; border-radius: 12px; font-size: 0.9rem; font-weight: 600;
        box-shadow: 0 8px 32px rgba(0,0,0,0.4); backdrop-filter: blur(12px);
        max-width: 380px; line-height: 1.4;
        animation: toastIn 0.35s cubic-bezier(0.23,1,0.32,1) both;
    `;
  toast.textContent = message;

  // Inject keyframe if not already present
  if (!document.getElementById("toast-keyframe-style")) {
    const style = document.createElement("style");
    style.id = "toast-keyframe-style";
    style.textContent = `
            @keyframes toastIn  { from { opacity:0; transform:translateY(16px); } to { opacity:1; transform:translateY(0); } }
            @keyframes toastOut { from { opacity:1; transform:translateY(0); } to { opacity:0; transform:translateY(16px); } }
        `;
    document.head.appendChild(style);
  }

  document.body.appendChild(toast);
  setTimeout(() => {
    toast.style.animation = "toastOut 0.3s ease forwards";
    setTimeout(() => toast.remove(), 320);
  }, 4000);
}
window.showToast = showToast;

async function toggleSick(id, state) {
  if (!confirm(`Mark this staff member as ${state ? "SICK" : "HEALTHY"}?`))
    return;
  try {
    const res = await fetchAuth(`${API_URL}/employees/sick`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ employee_id: id, is_sick: state }),
    });
    if (res.ok) {
      loadEmployees();
      loadDashboard(); // Update presence stats
    } else {
      const data = await res.json();
      alert(data.error || "Failed to update health status");
    }
  } catch (e) {
    console.error(e);
  }
}

// viewEmployeeNotes is now handled by openEmployeeNotes() which uses the real notes API & modal

// ==== MONTHLY PAYROLL LOGIC ====
let _payrollCache = []; // stores last-loaded payroll data for printing

async function loadPayrollStatus() {
  const month = document.getElementById("payroll-month").value;
  if (!month) return;

  try {
    const res = await fetchAuth(`${API_URL}/payroll/status?month=${month}`);
    const data = await res.json();
    const tbody = document.getElementById("payroll-tbody");
    tbody.innerHTML = "";

    if (!data.employees || data.employees.length === 0) {
      tbody.innerHTML =
        '<tr><td colspan="5" style="text-align:center; padding:30px; color:#94A3B8;">No employees with a configured salary found.</td></tr>';
      return;
    }

    _payrollCache = data.employees; // cache for printPayrollList

    data.employees.forEach((emp) => {
      const tr = document.createElement("tr");

      const paidAmount = emp.paid_amount || 0;
      const arrears = emp.arrears || 0;
      const totalDue = emp.total_due || emp.salary;
      const balance = totalDue - paidAmount;

      const isFullyPaid = balance <= 0;
      const isPartiallyPaid = paidAmount > 0 && !isFullyPaid;

      let statusBadge = "";
      if (isFullyPaid) {
        statusBadge = `<span style="background: rgba(34,197,94,0.1); color: #22c55e; padding: 4px 8px; border-radius: 6px; font-size: 0.8rem; font-weight: 600;">Fully Paid</span>`;
      } else if (isPartiallyPaid) {
        statusBadge = `<span style="background: rgba(245,158,11,0.1); color: #f59e0b; padding: 4px 8px; border-radius: 6px; font-size: 0.8rem; font-weight: 600;">Advance Paid</span>`;
      } else {
        statusBadge = `<span style="background: rgba(239,68,68,0.1); color: #ef4444; padding: 4px 8px; border-radius: 6px; font-size: 0.8rem; font-weight: 600;">Unpaid</span>`;
      }

      // Calculate Pay Date and Due Notice
      const createdDate = new Date(emp.created_at || new Date());
      const [selYear, selMonth] = month.split("-");
      const dueDate = new Date(
        selYear,
        parseInt(selMonth) - 1,
        createdDate.getDate(),
      );
      const dueStr = dueDate.toLocaleDateString();

      let dueNotice = "";
      if (!isFullyPaid) {
        const today = new Date();
        const diffTime = dueDate.getTime() - today.getTime();
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

        if (diffDays <= 3 && diffDays >= 0) {
          dueNotice = `<div style="font-size:0.75rem; color:#f59e0b; font-weight:bold; margin-top:4px;"><i class="fa-solid fa-triangle-exclamation"></i> Due in ${diffDays} day(s)</div>`;
        } else if (diffDays < 0) {
          dueNotice = `<div style="font-size:0.75rem; color:#ef4444; font-weight:bold; margin-top:4px;"><i class="fa-solid fa-triangle-exclamation"></i> Overdue by ${Math.abs(diffDays)} day(s)</div>`;
        }
      }

      let actionBtn = isFullyPaid
        ? `<button class="secondary-btn sm-btn" onclick="printPayrollSlip('${emp.first_name} ${emp.last_name}', '${emp.role}', ${paidAmount}, '${month}', '${emp.paid_at}')"><i class="fa-solid fa-print"></i> View Slip</button>`
        : `<div style="display:flex; flex-direction:column; gap:5px;">
                     <div style="display:flex; gap:5px; align-items:center;">
                         <input type="number" id="pay-amt-${emp.id}" value="${balance}" max="${balance}" min="1" class="form-control" style="width:100px; padding:5px; font-size:0.8rem;" title="Enter amount for pay advance or full payment">
                         <button class="primary-btn sm-btn" onclick="processPayroll(${emp.id}, '${emp.first_name} ${emp.last_name}')"><i class="fa-solid fa-money-check-dollar"></i> Pay</button>
                     </div>
                   </div>`;

      if (isPartiallyPaid) {
        actionBtn += `<div style="margin-top:5px;"><button class="secondary-btn sm-btn" onclick="printPayrollSlip('${emp.first_name} ${emp.last_name}', '${emp.role}', ${paidAmount}, '${month}', '${emp.paid_at}')"><i class="fa-solid fa-print"></i> Slip So Far</button></div>`;
      }

      tr.innerHTML = `
                <td>
                    <div style="font-weight:600;">${emp.first_name} ${emp.last_name}</div>
                    <div style="font-size:0.75rem; color:#94A3B8;">Due: ${dueStr}</div>
                    ${dueNotice}
                </td>
                <td>${emp.role}</td>
                <td>
                    <div style="font-weight: 600;">UGX ${emp.salary.toLocaleString()} /mo</div>
                    ${arrears > 0 ? `<div style="font-size:0.75rem; color:#f59e0b;">Arrears: UGX ${arrears.toLocaleString()}</div>` : ""}
                    <div style="font-size:0.8rem; font-weight:bold; margin-top:2px;">Total Owed: UGX ${totalDue.toLocaleString()}</div>
                    ${paidAmount > 0 ? `<div style="font-size:0.75rem; color:#22c55e;">Paid: UGX ${paidAmount.toLocaleString()}</div>` : ""}
                    ${balance > 0 ? `<div style="font-size:0.75rem; color:#ef4444;">Bal: UGX ${balance.toLocaleString()}</div>` : ""}
                </td>
                <td>${statusBadge}</td>
                <td>${actionBtn}</td>
            `;
      tbody.appendChild(tr);
    });
  } catch (e) {
    console.error("Payroll load error:", e);
  }
}

async function processPayroll(empId, empName) {
  const month = document.getElementById("payroll-month").value;
  if (!month) return alert("Please select a month first.");

  const amtInput = document.getElementById(`pay-amt-${empId}`);
  const amount = amtInput ? parseFloat(amtInput.value) : 0;

  if (!amount || amount <= 0) return alert("Please enter a valid amount.");

  if (
    !confirm(
      `Are you sure you want to process payroll for ${empName}?\nAmount: UGX ${amount.toLocaleString()}\nMonth: ${month}\n\nThis will record an expense in the SME portal.`,
    )
  )
    return;

  try {
    const res = await fetchAuth(`${API_URL}/payroll`, {
      method: "POST",
      body: JSON.stringify({
        employee_id: empId,
        month_year: month,
        amount: amount,
      }),
    });
    const data = await res.json();

    if (res.ok) {
      showToast(`Payroll processed for ${empName}!`, "success");
      loadPayrollStatus();
      printPayrollSlip(
        empName,
        "Employee",
        amount,
        month,
        new Date().toISOString(),
      );
    } else {
      alert(data.error);
    }
  } catch (e) {
    console.error("Payroll process error:", e);
  }
}

function printPayrollSlip(empName, role, amount, month, datePaid) {
  let printArea = document.getElementById("statement-print-area");
  if (!printArea) {
    printArea = document.createElement("div");
    printArea.id = "statement-print-area";
    printArea.style.display = "none";
    document.body.appendChild(printArea);
  }

  printArea.innerHTML = `
        <div style="font-family: sans-serif; max-width: 400px; margin: 0 auto; padding: 20px; border: 1px solid #ccc;">
            <h2 style="text-align: center; margin-bottom: 5px;">JOMISH SUITE</h2>
            <h3 style="text-align: center; margin-top: 0; color: #555;">PAYROLL SLIP</h3>
            <hr>
            <p><strong>Employee:</strong> ${empName}</p>
            <p><strong>Role:</strong> ${role}</p>
            <p><strong>Pay Period:</strong> ${month}</p>
            <p><strong>Paid On:</strong> ${new Date(datePaid).toLocaleString()}</p>
            <hr>
            <h3 style="margin-top: 15px;">NET PAY: <span style="float: right;">UGX ${amount.toLocaleString()}</span></h3>
            <br><br><br>
            <p>Received By (Signature): _______________________</p>
            <br>
            <p style="text-align: center; font-size: 0.8rem; color: #888;">Official Payroll Record<br>Auto-generated by Jomish Business Suite</p>
        </div>
    `;

  clearAllPrintModes();
  document.body.classList.add("print-mode-statement");
  window.print();
  setTimeout(() => {
    clearAllPrintModes();
  }, 1500);
}

function printPayrollList() {
  if (_payrollCache.length === 0) {
    showToast("Load payroll data first by selecting a month.", "warning");
    return;
  }

  const filterEl = document.getElementById("payroll-print-filter");
  const filter = filterEl ? filterEl.value : "all";
  const monthEl = document.getElementById("payroll-month");
  const month = monthEl ? monthEl.value : "";

  let rows = _payrollCache;
  if (filter === "paid") rows = rows.filter((e) => !!e.paid_at);
  if (filter === "unpaid") rows = rows.filter((e) => !e.paid_at);

  if (rows.length === 0) {
    showToast(`No ${filter} employees to print.`, "info");
    return;
  }

  const labelMap = {
    all: "All Employees",
    paid: "Paid Employees",
    unpaid: "Unpaid Employees",
  };
  const filterLabel = labelMap[filter] || "All Employees";

  let html = `
        <div style="font-family: sans-serif; padding: 20px;">
            <h2 style="text-align: center; margin-bottom: 5px;">JOMISH BUSINESS SUITE</h2>
            <h3 style="text-align: center; margin-top: 0; color: #555;">Payroll Report – ${filterLabel}</h3>
            ${month ? `<p style="text-align: center; font-weight: bold;">Period: ${month}</p>` : ""}
            <table style="width: 100%; border-collapse: collapse; margin-top: 20px;">
                <thead>
                    <tr style="background-color: #4F46E5; color: white;">
                        <th style="padding: 10px; text-align: left; border: 1px solid #ddd;">Employee Name</th>
                        <th style="padding: 10px; text-align: left; border: 1px solid #ddd;">Role</th>
                        <th style="padding: 10px; text-align: left; border: 1px solid #ddd;">Base Salary</th>
                        <th style="padding: 10px; text-align: left; border: 1px solid #ddd;">Status</th>
                        <th style="padding: 10px; text-align: left; border: 1px solid #ddd;">Date Paid</th>
                    </tr>
                </thead>
                <tbody>
    `;

  let totalPaid = 0;
  let totalUnpaid = 0;

  rows.forEach((emp, idx) => {
    const isPaid = !!emp.paid_at;
    const bg = idx % 2 === 0 ? "#f9f9f9" : "#ffffff";

    if (isPaid) {
      totalPaid += emp.paid_amount || emp.salary || 0;
    } else {
      totalUnpaid += emp.salary || 0;
    }

    html += `
            <tr style="background-color: ${bg};">
                <td style="padding: 10px; border: 1px solid #ddd;">${emp.first_name || ""} ${emp.last_name || ""}</td>
                <td style="padding: 10px; border: 1px solid #ddd;">${emp.role || "-"}</td>
                <td style="padding: 10px; border: 1px solid #ddd;">UGX ${(emp.salary || 0).toLocaleString()}</td>
                <td style="padding: 10px; border: 1px solid #ddd; color: ${isPaid ? "#22c55e" : "#ef4444"}; font-weight: bold;">${isPaid ? "Paid" : "Unpaid"}</td>
                <td style="padding: 10px; border: 1px solid #ddd;">${isPaid ? new Date(emp.paid_at).toLocaleDateString() : "—"}</td>
            </tr>
        `;
  });

  html += `
                </tbody>
            </table>
            <div style="margin-top: 20px; display: flex; justify-content: space-between; font-weight: bold; font-size: 1.1rem;">
                ${filter !== "unpaid" ? `<div>Total Paid: UGX ${totalPaid.toLocaleString()}</div>` : "<div></div>"}
                ${filter !== "paid" ? `<div>Total Unpaid: UGX ${totalUnpaid.toLocaleString()}</div>` : ""}
            </div>
            <p style="text-align: center; margin-top: 40px; font-size: 0.8rem; color: #888;">
                Printed on ${new Date().toLocaleString()} – Jomish Business Suite
            </p>
        </div>
    `;

  let printArea = document.getElementById("statement-print-area");
  if (!printArea) {
    printArea = document.createElement("div");
    printArea.id = "statement-print-area";
    printArea.style.display = "none";
    document.body.appendChild(printArea);
  }

  printArea.innerHTML = html;

  clearAllPrintModes();
  document.body.classList.add("print-mode-statement");
  window.print();
  setTimeout(() => {
    clearAllPrintModes();
  }, 1500);
}

// ─── Populate any role <select> from live DB ──────────────────────────────────
async function loadRolesIntoSelect(selectId, currentValue = "") {
  const sel = document.getElementById(selectId);
  if (!sel) return;
  try {
    const r = await fetchAuth(`${API_URL}/roles`);
    const data = await r.json();
    const roles = (data.roles || [])
      .map((r) => r.role_name)
      .filter(Boolean)
      .sort();
    sel.innerHTML = '<option value="">-- Select Role --</option>';
    roles.forEach((name) => {
      const opt = document.createElement("option");
      opt.value = name;
      opt.textContent = name;
      if (name === currentValue) opt.selected = true;
      sel.appendChild(opt);
    });
  } catch (e) {
    sel.innerHTML = '<option value="">-- Failed to load roles --</option>';
  }
}

async function handleAddEmployee(e) {
  e.preventDefault();
  const photoInput = document.getElementById("emp-photo");
  let photoBase64 = null;

  if (photoInput.files && photoInput.files[0]) {
    const file = photoInput.files[0];
    if (file.size > 5 * 1024 * 1024) {
      alert("Image too large! Please select a photo under 5MB.");
      return;
    }
    photoBase64 = await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = (ev) => resolve(ev.target.result);
      reader.readAsDataURL(file);
    });
  }

  const emailInput = document.getElementById("emp-email").value;
  if (!emailInput.toLowerCase().endsWith("@gmail.com")) {
    alert("Error: Only @gmail.com email addresses are allowed.");
    return;
  }

  const empColor = localStorage.getItem("jomish_biz_color") || "#4F46E5";

  const payload = {
    first_name: document.getElementById("emp-first").value,
    last_name: document.getElementById("emp-last").value,
    email: emailInput,
    phone: (document.getElementById("emp-phone").value || "").trim(),
    role: document.getElementById("emp-role").value,
    department: document.getElementById("emp-dept").value,
    salary: parseFloat(document.getElementById("emp-salary").value),
    profile_color: empColor,
    photo_base64: photoBase64,
    password: document.getElementById("emp-password").value,
  };

  try {
    const res = await fetchAuth(`${API_URL}/employees`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (res.ok) {
      document.getElementById("add-employee-modal").classList.add("hidden");
      document.getElementById("form-add-employee").reset();
      loadEmployees();
      showToast(
        `✅ ${data.first_name} ${data.last_name} added! Login ID: ${data.employee_code}`,
        "success",
      );
      generateIDCard(data);
    } else {
      alert(
        "Add Staff Error: " +
          (data.error ||
            "Check if email is already in use or photo is too large."),
      );
    }
  } catch (e) {
    console.error(e);
    alert(
      "Network Error: Please ensure you have launched the server using Launch_Jomish_Suite.bat.",
    );
  }
}

// --- Robust barcode renderer: retries until JsBarcode is available (handles defer load race) ---
function drawBarcode(svgSelector, value, attempt) {
  attempt = attempt || 0;
  const svgEl = document.querySelector(svgSelector);
  if (!svgEl) return;

  // Clear previous barcode stripes
  while (svgEl.firstChild) svgEl.removeChild(svgEl.firstChild);

  if (typeof JsBarcode === "undefined") {
    if (attempt < 20) {
      setTimeout(() => drawBarcode(svgSelector, value, attempt + 1), 100);
    } else {
      console.warn("JsBarcode unavailable after retries");
    }
    return;
  }

  // Sanitize value — CODE128 can't handle null/undefined/empty
  const safeVal = (value || "EMP-0").replace(/[^\x20-\x7E]/g, "");
  if (!safeVal) return;

  try {
    JsBarcode(svgSelector, safeVal, {
      format: "CODE128",
      displayValue: true,
      fontSize: 9,
      textMargin: 2,
      width: 1.4,
      height: 32,
      margin: 3,
      background: "#ffffff",
      lineColor: "#000000",
    });
  } catch (e) {
    console.warn("JsBarcode draw error:", e.message || e);
  }
}

function generateIDCard(emp) {
  const overlay = document.getElementById("print-overlay");
  if (!overlay) return;

  // Set dynamic background color based on profile_color
  const cardFront = document.getElementById("id-card-front");
  if (cardFront) {
    const color = emp.profile_color || "#1e3a8a";
    cardFront.style.background = `linear-gradient(135deg, ${color}, #000000)`;
  }

  // Always fetch fresh business settings from the server (never use stale localStorage)
  fetchAuth(`${API_URL}/settings/all`)
    .then((r) => r.json())
    .then((settings) => {
      // In global tech mode, don't show any company branding on ID cards
      if (settings._is_global_tech) {
        settings.business_name = "Jomish Business Suite";
        settings.business_contact = "";
        settings.business_location = "";
      }
      const bizName = (
        settings.business_name ||
        localStorage.getItem("jomish_biz_name") ||
        "JOMISH SUITE"
      ).toUpperCase();
      const bizContact =
        settings.business_contact ||
        localStorage.getItem("jomish_biz_contact") ||
        "";
      const bizLocation =
        settings.business_location ||
        localStorage.getItem("jomish_biz_location") ||
        "";
      const bizEmail =
        settings.business_email ||
        localStorage.getItem("jomish_biz_email") ||
        "";
      const bizLogo = settings.company_logo || null;
      const bizSignature = settings.business_signature || null;

      // Update localStorage with fresh data
      if (settings.business_name)
        localStorage.setItem("jomish_biz_name", settings.business_name);
      if (settings.business_contact)
        localStorage.setItem("jomish_biz_contact", settings.business_contact);
      if (settings.business_location)
        localStorage.setItem("jomish_biz_location", settings.business_location);
      if (settings.business_email)
        localStorage.setItem("jomish_biz_email", settings.business_email);

      // ─── Business name & logo (front + back) ────────────────────────
      const elBizName = document.getElementById("id-biz-name-front");
      const frontLogo = document.getElementById("id-card-logo-front");
      if (frontLogo) {
        if (bizLogo) {
          frontLogo.src = bizLogo;
          frontLogo.style.display = "block";
        } else {
          frontLogo.style.display = "none";
        }
      }
      if (elBizName) elBizName.querySelector("span").textContent = bizName;

      const elBizNameBack = document.getElementById("id-biz-name-back");
      const backLogo = document.getElementById("id-card-logo-back");
      if (backLogo) {
        if (bizLogo) {
          backLogo.src = bizLogo;
          backLogo.style.display = "block";
        } else {
          backLogo.style.display = "none";
        }
      }
      if (elBizNameBack)
        elBizNameBack.querySelector("span").textContent = bizName;

      // ─── Authorized Signature ────────────────────────────────────────
      const elSignature = document.getElementById("id-card-signature");
      if (elSignature) {
        if (bizSignature) {
          elSignature.src = bizSignature;
          elSignature.style.display = "block";
        } else {
          elSignature.style.display = "none";
        }
      }

      // ─── Employee Name & Role ─────────────────────────────────────────
      const elName = document.getElementById("print-emp-name-front");
      if (elName)
        elName.textContent =
          `${emp.first_name || ""} ${emp.last_name || ""}`.trim() ||
          emp.name ||
          "Unknown";

      const elRole = document.getElementById("print-emp-role-front");
      if (elRole) elRole.textContent = emp.role || "Staff";

      // ─── Contact Info (bottom section of front) ──────────────────
      const elContact = document.getElementById("id-contact-info");
      if (elContact)
        elContact.textContent = emp.phone || bizContact || "\u2014";

      const elBizEmail = document.getElementById("id-email-info");
      if (elBizEmail)
        elBizEmail.textContent = emp.email || bizEmail || "\u2014";

      const elLocation = document.getElementById("id-location-info");
      if (elLocation) elLocation.textContent = bizLocation || "\u2014";

      // ─── Back side: business contacts ────────────────────────────────
      const elContactBack = document.getElementById("id-contact-back");
      if (elContactBack) elContactBack.textContent = bizContact || "";

      const elEmailBack = document.getElementById("id-email-back");
      if (elEmailBack) elEmailBack.textContent = bizEmail || "";

      const elLocationBack = document.getElementById("id-location-back");
      if (elLocationBack) elLocationBack.textContent = bizLocation || "";

      // ─── Profile photo ────────────────────────────────────────────────
      const elPhotoFront = document.getElementById("id-profile-img-front");
      if (elPhotoFront) {
        elPhotoFront.src =
          emp.photo_base64 || emp.photo
            ? emp.photo_base64 || emp.photo
            : "lib/placeholder.png";
        elPhotoFront.onerror = () => {
          elPhotoFront.src = "lib/placeholder.png";
        };
      }

      overlay.classList.add("receipt-modal-visible");
      document.body.classList.add("print-mode-id");

      // Barcode — drawn AFTER modal is visible so SVG has real dimensions
      drawBarcode("#id-barcode-front", emp.employee_code || `EMP-${emp.id}`);
    })
    .catch(() => {
      // Fallback — use localStorage if fetch fails
      const bizName = (
        localStorage.getItem("jomish_biz_name") || "JOMISH SUITE"
      ).toUpperCase();
      const elBizName = document.getElementById("id-biz-name-front");
      if (elBizName) elBizName.querySelector("span").textContent = bizName;
      overlay.classList.add("receipt-modal-visible");
      document.body.classList.add("print-mode-id");
      drawBarcode("#id-barcode-front", emp.employee_code || `EMP-${emp.id}`);
    });
}

// Helper: Strip ALL print-mode classes to prevent cross-overlay bleeding
function clearAllPrintModes() {
  document.body.classList.remove(
    "print-mode-id",
    "print-mode-receipt",
    "print-mode-label",
    "print-mode-timetable",
    "print-mode-statement",
  );
}

function doPrintID() {
  if (isPrinting) return;
  isPrinting = true;

  clearAllPrintModes();
  document.body.classList.add("print-mode-id");

  // Dynamically inject exact CR80 @page style to prevent conflicts with A4 or receipt rolls
  const style = document.createElement("style");
  style.id = "dynamic-print-page-style";
  style.innerHTML = `@page { size: 85.6mm 54mm; margin: 0; }`;
  document.head.appendChild(style);

  window.print();

  // Clean up style override immediately after print dialog resolves
  style.remove();

  // Release print lock after a delay to absorb touchscreen click events
  setTimeout(() => {
    isPrinting = false;
  }, 1500);
}

function closeIDCard() {
  const overlay = document.getElementById("print-overlay");
  if (overlay) overlay.classList.remove("receipt-modal-visible");
  document.body.classList.remove("print-mode-id");

  const elName = document.getElementById("print-emp-name-front");
  if (elName) elName.textContent = "";

  const elRole = document.getElementById("print-emp-role-front");
  if (elRole) elRole.textContent = "";

  const elIdBack = document.getElementById("print-emp-id-back");
  if (elIdBack) elIdBack.textContent = "";

  const elPhoto = document.getElementById("id-profile-img-front");
  if (elPhoto) elPhoto.src = "lib/placeholder.png";
}

function getCategoryIcon(cat) {
  const c = String(cat || "General").toLowerCase();
  if (c.includes("beverage") || c.includes("drink") || c.includes("water"))
    return '<i class="fa-solid fa-cup-togo"></i>';
  if (c.includes("food") || c.includes("meal"))
    return '<i class="fa-solid fa-bowl-food"></i>';
  if (c.includes("pastry") || c.includes("bread") || c.includes("cake"))
    return '<i class="fa-solid fa-bread-slice"></i>';
  if (c.includes("service")) return '<i class="fa-solid fa-wrench"></i>';
  return '<i class="fa-solid fa-box"></i>';
}

// ==== POS HANDLERS & RECEIPT ====

// Quick photo upload from POS tiles
function quickUploadPhoto(productId) {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/*";
  input.capture = "environment"; // Opens camera on mobile
  input.onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      alert("Image too large (max 5MB)");
      return;
    }
    const base64 = await new Promise((r) => {
      const reader = new FileReader();
      reader.onload = (ev) => r(ev.target.result);
      reader.readAsDataURL(file);
    });
    try {
      const res = await fetchAuth(`${API_URL}/products/${productId}/photo`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ photo_base64: base64 }),
      });
      if (res.ok) {
        showToast(`Photo uploaded!`, "success");
        loadInventory();
      } else {
        alert("Failed to upload photo");
      }
    } catch (err) {
      alert("Upload error: " + err.message);
    }
  };
  input.click();
}

let cachedProducts = []; // Needed for instant barcode lookup
async function handleBarcodeScan(code) {
  // Always fetch fresh products to ensure additional_barcodes (from product_barcodes table) are included
  try {
    const res = await fetchAuth(`${API_URL}/products`);
    const data = await res.json();
    if (data.products) cachedProducts = data.products;
  } catch (e) {
    // If fetch fails, fall back to cached
    if (!cachedProducts.length) return null;
  }

  // Tightest-match: find the product with the smallest range containing this code
  let bestMatch = null;
  let bestRangeSize = Infinity;

  for (const p of cachedProducts) {
    if (String(p.barcode) === String(code) || String(p.id) === String(code)) {
      bestMatch = p;
      break; // Exact match is definitive
    }
    if (
      p.additional_barcodes &&
      p.additional_barcodes.some((b) => String(b) === String(code))
    ) {
      bestMatch = p;
      break; // Exact match on custom barcodes is definitive
    }
    if (p.barcode_end && !isNaN(code)) {
      const scanNum = parseInt(code);
      const startNum = parseInt(p.barcode);
      const endNum = parseInt(p.barcode_end);
      if (
        !isNaN(startNum) &&
        !isNaN(endNum) &&
        scanNum >= startNum &&
        scanNum <= endNum
      ) {
        const rangeSize = endNum - startNum;
        if (rangeSize < bestRangeSize) {
          bestMatch = p;
          bestRangeSize = rangeSize;
        }
      }
    }
  }

  // VALIDATE UNIQUE BARCODE
  if (bestMatch && !isNaN(code)) {
    if (soldBarcodes.has(code)) {
      showToast(`Barcode ${code} already sold and recorded!`, "danger");
      return null;
    }
    // Check if already in current cart
    const inCart = posCart.some(
      (item) => item.barcodes && item.barcodes.includes(code),
    );
    if (inCart) {
      showToast(`Barcode ${code} already in cart`, "warning");
      return null;
    }
  }

  if (bestMatch) {
    if (bestMatch.stock > 0) {
      addToCart(bestMatch, code);
      showToast(`${bestMatch.name} identified`, "success");
    } else {
      showToast(`Out of stock: ${bestMatch.name}`, "danger");
    }
    return bestMatch;
  } else {
    if (code.length > 3) {
      showToast(`Barcode ${code} not found in inventory`, "warning");
    }
    return null;
  }
}

// ==== CAMERA PRODUCT SCANNER ====
let productScanner = null;

async function stopProductScanner() {
  if (productScanner) {
    await productScanner.stop();
  }
  document.getElementById("product-scanner-modal").classList.add("hidden");
}



function setCartQty(id, val) {
  const qty = parseInt(val);
  if (isNaN(qty) || qty <= 0) {
    posCart = posCart.filter((i) => i.id !== id);
  } else {
    const item = posCart.find((i) => i.id === id);
    if (item) item.qty = qty;
  }
  renderCart();
}


// ==== CASH PAYMENT NUMPAD ENGINE ====

function numpadPress(key) {
  const input = document.getElementById("pay-amount");
  let val = input.value || "0";

  if (key === "C") {
    val = "0";
  } else if (key === "\u232b") {
    val = val.length > 1 ? val.slice(0, -1) : "0";
  } else {
    val = val === "0" ? key : val + key;
  }

  // Cap at 12 digits
  if (val.length > 12) return;
  input.value = val;
  updateChange();
}

function numpadExact() {
  const total =
    parseFloat(
      document.getElementById("btn-checkout").getAttribute("data-total"),
    ) || 0;
  document.getElementById("pay-amount").value = Math.round(total).toString();
  updateChange();
}

function updateChange() {
  const total =
    parseFloat(
      document.getElementById("btn-checkout").getAttribute("data-total"),
    ) || 0;
  const paid = parseInt(document.getElementById("pay-amount").value) || 0;
  const change = paid - Math.round(total);
  const changeEl = document.getElementById("pay-change");

  if (change >= 0) {
    changeEl.textContent = "UGX " + change.toLocaleString();
    changeEl.style.color = "#10B981"; // green
  } else {
    changeEl.textContent = "-UGX " + Math.abs(change).toLocaleString();
    changeEl.style.color = "#EF4444"; // red = not enough
  }
}

function closePaymentPanel() {
  document.getElementById("payment-panel").classList.add("hidden");
}

window.handleDeliveryCheckboxChange = function () {
  const isDelivery = document.getElementById("send-to-transport-chk").checked;
  const deliveryContainer = document.getElementById("delivery-info-container");
  const btnConfirmPay = document.getElementById("btn-confirm-pay");
  const btnGetInvoice = document.getElementById("btn-get-invoice");

  if (isDelivery) {
    deliveryContainer.style.display = "block";
    if (btnConfirmPay)
      btnConfirmPay.innerHTML =
        '<i class="fa-solid fa-truck"></i> CONFIRM & DISPATCH';
    if (btnGetInvoice) btnGetInvoice.style.display = "none"; // Only allow proper payment confirm for dispatch
  } else {
    deliveryContainer.style.display = "none";
    if (btnConfirmPay)
      btnConfirmPay.innerHTML =
        '<i class="fa-solid fa-check"></i> CONFIRM PAYMENT';
    if (btnGetInvoice) btnGetInvoice.style.display = "flex";
  }
};

window.handlePaymentMethodChange = async function () {
  const method = document.getElementById("payment-method-select").value;
  const buyerContainer = document.getElementById("buyer-name-container");
  const payAmountInput = document.getElementById("pay-amount");
  const deliveryChk = document.getElementById("send-to-transport-chk");

  if (method === "COD") {
    deliveryChk.checked = true;
    window.handleDeliveryCheckboxChange();
    payAmountInput.value = "0";
    payAmountInput.setAttribute("readonly", "true");
    buyerContainer.style.display = "block"; // Collect name and phone for COD
  } else {
    payAmountInput.removeAttribute("readonly");
    if (method === "CREDIT") {
      buyerContainer.style.display = "block";
    } else {
      buyerContainer.style.display = "none";
    }
  }

  if (method === "CREDIT" || method === "COD") {
    try {
      const res = await fetchAuth(`${API_URL}/buyers`);
      if (res.ok) {
        const data = await res.json();
        const datalist = document.getElementById("buyer-names-list");
        datalist.innerHTML = "";
        data.buyers.forEach((buyer) => {
          const option = document.createElement("option");
          option.value = buyer;
          datalist.appendChild(option);
        });
      }
    } catch (e) {
      console.error("Failed to load buyers list:", e);
    }
  }
};

async function confirmPayment() {
  const total =
    parseFloat(
      document.getElementById("btn-checkout").getAttribute("data-total"),
    ) || 0;
  const paid = parseInt(document.getElementById("pay-amount").value) || 0;
  const paymentMethod = document.getElementById("payment-method-select").value;
  const buyerName = document.getElementById("buyer-name-input").value.trim();
  const buyerPhone = document.getElementById("buyer-phone-input").value.trim();
  const isDelivery = document.getElementById("send-to-transport-chk").checked;
  const deliveryAddress = document
    .getElementById("delivery-address-input")
    .value.trim();

  if (paymentMethod === "CREDIT") {
    if (paid > Math.round(total)) {
      alert("For credit, amount paid cannot exceed the total amount.");
      return;
    }
    if (!buyerName) {
      alert("Please enter a Buyer Name for Credit transactions.");
      return;
    }
  } else if (paymentMethod !== "COD") {
    if (paid < Math.round(total)) {
      alert(
        "Amount paid is less than total! Customer still owes UGX " +
          (Math.round(total) - paid).toLocaleString(),
      );
      return;
    }
  }

  if (isDelivery && !deliveryAddress) {
    alert("Please enter a delivery location/address.");
    return;
  }

  const change = paid > Math.round(total) ? paid - Math.round(total) : 0;

  try {
    const res = await fetchAuth(`${API_URL}/checkout`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        total_amount: total,
        items: posCart,
        payment_method: paymentMethod,
        amount_paid: paid,
        buyer_name: buyerName,
        buyer_phone: buyerPhone,
        is_delivery: isDelivery,
        delivery_address: deliveryAddress,
      }),
    });
    if (res.ok) {
      const result = await res.json();
      closePaymentPanel();

      if (change > 0) {
        showToast(`Give change: UGX ${change.toLocaleString()}`, "success");
      }

      // Record used barcodes in local cache
      posCart.forEach((item) => {
        if (item.barcodes) {
          item.barcodes.forEach((bc) => soldBarcodes.add(bc));
        }
      });

      printReceipt(
        posCart,
        total,
        result.transaction_id,
        paymentMethod,
        paid,
        buyerName,
        null,
      );

      posCart = [];
      renderCart();
      loadDashboard();
      loadTransactions();
    } else {
      const data = await res.json();
      alert("Error: " + data.error);
    }
  } catch (e) {
    // ── Offline Fallback ──────────────────────────────────────────────────
    // If network is unavailable, save the sale locally in IndexedDB.
    // The cart is still cleared and a receipt is shown so the cashier's
    // workflow is not interrupted. The sale will auto-sync on reconnect.
    if (
      !navigator.onLine ||
      e.message.toLowerCase().includes("failed to fetch")
    ) {
      const client_uuid = crypto.randomUUID();
      const offlinePayload = {
        total_amount: total,
        items: posCart,
        payment_method: paymentMethod,
        amount_paid: paid,
        buyer_name: buyerName,
        buyer_phone: buyerPhone,
      };
      if (window.OfflineDB) {
        await window.OfflineDB.queueOfflineSale(client_uuid, offlinePayload);
      }
      closePaymentPanel();
      if (change > 0)
        showToast(`Give change: UGX ${change.toLocaleString()}`, "success");
      printReceipt(
        posCart,
        total,
        `OFFLINE-${client_uuid.slice(0, 8).toUpperCase()}`,
        paymentMethod,
        paid,
        buyerName,
        null,
      );
      posCart = [];
      renderCart();
      updateSyncBadge();
      showToast(
        "📶 Offline — sale saved locally. Will sync when reconnected.",
        "warning",
      );
      return;
    }
    alert("Checkout failed: " + e.message);
  }
}

// ── Offline Sync Engine ────────────────────────────────────────────────────────
// Posts all pending IndexedDB sales to /api/pos/batch-sync.
// Only deletes records that the server explicitly acknowledged (syncedIds).
// Failed / unacknowledged records stay in the queue for the next attempt.
async function syncOfflineSales() {
  if (!window.OfflineDB) return;
  const pending = await window.OfflineDB.getPendingOfflineSales();
  if (!pending.length) return;

  const token = localStorage.getItem("jomish_token");
  if (!token) return; // Not logged in — retry later

  try {
    const res = await fetch(`${API_URL}/pos/batch-sync`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ transactions: pending }),
    });

    if (!res.ok) throw new Error(`Server responded ${res.status}`);

    const { syncedIds = [], errors = [] } = await res.json();

    // Safe clear: delete ONLY server-confirmed UUIDs
    if (syncedIds.length) {
      await window.OfflineDB.removeSyncedSales(syncedIds);
      showToast(
        `✅ ${syncedIds.length} offline sale(s) synced to server.`,
        "success",
      );
    }
    if (errors.length) {
      console.warn("[Sync] Failed to sync some sales:", errors);
    }
  } catch (e) {
    console.warn(
      "[Sync] Batch sync failed \u2014 will retry on next reconnect:",
      e.message,
    );
  }

  updateSyncBadge();
}

// Updates the pending-sync count badge in the POS nav header.
async function updateSyncBadge() {
  if (!window.OfflineDB) return;
  const count = await window.OfflineDB.getPendingCount();
  let badge = document.getElementById("offline-sync-badge");
  if (count > 0) {
    if (!badge) {
      const btn = document.getElementById("pos-nav-petty-cash");
      if (!btn) return;
      badge = document.createElement("span");
      badge.id = "offline-sync-badge";
      badge.style.cssText =
        "position:fixed;top:14px;right:14px;background:#EF4444;color:#fff;border-radius:20px;padding:4px 10px;font-size:0.78rem;font-weight:700;z-index:9999;display:flex;align-items:center;gap:5px;box-shadow:0 2px 8px rgba(0,0,0,0.2);cursor:pointer;";
      badge.innerHTML = `<i class="fa-solid fa-cloud-arrow-up"></i> <span id="offline-sync-count">${count}</span> pending`;
      badge.title = "Offline sales pending sync — click to retry";
      badge.onclick = syncOfflineSales;
      document.body.appendChild(badge);
    } else {
      const countEl = document.getElementById("offline-sync-count");
      if (countEl) countEl.textContent = count;
    }
  } else {
    if (badge) badge.remove();
  }
}

async function getInvoice() {
  const total =
    parseFloat(
      document.getElementById("btn-checkout").getAttribute("data-total"),
    ) || 0;
  const buyerName = document.getElementById("buyer-name-input").value.trim();
  const buyerPhone = document.getElementById("buyer-phone-input").value.trim();
  // Saving an invoice means NO delivery dispatch yet. It just records the unpaid sale.
  // If they want to dispatch COD, they must use the standard checkout flow with COD selected.
  const isDelivery = false;
  const deliveryAddress = "";

  try {
    const res = await fetchAuth(`${API_URL}/checkout`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        total_amount: total,
        items: posCart,
        payment_method: "INVOICE",
        amount_paid: 0,
        buyer_name: buyerName,
        buyer_phone: buyerPhone,
        is_delivery: false,
        delivery_address: "",
      }),
    });
    if (res.ok) {
      const result = await res.json();
      closePaymentPanel();

      showToast("Invoice generated successfully!", "success");

      // Record used barcodes in local cache
      posCart.forEach((item) => {
        if (item.barcodes) {
          item.barcodes.forEach((bc) => soldBarcodes.add(bc));
        }
      });

      printReceipt(
        posCart,
        total,
        result.transaction_id,
        "INVOICE",
        0,
        buyerName,
        null,
        true,
      );

      posCart = [];
      renderCart();
      loadDashboard();
      loadTransactions();
    } else {
      const data = await res.json();
      alert("Error: " + data.error);
    }
  } catch (e) {
    alert("Invoice generation failed: " + e.message);
  }
}

// ============================================================
// RECEIPT & INVOICE PRINTING — Clean rebuild
// ============================================================

// Holds the current receipt data for the print window
let _currentReceiptData = null;

/**
 * Populate and show the on-screen receipt modal.
 * Called after every successful checkout or invoice generation.
 */
function printReceipt(
  items,
  total,
  orderId,
  paymentMethod = "CASH",
  amountPaid = null,
  buyerName = null,
  deliveryInfo = null,
  isInvoice = false,
) {
  // ── Business info ─────────────────────────────────────
  const bizName = localStorage.getItem("jomish_biz_name") || "Jomish Business";
  const bizLoc =
    localStorage.getItem("jomish_biz_location") || "Kampala, Uganda";
  const bizTel = localStorage.getItem("jomish_biz_contact") || "";
  const taxRate = parseFloat(localStorage.getItem("jomish_tax_rate") || "0");

  // ── Calculations ──────────────────────────────────────
  const paid = amountPaid !== null ? amountPaid : total;
  const sub = taxRate > 0 ? total / (1 + taxRate / 100) : total;
  const tax = total - sub;
  const change =
    paymentMethod !== "CREDIT" && paymentMethod !== "INVOICE"
      ? Math.max(0, paid - total)
      : 0;
  const bal =
    paymentMethod === "CREDIT" || paymentMethod === "INVOICE"
      ? Math.max(0, total - paid)
      : 0;
  const orderNo = String(orderId || Math.floor(Math.random() * 9999)).padStart(
    4,
    "0",
  );
  const dateStr = new Date().toLocaleString("en-UG", {
    timeZone: "Africa/Kampala",
  });

  // ── Store receipt data for the print window ────────────
  _currentReceiptData = {
    isInvoice,
    bizName,
    bizLoc,
    bizTel,
    taxRate,
    orderId: orderNo,
    dateStr,
    cashierName: USER_NAME || "Cashier",
    items: items.map((i) => ({
      name: i.name,
      qty: i.qty || 1,
      price: i.price,
    })),
    sub,
    tax,
    total,
    paid,
    change,
    bal,
    paymentMethod: deliveryInfo ? `${paymentMethod} (DELIVERY)` : paymentMethod,
    buyerName,
    deliveryInfo,
  };

  // ── Populate the on-screen receipt modal ───────────────
  const set = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  };

  set("receipt-biz-name", bizName);
  set("receipt-addr", bizLoc);
  set("receipt-contact", bizTel);
  set("receipt-date", "Date: " + dateStr);
  set("receipt-no", (isInvoice ? "INVOICE" : "RECEIPT") + " #" + orderNo);
  set("receipt-cashier", "Cashier: " + (USER_NAME || "Cashier"));

  // Items
  const tbody = document.getElementById("receipt-items");
  if (tbody) {
    tbody.innerHTML = "";
    items.forEach((i) => {
      const tr = document.createElement("tr");
      const qty = i.qty || 1;
      tr.innerHTML = `
                <td style="padding:2px 0;">${i.name}</td>
                <td style="text-align:center; padding:2px 4px;">${qty}</td>
                <td style="text-align:right; padding:2px 0;">UGX ${(i.price * qty).toLocaleString()}</td>`;
      tbody.appendChild(tr);
    });
  }

  set("r-subtotal", `UGX ${Math.round(sub).toLocaleString()}`);
  set(
    "r-tax",
    taxRate > 0
      ? `UGX ${Math.round(tax).toLocaleString()} (${taxRate}%)`
      : "UGX 0",
  );
  set("r-total", `UGX ${Math.round(total).toLocaleString()}`);
  set("r-method", paymentMethod);
  set("r-paid", `UGX ${Math.round(paid).toLocaleString()}`);

  // Conditional rows
  const show = (id, visible) => {
    const el = document.getElementById(id);
    if (el) el.style.display = visible ? "flex" : "none";
  };

  if (change > 0) {
    set("r-change", `UGX ${Math.round(change).toLocaleString()}`);
    show("r-change-row", true);
  } else {
    show("r-change-row", false);
  }

  if (bal > 0) {
    set("r-balance", `UGX ${Math.round(bal).toLocaleString()}`);
    show("r-balance-row", true);
  } else {
    show("r-balance-row", false);
  }

  if (buyerName) {
    set("r-buyer-name", buyerName);
    show("r-buyer-row", true);
  } else {
    show("r-buyer-row", false);
  }

  if (deliveryInfo) {
    if (typeof deliveryInfo === "object") {
      set(
        "r-delivery-client",
        `${deliveryInfo.clientName || ""} ${deliveryInfo.clientPhone ? "(" + deliveryInfo.clientPhone + ")" : ""}`.trim(),
      );
      set("r-delivery-loc", deliveryInfo.clientLocation || "");
    } else {
      set("r-delivery-client", String(deliveryInfo));
      set("r-delivery-loc", "");
    }
    const dRow = document.getElementById("r-delivery-row");
    if (dRow) dRow.style.display = "block";
  } else {
    const dRow = document.getElementById("r-delivery-row");
    if (dRow) dRow.style.display = "none";
  }

  // Logo
  const logo = document.getElementById("receipt-brand-logo");
  if (logo) {
    const savedLogo = localStorage.getItem("jomish_logo_base64");
    logo.src = savedLogo || "assets/default-logo.png";
    logo.style.display = "";
  }

  // Show the modal
  const overlay = document.getElementById("receipt-overlay");
  if (overlay) overlay.classList.add("receipt-modal-visible");
}

/**
 * Close the on-screen receipt modal.
 */
function closeReceipt() {
  const overlay = document.getElementById("receipt-overlay");
  if (overlay) overlay.classList.remove("receipt-modal-visible");
  _currentReceiptData = null;
}

/**
 * Build the receipt HTML string for printing.
 * Used by doPrint() to create the print window.
 */
function _buildReceiptHTML(d) {
  const fmtUGX = (n) => "UGX " + Math.round(n).toLocaleString();
  const heading = d.isInvoice ? "INVOICE" : "RECEIPT";

  let itemRows = "";
  d.items.forEach((i) => {
    const lineTotal = i.price * (i.qty || 1);
    itemRows += `
            <tr>
                <td style="padding:3px 0; text-align:left;">${i.name}</td>
                <td style="padding:3px 4px; text-align:center;">${i.qty || 1}</td>
                <td style="padding:3px 0; text-align:right;">${fmtUGX(lineTotal)}</td>
            </tr>`;
  });

  let conditionalRows = "";
  if (d.taxRate > 0) {
    conditionalRows += `<div class="row"><span>Tax (${d.taxRate}%):</span><span>${fmtUGX(d.tax)}</span></div>`;
  }
  if (d.change > 0) {
    conditionalRows += `<div class="row" style="color:#10B981;font-weight:bold;"><span>Change:</span><span>${fmtUGX(d.change)}</span></div>`;
  }
  if (d.bal > 0) {
    conditionalRows += `<div class="row" style="color:#EF4444;font-weight:bold;"><span>Balance Due:</span><span>${fmtUGX(d.bal)}</span></div>`;
  }
  if (d.buyerName) {
    conditionalRows += `<div class="row"><span>Buyer:</span><span>${d.buyerName}</span></div>`;
  }

  let deliveryBlock = "";
  if (d.deliveryInfo) {
    const clientStr =
      typeof d.deliveryInfo === "object"
        ? `${d.deliveryInfo.clientName || ""} ${d.deliveryInfo.clientPhone ? "(" + d.deliveryInfo.clientPhone + ")" : ""}`.trim()
        : String(d.deliveryInfo);
    const locStr =
      typeof d.deliveryInfo === "object"
        ? d.deliveryInfo.clientLocation || ""
        : "";
    deliveryBlock = `
            <div class="divider"></div>
            <div style="font-weight:bold;margin-bottom:3px;">🚚 DELIVERY</div>
            <div class="row"><span>Client:</span><span>${clientStr}</span></div>
            ${locStr ? `<div class="row"><span>Location:</span><span>${locStr}</span></div>` : ""}`;
  }

  const logoSrc =
    localStorage.getItem("jomish_logo_base64") || "assets/default-logo.png";

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>${heading} #${d.orderId}</title>
<style>
/* ─── 80mm thermal roll paper ─── */
@page {
    size: 80mm auto;
    margin: 3mm 2mm;
}
* { box-sizing: border-box; margin: 0; padding: 0; }
body {
    font-family: 'Courier New', Courier, monospace;
    font-size: 11pt;
    line-height: 1.4;
    width: 76mm;
    color: #000;
    background: #fff;
}
/* Screen preview */
@media screen {
    body {
        max-width: 320px;
        margin: 20px auto;
        padding: 16px;
        font-size: 12px;
        border: 1px dashed #aaa;
        border-radius: 4px;
        background: #fff;
    }
}
.center    { text-align: center; }
.bold      { font-weight: bold; }
.upper     { text-transform: uppercase; }
.biz-name  { font-size: 14pt; font-weight: bold; text-transform: uppercase; letter-spacing: 1px; }
.meta      { font-size: 9pt; color: #444; }
.divider   { border-top: 1px dashed #888; margin: 6px 0; }
.divider-solid { border-top: 1px solid #000; margin: 6px 0; }
.heading   { font-size: 13pt; font-weight: bold; text-align: center; margin: 4px 0; }
.row       { display: flex; justify-content: space-between; margin: 2px 0; font-size: 10pt; }
.total-row { display: flex; justify-content: space-between; font-weight: bold; font-size: 12pt; margin-top: 4px; }
table      { width: 100%; border-collapse: collapse; }
th, td     { font-size: 10pt; vertical-align: top; }
th         { border-bottom: 1px dashed #888; padding: 3px 0; }
.footer    { text-align: center; font-size: 9pt; color: #555; margin-top: 10px; padding-top: 6px; border-top: 1px dashed #888; }
.logo      { max-height: 52px; max-width: 140px; }
</style>
</head>
<body>

<!-- Logo -->
<div class="center" style="margin-bottom:6px;">
    <img class="logo" src="${logoSrc}" alt="" onerror="this.style.display='none'">
</div>

<!-- Business info -->
<div class="center" style="margin-bottom:8px;">
    <div class="biz-name">${d.bizName}</div>
    ${d.bizLoc ? `<div class="meta">${d.bizLoc}</div>` : ""}
    ${d.bizTel ? `<div class="meta">${d.bizTel}</div>` : ""}
</div>

<div class="divider"></div>

<!-- Receipt heading -->
<div class="heading">${heading} #${d.orderId}</div>
<div class="row">
    <span>Date: ${d.dateStr}</span>
</div>
<div class="row">
    <span>Cashier: ${d.cashierName}</span>
</div>

<div class="divider"></div>

<!-- Items -->
<table>
    <thead>
        <tr>
            <th style="text-align:left;">Item</th>
            <th style="text-align:center; width:30px;">Qty</th>
            <th style="text-align:right;">Amount</th>
        </tr>
    </thead>
    <tbody>${itemRows}</tbody>
</table>

<div class="divider"></div>

<!-- Totals -->
<div class="row"><span>Subtotal:</span><span>${fmtUGX(d.sub)}</span></div>
${conditionalRows}
<div class="divider-solid"></div>
<div class="total-row"><span>TOTAL:</span><span>${fmtUGX(d.total)}</span></div>

<div class="divider"></div>

<!-- Payment -->
<div class="row"><span>Payment:</span><strong>${d.paymentMethod}</strong></div>
<div class="row"><span>Paid:</span><span>${fmtUGX(d.paid)}</span></div>
${deliveryBlock}

<!-- Footer -->
<div class="footer">
    <div class="bold">Thank you for your business!</div>
    <div style="font-size:8pt; font-style:italic; margin-top:3px;">Powered by Jomish Business Suite</div>
</div>

</body>
</html>`;
}

/**
 * Trigger window.print() via a hidden iframe to avoid popup blockers and freezing.
 * This is the ONLY print path — clean, reliable, works on every device.
 */
async function doPrint() {
  const d = _currentReceiptData;
  if (!d) {
    showToast("No receipt data to print.", "error");
    return;
  }

  const html = _buildReceiptHTML(d);

  // Remove old iframe if it exists
  let oldFrame = document.getElementById("print-iframe");
  if (oldFrame) {
    oldFrame.remove();
  }

  // Create a hidden iframe
  const iframe = document.createElement("iframe");
  iframe.id = "print-iframe";
  iframe.style.position = "absolute";
  iframe.style.width = "0px";
  iframe.style.height = "0px";
  iframe.style.border = "none";
  document.body.appendChild(iframe);

  const doc = iframe.contentWindow.document;
  doc.open();
  doc.write(html);
  doc.close();

  // Trigger print once the iframe content loads
  iframe.onload = () => {
    iframe.contentWindow.focus();
    iframe.contentWindow.print();
  };

  // Fallback: trigger print after 500ms if onload doesn't fire
  setTimeout(() => {
    try {
      iframe.contentWindow.focus();
      iframe.contentWindow.print();
    } catch (e) {}
  }, 500);
}

// ==== HARDWARE TEST PRINT FUNCTIONS ====

function testPrintReceipt() {
  const testItems = [
    { name: "Bread (Large)", price: 8000, qty: 2 },
    { name: "Milk 500ml", price: 3500, qty: 1 },
    { name: "Test Product", price: 12000, qty: 1 },
  ];
  const total = testItems.reduce((s, i) => s + i.price * i.qty, 0);
  printReceipt(testItems, total, 9999, "CASH", total);
  showToast("Test receipt generated — click Print in the modal.", "success");
}

function testPrintLabel() {
  printProductLabelsRange("TEST PRODUCT", 100001, 100001, 5000);
  showToast("1 test barcode sticker generated (38×25mm)", "success");
}

function testPrintID() {
  const testEmp = {
    id: 0,
    first_name: "Test",
    last_name: "Employee",
    role: "Staff Member",
    employee_code: "TEST-001",
    photo_base64: null,
  };
  generateIDCard(testEmp);
  showToast("Test ID card printed (85.6×54mm CR80)", "success");
}

// ==== WEBSERIAL THERMAL PRINTER INTEGRATION ====
// Drives the "⚡ Direct Print" button on the receipt modal and the
// Hardware Settings connection panel for the TrackSol TIRP-80-WRU
// (and any POS-80 class 80mm ESC/POS USB thermal printer).
// ================================================================

/**
 * Update all UI elements that reflect the WebSerial connection state.
 * Called automatically by ThermalSerial.onStatusChange().
 *
 * @param {boolean} connected
 * @param {string|null} label
 */
function _updateThermalSerialUI(connected, label) {
  // ── Status pill (Hardware Settings panel) ─────────────────────────
  const pill = document.getElementById("serial-status-pill");
  const dot = document.getElementById("serial-status-dot");
  const statusTx = document.getElementById("serial-status-text");
  const connectI = document.getElementById("serial-connect-icon");
  const connectL = document.getElementById("serial-connect-label");
  const testBtn = document.getElementById("btn-serial-test");
  const hwEscBtn = document.getElementById("hw-test-escpos");

  if (pill) {
    if (connected) {
      pill.style.background = "rgba(16,185,129,0.12)";
      pill.style.border = "1px solid rgba(16,185,129,0.35)";
      pill.style.color = "#10B981";
    } else {
      pill.style.background = "rgba(239,68,68,0.1)";
      pill.style.border = "1px solid rgba(239,68,68,0.3)";
      pill.style.color = "#EF4444";
    }
  }
  if (dot) dot.style.background = connected ? "#10B981" : "#EF4444";
  if (statusTx)
    statusTx.textContent = connected ? label || "Connected" : "Not Connected";
  if (connectI)
    connectI.className = connected
      ? "fa-solid fa-plug-circle-xmark"
      : "fa-solid fa-plug";
  if (connectL)
    connectL.textContent = connected ? "Disconnect" : "Connect Printer";

  // Show/hide Test ESC/POS buttons
  if (testBtn) testBtn.style.display = connected ? "flex" : "none";
  if (hwEscBtn) hwEscBtn.style.display = connected ? "inline" : "none";

  // ── Thermal Printer stat card ─────────────────────────────────────
  const hwCard = document.getElementById("hw-thermal-status");
  if (hwCard) {
    hwCard.innerHTML = connected
      ? '<i class="fa-solid fa-circle-check"></i> Online'
      : '<i class="fa-solid fa-circle-xmark"></i> Offline';
    hwCard.style.color = connected ? "#10B981" : "#EF4444";
  }

  // ── Receipt modal — show "not connected" hint under Direct Print ───
  const hint = document.getElementById("receipt-printer-status");
  if (hint) hint.style.display = connected ? "none" : "block";
}

/**
 * Toggle connect / disconnect from the Hardware Settings panel.
 */
async function thermalSerialToggle() {
  if (!("serial" in navigator)) {
    showToast(
      "Web Serial is not supported in this browser. Use Chrome or Edge.",
      "danger",
    );
    return;
  }

  if (ThermalSerial.isConnected()) {
    await ThermalSerial.disconnect();
    showToast("Thermal printer disconnected.", "info");
  } else {
    const baudSel = document.getElementById("serial-baud-select");
    const baud = baudSel ? parseInt(baudSel.value, 10) : 9600;
    try {
      showToast("Opening port picker… select your COM port.", "info");
      await ThermalSerial.connect(baud);
      showToast(
        '✅ Thermal printer connected! Click "Test ESC/POS" to verify.',
        "success",
      );
    } catch (err) {
      if (err.name === "NotFoundError" || err.message.includes("cancelled")) {
        showToast("Port selection cancelled.", "info");
      } else {
        showToast("Connection failed: " + err.message, "danger");
      }
    }
  }
}

/**
 * Send a live receipt directly to the thermal printer via WebSerial.
 * Called by the "⚡ Direct Print" button on the receipt modal.
 * Falls back to window.print() if the printer isn't connected.
 */
async function thermalSerialPrint() {
  if (!_currentReceiptData) {
    showToast("No receipt data to print.", "error");
    return;
  }

  if (!("serial" in navigator)) {
    // Browser doesn't support WebSerial — silently fall back
    showToast(
      "WebSerial not supported — using browser dialog instead.",
      "info",
    );
    doPrint();
    return;
  }

  if (!ThermalSerial.isConnected()) {
    showToast(
      "Printer not connected. Please select your printer from the popup.",
      "warning",
    );
    await thermalSerialToggle();
    if (!ThermalSerial.isConnected()) {
      return; // user cancelled or failed to connect
    }
  }

  const btn = document.getElementById("btn-direct-print");
  if (btn) {
    btn.disabled = true;
    btn.innerHTML =
      '<i class="fa-solid fa-circle-notch fa-spin"></i> Printing…';
  }

  try {
    await ThermalSerial.printReceipt(_currentReceiptData);
    showToast("✅ Receipt sent to printer!", "success");
    // Auto-close the modal after a brief moment
    setTimeout(closeReceipt, 900);
  } catch (err) {
    console.error("[ThermalSerial] printReceipt failed:", err);
    showToast("Print failed: " + err.message, "danger");
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<i class="fa-solid fa-bolt"></i> Direct Print';
    }
  }
}

/**
 * Send a test banner to the thermal printer from Hardware Settings.
 */
async function thermalSerialTestPrint() {
  if (!ThermalSerial.isConnected()) {
    showToast("Connect the printer first.", "danger");
    return;
  }
  const btn = document.getElementById("btn-serial-test");
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Sending…';
  }
  try {
    const bizName =
      localStorage.getItem("jomish_biz_name") || "Jomish Business";
    await ThermalSerial.testPrint(bizName);
    showToast("✅ ESC/POS test sent — paper should cut now!", "success");
  } catch (err) {
    showToast("Test print failed: " + err.message, "danger");
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<i class="fa-solid fa-bolt"></i> Test ESC/POS Print';
    }
  }
}

// Register status-change callback and attempt auto-reconnect on load.
// Using DOMContentLoaded in case this runs after thermal-serial.js.
(function _initThermalSerial() {
  function setup() {
    if (typeof ThermalSerial === "undefined") return; // library not loaded
    ThermalSerial.onStatusChange(_updateThermalSerialUI);
    ThermalSerial.autoReconnect(); // silently re-opens last port if still available
    // Restore saved baud rate into the selector
    const saved = localStorage.getItem("jomish_thermal_baud");
    if (saved) {
      const sel = document.getElementById("serial-baud-select");
      if (sel) sel.value = saved;
    }
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", setup);
  } else {
    // DOM already ready — defer one tick so thermal-serial.js has time to execute
    setTimeout(setup, 0);
  }
})();

// ==== OTHER HELPERS ====

async function handleAddSchedule(e) {
  // Legacy handler — the new override modal (openShiftModal) handles all assignments.
  // This stub prevents errors from the old listener binding.
  if (e) e.preventDefault();
  showToast("Use the Shift Timetable tab to assign shifts.", "info");
}

async function loadRoles() {
  try {
    const res = await fetchAuth(`${API_URL}/roles`);
    const data = await res.json();
    const tbody = document.querySelector("#roles-table tbody");
    if (!tbody) return;
    tbody.innerHTML = "";
    data.roles.forEach((r) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `<td style="font-weight:bold;">
                    ${r.role_name}
                    <button class="icon-btn action-btn" onclick="promptSetRolePassword('${r.role_name}')" title="Set Portal Password for this Role" style="margin-left: 8px; font-size: 0.8rem; padding: 2px 6px;">
                        <i class="fa-solid fa-key"></i>
                    </button>
                </td>
                <td><input type="checkbox" ${r.can_see_dashboard ? "checked" : ""} onchange="updateRole('${r.role_name}', 'dashboard', this.checked)"></td>
                <td><input type="checkbox" ${r.can_see_hr ? "checked" : ""} onchange="updateRole('${r.role_name}', 'hr', this.checked)"></td>
                <td><input type="checkbox" ${r.can_see_attendance ? "checked" : ""} onchange="updateRole('${r.role_name}', 'attendance', this.checked)"></td>
                <td><input type="checkbox" ${r.can_see_sme ? "checked" : ""} onchange="updateRole('${r.role_name}', 'sme', this.checked)"></td>
                <td><input type="checkbox" ${r.can_see_pos ? "checked" : ""} onchange="updateRole('${r.role_name}', 'pos', this.checked)"></td>
                <td><input type="checkbox" ${r.can_see_secretary ? "checked" : ""} onchange="updateRole('${r.role_name}', 'secretary', this.checked)"></td>
                <td><input type="checkbox" ${r.can_see_transport ? "checked" : ""} onchange="updateRole('${r.role_name}', 'transport', this.checked)"></td>
                <td><input type="checkbox" ${r.can_see_hardware ? "checked" : ""} onchange="updateRole('${r.role_name}', 'hardware', this.checked)"></td>
                <td><input type="checkbox" ${r.can_see_system_users ? "checked" : ""} onchange="updateRole('${r.role_name}', 'system_users', this.checked)"></td>
                <td><input type="checkbox" ${r.can_see_schedules ? "checked" : ""} onchange="updateRole('${r.role_name}', 'schedules', this.checked)"></td>`;
      tbody.appendChild(tr);
    });
  } catch (e) {
    console.error(e);
  }
}

async function promptAddRole() {
  const roleName = prompt("Enter the new role name:");
  if (!roleName || !roleName.trim()) return;

  try {
    const res = await fetchAuth(`${API_URL}/roles`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: roleName.trim() }),
    });
    if (res.ok) {
      showToast(`Role '${roleName}' created successfully!`, "success");
      loadRoles();
      // Try to refresh the select dropdown in the modal if it's visible
      loadRolesIntoSelect("emp-role", roleName.trim());
    } else {
      const data = await res.json();
      showToast(data.error || "Failed to create role", "danger");
    }
  } catch (e) {
    showToast("Network error while creating role.", "danger");
  }
}

// Pending role name — stored while waiting for password to be set
let _pendingRoleChange = null;

async function updateRole(roleName, module, isChecked) {
  const tbody = document.querySelector("#roles-table tbody");
  let row;
  for (let tr of tbody.children) {
    if (tr.children[0].innerText === roleName) {
      row = tr;
      break;
    }
  }
  if (!row) return;

  // 1. Collect current checkbox state and save permissions immediately
  const payload = {
    can_see_dashboard: row.children[1].querySelector("input").checked ? 1 : 0,
    can_see_hr: row.children[2].querySelector("input").checked ? 1 : 0,
    can_see_attendance: row.children[3].querySelector("input").checked ? 1 : 0,
    can_see_sme: row.children[4].querySelector("input").checked ? 1 : 0,
    can_see_pos: row.children[5].querySelector("input").checked ? 1 : 0,
    can_see_secretary: row.children[6].querySelector("input").checked ? 1 : 0,
    can_see_transport: row.children[7].querySelector("input").checked ? 1 : 0,
    can_see_hardware: row.children[8].querySelector("input").checked ? 1 : 0,
    can_see_system_users: row.children[9].querySelector("input").checked
      ? 1
      : 0,
    can_see_schedules: row.children[10].querySelector("input").checked ? 1 : 0,
  };

  try {
    await fetchAuth(`${API_URL}/roles/${roleName}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    showToast(`✅ Permissions for '${roleName}' updated!`, "success");
  } catch (e) {
    showToast("Failed to update role permissions.", "error");
    return;
  }
}

// New dedicated function to reset passwords for an entire role
window.promptSetRolePassword = function (roleName) {
  _pendingRoleChange = roleName;
  document.getElementById("confirm-pwd-desc").textContent =
    `Set the portal login password for all "${roleName}" users. They will use this to sign in.`;
  document.getElementById("confirm-pwd-input").value = "";
  document.getElementById("confirm-pwd-input").type = "password";
  document.getElementById("confirm-pwd-input").placeholder =
    "Type new portal password…";
  document.getElementById("confirm-pwd-error").style.display = "none";
  document.querySelector("#confirm-password-modal h3").innerHTML =
    '<i class="fa-solid fa-key"></i> Set Portal Password';
  document.getElementById("confirm-password-modal").classList.remove("hidden");
  setTimeout(() => document.getElementById("confirm-pwd-input").focus(), 100);
};

async function submitConfirmPassword() {
  const pwd = document.getElementById("confirm-pwd-input").value.trim();
  const errEl = document.getElementById("confirm-pwd-error");
  if (!pwd) {
    errEl.textContent = "Please enter a password.";
    errEl.style.display = "block";
    return;
  }

  const roleName = _pendingRoleChange;
  if (!roleName) {
    document.getElementById("confirm-password-modal").classList.add("hidden");
    return;
  }

  try {
    const res = await fetchAuth(
      `${API_URL}/roles/${encodeURIComponent(roleName)}/password`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: pwd }),
      },
    );
    const data = await res.json();
    if (!res.ok) {
      errEl.textContent = data.error || "Failed to set password.";
      errEl.style.display = "block";
      return;
    }

    document.getElementById("confirm-password-modal").classList.add("hidden");
    _pendingRoleChange = null;
    showToast(`🔑 ${data.message}`, "success");
  } catch (e) {
    showToast("Failed to set portal password.", "error");
  }
}

async function loadBrandLogo() {
  try {
    const res = await fetchAuth(`${API_URL}/settings/all`);
    const data = await res.json();

    // ─── GLOBAL TECH MODE ───────────────────────────────────────────────
    // When logged in as 'tech' (no company prefix), hide ALL company branding.
    // The global tech is a Jomish system account and must not see any company data.
    if (data._is_global_tech) {
      // Hide every company logo
      document.querySelectorAll(".global-logo").forEach((img) => {
        img.src = "";
        img.style.display = "none";
      });

      // Set sidebar brand to generic Jomish label
      const sideBrand = document.getElementById("sidebar-brand-name");
      if (sideBrand) {
        sideBrand.innerText = "Jomish Suite";
        sideBrand.style.display = "";
      }

      // Set dashboard header to generic label
      const dashHeader = document.querySelector("#dashboard header h1");
      if (dashHeader) dashHeader.innerText = "Jomish Business Suite";

      // Hide the receipt brand (receipts belong to companies, not global tech)
      const rBrand = document.getElementById("receipt-brand");
      if (rBrand) rBrand.innerText = "Jomish";

      // Clear any stale company name from previous login
      localStorage.removeItem("jomish_biz_name");
      localStorage.removeItem("jomish_biz_location");
      localStorage.removeItem("jomish_biz_contact");
      localStorage.removeItem("jomish_biz_color");
      localStorage.removeItem("jomish_emp_prefix");

      enforceRBAC();
      return; // Don't apply any company-specific settings
    }
    // ─── END GLOBAL TECH MODE ───────────────────────────────────────────

    // Apply Logo
    if (data.company_logo) {
      document.querySelectorAll(".global-logo").forEach((img) => {
        img.src = data.company_logo;
        img.style.display = "block";
      });
    }

    // Apply Business Name
    if (data.business_name) {
      const bizName = data.business_name;
      localStorage.setItem("jomish_biz_name", bizName);
      // Sidebar - reveal company brand after login
      const sideBrand = document.getElementById("sidebar-brand-name");
      if (sideBrand) {
        sideBrand.innerText = bizName;
        sideBrand.style.display = "";
      }
      // (Legacy selector fallback)
      const sideBrandLegacy = document.querySelector(
        ".brand h2:not(#sidebar-brand-name)",
      );
      if (sideBrandLegacy) sideBrandLegacy.innerText = bizName;

      // Dashboard Header
      const dashHeader = document.querySelector("#dashboard header h1");
      if (dashHeader) dashHeader.innerText = bizName + " Hub";

      // Receipt Header
      const rBrand = document.getElementById("receipt-brand");
      if (rBrand) rBrand.innerText = bizName.toUpperCase();

      // ID Card Header
      const idBrand = document.getElementById("id-biz-name-front");
      if (idBrand)
        idBrand.querySelector("span").textContent = bizName.toUpperCase();

      // Populate Input if on screen
      const bizInput = document.getElementById("business-name-input");
      if (bizInput) bizInput.value = bizName;
    }

    // Apply Other Business Settings
    if (data.business_location) {
      localStorage.setItem("jomish_biz_location", data.business_location);
      const locInput = document.getElementById("business-location-input");
      if (locInput) locInput.value = data.business_location;
    }
    if (data.business_contact) {
      localStorage.setItem("jomish_biz_contact", data.business_contact);
      const conInput = document.getElementById("business-contact-input");
      if (conInput) conInput.value = data.business_contact;
    }
    if (data.business_color) {
      localStorage.setItem("jomish_biz_color", data.business_color);
      const colorInput = document.getElementById("business-color-input");
      if (colorInput) colorInput.value = data.business_color;
    }
    if (data.emp_prefix) {
      localStorage.setItem("jomish_emp_prefix", data.emp_prefix);
      const prefixInput = document.getElementById("business-emp-prefix-input");
      if (prefixInput) prefixInput.value = data.emp_prefix;
    }

    const brandColor = localStorage.getItem("jomish_biz_color") || "#4F46E5";
    const frontCard = document.getElementById("id-card-front");
    const backCard = document.getElementById("id-card-back");
    if (frontCard) frontCard.style.setProperty("--brand-id-color", brandColor);
    if (backCard) backCard.style.setProperty("--brand-id-color", brandColor);

    // Apply Module Visibility Configuration
    if (data.business_modules) {
      try {
        const modules =
          typeof data.business_modules === "string"
            ? JSON.parse(data.business_modules)
            : data.business_modules;
        Object.assign(ENABLED_TABS, modules);

        // Populate checkboxes if elements exist
        [
          "dashboard",
          "hr",
          "attendance",
          "sme",
          "pos",
          "secretary",
          "transport",
          "schedules",
          "hardware",
        ].forEach((m) => {
          const cb = document.getElementById(`mod-${m}`);
          if (cb && modules[m] !== undefined) cb.checked = !!modules[m];
        });
        const cbSysUser = document.getElementById("mod-system-users");
        if (cbSysUser && modules.system_users !== undefined)
          cbSysUser.checked = !!modules.system_users;
      } catch (e) {
        console.error("Failed to parse business_modules setting", e);
      }
    }

    if (data.global_shifts) {
      try {
        const s =
          typeof data.global_shifts === "string"
            ? JSON.parse(data.global_shifts)
            : data.global_shifts;
        if (Array.isArray(s) && s.length > 0) {
          GLOBAL_SHIFTS = s;
        }
      } catch (e) {
        console.error("Failed to parse global_shifts", e);
      }
    }
    if (data.global_operational_days) {
      try {
        const d =
          typeof data.global_operational_days === "string"
            ? JSON.parse(data.global_operational_days)
            : data.global_operational_days;
        if (Array.isArray(d)) {
          GLOBAL_OPERATIONAL_DAYS = d;
        }
      } catch (e) {
        console.error("Failed to parse global_operational_days", e);
      }
    }

    // Populate days UI
    document.querySelectorAll("#tech-shift-days input").forEach((i) => {
      i.checked = GLOBAL_OPERATIONAL_DAYS.includes(i.value);
    });

    renderTechShifts();
    enforceRBAC();
  } catch (e) {
    console.error(e);
  }
}

async function handleLogoUpload() {
  const input = document.getElementById("upload-logo-input");
  if (!input.files || input.files.length === 0) return alert("Select file");
  const file = input.files[0];
  const reader = new FileReader();
  reader.onload = async (e) => {
    const res = await fetchAuth(`${API_URL}/settings/logo`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ logo_base64: e.target.result }),
    });
    if (res.ok) {
      showToast("Logo Updated Everywhere!", "success");
      loadBrandLogo();
    } else {
      const data = await res.json();
      showToast("Error: " + (data.error || "Could not upload logo"), "danger");
    }
  };
  reader.readAsDataURL(file);
}

async function handleSignatureUpload() {
  const input = document.getElementById("upload-signature-input");
  if (!input.files || input.files.length === 0) return alert("Select file");
  const file = input.files[0];
  const reader = new FileReader();
  reader.onload = async (e) => {
    const res = await fetchAuth(`${API_URL}/settings/signature`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ signature_base64: e.target.result }),
    });
    if (res.ok) {
      showToast("Signature Updated Everywhere!", "success");
    } else {
      const data = await res.json();
      showToast(
        "Error: " + (data.error || "Could not upload signature"),
        "danger",
      );
    }
  };
  reader.readAsDataURL(file);
}

async function handleDetailsUpdate() {
  const name = document.getElementById("business-name-input").value;
  const location = document.getElementById("business-location-input").value;
  const contact = document.getElementById("business-contact-input").value;
  const color = document.getElementById("business-color-input").value;
  const empPrefix = document.getElementById("business-emp-prefix-input").value;

  const res = await fetchAuth(`${API_URL}/settings/details`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      business_name: name,
      business_location: location,
      business_contact: contact,
      business_color: color,
      emp_prefix: empPrefix,
    }),
  });
  if (res.ok) {
    showToast("Business Details & Color Updated Successfully!", "success");
    loadBrandLogo();
  } else {
    const data = await res.json();
    showToast("Error: " + (data.error || "Could not save details"), "danger");
  }
}

async function handleSaveModulesUpdate() {
  const btn = document.getElementById("btn-save-modules");
  if (btn) {
    btn.disabled = true;
    btn.textContent = "Saving...";
  }

  const modules = {
    dashboard: document.getElementById("mod-dashboard").checked,
    hr: document.getElementById("mod-hr").checked,
    attendance: document.getElementById("mod-attendance").checked,
    sme: document.getElementById("mod-sme").checked,
    pos: document.getElementById("mod-pos").checked,
    secretary: document.getElementById("mod-secretary").checked,
    transport: document.getElementById("mod-transport")
      ? document.getElementById("mod-transport").checked
      : true,
    schedules: document.getElementById("mod-schedules")
      ? document.getElementById("mod-schedules").checked
      : true,
    hardware: document.getElementById("mod-hardware")
      ? document.getElementById("mod-hardware").checked
      : true,
    system_users: document.getElementById("mod-system-users")
      ? document.getElementById("mod-system-users").checked
      : true,
  };

  try {
    const res = await fetchAuth(`${API_URL}/settings`, {
      method: "POST",
      body: JSON.stringify({
        key: "business_modules",
        data: modules,
      }),
    });

    if (res.ok) {
      alert("Custom Active Tabs Saved Successfully!");
      // Immediate local update
      Object.assign(ENABLED_TABS, modules);
      enforceRBAC();
    } else {
      const data = await res.json();
      alert("Error: " + (data.error || "Failed to save configuration."));
    }
  } catch (err) {
    console.error("Modules Update Error:", err);
    alert("Network Error. Please check server connection.");
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = "Save Custom Active Tabs";
    }
  }
}

function renderTechShifts() {
  const container = document.getElementById("tech-shifts-container");
  if (!container) return;
  container.innerHTML = "";
  GLOBAL_SHIFTS.forEach((shift, idx) => {
    container.innerHTML += `
            <div style="display:flex; gap:10px; align-items:center; background:var(--background); padding:10px; border-radius:8px; border:1px solid var(--border);">
                <input type="text" id="tech-shift-label-${idx}" value="${shift.label}" class="form-control" style="flex:2" placeholder="Shift Name (e.g. Day)">
                <input type="time" id="tech-shift-start-${idx}" value="${shift.start_time || "00:00"}" class="form-control" style="flex:1">
                <span style="color:#94A3B8">to</span>
                <input type="time" id="tech-shift-end-${idx}" value="${shift.end_time || "00:00"}" class="form-control" style="flex:1">
                <button class="secondary-btn" onclick="removeTechShift(${idx})" style="color:var(--danger); border-color:transparent;"><i class="fa-solid fa-trash"></i></button>
            </div>
        `;
  });
}

window.addTechShift = function () {
  GLOBAL_SHIFTS.push({
    id: "shift_" + Date.now(),
    label: "New Shift",
    icon: "fa-solid fa-clock",
    color: "#6366F1",
    start_time: "08:00",
    end_time: "17:00",
  });
  renderTechShifts();
};

window.removeTechShift = function (idx) {
  GLOBAL_SHIFTS.splice(idx, 1);
  renderTechShifts();
};

window.saveTechShifts = async function () {
  for (let i = 0; i < GLOBAL_SHIFTS.length; i++) {
    const label =
      document.getElementById("tech-shift-label-" + i).value || "Shift " + i;
    GLOBAL_SHIFTS[i].label = label;
    GLOBAL_SHIFTS[i].id = label.toLowerCase().replace(/[^a-z0-9]/g, "");
    GLOBAL_SHIFTS[i].start_time =
      document.getElementById("tech-shift-start-" + i).value || "00:00";
    GLOBAL_SHIFTS[i].end_time =
      document.getElementById("tech-shift-end-" + i).value || "00:00";
  }

  GLOBAL_OPERATIONAL_DAYS = Array.from(
    document.querySelectorAll("#tech-shift-days input:checked"),
  ).map((i) => i.value);

  try {
    const res1 = await fetchAuth(`${API_URL}/settings`, {
      method: "POST",
      body: JSON.stringify({ key: "global_shifts", data: GLOBAL_SHIFTS }),
    });
    const res2 = await fetchAuth(`${API_URL}/settings`, {
      method: "POST",
      body: JSON.stringify({
        key: "global_operational_days",
        data: GLOBAL_OPERATIONAL_DAYS,
      }),
    });
    if (res1.ok && res2.ok) {
      showToast("Shift Configuration Saved!", "success");
      if (window.loadShiftTimetable) window.loadShiftTimetable(); // refresh UI if active
    } else {
      alert("Failed to save shifts or days.");
    }
  } catch (e) {
    console.error(e);
    alert("Error saving shifts");
  }
};

async function loadAttendance() {

  // 1. Load History Logs (Independent Catch)
  try {
    const res = await fetchAuth(`${API_URL}/attendance`);
    const data = await res.json();
    const tbody = document.querySelector("#attendance-table tbody");
    if (tbody) {
      tbody.innerHTML = "";
      data.attendance.forEach((log) => {
        const tr = document.createElement("tr");
        tr.innerHTML = `<td>SCAN-${log.id}</td><td>${log.first_name} ${log.last_name}</td><td>${formatDisplayDate(log.scan_time, true)}</td><td>${log.scan_type}</td><td style="color: ${log.scan_type === "IN" ? "var(--success)" : "var(--danger)"}; font-weight:bold;">${log.scan_type}</td>`;
        tbody.appendChild(tr);
      });
    }
  } catch (e) {
    console.error("History Log Error:", e);
  }

  // 2. Load Present Staff (Independent Catch)
  try {
    const presRes = await fetchAuth(`${API_URL}/attendance/present`);
    const presData = await presRes.json();

    const pTbody = document.querySelector("#present-staff-table tbody");
    if (pTbody) {
      pTbody.innerHTML = "";
      const present = presData.present_staff || [];
      if (present.length === 0) {
        pTbody.innerHTML =
          '<tr><td colspan="4" style="text-align:center; padding:20px; color:var(--text-muted);">No staff currently in building.</td></tr>';
      } else {
        present.forEach((e) => {
          const tr = document.createElement("tr");
          let timeStr = "Recently";
          if (e.login_time) {
            try {
              const date = new Date(e.login_time);
              if (!isNaN(date.getTime())) {
                timeStr = date.toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                });
              }
            } catch (err) {}
          }

          tr.innerHTML = `
                        <td><strong>${e.first_name} ${e.last_name}</strong></td>
                        <td>${e.role}</td>
                        <td style="color:var(--primary); font-weight:bold;">${timeStr}</td>
                        <td><button class="sm-btn danger" onclick="clockOutStaff(${e.id})">Clock Out</button></td>
                    `;
          pTbody.appendChild(tr);
        });
      }
    } else {
      console.error(
        "Attendance: Table #present-staff-table tbody not found in DOM!",
      );
    }
  } catch (e) {
    console.error("Presence Monitoring Error:", e);
  }
}

async function downloadAttendancePDF() {
  try {
    const { jsPDF } = window.jspdf;
    const res = await fetchAuth(`${API_URL}/attendance`);
    const data = await res.json();

    const doc = new jsPDF();

    // Header
    doc.setFontSize(22);
    doc.text("Jomish Business Suite", 14, 20);
    doc.setFontSize(12);
    doc.setTextColor(100);
    doc.text("Employee Attendance History Report", 14, 30);
    doc.text(`Generated on: ${new Date().toLocaleString()}`, 14, 37);

    // Table
    const columns = ["ID", "Staff Name", "Date & Time", "Action", "Status"];
    const rows = data.attendance.map((log) => [
      `SCAN-${log.id}`,
      `${log.first_name} ${log.last_name}`,
      new Date(log.scan_time).toLocaleString(),
      log.scan_type,
      log.status,
    ]);

    doc.autoTable({
      startY: 45,
      head: [columns],
      body: rows,
      theme: "striped",
      headStyles: { fillColor: [79, 70, 229] }, // Jomish Indigo
    });

    doc.save(`Attendance_Report_${new Date().toISOString().split("T")[0]}.pdf`);
  } catch (e) {
    console.error(e);
    alert("Failed to generate PDF. Make sure you are connected.");
  }
}

// ── SME Filter State ──────────────────────────────────────────────────────────
window._smeAllTransactions = [];
window._smeDateRange = "all";

async function loadTransactions(searchTerm = "") {
  try {
    const res = await fetchAuth(`${API_URL}/transactions?t=${Date.now()}`);
    if (!res.ok) {
      const err = await res.json();
      console.error("TX Load Error:", err);
      return;
    }
    const data = await res.json();
    window._smeAllTransactions = data.transactions || [];
    renderSMETransactions(searchTerm);
  } catch (e) {
    console.error("TX Network Error:", e);
  }
}

function renderSMETransactions(searchTerm = "") {
  const tbody = document.querySelector("#transactions-table tbody");
  if (!tbody) return;
  tbody.innerHTML = "";

  const search = (
    searchTerm ||
    document.getElementById("sme-search")?.value ||
    ""
  ).toLowerCase();
  const typeFilter = document.getElementById("sme-filter-type")?.value || "";
  const catFilter = document.getElementById("sme-filter-category")?.value || "";
  const fromVal = document.getElementById("sme-filter-from")?.value;
  const toVal = document.getElementById("sme-filter-to")?.value;

  // Build date bounds from quick-select or custom inputs
  let fromDate = null,
    toDate = null;
  const now = new Date();
  if (window._smeDateRange === "today") {
    fromDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    toDate = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
      23,
      59,
      59,
    );
  } else if (window._smeDateRange === "week") {
    const day = now.getDay();
    fromDate = new Date(now);
    fromDate.setDate(now.getDate() - day);
    fromDate.setHours(0, 0, 0, 0);
    toDate = new Date(now);
    toDate.setHours(23, 59, 59, 999);
  } else if (window._smeDateRange === "month") {
    fromDate = new Date(now.getFullYear(), now.getMonth(), 1);
    toDate = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
  } else if (fromVal || toVal) {
    if (fromVal) {
      fromDate = new Date(fromVal);
      fromDate.setHours(0, 0, 0, 0);
    }
    if (toVal) {
      toDate = new Date(toVal);
      toDate.setHours(23, 59, 59, 999);
    }
  }

  // Category keyword map
  const categoryKeywords = {
    petty: ["petty cash"],
    cash_drop: ["cash drop", "remit"],
    payroll: ["salary", "payroll", "wage"],
    pos: ["pos", "sale", "receipt"],
  };

  let filtered = window._smeAllTransactions.filter((tx) => {
    const desc = (tx.description || "").toLowerCase();
    const txDate = new Date(tx.transaction_date);

    if (
      search &&
      !String(tx.id).includes(search) &&
      !String(tx.id).padStart(4, "0").includes(search) &&
      !desc.includes(search)
    )
      return false;
    if (typeFilter && tx.type !== typeFilter) return false;
    if (catFilter) {
      const keywords = categoryKeywords[catFilter] || [];
      if (!keywords.some((k) => desc.includes(k))) return false;
    }
    if (fromDate && txDate < fromDate) return false;
    if (toDate && txDate > toDate) return false;
    return true;
  });

  // Update summary bar
  const totalIncome = filtered
    .filter((t) => t.type === "INCOME")
    .reduce((s, t) => s + t.amount, 0);
  const totalExpense = filtered
    .filter((t) => t.type !== "INCOME")
    .reduce((s, t) => s + t.amount, 0);
  const summaryEl = document.getElementById("sme-filter-summary");
  if (summaryEl) {
    summaryEl.innerHTML =
      filtered.length === 0
        ? "No records"
        : `<span style="color:var(--success)">+UGX ${totalIncome.toLocaleString()}</span> &nbsp;|&nbsp; <span style="color:var(--danger)">-UGX ${totalExpense.toLocaleString()}</span> &nbsp;|&nbsp; <strong>${filtered.length} records</strong>`;
  }

  if (filtered.length === 0) {
    tbody.innerHTML =
      '<tr><td colspan="7" style="text-align:center; padding:20px; color:var(--text-muted);">No records match your filters.</td></tr>';
    return;
  }

  filtered.forEach((tx) => {
    const color = tx.type === "INCOME" ? "var(--success)" : "var(--danger)";
    const receiptNo = String(tx.id).padStart(4, "0");
    const tr = document.createElement("tr");
    const canDelete =
      ["CEO", "HR"].includes(USER_ROLE) || USER_NAME === "System Technician";
    const actionHtml = canDelete
      ? `<td><button class='sm-btn danger' onclick="deleteTransaction(${tx.id})" style="padding:4px 10px;font-weight:bold;border-radius:6px;font-size:0.75rem;"><i class="fa-solid fa-trash"></i> Delete</button></td>`
      : `<td>—</td>`;
    let displayType = tx.type;
    if (tx.type === "GOODS_ON_CREDIT") displayType = "GOODS ON CREDIT";
    const cashierName = tx.recorded_by_name || "—";
    tr.innerHTML = `<td><a href="#" onclick="viewReceiptDetails(${tx.id}); return false;" style="color:var(--primary);font-weight:bold;text-decoration:none;">RCPT-${receiptNo}</a></td><td>${formatDisplayDate(tx.transaction_date, true)}</td><td style="color:${color};font-weight:bold;">${tx.type === "INCOME" ? "+" : "-"}UGX ${tx.amount.toLocaleString()}</td><td>${displayType}</td><td>${tx.description}</td><td>${cashierName}</td>${actionHtml}`;
    tbody.appendChild(tr);
  });
}

window.setSMEDateFilter = function (range, btn) {
  window._smeDateRange = range;
  // Clear custom date inputs when using quick filter
  if (range !== "custom") {
    const f = document.getElementById("sme-filter-from");
    const t = document.getElementById("sme-filter-to");
    if (f) f.value = "";
    if (t) t.value = "";
  }
  // Update active button style
  document
    .querySelectorAll(".sme-date-btn")
    .forEach((b) => b.classList.remove("active"));
  if (btn) btn.classList.add("active");
  renderSMETransactions();
};

window.applyAllSMEFilters = function () {
  // If user picks a custom date, deactivate quick-select buttons
  window._smeDateRange = "custom";
  document
    .querySelectorAll(".sme-date-btn")
    .forEach((b) => b.classList.remove("active"));
  renderSMETransactions();
};

window.resetSMEFilters = function () {
  window._smeDateRange = "all";
  const fields = [
    "sme-filter-from",
    "sme-filter-to",
    "sme-filter-type",
    "sme-filter-category",
    "sme-search",
  ];
  fields.forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.value = "";
  });
  document
    .querySelectorAll(".sme-date-btn")
    .forEach((b) => b.classList.remove("active"));
  const allBtn = document.querySelector('.sme-date-btn[data-range="all"]');
  if (allBtn) allBtn.classList.add("active");
  renderSMETransactions();
};

function toggleSmeView(view) {
  if (view === "transactions") {
    document.getElementById("sme-view-transactions").style.display = "block";
    document.getElementById("sme-view-reports").style.display = "none";
  } else {
    document.getElementById("sme-view-transactions").style.display = "none";
    document.getElementById("sme-view-reports").style.display = "block";
    populateCashierSelect();
  }
}

async function viewReceiptDetails(txId) {
  try {
    const res = await fetchAuth(`${API_URL}/pos_orders/tx/${txId}`);
    if (!res.ok) {
      showToast("Receipt details not found or not a POS order.", "error");
      return;
    }
    const order = await res.json();

    document.getElementById("rd-tx-id").textContent =
      `RCPT-${String(txId).padStart(4, "0")}`;
    document.getElementById("rd-cashier").textContent =
      order.cashier_name || "System";
    document.getElementById("rd-date").textContent = formatDisplayDate(
      order.order_date,
      true,
    );

    const tbody = document.getElementById("rd-items-body");
    tbody.innerHTML = "";

    if (!order.items || order.items.length === 0) {
      tbody.innerHTML =
        '<tr><td colspan="4" style="text-align:center; color:var(--text-muted); padding:20px;">Itemized data not available for this legacy receipt.</td></tr>';
    } else {
      order.items.forEach((item) => {
        tbody.innerHTML += `
                    <tr>
                        <td style="padding:8px; border-bottom:1px solid var(--border);">${item.product_name}</td>
                        <td style="text-align:center; padding:8px; border-bottom:1px solid var(--border);">${item.qty}</td>
                        <td style="text-align:right; padding:8px; border-bottom:1px solid var(--border);">UGX ${item.price.toLocaleString()}</td>
                        <td style="text-align:right; padding:8px; border-bottom:1px solid var(--border); font-weight:bold;">UGX ${(item.total || item.price * item.qty).toLocaleString()}</td>
                    </tr>
                `;
      });
    }

    document.getElementById("rd-grand-total").textContent =
      `UGX ${order.total_amount.toLocaleString()}`;
    document.getElementById("receipt-details-modal").classList.remove("hidden");
  } catch (e) {
    console.error("Error fetching receipt details:", e);
    showToast("Network error fetching receipt details.", "error");
  }
}

async function populateCashierSelect() {
  try {
    const res = await fetchAuth(`${API_URL}/employees`);
    if (!res.ok) return;
    const data = await res.json();
    const select = document.getElementById("report-cashier-select");
    const currentVal = select.value;
    select.innerHTML = '<option value="">All Cashiers</option>';
    data.employees.forEach((emp) => {
      if (emp.role === "Cashier" || emp.role === "CEO" || emp.role === "HR") {
        const opt = document.createElement("option");
        opt.value = emp.id;
        opt.textContent = emp.nickname || `${emp.first_name} ${emp.last_name}`;
        select.appendChild(opt);
      }
    });
    const optTech = document.createElement("option");
    optTech.value = "9999";
    optTech.textContent = "System Technician";
    select.appendChild(optTech);
    select.value = currentVal;
  } catch (e) {
    console.error("Error populating cashiers:", e);
  }
}

async function loadCashierReport() {
  const start = document.getElementById("report-start-date").value;
  const end = document.getElementById("report-end-date").value;
  const cashierId = document.getElementById("report-cashier-select").value;

  if (!start || !end) {
    showToast("Please select both start and end dates.", "error");
    return;
  }

  let url = `${API_URL}/reports/sme-cashier?start_date=${start}&end_date=${end}`;
  if (cashierId) url += `&cashier_id=${cashierId}`;

  try {
    const res = await fetchAuth(url);
    if (!res.ok) throw new Error("Failed to load report");
    const data = await res.json();

    const tbody = document.querySelector("#cashier-report-table tbody");
    tbody.innerHTML = "";

    if (!data.reports || data.reports.length === 0) {
      tbody.innerHTML =
        '<tr><td colspan="6" style="text-align:center; padding:20px; color:var(--text-muted);">No records found in this period.</td></tr>';
      return;
    }

    data.reports.forEach((rep) => {
      const tr = document.createElement("tr");
      const inc = rep.total_income || 0;
      const exp = rep.total_expense || 0;
      const net = inc - exp;
      const netColor = net >= 0 ? "var(--success)" : "var(--danger)";
      tr.innerHTML = `
                <td style="font-weight:bold;">${rep.cashier_name || "System Technician"}</td>
                <td style="text-align:center;">${rep.income_count || 0}</td>
                <td style="text-align:center;">${rep.expense_count || 0}</td>
                <td style="text-align:right; color:var(--success);">UGX ${inc.toLocaleString()}</td>
                <td style="text-align:right; color:var(--danger);">UGX ${exp.toLocaleString()}</td>
                <td style="text-align:right; font-weight:bold; color:${netColor};">UGX ${net.toLocaleString()}</td>
            `;
      tbody.appendChild(tr);
    });
  } catch (e) {
    console.error("Error fetching report:", e);
    showToast("Error fetching report data.", "error");
  }
}

async function handleAddTx(e) {
  e.preventDefault();

  const amount = parseFloat(document.getElementById("tx-amount").value);
  const type = document.getElementById("tx-type").value;
  const description = document.getElementById("tx-desc").value;

  const payload = { amount, type, description };

  const backdateToggle = document.getElementById("tx-backdate-toggle");
  if (backdateToggle && backdateToggle.checked) {
    const datetimeVal = document.getElementById("tx-datetime").value;
    if (datetimeVal) {
      payload.transaction_date = new Date(datetimeVal).toISOString();
    }
  }

  try {
    const res = await fetchAuth(`${API_URL}/transactions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (res.ok) {
      showToast("Transaction saved", "success");
      document.getElementById("add-tx-modal").classList.add("hidden");
      document.getElementById("form-add-tx").reset();

      // Hide backdate container on reset
      const container = document.getElementById("tx-datetime-container");
      if (container) container.classList.add("hidden");

      loadTransactions();
      loadDashboard();
    } else {
      const data = await res.json();
      showToast(data.error || "Failed to save transaction", "danger");
    }
  } catch (e) {
    showToast("Network error. Please check server.", "danger");
  }
}

function toggleBackdateField() {
  const isChecked = document.getElementById("tx-backdate-toggle").checked;
  const container = document.getElementById("tx-datetime-container");
  if (container) {
    if (isChecked) {
      container.classList.remove("hidden");
      const now = new Date();
      const offsetMs = now.getTimezoneOffset() * 60 * 1000;
      const localISOTime = new Date(now.getTime() - offsetMs)
        .toISOString()
        .substring(0, 16);
      document.getElementById("tx-datetime").value = localISOTime;
    } else {
      container.classList.add("hidden");
      document.getElementById("tx-datetime").value = "";
    }
  }
}

async function deleteTransaction(id) {
  const receiptNo = String(id).padStart(4, "0");
  if (
    !confirm(
      `<i class="fa-solid fa-triangle-exclamation"></i> WARNING: Are you absolutely sure you want to permanently delete transaction RCPT-${receiptNo}? This action is irreversible and will affect the financial portal history.`,
    )
  ) {
    return;
  }

  try {
    const res = await fetchAuth(`${API_URL}/transactions/${id}`, {
      method: "DELETE",
    });
    if (res.ok) {
      showToast(
        `Transaction RCPT-${receiptNo} deleted successfully.`,
        "success",
      );
      loadTransactions();
      loadDashboard();
    } else {
      const data = await res.json();
      alert("Error deleting transaction: " + (data.error || "Access Denied"));
    }
  } catch (e) {
    console.error("Delete Transaction Error:", e);
    alert("Network error. Check server connection.");
  }
}

async function resetDatabase() {
  // Custom prompt for Electron compatibility to avoid native confirm() focus loss
  const promptOverlay = document.createElement("div");
  promptOverlay.style =
    "position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.8); z-index:9999; display:flex; justify-content:center; align-items:center;";
  promptOverlay.innerHTML = `
        <div style="background:var(--surface); padding:24px; border-radius:12px; border:1px solid #EF4444; width:450px; text-align:center;">
            <h3 style="color:#EF4444; margin-top:0;"><i class="fa-solid fa-bell"></i> CRITICAL WARNING</h3>
            <p style="font-size:0.9rem; color:var(--danger); font-weight:bold; margin-bottom:10px;">
                You are about to permanently delete the entire database. This will wipe all employees, transactions, product inventories, attendance logs, and internal messages. This action is IRREVERSIBLE.
            </p>
            <p style="font-size:0.9rem; color:var(--text-muted); margin-bottom:16px;">To proceed with database destruction, please enter the Technician password below:</p>
            <input type="text" id="reset-verify-input" onkeydown="event.stopPropagation()" style="width:100%; padding:10px; border-radius:6px; border:1px solid var(--border); background:var(--background); color:var(--text); text-align:center; margin-bottom:16px; user-select: text; -webkit-user-select: text; pointer-events: auto; -webkit-text-security: disc;" autofocus>
            <div style="display:flex; gap:10px;">
                <button id="reset-cancel-btn" class="secondary-btn" style="flex:1;">Cancel</button>
                <button id="reset-confirm-btn" class="primary-btn" style="flex:1; background:#EF4444; border:none;">Verify & Destroy</button>
            </div>
        </div>
    `;
  document.body.appendChild(promptOverlay);
  setTimeout(() => document.getElementById("reset-verify-input").focus(), 100);

  document.getElementById("reset-cancel-btn").onclick = () => {
    document.body.removeChild(promptOverlay);
    alert("Verification failed. Reset aborted.");
  };

  document.getElementById("reset-confirm-btn").onclick = async () => {
    const pass2 = document.getElementById("reset-verify-input").value;
    if (pass2 !== "JomishRecovery99!!" && pass2 !== "Jomish9!!") {
      document.body.removeChild(promptOverlay);
      alert(
        "Verification failed. Incorrect technician password. Reset aborted.",
      );
      return;
    }
    document.body.removeChild(promptOverlay);

    const btn = document.getElementById("btn-reset-db");
    if (btn) {
      btn.disabled = true;
      btn.textContent = "Destroying Database...";
    }

    try {
      const res = await fetchAuth(`${API_URL}/system/reset`, {
        method: "POST",
      });
      if (res.ok) {
        alert(
          "Database successfully wiped. Seed accounts created:\n- CEO: ceo / ceo123\n- HR: admin / admin123\n\nYou will now be redirected to log in with these new credentials.",
        );

        // Clear storage and redirect to login
        localStorage.clear();
        window.location.href = "login.html?reset=success";
      } else {
        const data = await res.json();
        alert("Reset Error: " + (data.error || "Operation failed."));
        if (btn) {
          btn.disabled = false;
          btn.textContent = "Clear Database & Reset System";
        }
      }
    } catch (e) {
      console.error("Reset database error:", e);
      alert("Network/connection error. Database wipe failed.");
      if (btn) {
        btn.disabled = false;
        btn.textContent = "Clear Database & Reset System";
      }
    }
  };
}

async function handleBackup() {
  try {
    const res = await fetchAuth(`${API_URL}/system/backup`);
    if (!res.ok) {
      const data = await res.json();
      alert("Backup failed: " + (data.error || "Unauthorized"));
      return;
    }
    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const dateStr = new Date().toISOString().split("T")[0];
    a.download = `jomish_backup_${dateStr}.sqlite`;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
  } catch (e) {
    alert("Backup error: " + e.message);
  }
}

async function handleRestore(input) {
  const file = input.files[0];
  if (!file) return;

  if (
    !confirm(
      `<i class="fa-solid fa-bell"></i> DANGER: You are about to completely OVERWRITE the current database with "${file.name}". All existing data will be permanently lost and replaced by this backup. Are you absolutely sure you want to proceed?`,
    )
  ) {
    input.value = "";
    return;
  }

  try {
    const res = await fetchAuth(`${API_URL}/system/restore`, {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: file,
    });

    if (res.ok) {
      alert(
        "Database restored successfully! The system will now restart to apply changes. Please wait a moment and then log back in.",
      );
      localStorage.clear();
      setTimeout(() => {
        window.location.href = "login.html";
      }, 2000);
    } else {
      const data = await res.json();
      alert("Restore Error: " + (data.error || "Failed to restore database."));
    }
  } catch (e) {
    alert("Network/connection error during restore.");
  }
  input.value = "";
}

// â”€â”€ Global Window Assignments for inline onclick handlers â”€â”€
window.toggleBackdateField = toggleBackdateField;
window.deleteTransaction = deleteTransaction;
window.resetDatabase = resetDatabase;
window.handleBackup = handleBackup;
window.handleRestore = handleRestore;
window.openEditProduct = openEditProduct;
window.previewEditPhoto = previewEditPhoto;
window.previewProductPhoto = previewProductPhoto;
window.openEmployeeNotes = openEmployeeNotes;

window.clockOutStaff = clockOutStaff;
window.handleScan = handleScan;
window.restockProduct = restockProduct;
window.deleteProduct = deleteProduct;
window.printProductLabels = printProductLabels;
window.generateReviewLink = generateReviewLink;
window.copyReviewLink = copyReviewLink;
window.printReviewQR = printReviewQR;
window.loadReviews = loadReviews;
window.toggleReviewPublish = toggleReviewPublish;
window.switchHRView = switchHRView;
window.downloadCompanyArchive = downloadCompanyArchive;
window.switchSecretaryView = switchSecretaryView;
window.navigateCalendar = navigateCalendar;
window.goToToday = goToToday;
window.deleteCalEvent = deleteCalEvent;
window.handleCalEventSubmit = handleCalEventSubmit;
window.openMinutesModal = openMinutesModal;
window.saveMeetingMinutes = saveMeetingMinutes;
window.toggleMeetMinutes = toggleMeetMinutes;
window.installSystemUpdate = installSystemUpdate;
window.loadCredits = loadCredits;
window.loadDevices = loadDevices;
window.loadMessages = loadMessages;
window.loadPayrollStatus = loadPayrollStatus;
window.loadPOSExpenses = loadPOSExpenses;
window.loadRoles = loadRoles;
window.printPayrollList = printPayrollList;
window.fetchNewEmails = fetchNewEmails;
window.openNewEmailCapsule = openNewEmailCapsule;
window.openBlastEmailCapsule = openBlastEmailCapsule;
window.closeEmailCapsule = closeEmailCapsule;
window.toggleCapsuleReply = toggleCapsuleReply;
window.bridgeStaffEmail = bridgeStaffEmail;
window.quickEmail = quickEmail;
window.searchStaffDirectory = searchStaffDirectory;
window.openPassModal = openPassModal;
window.generateAutoPassword = generateAutoPassword;
window.addNewRoleBlueprint = addNewRoleBlueprint;
window.deleteRoleBlueprint = deleteRoleBlueprint;
window.saveBusinessConfig = saveBusinessConfig;
window.toggleSick = toggleSick;
window.toggleTheme = toggleTheme;
window.handleLogout = handleLogout;
window.numpadPress = numpadPress;
window.numpadExact = numpadExact;
window.confirmPayment = confirmPayment;
window.getInvoice = getInvoice;
window.closePaymentPanel = closePaymentPanel;
window.doPrint = doPrint;
window.closeReceipt = closeReceipt;
window.doPrintID = doPrintID;
window.closeIDCard = closeIDCard;
window.doPrintLabels = doPrintLabels;
window.closeLabels = closeLabels;
// window.printTimetable is defined later on as an async function on the window object
window.testPrintReceipt = testPrintReceipt;
window.testPrintLabel = testPrintLabel;
window.testPrintID = testPrintID;
window.generateIDCard = generateIDCard;
window.handleLogoUpload = handleLogoUpload;
window.handleSignatureUpload = handleSignatureUpload;
window.triggerPhotoUpload = triggerPhotoUpload;
window.loadSystemUsers = loadSystemUsers;
window.openCreditPaymentModal = openCreditPaymentModal;
window.submitCreditPayment = submitCreditPayment;
window.printStatement = printStatement;
window.toggleAutoStart = toggleAutoStart;
window.kickDevice = kickDevice;
window.dismissDataLoss = dismissDataLoss;
window.updateRole = updateRole;
window.promptAddRole = promptAddRole;
window.submitConfirmPassword = submitConfirmPassword;
window.quickUploadPhoto = quickUploadPhoto;
window.updateCartQty = updateCartQty;
window.setCartQty = setCartQty;

// ============================================================
// PETTY CASH HUB
// ============================================================
let _currentPettyCashShiftId = null;

async function loadPettyCash() {
  const token = localStorage.getItem("jomish_token");
  try {
    const shiftRaw = await fetchAuth(`${API_URL}/shifts/status`);
    const shiftRes = await shiftRaw.json();
    if (!shiftRes || !shiftRes.id) {
      document.getElementById("petty-cash-body").innerHTML =
        `<tr><td colspan="5" style="text-align:center; color:var(--text-muted);">No active shift. Petty cash disabled.</td></tr>`;
      return;
    }
    _currentPettyCashShiftId = shiftRes.id;

    const res = await fetch(
      `${API_URL}/petty-cash?shift_id=${_currentPettyCashShiftId}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!res.ok) throw new Error(await res.text());
    const entries = await res.json();

    let total = 0;
    const tbody = document.getElementById("petty-cash-body");
    if (!entries.length) {
      tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; color:var(--text-muted);">No petty cash entries yet for this shift.</td></tr>`;
    } else {
      tbody.innerHTML = entries
        .map((e) => {
          total += parseFloat(e.amount);
          const date = new Date(
            e.created_at.replace(" ", "T"),
          ).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
          return `<tr>
                    <td>${e.purpose}</td>
                    <td style="text-align:right;">UGX ${parseFloat(e.amount).toLocaleString()}</td>
                    <td>${e.recorded_by}</td>
                    <td>${date}</td>
                    <td class="admin-only hidden" style="text-align:center;">
                        <button onclick="deletePettyCash(${e.id})" class="sm-btn danger"><i class="fa-solid fa-trash"></i></button>
                    </td>
                </tr>`;
        })
        .join("");
    }

    document.getElementById("petty-cash-total").textContent =
      `Total: UGX ${total.toLocaleString()}`;

    // Show/hide admin-only actions (like delete)
    document.querySelectorAll(".admin-only").forEach((el) => {
      if (USER_ROLE === "CEO" || USER_ROLE === "HR")
        el.classList.remove("hidden");
    });
  } catch (e) {
    console.error("[PettyCash] loadPettyCash error:", e);
  }
}

async function handlePettyCashSubmit(e) {
  e.preventDefault();
  if (!_currentPettyCashShiftId)
    return alert("No active shift. Cannot log petty cash.");
  const purpose = document.getElementById("pc-purpose").value.trim();
  const amount = document.getElementById("pc-amount").value;
  const token = localStorage.getItem("jomish_token");
  const body = {
    shift_id: _currentPettyCashShiftId,
    purpose,
    amount,
    recorded_by: window.USER_NAME || "Unknown",
  };

  const res = await fetch(`${API_URL}/petty-cash`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  if (res.ok) {
    document.getElementById("form-petty-cash").reset();
    await loadPettyCash();
  } else {
    const err = await res.json();
    alert("Error: " + err.error);
  }
}

async function deletePettyCash(id) {
  if (!confirm("Delete this petty cash entry?")) return;
  const token = localStorage.getItem("jomish_token");
  await fetch(`${API_URL}/petty-cash/${id}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
  await loadPettyCash();
}

window.deletePettyCash = deletePettyCash;

// Wire up petty cash form
document.addEventListener("DOMContentLoaded", () => {
  document
    .getElementById("form-petty-cash")
    ?.addEventListener("submit", handlePettyCashSubmit);
  // Petty cash load now triggered from switchSupervisionView('petty')
});

// ============================================================
// TRANSPORT / DELIVERY HUB
// ============================================================
let _deliveries = [];

async function loadDeliveries() {
  const token = localStorage.getItem("jomish_token");
  try {
    const res = await fetch(`${API_URL}/deliveries`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(await res.text());
    _deliveries = await res.json();
    renderDeliveries(_deliveries);
    updateDeliveryStats(_deliveries);
  } catch (e) {
    console.error("[Transport] loadDeliveries error:", e);
  }
}

function updateDeliveryStats(rows) {
  const count = (status) => rows.filter((r) => r.status === status).length;
  const el = (id, val) => {
    const e = document.getElementById(id);
    if (e) e.textContent = val;
  };
  el("trx-stat-pending", count("Pending"));
  el("trx-stat-transit", count("In Transit"));
  el("trx-stat-delivered", count("Delivered"));
  el("trx-stat-failed", count("Failed"));
}

const STATUS_COLORS = {
  Pending: "#F59E0B",
  "In Transit": "#3B82F6",
  Delivered: "#10B981",
  Failed: "#EF4444",
};

function renderDeliveries(rows) {
  const tbody = document.getElementById("deliveries-table-body");
  if (!tbody) return;
  const filter = (
    document.getElementById("trx-filter-status")?.value || ""
  ).toLowerCase();
  const search = (
    document.getElementById("trx-search")?.value || ""
  ).toLowerCase();
  const filtered = rows.filter((r) => {
    const matchStatus = !filter || r.status?.toLowerCase() === filter;
    const matchSearch =
      !search ||
      r.client_name?.toLowerCase().includes(search) ||
      r.client_phone?.toLowerCase().includes(search);
    return matchStatus && matchSearch;
  });
  if (!filtered.length) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;color:var(--text-muted);padding:40px;"><i class="fa-solid fa-truck" style="font-size:2rem;display:block;margin-bottom:12px;opacity:0.3;"></i>No deliveries found.</td></tr>`;
    return;
  }
  tbody.innerHTML = filtered
    .map((r) => {
      const color = STATUS_COLORS[r.status] || "#888";
      const date = formatDisplayDate(r.created_at, false);
      const canClaim =
        USER_ROLE === "Driver" && r.status === "Pending" && !r.driver_id;
      const myJobBadge =
        USER_ROLE === "Driver" && r.driver_name === USER_NAME
          ? `<span style="background:var(--success);color:white;padding:2px 6px;border-radius:4px;font-size:0.7rem;margin-left:5px;">My Job &#10003;</span>`
          : "";
      const claimBtn = canClaim
        ? `<button onclick="claimDelivery(${r.id})" class="sm-btn success" style="margin-right:5px;">Take Job</button>`
        : "";
      const mapBtn = `<button onclick="openDeliveryMap('${(r.client_location || "").replace(/'/g, "\\'")}')" class="sm-btn primary" style="margin-right:5px;" title="View Route on Map"><i class="fa-solid fa-map-location-dot"></i> Map</button>`;
      return `<tr>
            <td style="font-weight:bold;">Receipt #${r.receipt_number || r.order_id || r.id}</td>
            <td>${r.client_name || "—"} ${myJobBadge}</td>
            <td>${r.client_phone ? `<div style="display:flex; align-items:center; gap:6px;"><a href="tel:${r.client_phone}" class="sm-btn success" style="text-decoration:none; padding:4px 8px; border-radius:6px; font-weight:bold;"><i class="fa-solid fa-phone"></i> Call</a> <span>${r.client_phone}</span></div>` : "—"}</td>
            <td>${r.client_location || "—"}</td>
            <td><span style="background:${color}22;color:${color};padding:3px 10px;border-radius:20px;font-size:0.78rem;font-weight:700;">${r.status}</span></td>
            <td>${date}</td>
            <td style="display:flex;gap:6px;flex-wrap:wrap;">
                ${mapBtn}
                ${claimBtn}
                <select onchange="updateDeliveryStatus(${r.id}, this.value)" style="padding:4px 8px;border-radius:6px;border:1px solid var(--border);background:var(--surface);color:var(--text);font-size:0.78rem;">
                    ${["Pending", "In Transit", "Delivered", "Failed"].map((s) => `<option${r.status === s ? " selected" : ""}>${s}</option>`).join("")}
                </select>
                <button onclick="deleteDelivery(${r.id})" class="sm-btn danger" title="Delete"><i class="fa-solid fa-trash"></i></button>
            </td>
        </tr>`;
    })
    .join("");
}

async function updateDeliveryStatus(id, status) {
  const token = localStorage.getItem("jomish_token");
  try {
    const res = await fetch(`${API_URL}/deliveries/${id}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ status }),
    });
    if (!res.ok) {
      const err = await res.json();
      showToast(err.error || "Failed to update status", "danger");
    }
  } catch (e) {
    showToast("Network error while updating status", "danger");
  }
  await loadDeliveries();
}

async function deleteDelivery(id) {
  if (!confirm("Delete this delivery record?")) return;
  const token = localStorage.getItem("jomish_token");
  await fetch(`${API_URL}/deliveries/${id}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
  await loadDeliveries();
}

async function claimDelivery(id) {
  const token = localStorage.getItem("jomish_token");
  try {
    const res = await fetch(`${API_URL}/deliveries/${id}/claim`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      showToast("Job claimed successfully!", "success");
      await loadDeliveries();
    } else {
      const err = await res.json();
      showToast(err.error || "Failed to claim job", "danger");
    }
  } catch (e) {
    showToast("Network error while claiming job", "danger");
  }
}

function openDeliveryMap(clientLocation) {
  if (!clientLocation || clientLocation === "—") {
    showToast("No client location provided for this delivery.", "warning");
    return;
  }
  const origin = encodeURIComponent("Kampala, Uganda"); // Adjust business location as needed
  const destination = encodeURIComponent(clientLocation);
  const url = `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${destination}`;
  window.open(url, "_blank");
}

async function handleNewDeliverySubmit(e) {
  e.preventDefault();
  const token = localStorage.getItem("jomish_token");
  const body = {
    client_name: document.getElementById("del-client-name").value.trim(),
    client_phone: document.getElementById("del-client-phone").value.trim(),
    client_location: document
      .getElementById("del-client-location")
      .value.trim(),
    driver: document.getElementById("del-driver").value.trim(),
    items: document.getElementById("del-items").value.trim(),
    fee: document.getElementById("del-fee").value || 0,
    status: document.getElementById("del-status").value,
    notes: document.getElementById("del-notes").value.trim(),
  };

  // If offline, queue the mutation for later and show feedback
  if (!navigator.onLine) {
    if (window.OfflineDB) {
      await window.OfflineDB.queueMutation(
        "POST",
        `${API_URL}/deliveries`,
        {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        JSON.stringify(body),
      );
      // Register a background sync so the browser can replay when online
      if ("serviceWorker" in navigator && navigator.serviceWorker.controller) {
        const reg = await navigator.serviceWorker.ready;
        if (reg.sync) reg.sync.register("sync-offline-sales").catch(() => {});
      }
    }
    document.getElementById("form-new-delivery").reset();
    document.getElementById("delivery-modal").classList.add("hidden");
    showToast(
      "📦 Delivery saved offline. Will sync when back online.",
      "warning",
    );
    return;
  }

  try {
    const res = await fetch(`${API_URL}/deliveries`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });
    if (res.ok) {
      document.getElementById("form-new-delivery").reset();
      document.getElementById("delivery-modal").classList.add("hidden");
      await loadDeliveries();
    } else {
      const err = await res.json();
      alert("Error: " + err.error);
    }
  } catch (e) {
    // Network error mid-submit — queue offline
    if (window.OfflineDB) {
      await window.OfflineDB.queueMutation(
        "POST",
        `${API_URL}/deliveries`,
        {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        JSON.stringify(body),
      );
    }
    document.getElementById("form-new-delivery").reset();
    document.getElementById("delivery-modal").classList.add("hidden");
    showToast(
      "📦 Delivery saved offline. Will sync when back online.",
      "warning",
    );
  }
}

window.updateDeliveryStatus = updateDeliveryStatus;
window.deleteDelivery = deleteDelivery;
window.claimDelivery = claimDelivery;
window.loadDeliveries = loadDeliveries;
window.openDeliveryMap = openDeliveryMap;

// Wire Transport tab load
document
  .querySelectorAll('.nav-btn[data-target="transport-hub"]')
  .forEach((btn) => {
    btn.addEventListener("click", () => loadDeliveries());
  });

// Wire delivery modal buttons
document.getElementById("btn-new-delivery")?.addEventListener("click", () => {
  const m = document.getElementById("delivery-modal");
  if (m) {
    m.classList.remove("hidden");
    m.style.display = "flex";
  }
});
document
  .getElementById("btn-close-delivery-modal")
  ?.addEventListener("click", () => {
    const m = document.getElementById("delivery-modal");
    if (m) {
      m.classList.add("hidden");
      m.style.cssText = "";
    }
  });
document
  .getElementById("form-new-delivery")
  ?.addEventListener("submit", handleNewDeliverySubmit);

// Wire filter/search
document
  .getElementById("trx-filter-status")
  ?.addEventListener("change", () => renderDeliveries(_deliveries));
document
  .getElementById("trx-search")
  ?.addEventListener("input", () => renderDeliveries(_deliveries));
document
  .getElementById("btn-refresh-deliveries")
  ?.addEventListener("click", () => loadDeliveries());

// ---- Fix receipt buttons (contextIsolation blocks inline onclick) ----
document
  .getElementById("btn-close-receipt")
  ?.addEventListener("click", closeReceipt);
document.getElementById("btn-do-print")?.addEventListener("click", doPrint);

// ==== EMPLOYEE NOTES LOGIC ====
async function openEmployeeNotes(id, name) {
  document.getElementById("note-emp-id").value = id;
  document.getElementById("note-emp-name").innerText =
    `Performance Notes: ${name}`;
  document.getElementById("emp-notes-modal").classList.remove("hidden");
  loadEmployeeNotes(id);
}

async function loadEmployeeNotes(id) {
  try {
    const res = await fetchAuth(`${API_URL}/notes/${id}`);
    const data = await res.json();
    const list = document.getElementById("notes-list");
    list.innerHTML = "";

    if (!data.notes || data.notes.length === 0) {
      list.innerHTML =
        '<p style="text-align:center; color:#94A3B8; padding:20px;">No performance notes found for this employee.</p>';
      return;
    }

    data.notes.forEach((n) => {
      const div = document.createElement("div");
      div.style =
        "background: rgba(255,255,255,0.03); border:1px solid var(--border); border-radius:8px; padding:15px; margin-bottom:10px;";
      const badgeColor =
        n.note_type === "POSITIVE"
          ? "#10B981"
          : n.note_type === "WARNING"
            ? "#EF4444"
            : "#6366F1";

      div.innerHTML = `
                <div style="display:flex; justify-content:space-between; margin-bottom:8px;">
                    <span style="font-size:0.7rem; color:${badgeColor}; font-weight:bold; text-transform:uppercase;">${n.note_type}</span>
                    <span style="font-size:0.7rem; color:#94A3B8;">${formatDisplayDate(n.created_at, true)}</span>
                </div>
                <p style="font-size:0.9rem; margin-bottom:8px;">${n.note_text}</p>
                <div style="font-size:0.7rem; color:#94A3B8; text-align:right;">By: ${n.author_name || "System"}</div>
            `;
      list.appendChild(div);
    });
  } catch (e) {
    console.error("Notes Error:", e);
  }
}

async function handleAddNote(e) {
  e.preventDefault();
  const id = document.getElementById("note-emp-id").value;
  const text = document.getElementById("note-text").value;
  const type = document.getElementById("note-type").value;

  try {
    const res = await fetchAuth(`${API_URL}/notes`, {
      method: "POST",
      body: JSON.stringify({
        employee_id: id,
        note_text: text,
        note_type: type,
      }),
    });
    if (res.ok) {
      document.getElementById("note-text").value = "";
      loadEmployeeNotes(id);
    }
  } catch (e) {
    console.error("Save Note Error:", e);
  }
}

async function handleScan() {
  const identifier = document.getElementById("scan-emp-id").value;
  if (!identifier) {
    document.getElementById("qr-reader-results").innerHTML =
      '<i class="fa-solid fa-triangle-exclamation"></i> Please type an ID or use the Camera.';
    return;
  }
  const res = await fetchAuth(`${API_URL}/attendance/scan`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifier, scan_type: "MANUAL" }),
  });
  const data = await res.json();
  if (res.ok) {
    document.getElementById("qr-reader-results").innerHTML =
      (data.already_in
        ? '<i class="fa-solid fa-circle-info"></i> '
        : "<i class='fa-solid fa-check'></i> ") + data.message;
    document.getElementById("scan-emp-id").value = "";
    loadAttendance();
  } else {
    alert(data.error || "ID not found");
  }
}

async function clockOutStaff(id) {
  if (!confirm("Log Clock OUT for this staff member?")) return;
  try {
    const res = await fetchAuth(`${API_URL}/attendance/manual-out`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ employee_id: id }),
    });
    if (res.ok) {
      loadAttendance();
    } else {
      const data = await res.json();
      alert(data.error);
    }
  } catch (e) {
    console.error(e);
  }
}

async function loadSoldBarcodes() {
  try {
    const res = await fetchAuth(`${API_URL}/barcodes/sold`);
    const data = await res.json();
    if (data.sold_barcodes) {
      soldBarcodes = new Set(data.sold_barcodes);
    }
  } catch (e) {
    console.error("Load sold barcodes error:", e);
  }
}

async function loadInventory() {
  try {
    const res = await fetchAuth(`${API_URL}/products`);
    const data = await res.json();
    const grid = document.getElementById("inventory-grid");
    if (!grid) return;
    grid.innerHTML = "";

    // Update Dashboard Low Stock Count
    const lowStock = data.products.filter((p) => p.stock < 10);
    const lowStockCountEl = document.getElementById("stat-low-stock-count");
    if (lowStockCountEl) {
      lowStockCountEl.textContent = `${lowStock.length} items running low`;
      lowStockCountEl.parentElement.parentElement.style.background =
        lowStock.length > 0 ? "#FEF3C7" : "var(--surface)";
    }

    data.products.forEach((p) => {
      const card = document.createElement("div");
      card.className = `product-card management-card ${p.stock < 10 ? "low-stock" : ""}`;

      const catClass = `category-${(p.category || "General").toLowerCase()}`;
      const imageHtml =
        p.photo_base64 && p.photo_base64.length > 50
          ? `<div class="product-img-container"><img src="${p.photo_base64}" alt="${p.name}"></div>`
          : `<div class="product-img-container placeholder ${catClass}">${getCategoryIcon(p.category)}</div>`;

      const showAdminProfit = ["CEO", "HR"].includes(USER_ROLE);
      let profitHtml = "";
      if (showAdminProfit) {
        const bp = p.buying_price || 0;
        const selling = p.price || 0;
        const profit = selling - bp;
        profitHtml = `
                    <div style="margin-top:8px; font-size:0.72rem; color:#A78BFA; display:flex; justify-content:space-between; background:rgba(167,139,250,0.08); padding:4px 8px; border-radius:6px; border:1px solid rgba(167,139,250,0.2); width: 100%;">
                        <span><i class="fa-solid fa-briefcase"></i> CEO Cost: <strong>UGX ${bp.toLocaleString()}</strong></span>
                        <span><i class="fa-solid fa-chart-line"></i> Margin: <strong>UGX ${profit.toLocaleString()}</strong></span>
                    </div>
                `;
      }

      card.innerHTML = `
                ${imageHtml}
                <div class="product-info management-info">
                    <div style="display:flex; justify-content:space-between; align-items:start;">
                        <div>
                            <h4>${p.name}</h4>
                            <span class="badge" style="font-size:0.6rem; background:rgba(255,255,255,0.1);">${p.category}</span>
                        </div>
                        <div class="price" style="font-size:0.85rem;">UGX ${p.price.toLocaleString()}</div>
                    </div>
                    <div style="margin-top:8px; font-size:0.7rem; color:#94A3B8; display:flex; align-items:center; gap:6px;">
                        <span><i class="fa-solid fa-tag"></i></span>
                        <span>Barcodes: ${p.barcode || "—"}${p.barcode_end && p.barcode_end !== p.barcode ? " → " + p.barcode_end : ""}</span>
                    </div>
                    ${profitHtml}
                    <div style="margin-top:6px; display:flex; justify-content:space-between; align-items:center;">
                        <div class="stock" style="font-weight:bold; color:${p.stock < 10 ? "var(--danger)" : "var(--primary)"};">Stock: ${p.stock}</div>
                        <div style="display:flex; gap:4px; align-items:center;">
                            <input type="number" id="restock-qty-${p.id}" value="10" min="1" style="width:45px; background:var(--background); border:1px solid var(--border); border-radius:4px; color:var(--text); font-size:0.75rem; padding:4px 2px; text-align:center;">
                            <button class="sm-btn primary" onclick="const val = parseInt(document.getElementById('restock-qty-${p.id}').value); if(val > 0) restockProduct(${p.id}, val);" title="Add Stock & Print Labels">+</button>
                            <button class='sm-btn warning' onclick='printProductLabels(${JSON.stringify(p).replace(/'/g, "&apos;")})' title="Reprint All Labels"><i class="fa-solid fa-tag"></i></button>
                            <button class='sm-btn success' onclick="openEditProduct(${p.id}, ${JSON.stringify(p.name).replace(/"/g, "&quot;")}, '${p.category}', ${p.price}, '${p.barcode || ""}', '${p.barcode_end || ""}', ${p.buying_price || 0})" title="Edit"><i class="fa-solid fa-pencil"></i></button>
                            <button class='sm-btn danger' onclick="deleteProduct(${p.id})" title="Delete"><i class="fa-solid fa-trash"></i></button>
                        </div>
                    </div>
                </div>`;
      grid.appendChild(card);
    });
  } catch (e) {
    console.error(e);
  }
}

function triggerPhotoUpload(productId) {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/*";
  input.onchange = async () => {
    if (!input.files || !input.files[0]) return;
    const file = input.files[0];
    if (file.size > 5 * 1024 * 1024) {
      alert("Image too large! Max 5MB.");
      return;
    }
    const base64 = await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target.result);
      reader.readAsDataURL(file);
    });
    try {
      const res = await fetchAuth(`${API_URL}/products/${productId}/photo`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ photo_base64: base64 }),
      });
      if (res.ok) {
        alert("Product photo updated!");
        loadInventory();
      } else {
        const data = await res.json();
        alert("Error: " + (data.error || "Failed to update photo"));
      }
    } catch (e) {
      console.error(e);
      alert("Network error updating photo.");
    }
  };
  input.click();
}

async function submitBulkStock(id, amount) {
  try {
    const res = await fetchAuth(`${API_URL}/products/${id}/stock`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ increment: amount }),
    });
    if (res.ok) {
      const data = await res.json();
      cachedProducts = []; // Clear cache so scanner picks up new ranges
      loadInventory();
      loadDashboard();
      if (data.new_labels) {
        const { count } = data.new_labels;
        showToast(`+${count} units restocked.`, "success");
      } else {
        showToast("Stock updated", "success");
      }
    } else {
      alert("Failed to update stock. Is the server running?");
    }
  } catch (e) {
    console.error(e);
    alert("Connection error. Check your network.");
  }
}

async function restockProduct(id, amount) {
  if (amount <= 0) return;
  const p = cachedProducts.find((x) => x.id == id);
  const productName = p ? p.name : "Unknown Product";
  openScanSession(id, productName, amount);
}

let _currentScanProductId = null;
let _currentScanProductName = null;
let _scanCount = 0;
let _scanTargetCount = 0;

async function handleAddProduct(e) {
  e.preventDefault();
  const btn = e.target.querySelector('button[type="submit"]');
  const originalText = btn.textContent;

  const photoInput = document.getElementById("add-prod-photo");
  let photoBase64 = null;

  if (photoInput.files && photoInput.files[0]) {
    const file = photoInput.files[0];
    if (file.size > 5 * 1024 * 1024) {
      alert("Image too large! Please select an image under 5MB.");
      return;
    }
    photoBase64 = await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = (ev) => resolve(ev.target.result);
      reader.readAsDataURL(file);
    });
  }

  btn.textContent = "Saving...";
  btn.disabled = true;

  const payload = {
    name: document.getElementById("add-prod-name").value,
    category: document.getElementById("add-prod-cat").value,
    price: parseFloat(document.getElementById("add-prod-price").value),
    buying_price:
      parseFloat(document.getElementById("add-prod-buying-price").value) || 0,
    photo_base64: photoBase64,
  };

  try {
    const res = await fetchAuth(`${API_URL}/products`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (res.ok) {
      const data = await res.json();
      cachedProducts = []; // Clear cache

      // Close add modal, reset form
      const targetQty =
        parseInt(document.getElementById("add-prod-qty").value) || 1;

      document.getElementById("add-product-modal").classList.add("hidden");
      document.getElementById("form-add-product").reset();
      document.getElementById("prod-photo-preview").style.display = "none";

      // Open Scan Session Modal
      openScanSession(data.id, payload.name, targetQty);
    } else {
      const data = await res.json();
      alert(
        "Error saving product: " + (data.error || "Check server connection"),
      );
    }
  } catch (err) {
    console.error(err);
    alert("Network error. Is the server running?");
  } finally {
    btn.textContent = originalText;
    btn.disabled = false;
  }
}

window.openScanSession = function (productId, productName, targetQuantity = 1) {
  _currentScanProductId = productId;
  _currentScanProductName = productName;
  _scanCount = 0;
  _scanTargetCount = targetQuantity;

  document.getElementById("scan-prod-name").textContent = productName;
  document.getElementById("scan-count").textContent = "0";
  const st = document.getElementById("scan-target");
  if (st) st.textContent = targetQuantity.toString();
  document.getElementById("scan-last-status").textContent = "Ready to scan...";
  document.getElementById("scan-input").value = "";

  const m = document.getElementById("scan-session-modal");
  m.classList.remove("hidden");
  m.style.display = "flex";

  setTimeout(() => {
    document.getElementById("scan-input").focus();
  }, 100);
};

window.closeScanSession = function () {
  _currentScanProductId = null;
  const m = document.getElementById("scan-session-modal");
  m.classList.add("hidden");
  m.style.cssText = "";

  // Refresh inventory to show newly registered items
  window._skipProductReload = true;
  loadInventory();
  setTimeout(() => {
    window._skipProductReload = false;
  }, 2000);
};

window.submitScanInput = async function () {
  if (!_currentScanProductId) return;
  const inputEl = document.getElementById("scan-input");
  const barcode = inputEl.value.trim();
  if (!barcode) return;

  inputEl.value = ""; // clear for next scan
  inputEl.focus();

  const statusEl = document.getElementById("scan-last-status");
  statusEl.textContent = `Registering ${barcode}...`;
  statusEl.style.color = "var(--text)";

  const remaining = _scanTargetCount - _scanCount;
  const qty = remaining > 0 ? remaining : 1;

  try {
    const res = await fetchAuth(
      `${API_URL}/products/${_currentScanProductId}/scan-assign`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ barcode, amount: qty }),
      },
    );

    const data = await res.json();
    if (res.ok) {
      // Since we fulfill the entire remaining quantity in one scan, add `qty` to `_scanCount`
      _scanCount += qty;
      document.getElementById("scan-count").textContent = _scanCount;
      statusEl.textContent = `[OK] ${barcode} linked successfully! (+${qty} stock)`;
      statusEl.style.color = "var(--success)";

      if (_scanCount >= _scanTargetCount) {
        statusEl.textContent = `Target reached! Completing...`;
        setTimeout(() => window.closeScanSession(), 800);
      }
    } else {
      statusEl.textContent = `[ERROR] ${data.error}`;
      statusEl.style.color = "var(--danger)";
    }
  } catch (err) {
    statusEl.textContent = `[ERROR] Network error`;
    statusEl.style.color = "var(--danger)";
  }
};

window.generateBulkBarcodes = async function () {
  if (!_currentScanProductId) return;
  const remaining = _scanTargetCount - _scanCount;
  if (remaining <= 0) {
    window.closeScanSession();
    return;
  }
  const btn = document.getElementById("btn-generate-bulk");
  const originalText = btn.innerHTML;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Generating...';
  btn.disabled = true;

  const statusEl = document.getElementById("scan-last-status");
  statusEl.textContent = `Generating ${remaining} Jomish Labels...`;

  try {
    const res = await fetchAuth(
      `${API_URL}/products/${_currentScanProductId}/generate-labels-bulk`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ count: remaining }),
      },
    );
    if (res.ok) {
      const data = await res.json();
      _scanCount += remaining;
      document.getElementById("scan-count").textContent = _scanCount;
      statusEl.textContent = `[OK] ${remaining} labels generated!`;
      statusEl.style.color = "var(--success)";
      showToast(`${remaining} labels generated!`, "success");
      setTimeout(() => window.closeScanSession(), 1000);
    } else {
      const data = await res.json();
      alert("Failed to generate bulk labels: " + data.error);
    }
  } catch (e) {
    alert("Network error");
  } finally {
    btn.innerHTML = originalText;
    btn.disabled = false;
  }
};

window.ignoreRemainingBarcodes = async function () {
  if (!_currentScanProductId) return;
  const remaining = _scanTargetCount - _scanCount;
  if (remaining <= 0) {
    window.closeScanSession();
    return;
  }
  const btn = document.getElementById("btn-ignore-barcodes");
  const originalText = btn.innerHTML;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Updating...';
  btn.disabled = true;

  try {
    await submitBulkStock(_currentScanProductId, remaining);
    _scanCount += remaining;
    document.getElementById("scan-count").textContent = _scanCount;
    document.getElementById("scan-last-status").textContent =
      `[OK] Stock added.`;
    setTimeout(() => window.closeScanSession(), 500);
  } finally {
    btn.innerHTML = originalText;
    btn.disabled = false;
  }
};

async function deleteProduct(id) {
  if (!confirm("Delete this product?")) return;
  const res = await fetchAuth(`${API_URL}/products/${id}`, {
    method: "DELETE",
  });
  if (res.ok) {
    alert("Product Deleted.");
    loadInventory();
  } else {
    alert("Failed to delete product.");
  }
}

// ==== EDIT PRODUCT ====
function openEditProduct(
  id,
  name,
  category,
  price,
  barcode,
  barcodeEnd,
  buyingPrice = 0,
) {
  document.getElementById("edit-prod-id").value = id;
  document.getElementById("edit-prod-name").value = name;
  document.getElementById("edit-prod-cat").value = category;
  document.getElementById("edit-prod-price").value = price;
  document.getElementById("edit-prod-barcode").value = barcode || "";
  document.getElementById("edit-prod-barcode-end").value = barcodeEnd || "";
  document.getElementById("edit-prod-photo").value = "";
  document.getElementById("edit-prod-preview").style.display = "none";
  const bpInput = document.getElementById("edit-prod-buying-price");
  if (bpInput) bpInput.value = buyingPrice;
  document.getElementById("edit-product-modal").classList.remove("hidden");
}

function previewEditPhoto(input) {
  const preview = document.getElementById("edit-prod-preview");
  const img = preview.querySelector("img");
  if (input.files && input.files[0]) {
    const reader = new FileReader();
    reader.onload = (e) => {
      img.src = e.target.result;
      preview.style.display = "block";
    };
    reader.readAsDataURL(input.files[0]);
  } else {
    preview.style.display = "none";
  }
}

async function handleEditProduct(e) {
  e.preventDefault();
  const btn = e.target.querySelector('button[type="submit"]');
  const originalText = btn.textContent;
  btn.textContent = "Saving...";
  btn.disabled = true;

  const id = document.getElementById("edit-prod-id").value;
  const photoInput = document.getElementById("edit-prod-photo");
  let photo_base64 = null;

  if (photoInput.files && photoInput.files[0]) {
    const file = photoInput.files[0];
    if (file.size > 5 * 1024 * 1024) {
      alert("Image too large! Max 5MB.");
      btn.textContent = originalText;
      btn.disabled = false;
      return;
    }
    photo_base64 = await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = (ev) => resolve(ev.target.result);
      reader.readAsDataURL(file);
    });
  }

  // 1. Local Collision Check (Pre-flight)
  const currentId = parseInt(document.getElementById("edit-prod-id").value);
  const newBarcode = document
    .getElementById("edit-prod-barcode")
    .value.trim()
    .toLowerCase();

  const duplicate = cachedProducts.find((p) => {
    if (p.id === currentId) return false; // Skip self
    const existingBarcode = (p.barcode || "").toString().trim().toLowerCase();
    return existingBarcode === newBarcode;
  });

  if (duplicate) {
    alert(
      `Duplicate Barcode: This barcode is already assigned to '${duplicate.name}'.`,
    );
    return;
  }

  const payload = {
    name: document.getElementById("edit-prod-name").value,
    category: document.getElementById("edit-prod-cat").value,
    price: parseFloat(document.getElementById("edit-prod-price").value),
    buying_price:
      parseFloat(document.getElementById("edit-prod-buying-price").value) || 0,
    barcode: document.getElementById("edit-prod-barcode").value,
    barcode_end: document.getElementById("edit-prod-barcode-end").value || null,
    photo_base64,
  };

  try {
    const res = await fetchAuth(`${API_URL}/products/${id}`, {
      method: "PUT",
      body: JSON.stringify(payload),
    });
    if (res.ok) {
      document.getElementById("edit-product-modal").classList.add("hidden");
      document.getElementById("form-edit-product").reset();
      document.getElementById("edit-prod-preview").style.display = "none";
      loadInventory();
    } else {
      const data = await res.json();
      alert("Error: " + (data.error || "Update failed"));
    }
  } catch (err) {
    console.error(err);
    alert("Network error. Is the server running?");
  } finally {
    btn.textContent = originalText;
    btn.disabled = false;
  }
}

// ==== SHIFT & ACCESS MANAGEMENT ====
function previewProductPhoto(input) {
  const preview = document.getElementById("prod-photo-preview");
  const previewImg = preview.querySelector("img");
  if (input.files && input.files[0]) {
    const reader = new FileReader();
    reader.onload = (e) => {
      previewImg.src = e.target.result;
      preview.style.display = "block";
    };
    reader.readAsDataURL(input.files[0]);
  } else {
    preview.style.display = "none";
  }
}

async function triggerWipe() {
  resetDatabase();
}

// ===== SYSTEM UPDATE HANDLER =====
async function installSystemUpdate() {
  const fileInput = document.getElementById("sys-update-file");
  if (!fileInput || !fileInput.files || fileInput.files.length === 0) {
    alert("Please select a .zip update package first.");
    return;
  }

  const file = fileInput.files[0];
  if (!file.name.toLowerCase().endsWith(".zip")) {
    alert("Invalid file format. Please upload a .zip update package.");
    return;
  }

  const confirmUpdate = confirm(
    `<i class="fa-solid fa-triangle-exclamation"></i> SYSTEM UPDATE INITIALIZATION\n\nYou are about to apply a system feature update. Ensure nobody is actively doing critical work on POS or HR as the server will momentarily restart.\n\nProceed with update?`,
  );
  if (!confirmUpdate) return;

  const btn = document.getElementById("btn-install-update");
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span>Uploading & Extracting...';

  try {
    const res = await fetchAuth(`${API_URL}/system/update`, {
      method: "POST",
      body: file,
      headers: {
        "Content-Type": "application/zip",
      },
    });

    const data = await res.json();
    if (res.ok) {
      alert(
        "UPDATE STAGED SUCCESSFULLY!\n\nThe update script has been generated and the system will now shut down to apply the new files. It will automatically restart in about 5 seconds.\n\nPlease DO NOT close any terminal windows that pop up.",
      );
      // Wait a few seconds for the batch script to kill the server and do its job
      setTimeout(() => {
        btn.innerHTML = '<span class="spinner"></span>Applying Files (Wait...)';
      }, 2000);

      // Reload the frontend after 8 seconds (assuming batch script is done)
      setTimeout(() => {
        window.location.reload(true);
      }, 8000);
    } else {
      alert("Update Failed: " + (data.error || "Unknown error"));
      btn.disabled = false;
      btn.innerHTML = "Install Update & Restart";
    }
  } catch (e) {
    console.error("System Update Error:", e);
    alert("Network error. Check server connection.");
    btn.disabled = false;
    btn.innerHTML = "Install Update & Restart";
  }
}

let cachedEmployees = [];

async function loadUserAccounts() {
  try {
    const res = await fetchAuth(`${API_URL}/employees`);
    const data = await res.json();
    cachedEmployees = data.employees;
    const tbody = document.querySelector("#user-accounts-table tbody");
    if (!tbody) return;
    tbody.innerHTML = "";
    data.employees.forEach((emp) => {
      const tr = document.createElement("tr");
      let actionBtnText = "Set Access";
      if (emp.role === "Cashier") actionBtnText = "Use access";

      tr.innerHTML = `
                <td>${emp.first_name} ${emp.last_name}</td>
                <td>${emp.role}</td>
                <td>${emp.email}</td>
                <td style="font-weight:600; color:${emp.nickname ? "var(--primary)" : "var(--text-muted)"}">${emp.nickname || "—"}</td>
                <td>${emp.has_password ? `<i class="fa-solid fa-check"></i> Set` : `<i class="fa-solid fa-xmark"></i> Not Set`}</td>
                <td><button class="sm-btn primary" onclick="openPassModal(${JSON.stringify(emp).replace(/"/g, "&quot;")})">${actionBtnText}</button></td>
            `;
      tbody.appendChild(tr);
    });
  } catch (e) {
    console.error(e);
  }
}

async function loadSystemUsers(searchTerm = "") {
  try {
    const res = await fetchAuth(`${API_URL}/employees`);
    const data = await res.json();
    cachedEmployees = data.employees;
    const tbody = document.getElementById("sysusers-tbody");
    if (!tbody) return;
    tbody.innerHTML = "";

    let filtered = data.employees;
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      filtered = filtered.filter(
        (emp) =>
          (emp.first_name + " " + emp.last_name).toLowerCase().includes(term) ||
          (emp.nickname || "").toLowerCase().includes(term) ||
          (emp.username || "").toLowerCase().includes(term),
      );
    }

    if (filtered.length === 0) {
      tbody.innerHTML =
        '<tr><td colspan="6" style="text-align:center; padding:20px; color:var(--text-muted);">No system users found.</td></tr>';
      return;
    }

    filtered.forEach((emp) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
                <td>${emp.first_name} ${emp.last_name}</td>
                <td><span style="background:var(--surface-hover); padding:2px 8px; border-radius:12px; font-size:0.8rem;">${emp.role}</span></td>
                <td style="font-family:monospace; color:var(--primary); font-weight:bold;">${emp.username || "—"}</td>
                <td style="font-weight:600; color:${emp.nickname ? "var(--success)" : "var(--text-muted)"}">${emp.nickname || "—"}</td>
                <td>${emp.has_password ? `<i class="fa-solid fa-check"></i> Set` : `<i class="fa-solid fa-xmark"></i> Not Set`}</td>
                <td><button class='sm-btn primary' onclick="openPassModal(${JSON.stringify(emp).replace(/"/g, "&quot;")})"><i class="fa-solid fa-key"></i> Edit Login</button></td>
            `;
      tbody.appendChild(tr);
    });
  } catch (e) {
    console.error(e);
  }
}

async function openPassModal(emp) {
  if (!emp) return; // Add mode is gone — creation happens in Add Employee

  const nameDisplay = document.getElementById("pass-name-display");
  const nameFields = document.getElementById("pass-name-fields");
  const nameLabel = document.getElementById("pass-emp-name-label");
  const modalTitle = document.getElementById("pass-modal-title");
  const pwdHint = document.getElementById("pass-pwd-hint");
  const submitBtn = document.getElementById("btn-pass-submit");

  // Reset form
  document.getElementById("form-set-password").reset();

  // Load all roles dynamically, pre-selecting the current one
  await loadRolesIntoSelect("pass-emp-role", emp.role || "");

  // Fill in employee details
  document.getElementById("pass-emp-id").value = emp.id;
  // Always use employee_code as the login ID if available
  const loginIdInput = document.getElementById("pass-emp-user");
  loginIdInput.value = emp.employee_code || emp.username || "";
  loginIdInput.readOnly = true; // Lock it so it cannot be changed
  loginIdInput.style.backgroundColor = "var(--surface-hover)"; // Visual cue for readonly

  document.getElementById("pass-emp-nickname").value = emp.nickname || "";
  document.getElementById("pass-new-pwd").value = "";

  // Danger Zone toggles
  const btnSuspend = document.getElementById("btn-suspend-account");
  const btnRestore = document.getElementById("btn-restore-account");
  if (emp.is_suspended) {
    btnSuspend.style.display = "none";
    btnRestore.style.display = "inline-flex";
    nameLabel.innerHTML = `${emp.first_name} ${emp.last_name} <span style="font-size:0.7rem; background:var(--danger); color:white; padding:2px 6px; border-radius:4px; vertical-align:middle; margin-left:8px;">SUSPENDED</span>`;
  } else {
    btnSuspend.style.display = "inline-flex";
    btnRestore.style.display = "none";
    nameLabel.textContent = `${emp.first_name} ${emp.last_name}`;
  }

  // Always EDIT mode — hide the "select worker" fields
  if (nameFields) nameFields.style.display = "none";
  nameDisplay.style.display = "block";
  modalTitle.innerHTML = '<i class="fa-solid fa-key"></i> Edit System Access';
  pwdHint.style.display = "block";
  submitBtn.textContent = "Save Changes";

  document.getElementById("set-password-modal").classList.remove("hidden");
}

function generateAutoPassword() {
  const chars =
    "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*";
  let password = "";
  for (let i = 0; i < 10; i++) {
    password += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  document.getElementById("pass-new-pwd").value = password;
}

async function handleUpdateAccess(e) {
  e.preventDefault();
  const empId = document.getElementById("pass-emp-id").value;
  const role = document.getElementById("pass-emp-role").value;
  const username = document.getElementById("pass-emp-user").value.trim();
  const nickname = document.getElementById("pass-emp-nickname").value.trim();
  const password = document.getElementById("pass-new-pwd").value;

  if (empId) {
    // â”€â”€ EDIT MODE: update credentials on existing employee â”€â”€
    const payload = { password, role, username, nickname };
    const res = await fetchAuth(`${API_URL}/users/${empId}/credentials`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (res.ok) {
      showToast(`User credentials updated!`, "success");
      document.getElementById("set-password-modal").classList.add("hidden");
      loadUserAccounts();
      loadSystemUsers();
    } else {
      const data = await res.json();
      alert(
        "Error: " +
          (data.error ||
            "Server rejected the update. Please RESTART the server."),
      );
    }
  } else {
    // â”€â”€ ADD MODE: create a brand new system user â”€â”€
    if (!empId) return alert("Please select a worker first.");
    if (!username) return alert("Please enter a login username.");
    if (!password) return alert("Please set an initial password.");

    const payload = { password, role, username, nickname };
    const res = await fetchAuth(`${API_URL}/users/${empId}/credentials`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (res.ok) {
      showToast(`System user "${firstName} ${lastName}" created!`, "success");
      document.getElementById("set-password-modal").classList.add("hidden");
      loadUserAccounts();
      loadSystemUsers();
      loadEmployees();
    } else {
      const data = await res.json();
      alert(
        "Error: " + (data.error || "Could not create user. Check the server."),
      );
    }
  }
}

function autoRedirect() {
  if (USER_ROLE === "Cashier" || USER_ROLE === "Finance Manager") {
    if (posBtn && posBtn.style.display !== "none") {
      posBtn.click();
    } else {
      const fallback = document.querySelector(
        '.sidebar nav .nav-btn:not([style*="display: none"])',
      );
      if (fallback) fallback.click();
    }
  } else if (USER_ROLE === "Security") {
    const attBtn = document.querySelector('[data-target="supervision-hub"]');
    if (attBtn && attBtn.style.display !== "none") {
      attBtn.click();
    } else {
      const fallback = document.querySelector(
        '.sidebar nav .nav-btn:not([style*="display: none"])',
      );
      if (fallback) fallback.click();
    }
  } else if (USER_ROLE === "Receptionist") {
    const secBtn = document.querySelector('[data-target="secretary-hub"]');
    if (secBtn && secBtn.style.display !== "none") {
      secBtn.click();
    } else {
      const attBtn = document.querySelector('[data-target="supervision-hub"]');
      if (attBtn && attBtn.style.display !== "none") {
        attBtn.click();
      } else {
        const fallback = document.querySelector(
          '.sidebar nav .nav-btn:not([style*="display: none"])',
        );
        if (fallback) fallback.click();
      }
    }
  }
}

async function handleLogout() {
  if (!confirm("Are you sure you want to logout?")) return;
  try {
    await fetch(`${API_URL}/logout`, { method: "POST" });
  } catch (e) {}
  localStorage.removeItem("jomish_token");
  localStorage.removeItem("jomish_role");
  localStorage.removeItem("jomish_name");
  localStorage.removeItem("jomish_offline_mode");
  location.reload();
}

async function validateSession() {
  const token = localStorage.getItem("jomish_token");
  // No token = offline mode; skip validation to avoid unnecessary errors
  if (!token) return;
  // Also skip if explicitly in offline mode
  if (localStorage.getItem("jomish_offline_mode") === "true") return;
  try {
    const res = await fetch(`${API_URL}/verify`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      // Only logout on explicit auth rejection (401/403), not on network failure
      if (res.status === 401 || res.status === 403) {
        try {
          await fetch(`${API_URL}/logout`, { method: "POST" });
        } catch (e) {}
        localStorage.removeItem("jomish_token");
        localStorage.removeItem("jomish_role");
        localStorage.removeItem("jomish_permissions");
        localStorage.removeItem("jomish_offline_mode");
        window.location.href = "login.html?reason=session_expired";
      }
    }
  } catch (e) {
    // Network error — likely offline, keep session valid
    console.warn("Session validation skipped (offline/network error).");
  }
}

async function loadSystemStatus() {
  try {
    const res = await fetch(`${API_URL}/system/status`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const dbStatus = document.getElementById("db-type-status");
    if (dbStatus) {
      const dbType = (data.dbType || "sqlite").toUpperCase();
      dbStatus.innerText = dbType + " Engine — Connected";
      dbStatus.style.color = data.dbType === "postgres" ? "#10B981" : "#4F46E5";
    }

    // Update camera troubleshoot URL dynamically
    const troubleshootUrl = document.getElementById("troubleshoot-url");
    if (troubleshootUrl) {
      troubleshootUrl.innerText = window.location.origin;
    }

    const staffCount = document.getElementById("total-staff-status");
    if (staffCount) {
      const empRes = await fetch(`${API_URL}/employees`, {
        headers: {
          Authorization: `Bearer ${localStorage.getItem("jomish_token")}`,
        },
      });
      if (empRes.ok) {
        const empData = await empRes.json();
        staffCount.innerText = (empData.employees?.length || 0) + " Members";
      }
    }
  } catch (e) {
    console.error("System status fetch failed", e);
    const dbStatus = document.getElementById("db-type-status");
    if (dbStatus) {
      dbStatus.innerText = "Offline";
      dbStatus.style.color = "#EF4444";
    }
  }
}

async function handleAutoSchedule() {
  // Legacy prompt-based auto-schedule replaced by Smart Scheduler.
  // Delegate to the new IIFE function which reads the Business Blueprint.
  if (typeof window.smartAutoSchedule === "function") {
    window.smartAutoSchedule();
  } else {
    showToast("Navigate to the Shift Timetable tab to auto-schedule.", "info");
  }
}

window.printTimetable = async function () {
  const weekLabel = document.getElementById("tt-week-label")?.innerText || "";
  const companyName =
    document.getElementById("brand-name")?.innerText || "Jomish Business Suite";
  const today = new Date().toLocaleDateString("en-UG", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const customNotes =
    document.getElementById("timetable-print-notes")?.value.trim() || "";

  // Parse from/to from the week label ("2024-01-01  →  2024-01-07")
  const parts = weekLabel.split("→").map((s) => s.trim());
  const from = parts[0];
  const to = parts[1];
  if (!from || !to) {
    alert("Timetable not loaded yet. Please wait.");
    return;
  }

  // Fetch live assignments
  let assignments = [];
  try {
    const res = await fetchAuth(
      `${API_URL}/shift-assignments?from=${from}&to=${to}`,
    );
    const data = await res.json();
    assignments = data.assignments || [];
  } catch (e) {
    alert("Could not load timetable data.");
    return;
  }

  // Build 7-day columns Mon→Sun
  const startDate = new Date(from + "T00:00:00");
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(startDate);
    d.setDate(d.getDate() + i);
    return d;
  });
  const dayNames = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];
  const dateLabels = days.map((d) =>
    d.toLocaleDateString("en-UG", { day: "2-digit", month: "short" }),
  );

  // Build per-employee map: id → {name, role, days: {dateStr → {slot, time}}}
  const empMap = {};
  assignments.forEach((a) => {
    const key = a.employee_id;
    if (!empMap[key])
      empMap[key] = {
        name: `${a.first_name} ${a.last_name}`,
        role: a.role,
        dayData: {},
      };
    empMap[key].dayData[a.shift_date] = {
      slot: a.slot || "",
      start: a.start_time || "",
      end: a.end_time || "",
    };
  });

  let employees = Object.values(empMap).sort((a, b) =>
    a.name.localeCompare(b.name),
  );

  // Ensure at least 15 rows (blank rows like the template)
  while (employees.length < 15)
    employees.push({ name: "", role: "", dayData: {} });

  // Build table rows
  const rowsHtml = employees
    .map((emp, idx) => {
      const bg = idx % 2 === 0 ? "#ffffff" : "#d9edf7";
      // Compute total hours for the week
      let totalHours = 0;
      days.forEach((d) => {
        const ds = d.toISOString().split("T")[0];
        const info = emp.dayData[ds];
        if (info && info.start && info.end) {
          const [sh, sm] = info.start.split(":").map(Number);
          const [eh, em] = info.end.split(":").map(Number);
          totalHours += Math.max(0, eh * 60 + em - (sh * 60 + sm)) / 60;
        }
      });
      const hoursStr = totalHours > 0 ? totalHours.toFixed(1) + " hrs" : "";

      const dayCells = days
        .map((d) => {
          const ds = d.toISOString().split("T")[0];
          const info = emp.dayData[ds];
          const cellText = info
            ? `${info.slot}${info.start ? "<br><small>" + info.start + "-" + info.end + "</small>" : ""}`
            : "";
          return `<td style="border:1px solid #2196a8; padding:5px 6px; text-align:center; font-size:8pt; vertical-align:middle; background:${bg}; -webkit-print-color-adjust:exact; print-color-adjust:exact;">${cellText}</td>`;
        })
        .join("");

      return `<tr>
            <td style="border:1px solid #2196a8; padding:5px 8px; font-weight:${emp.name ? "600" : "normal"}; font-size:9pt; background:${bg}; -webkit-print-color-adjust:exact; print-color-adjust:exact; white-space:nowrap;">${emp.name}</td>
            <td style="border:1px solid #2196a8; padding:5px 6px; text-align:center; font-size:8pt; background:${bg}; -webkit-print-color-adjust:exact; print-color-adjust:exact;">${hoursStr}</td>
            ${dayCells}
        </tr>`;
    })
    .join("");

  // Column header: DATE | HOURS | MON(date) | TUE(date) ...
  const dayHeaderCells = dayNames
    .map(
      (dn, i) =>
        `<th style="background:#1a9ab5; color:#fff; padding:7px 4px; border:1px solid #0e7a91; font-size:9pt; text-align:center; -webkit-print-color-adjust:exact; print-color-adjust:exact;">${dn}<br><span style="font-size:7pt; font-weight:normal;">${dateLabels[i]}</span></th>`,
    )
    .join("");

  const printWindow = window.open("", "_blank", "width=1100,height=750");
  if (!printWindow) {
    alert("Please allow popups to print the timetable.");
    return;
  }

  const notesHtml = customNotes
    ? `<div style="font-size:10pt; line-height:1.5; white-space:pre-wrap; padding: 10px; border: 1px solid #2196a8;">${customNotes}</div>`
    : Array.from({ length: 4 })
        .map(() => `<div class="notes-row"></div>`)
        .join("");

  printWindow.document.write(`<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>Weekly Shift Timetable — ${weekLabel}</title>
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: Arial, Helvetica, sans-serif; background: #fff; color: #000; padding: 12mm 10mm; }
        .top-title { font-size: 16pt; font-weight: bold; margin-bottom: 10px; }
        .meta-row { display: flex; justify-content: space-between; margin-bottom: 14px; gap: 20px; }
        .meta-box { display: flex; flex-direction: column; gap: 2px; }
        .meta-label { font-size: 7pt; text-transform: uppercase; letter-spacing: 0.5px; color: #555; }
        .meta-value { border: 1px solid #aaa; min-width: 180px; padding: 4px 8px; font-size: 10pt; min-height: 22px; }
        table { width: 100%; border-collapse: collapse; }
        .notes-section { margin-top: 20px; }
        .notes-title { text-align: center; font-size: 12pt; font-weight: bold; margin-bottom: 8px; letter-spacing: 2px; }
        .notes-row { border: 1px solid #2196a8; height: 22px; margin-bottom: -1px; }
        @media print {
            body { padding: 8mm 6mm; }
            @page { size: A3 landscape; margin: 8mm; }
        }
    </style>
</head>
<body>
    <div class="top-title">${companyName} — Weekly Staff Shift Timetable</div>
    <div class="meta-row">
        <div class="meta-box">
            <div class="meta-label">Week Beginning:</div>
            <div class="meta-value">${from}</div>
        </div>
        <div class="meta-box">
            <div class="meta-label">Week Ending:</div>
            <div class="meta-value">${to}</div>
        </div>
        <div style="flex:1;"></div>
        <div class="meta-box">
            <div class="meta-label">Printed By:</div>
            <div class="meta-value">${document.getElementById("user-display-name")?.innerText || ""}</div>
        </div>
        <div class="meta-box">
            <div class="meta-label">Date Printed:</div>
            <div class="meta-value" style="font-size:8pt;">${today}</div>
        </div>
    </div>

    <table>
        <thead>
            <tr>
                <th style="background:#1a9ab5; color:#fff; padding:7px 8px; border:1px solid #0e7a91; font-size:9pt; text-align:left; -webkit-print-color-adjust:exact; print-color-adjust:exact; min-width:130px;">NAME / EMPLOYEE</th>
                <th style="background:#1a9ab5; color:#fff; padding:7px 6px; border:1px solid #0e7a91; font-size:9pt; text-align:center; -webkit-print-color-adjust:exact; print-color-adjust:exact; min-width:55px;">HOURS</th>
                ${dayHeaderCells}
            </tr>
        </thead>
        <tbody>
            ${rowsHtml}
        </tbody>
    </table>

    <div class="notes-section">
        <div class="notes-title">NOTES</div>
        ${notesHtml}
    </div>

    <div style="margin-top:14px; display:flex; justify-content:space-between; font-size:7pt; color:#666; border-top:1px solid #ccc; padding-top:6px;">
        <span>Generated by Jomish Business Suite</span>
        <span>Confidential — Internal Use Only</span>
        <span>Page 1</span>
    </div>

    <script>
        window.onload = function() { window.print(); setTimeout(function() { window.close(); }, 1800); };
    <\/script>
</body>
</html>`);
  printWindow.document.close();
};

async function loadSchedules() {
  // Legacy function — the new IIFE module renders the timetable grid.
  // Only keep counter sync here for the summary bar.
  if (typeof window.loadShiftTimetable === "function") {
    const section = document.getElementById("schedules");
    if (section && section.classList.contains("active")) {
      window.loadShiftTimetable();
    }
  }
}

// ==== PRINT PRODUCT LABELS (by range) ====
async function printProductLabelsRange(productName, startNum, endNum, price) {
  if (isNaN(startNum) || isNaN(endNum)) {
    console.error("Cannot print: invalid barcode range", startNum, endNum);
    return;
  }

  const count = endNum - startNum + 1;
  if (count > 200 && !confirm(`This will generate ${count} labels. Continue?`))
    return;

  const container = document.getElementById("labels-container");
  if (!container) return;
  container.innerHTML = "";

  for (let i = 0; i < count; i++) {
    const currentCode = (startNum + i).toString();

    const labelDiv = document.createElement("div");
    labelDiv.className = "label-sticker";

    const nameEl = document.createElement("div");
    nameEl.style =
      "font-size: 5pt; font-family: helvetica, sans-serif; font-weight: bold; text-align: center; line-height: 1.1; width: 100%; overflow: hidden; white-space: nowrap; text-overflow: ellipsis;";
    nameEl.textContent = productName.toUpperCase();

    const priceEl = document.createElement("div");
    priceEl.style =
      "font-size: 4.5pt; font-family: helvetica, sans-serif; text-align: center; margin-bottom: 2px;";
    if (price) {
      priceEl.textContent = "UGX " + Number(price).toLocaleString();
    } else {
      priceEl.textContent = " ";
    }

    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.style = "width: 100%; height: 12mm; max-width: 35mm;";
    try {
      JsBarcode(svg, currentCode, {
        format: "CODE128",
        width: 1.5,
        height: 50,
        displayValue: false,
        margin: 10,
      });
    } catch (e) {
      JsBarcode(svg, currentCode, {
        format: "codabar",
        width: 1.5,
        height: 50,
        displayValue: false,
        margin: 10,
      });
    }

    const codeEl = document.createElement("div");
    codeEl.style =
      "font-size: 6pt; font-family: 'Courier New', monospace; font-weight: bold; text-align: center; margin-top: 1px;";
    codeEl.textContent = currentCode;

    const footerEl = document.createElement("div");
    footerEl.style =
      "font-size: 2.5pt; font-family: helvetica, sans-serif; text-align: center; color: #666; margin-top: auto;";
    footerEl.textContent = "JOMISH";

    labelDiv.appendChild(nameEl);
    labelDiv.appendChild(priceEl);
    labelDiv.appendChild(svg);
    labelDiv.appendChild(codeEl);
    labelDiv.appendChild(footerEl);

    container.appendChild(labelDiv);
  }

  document
    .getElementById("label-overlay")
    .classList.add("receipt-modal-visible");
  showToast(`${count} barcode labels ready for printing!`, "success");
}

function doPrintLabels() {
  if (isPrinting) return;
  isPrinting = true;

  clearAllPrintModes();
  document.body.classList.add("print-mode-label");

  // Dynamically inject exact 38mm x 25mm barcode sticker @page style
  const style = document.createElement("style");
  style.id = "dynamic-print-page-style";
  style.innerHTML = `@page { size: 38mm 25mm; margin: 0; }`;
  document.head.appendChild(style);

  window.print();

  // Clean up style override immediately after print dialog resolves
  document.body.classList.remove("print-mode-label");
  style.remove();

  // Release print lock after a delay to absorb touchscreen click events
  setTimeout(() => {
    isPrinting = false;
  }, 1500);
}

function closeLabels() {
  const overlay = document.getElementById("label-overlay");
  if (overlay) overlay.classList.remove("receipt-modal-visible");
  document.body.classList.remove("print-mode-label");
  // Clear labels container on close
  const container = document.getElementById("labels-container");
  if (container) container.innerHTML = "";
}

// Wrapper for inventory label button
async function printProductLabels(p) {
  const startNum = parseInt(p.barcode);
  const endNum = parseInt(p.barcode_end || p.barcode);
  if (isNaN(startNum)) {
    alert("Cannot print: Barcode must be numeric.");
    return;
  }
  printProductLabelsRange(p.name, startNum, endNum, p.price);
}

// Barcode fields are now auto-assigned
function initBarcodeAutoCalc() {
  const barcodeNote = document.getElementById("prod-barcode");
  if (barcodeNote)
    barcodeNote.closest(".form-group")?.setAttribute("style", "display:none");
}

// ===== SECRETARY HUB: CALENDAR & EMAIL ENGINE =====
let calMonth = new Date().getMonth();
let calYear = new Date().getFullYear();
let calEvents = [];
let calSelectedDate = new Date().toISOString().split("T")[0];

function loadSecretaryHub() {
  switchSecretaryView("calendar");
  // Auto-trigger a sync in the background when hub is opened
  fetchAuth(`${API_URL}/emails/fetch`, { method: "POST" }).catch(() => {});

  // Form handler is now bound directly in index.html via onsubmit
  const calForm = document.getElementById("form-cal-event");
  if (calForm) calForm._bound = true;
  const emailForm = document.getElementById("form-email-config");
  if (emailForm && !emailForm._bound) {
    emailForm.addEventListener("submit", handleEmailConfigSubmit);
    emailForm._bound = true;
  }
}

function switchSecretaryView(view) {
  document.getElementById("sec-calendar-view").style.display =
    view === "calendar" ? "block" : "none";
  document.getElementById("sec-inbox-view").style.display =
    view === "inbox" ? "block" : "none";
  const msgView = document.getElementById("sec-messages-view");
  if (msgView) msgView.style.display = view === "messages" ? "block" : "none";
  const dirView = document.getElementById("sec-directory-view");
  if (dirView) dirView.style.display = view === "directory" ? "block" : "none";
  const meetView = document.getElementById("sec-meet-view");
  if (meetView) {
    if (view === "meet") {
      meetView.style.position = "relative";
      meetView.style.visibility = "visible";
      meetView.style.height = "auto";
      meetView.style.display = "block";
    } else {
      meetView.style.position = "absolute";
      meetView.style.visibility = "hidden";
      meetView.style.height = "0";
      meetView.style.display = "none";
    }
  }

  const calBtn = document.getElementById("btn-sec-calendar");
  if (calBtn) calBtn.classList.toggle("active", view === "calendar");
  const inboxBtn = document.getElementById("btn-sec-inbox");
  if (inboxBtn) inboxBtn.classList.toggle("active", view === "inbox");
  const msgBtn = document.getElementById("btn-sec-messages");
  if (msgBtn) msgBtn.classList.toggle("active", view === "messages");
  const dirBtn = document.getElementById("btn-sec-directory");
  if (dirBtn) dirBtn.classList.toggle("active", view === "directory");
  const meetBtn = document.getElementById("btn-sec-meet");
  if (meetBtn) meetBtn.classList.toggle("active", view === "meet");

  if (view === "calendar") renderCalendar();
  if (view === "inbox") {
    loadEmails();
    loadEmailConfig();
  }
  if (view === "messages") {
    loadStaffList();
    loadMessages();
  }
  if (view === "directory") renderStaffDirectory();
  if (view === "meet") loadMeetingOptions();

  // Ensure webview pointer events are only active when on the meet tab
  const wv = document.getElementById("meet-frame");
  if (wv) {
    wv.style.pointerEvents = view === "meet" ? "auto" : "none";
  }

  // Track whether the Meet webview tab is active (used by barcode scanner bypass).
  window._webviewTabActive = view === "meet";

  // ALWAYS restore host focus after a view switch.
  if (window.electronAPI && window.electronAPI.forceFocus) {
    window.electronAPI.forceFocus();
  } else {
    window.focus();
    document.body.focus();
  }
}

async function loadMeetingOptions() {
  try {
    const today = new Date();
    const m = today.getMonth() + 1;
    const y = today.getFullYear();
    const todayStr = today.toISOString().split("T")[0];

    const res = await fetchAuth(
      `${API_URL}/calendar/events?month=${m}&year=${y}`,
    );
    const data = await res.json();

    const select = document.getElementById("meet-event-select");
    if (!select) return;

    select.innerHTML = '<option value="">-- Select a Meeting --</option>';

    const todaysEvents = (data.events || []).filter(
      (e) => e.event_date === todayStr,
    );
    if (todaysEvents.length === 0) {
      select.innerHTML =
        '<option value="">No meetings scheduled for today</option>';
    } else {
      todaysEvents.forEach((e) => {
        select.innerHTML += `<option value="${e.id}">${e.start_time || ""} - ${e.title}</option>`;
      });
    }

    // Listen to change to load existing minutes if any
    select.addEventListener("change", () => {
      const ev = todaysEvents.find((x) => x.id == select.value);
      const textarea = document.getElementById("meet-minutes-text");
      if (ev && textarea) {
        textarea.value = ev.minutes || "";
      } else if (textarea) {
        textarea.value = "";
      }
    });
  } catch (e) {
    console.error("Error loading meetings for minutes:", e);
  }
}

async function saveMeetingMinutes() {
  const select = document.getElementById("meet-event-select");
  const textarea = document.getElementById("meet-minutes-text");
  if (!select || !textarea) return;

  const eventId = select.value;
  const minutes = textarea.value.trim();

  if (!eventId) {
    alert("Please select a meeting from the dropdown first.");
    return;
  }

  try {
    const res = await fetchAuth(
      `${API_URL}/calendar/events/${eventId}/minutes`,
      {
        method: "POST",
        body: JSON.stringify({ minutes }),
      },
    );

    if (res.ok) {
      showToast(`Meeting minutes saved successfully!`, "success");
    } else {
      const data = await res.json();
      alert("Error: " + (data.error || "Failed to save minutes"));
    }
  } catch (e) {
    console.error("Save minutes error:", e);
    alert("Failed to connect to server.");
  }
}

function toggleMeetMinutes() {
  const floatPanel = document.getElementById("meet-minutes-float");
  if (!floatPanel) return;
  if (floatPanel.style.display === "none" || !floatPanel.style.display) {
    floatPanel.style.display = "block";
    if (typeof loadMeetingOptions === "function") loadMeetingOptions();
  } else {
    floatPanel.style.display = "none";
  }
}

// Drag logic for meet-minutes-float
setTimeout(() => {
  const floatPanel = document.getElementById("meet-minutes-float");
  const dragHandle = document.getElementById("meet-minutes-drag-handle");
  if (!floatPanel || !dragHandle) return;

  let isDragging = false;
  let offsetX, offsetY;

  dragHandle.addEventListener("mousedown", (e) => {
    // Don't drag if clicking the close button
    if (
      e.target.tagName.toLowerCase() === "button" ||
      e.target.closest("button")
    )
      return;
    isDragging = true;
    const rect = floatPanel.getBoundingClientRect();
    offsetX = e.clientX - rect.left;
    offsetY = e.clientY - rect.top;
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
    // Prevent text selection during drag
    e.preventDefault();
  });

  function onMouseMove(e) {
    if (!isDragging) return;
    // Make sure it doesn't go off-screen completely, but simple assignment is fine
    let newX = e.clientX - offsetX;
    let newY = e.clientY - offsetY;

    floatPanel.style.left = newX + "px";
    floatPanel.style.top = newY + "px";
    floatPanel.style.right = "auto"; // Remove right anchoring
  }

  function onMouseUp() {
    isDragging = false;
    document.removeEventListener("mousemove", onMouseMove);
    document.removeEventListener("mouseup", onMouseUp);
  }
}, 1000);

function navigateCalendar(delta) {
  calMonth += delta;
  if (calMonth > 11) {
    calMonth = 0;
    calYear++;
  }
  if (calMonth < 0) {
    calMonth = 11;
    calYear--;
  }
  renderCalendar();
}

function goToToday() {
  calMonth = new Date().getMonth();
  calYear = new Date().getFullYear();
  calSelectedDate = new Date().toISOString().split("T")[0];
  renderCalendar();
}

async function renderCalendar() {
  const monthNames = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];
  document.getElementById("cal-month-title").textContent =
    `${monthNames[calMonth]} ${calYear}`;

  // Fetch events for this month
  try {
    const m = calMonth + 1;
    const res = await fetchAuth(
      `${API_URL}/calendar/events?month=${m}&year=${calYear}`,
    );
    const data = await res.json();
    calEvents = data.events || [];
  } catch (e) {
    console.error("Calendar fetch error:", e);
    calEvents = [];
  }

  const grid = document.getElementById("calendar-grid");
  grid.innerHTML = "";

  const firstDay = new Date(calYear, calMonth, 1);
  let startDay = firstDay.getDay() - 1; // Monday=0
  if (startDay < 0) startDay = 6;

  const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
  const daysInPrev = new Date(calYear, calMonth, 0).getDate();
  const todayStr = new Date().toISOString().split("T")[0];
  const totalCells = Math.ceil((startDay + daysInMonth) / 7) * 7;

  for (let i = 0; i < totalCells; i++) {
    const cell = document.createElement("div");
    cell.className = "cal-day";
    let dateStr, dayNum;

    if (i < startDay) {
      dayNum = daysInPrev - startDay + i + 1;
      const pm = calMonth === 0 ? 12 : calMonth;
      const py = calMonth === 0 ? calYear - 1 : calYear;
      dateStr = `${py}-${String(pm).padStart(2, "0")}-${String(dayNum).padStart(2, "0")}`;
      cell.classList.add("other-month");
    } else if (i >= startDay + daysInMonth) {
      dayNum = i - startDay - daysInMonth + 1;
      const nm = calMonth === 11 ? 1 : calMonth + 2;
      const ny = calMonth === 11 ? calYear + 1 : calYear;
      dateStr = `${ny}-${String(nm).padStart(2, "0")}-${String(dayNum).padStart(2, "0")}`;
      cell.classList.add("other-month");
    } else {
      dayNum = i - startDay + 1;
      dateStr = `${calYear}-${String(calMonth + 1).padStart(2, "0")}-${String(dayNum).padStart(2, "0")}`;
    }

    if (dateStr === todayStr) cell.classList.add("today");
    if (dateStr === calSelectedDate) cell.classList.add("selected");

    const numEl = document.createElement("div");
    numEl.className = "cal-day-num";
    numEl.textContent = dayNum;
    cell.appendChild(numEl);

    // Show event dots
    const dayEvents = calEvents.filter((e) => e.event_date === dateStr);
    dayEvents.slice(0, 3).forEach((evt) => {
      const dot = document.createElement("div");
      dot.className = "cal-event-dot";
      dot.style.background = evt.color || "#4F46E5";
      dot.textContent = evt.title;
      cell.appendChild(dot);
    });
    if (dayEvents.length > 3) {
      const more = document.createElement("div");
      more.style.cssText =
        "font-size:0.6rem; color:var(--text-muted); padding-left:5px;";
      more.textContent = `+${dayEvents.length - 3} more`;
      cell.appendChild(more);
    }

    cell.dataset.date = dateStr;
    cell.onclick = () => selectCalendarDate(dateStr);
    grid.appendChild(cell);
  }

  showDayEvents(calSelectedDate);
}

function selectCalendarDate(dateStr) {
  calSelectedDate = dateStr;
  // Update highlight without re-fetching from API
  document
    .querySelectorAll(".cal-day")
    .forEach((d) => d.classList.remove("selected"));
  document.querySelectorAll(".cal-day").forEach((d) => {
    if (d.dataset && d.dataset.date === dateStr) d.classList.add("selected");
  });
  showDayEvents(dateStr);
  // Pre-fill the event modal date
  const dateInput = document.getElementById("cal-evt-date");
  if (dateInput) dateInput.value = dateStr;
}

function showDayEvents(dateStr) {
  const container = document.getElementById("cal-events-list");
  const title = document.getElementById("cal-events-title");
  const d = new Date(dateStr + "T12:00:00");
  const dayName = d.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
  title.innerHTML = `<i class="fa-solid fa-thumbtack"></i> Events for ${dayName}`;

  const dayEvents = calEvents.filter((e) => e.event_date === dateStr);
  if (dayEvents.length === 0) {
    container.innerHTML = `<p style="color:var(--text-muted); text-align:center; padding:20px;">No events scheduled for this day.</p>`;
    return;
  }

  container.innerHTML = "";
  dayEvents.forEach((evt) => {
    const card = document.createElement("div");
    card.className = "cal-event-card";
    card.style.borderLeftColor = evt.color || "#4F46E5";
    const timeStr = evt.start_time
      ? `${evt.start_time}${evt.end_time ? " - " + evt.end_time : ""}`
      : "All Day";
    const typeColors = {
      Meeting: "#4F46E5",
      Appointment: "#10B981",
      Deadline: "#EF4444",
      Reminder: "#F59E0B",
      Holiday: "#EC4899",
      Other: "#8B5CF6",
    };
    card.innerHTML = `
            <div style="flex:1;">
                <div style="display:flex; align-items:center; gap:8px; margin-bottom:6px;">
                    <span style="background:${typeColors[evt.event_type] || "#4F46E5"}22; color:${typeColors[evt.event_type] || "#4F46E5"}; padding:2px 8px; border-radius:4px; font-size:0.7rem; font-weight:600;">${evt.event_type}</span>
                    <span style="font-size:0.8rem; color:var(--text-muted);"><i class="fa-regular fa-clock"></i> ${timeStr}</span>
                </div>
                <h4 style="margin:0 0 4px 0; font-size:1rem;">${evt.title}</h4>
                ${evt.description ? `<p style="font-size:0.85rem; color:var(--text-muted); margin:0;">${evt.description}</p>` : ""}
            </div>
            <div style="display:flex; flex-direction:column; gap:5px; align-items:flex-end;">
                ${evt.event_type === "Meeting" ? `<button class="sm-btn" style="background:#4F46E5; color:white; border:none;" onclick="openMinutesModal(${evt.id})" title="Meeting Minutes"><i class="fa-solid fa-pen-to-square"></i> Minutes</button>` : ""}
                <button class='sm-btn danger' onclick="deleteCalEvent(${evt.id})" title="Delete"><i class="fa-solid fa-trash"></i></button>
            </div>
        `;
    container.appendChild(card);
  });
}

async function handleCalEventSubmit(e) {
  e.preventDefault();

  // STEP 1: Read all form values
  const title = document.getElementById("cal-evt-title").value.trim();
  const event_date = document.getElementById("cal-evt-date").value;
  const event_type = document.getElementById("cal-evt-type").value;
  const start_time = document.getElementById("cal-evt-start").value;
  const end_time = document.getElementById("cal-evt-end").value;
  const description = document.getElementById("cal-evt-desc").value;
  const color = document.getElementById("cal-evt-color").value;

  // STEP 2: Validate required fields
  if (!title) {
    alert("ERROR: Title is empty. Please enter an event title.");
    return;
  }
  if (!event_date) {
    alert("ERROR: Date is empty. Please pick a date.");
    return;
  }

  const payload = {
    title,
    event_type,
    event_date,
    start_time,
    end_time,
    description,
    color,
  };

  // STEP 3: Check token
  const token = localStorage.getItem("jomish_token");
  if (!token) {
    alert("ERROR: No login token found. You are not logged in.");
    return;
  }

  // STEP 4: Send to server
  try {
    const res = await fetchAuth(`${API_URL}/calendar/events`, {
      method: "POST",
      body: JSON.stringify(payload),
    });

    // STEP 5: Check HTTP status
    if (res.ok) {
      document.getElementById("cal-event-modal").classList.add("hidden");
      e.target.reset();
      calSelectedDate = event_date;
      const [y, m] = event_date.split("-");
      calYear = parseInt(y, 10);
      calMonth = parseInt(m, 10) - 1;
      await renderCalendar();
      showToast("Calendar event created!", "success");
    } else {
      let errMsg = "Unknown server error (status " + res.status + ")";
      try {
        const d = await res.json();
        errMsg = d.error || errMsg;
      } catch (je) {}
      alert("SERVER ERROR: " + errMsg);
    }
  } catch (err) {
    alert(
      "NETWORK ERROR: Could not reach server.\nDetails: " +
        err.message +
        "\nAPI URL: " +
        API_URL,
    );
  }
}

async function deleteCalEvent(id) {
  if (!confirm("Delete this event?")) return;
  try {
    const res = await fetchAuth(`${API_URL}/calendar/events/${id}`, {
      method: "DELETE",
    });
    if (res.ok) renderCalendar();
  } catch (e) {
    console.error("Delete event error:", e);
  }
}

// ===== MEETING MINUTES LOGIC =====
function openMinutesModal(eventId) {
  const evt = calEvents.find((e) => e.id === eventId);
  if (!evt) return;

  document.getElementById("minutes-evt-id").value = eventId;
  document.getElementById("minutes-modal-title").textContent =
    `Minutes: ${evt.title}`;

  const timeStr = evt.start_time
    ? `${evt.start_time}${evt.end_time ? " - " + evt.end_time : ""}`
    : "All Day";
  document.getElementById("minutes-modal-subtitle").innerHTML =
    `<i class="fa-solid fa-calendar"></i> ${evt.event_date} | <i class="fa-regular fa-clock"></i> ${timeStr}`;

  document.getElementById("minutes-content").value = evt.minutes || "";

  document.getElementById("minutes-modal").classList.remove("hidden");
}

document
  .getElementById("btn-save-minutes")
  ?.addEventListener("click", async () => {
    const btn = document.getElementById("btn-save-minutes");
    btn.disabled = true;
    btn.textContent = "Saving...";

    const id = document.getElementById("minutes-evt-id").value;
    const minutes = document.getElementById("minutes-content").value;

    try {
      const res = await fetchAuth(`${API_URL}/calendar/events/${id}/minutes`, {
        method: "POST",
        body: JSON.stringify({ minutes }),
      });

      if (res.ok) {
        alert("Minutes saved successfully!");
        const evt = calEvents.find((e) => e.id == id);
        if (evt) evt.minutes = minutes;
        document.getElementById("minutes-modal").classList.add("hidden");
      } else {
        alert("Error saving minutes.");
      }
    } catch (e) {
      alert("Network error saving minutes.");
    }

    btn.disabled = false;
    btn.textContent = "Save Minutes";
  });

document
  .getElementById("btn-download-minutes")
  ?.addEventListener("click", () => {
    const id = document.getElementById("minutes-evt-id").value;
    const evt = calEvents.find((e) => e.id == id);
    if (!evt) return;

    const minutes = document.getElementById("minutes-content").value;
    if (!minutes.trim()) {
      alert("Please save some minutes before downloading.");
      return;
    }

    try {
      const { jsPDF } = window.jspdf;
      const doc = new jsPDF();

      doc.setFontSize(18);
      doc.text("Meeting Minutes", 14, 20);

      doc.setFontSize(12);
      doc.setTextColor(100);
      doc.text(`Subject: ${evt.title}`, 14, 30);
      doc.text(`Date: ${evt.event_date}`, 14, 38);
      const timeStr = evt.start_time
        ? `${evt.start_time}${evt.end_time ? " - " + evt.end_time : ""}`
        : "All Day";
      doc.text(`Time: ${timeStr}`, 14, 46);

      doc.line(14, 50, 196, 50); // Horizontal line

      doc.setFontSize(11);
      doc.setTextColor(0);

      // Handle multi-line text wrapping automatically
      const splitText = doc.splitTextToSize(minutes, 180);
      doc.text(splitText, 14, 60);

      doc.save(
        `Meeting_Minutes_${evt.event_date}_${evt.title.replace(/[^a-z0-9]/gi, "_")}.pdf`,
      );
    } catch (e) {
      console.error("PDF Generation Error:", e);
      alert("Error generating PDF. Make sure the jsPDF library is loaded.");
    }
  });

// ===== EMAIL INBOX =====
async function loadEmails() {
  try {
    const res = await fetchAuth(`${API_URL}/emails`);
    const data = await res.json();
    const emails = data.emails || [];
    const unread = data.unread_count || 0;

    document.getElementById("email-total-count").textContent = emails.length;
    document.getElementById("email-unread-count").textContent = unread;
    const badge = document.getElementById("unread-badge");
    if (badge) {
      badge.textContent = unread;
      badge.style.display = unread > 0 ? "inline" : "none";
    }

    window.unreadEmails = unread;
    if (typeof updateSecretaryGlobalBadge === "function")
      updateSecretaryGlobalBadge();

    const tbody = document.getElementById("email-inbox-tbody");
    if (emails.length === 0) {
      tbody.innerHTML =
        '<tr><td colspan="4" style="text-align:center; padding:40px; color:#94A3B8;">No emails yet. Click "Fetch New Emails" to pull from Gmail.</td></tr>';
      return;
    }

    tbody.innerHTML = "";
    emails.forEach((em) => {
      const tr = document.createElement("tr");
      tr.className = `email-row ${em.is_read ? "read" : "unread"}`;
      tr.innerHTML = `
                <td style="width:30px; text-align:center;"></td>
                <td style="max-width:180px;"><strong style="display:block; font-size:0.88rem;">${em.from_name || em.from_address}</strong><span style="font-size:0.72rem; color:var(--text-muted);">${em.from_address}</span></td>
                <td style="max-width:350px;"><div style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${em.subject}</div></td>
                <td style="white-space:nowrap; font-size:0.8rem; color:var(--text-muted);">${formatDisplayDate(em.received_at)}</td>
            `;
      tr.onclick = () => openEmailPreview(em);
      tbody.appendChild(tr);
    });
  } catch (e) {
    console.error("Load emails error:", e);
  }
}

async function openEmailPreview(em) {
  window._currentEmail = em;

  // Populate Capsule
  document.getElementById("capsule-subject").textContent = em.subject;
  document.getElementById("capsule-from").textContent =
    em.from_name || em.from_address;
  document.getElementById("capsule-date").textContent = formatDisplayDate(
    em.received_at,
  );
  document.getElementById("capsule-body").textContent =
    em.body_preview || "(No content)";

  // Show Reading View
  document.getElementById("capsule-read-view").style.display = "block";
  document.getElementById("capsule-reply-view").style.display = "none";
  document.getElementById("btn-capsule-reply").style.display = "block";

  // Slide in
  document.getElementById("email-capsule-panel").classList.add("active");

  // Mark as read in background
  if (!em.is_read) {
    try {
      await fetchAuth(`${API_URL}/emails/${em.id}/read`, { method: "PATCH" });
      loadEmails(); // Refresh list to update UI count
    } catch (e) {}
  }
}

function closeEmailCapsule() {
  document.getElementById("email-capsule-panel").classList.remove("active");
}

function toggleCapsuleReply() {
  const readView = document.getElementById("capsule-read-view");
  const replyView = document.getElementById("capsule-reply-view");
  const em = window._currentEmail;

  if (replyView.style.display === "none") {
    // Switch to Reply
    document.getElementById("reply-to").value = em.from_address;
    document.getElementById("reply-subject").value = `Re: ${em.subject}`;
    document.getElementById("reply-body").value =
      `\n\n--- Original Message ---\nFrom: ${em.from_address}\nDate: ${formatDisplayDate(em.received_at)}\n\n${em.body_preview}`;

    readView.style.display = "none";
    replyView.style.display = "block";
    document.getElementById("btn-capsule-reply").style.display = "none";
    document.getElementById("reply-body").focus();
    window._isBlastMode = false;
  } else {
    // Back to Reading
    readView.style.display = "block";
    replyView.style.display = "none";
    document.getElementById("btn-capsule-reply").style.display = "block";
  }
}

// handleEmailReplySubmit() is defined below with blast-mode support

function bridgeStaffEmail(email, name, content) {
  // Populate Capsule with Staff Info
  document.getElementById("reply-to").value = email;
  document.getElementById("reply-subject").value =
    `Follow-up: Internal Message for ${name}`;
  document.getElementById("reply-body").value =
    `Hi ${name.split(" ")[0]},\n\nI'm following up on our internal message:\n"${content}"\n\n---\nBest Regards,\n${localStorage.getItem("jomish_name")}`;

  // Switch to Reply View in Capsule
  document.getElementById("capsule-read-view").style.display = "none";
  document.getElementById("capsule-reply-view").style.display = "block";
  document.getElementById("btn-capsule-reply").style.display = "none";

  // Open Capsule
  document.getElementById("email-capsule-panel").classList.add("active");
}

async function fetchNewEmails(e) {
  const btn =
    e && e.target
      ? e.target
      : document.querySelector('[onclick*="fetchNewEmails"]');
  if (btn) {
    btn.disabled = true;
    btn.textContent = "Syncing Gmail...";
  }
  try {
    const res = await fetchAuth(`${API_URL}/emails/fetch`, { method: "POST" });
    const data = await res.json();
    if (res.ok) {
      showToast(data.message || "Inbox synced.", "success");
      loadEmails();
    } else {
      showToast(data.error || "Failed to sync emails.", "danger");
    }
  } catch (e) {
    showToast(`Network error. Check server connection.`, "danger");
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<i class="fa-solid fa-inbox"></i> Sync Inbox';
    }
  }
}

async function loadEmailConfig() {
  try {
    const res = await fetchAuth(`${API_URL}/settings/email`);
    const data = await res.json();
    const statusEl = document.getElementById("email-connection-status");
    if (data.configured) {
      statusEl.innerHTML = '<i class="fa-solid fa-check"></i> ' + data.email;
      statusEl.style.color = "var(--success)";
    } else {
      statusEl.textContent = "Not Configured";
      statusEl.style.color = "var(--text-muted)";
    }
  } catch (e) {
    console.error("Email config load error:", e);
  }
}

async function handleEmailConfigSubmit(e) {
  e.preventDefault();
  const email = document.getElementById("email-cfg-address").value;
  const pwd = document.getElementById("email-cfg-password").value;
  const resendKey = document.getElementById("email-cfg-resend-key").value;

  // Only require password if one isn't already set, or if we are changing it
  const payload = { email };
  if (pwd) payload.app_password = pwd;
  if (resendKey) payload.resend_api_key = resendKey;

  try {
    const res = await fetchAuth(`${API_URL}/settings/email`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (res.ok) {
      alert("Gmail configuration saved!");
      document.getElementById("email-config-modal").classList.add("hidden");
      e.target.reset();
      loadEmailConfig();
    } else {
      const d = await res.json();
      alert("" + (d.error || "Failed to save configuration."));
    }
  } catch (err) {
    alert("Network error");
  }
}

// ===== INTERNAL MESSAGING ENGINE =====
let _receptionistId = null;

async function loadStaffList() {
  try {
    const res = await fetchAuth(`${API_URL}/employees`);
    const data = await res.json();

    const selInternal = document.getElementById("msg-to-id");
    const selCapsule = document.getElementById("capsule-staff-select");

    const htmlInternal = ['<option value="">-- Search Directory --</option>'];
    const htmlCapsule = ['<option value="">-- Search Directory --</option>'];

    (data.employees || []).forEach((emp) => {
      const emailInfo = emp.email ? ` - ${emp.email}` : " (No Email Set)";
      const label = `${emp.first_name} ${emp.last_name} (${emp.role || "Staff"})${emailInfo}`;

      htmlInternal.push(`<option value="${emp.id}">${label}</option>`);
      if (emp.email) {
        htmlCapsule.push(`<option value="${emp.email}">${label}</option>`);
      } else {
        htmlCapsule.push(`<option value="" disabled>${label}</option>`);
      }
    });

    if (selInternal) selInternal.innerHTML = htmlInternal.join("");
    if (selCapsule) selCapsule.innerHTML = htmlCapsule.join("");
  } catch (e) {
    console.error("Staff list error:", e);
  }
}

function openNewEmailCapsule() {
  // Reset for Single Message
  document.getElementById("reply-to").value = "";
  document.getElementById("reply-to").classList.remove("dimmed-input");
  document.getElementById("reply-subject").value = "";
  document.getElementById("reply-body").value = "";
  document.getElementById("capsule-staff-select").value = "";

  // Show search
  document.getElementById("capsule-recipient-group").style.display = "block";

  document.getElementById("capsule-read-view").style.display = "none";
  document.getElementById("capsule-reply-view").style.display = "block";
  document.getElementById("btn-capsule-reply").style.display = "none";

  // Set Header
  document.getElementById("capsule-reply-view").querySelector("h2").innerHTML =
    '<i class="fa-solid fa-envelope"></i> Compose New Email';

  // Open Panel
  document.getElementById("email-capsule-panel").classList.add("active");
  loadStaffList();
  window._isBlastMode = false;
}

function openBlastEmailCapsule() {
  // Set Blast Mode
  document.getElementById("reply-to").value =
    '<i class="fa-solid fa-bullhorn"></i> ALL ACTIVE STAFF (BCC Blast)';
  document.getElementById("reply-to").classList.add("dimmed-input");
  document.getElementById("reply-subject").value = "";
  document.getElementById("reply-body").value = "";

  // Hide Search since it's a blast
  document.getElementById("capsule-recipient-group").style.display = "none";

  document.getElementById("capsule-read-view").style.display = "none";
  document.getElementById("capsule-reply-view").style.display = "block";
  document.getElementById("btn-capsule-reply").style.display = "none";

  // Set Header
  document.getElementById("capsule-reply-view").querySelector("h2").innerHTML =
    '<i class="fa-solid fa-bullhorn"></i> Mass Staff Email Blast';

  // Open Panel
  document.getElementById("email-capsule-panel").classList.add("active");

  // Set flag for handler
  window._isBlastMode = true;
}

async function handleEmailReplySubmit(e) {
  e.preventDefault();
  const btn = document.getElementById("btn-send-reply");
  btn.disabled = true;
  btn.textContent = "Processing...";

  const isBlast = window._isBlastMode === true;
  const endpoint = isBlast
    ? `${API_URL}/emails/blast`
    : `${API_URL}/emails/send`;

  const payload = {
    subject: document.getElementById("reply-subject").value,
    body: document.getElementById("reply-body").value,
  };

  if (!isBlast) payload.to = document.getElementById("reply-to").value;

  try {
    const res = await fetchAuth(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (res.ok) {
      alert(
        isBlast ? "Staff Blast sent successfully!" : "Email sent successfully!",
      );
      closeEmailCapsule();
      e.target.reset();
    } else {
      const data = await res.json();
      alert("Failed: " + (data.error || "Check configuration"));
    }
  } catch (err) {
    alert("Network error.");
  } finally {
    btn.disabled = false;
    btn.textContent = isBlast ? "Send Blast" : "Send Reply";
    window._isBlastMode = false; // Reset
  }
}

async function loadMessages() {
  try {
    const res = await fetchAuth(`${API_URL}/messages`);
    const data = await res.json();
    const msgs = data.messages || [];

    const container = document.getElementById("sec-messages-list");
    if (!container) return;

    // Update badge
    const userId = parseInt(localStorage.getItem("jomish_user_id"));
    const unread = msgs.filter((m) => m.to_id === userId && !m.is_read).length;
    const badge = document.getElementById("msg-badge");
    if (badge) {
      badge.textContent = unread;
      badge.style.display = unread > 0 ? "inline" : "none";
    }

    if (msgs.length === 0) {
      container.innerHTML =
        '<p style="color:var(--text-muted); text-align:center; padding:30px;">No messages yet. Send your first message to a staff member!</p>';
      return;
    }

    container.innerHTML = "";
    msgs.forEach((m) => {
      const isSent = m.from_id === userId;
      const otherName = isSent
        ? `${m.to_first || ""} ${m.to_last || ""}`
        : `${m.from_first || ""} ${m.from_last || ""}`;
      const otherRole = isSent ? m.to_role : m.from_role;
      const card = document.createElement("div");
      card.className = "msg-card";
      card.style.cssText = `background:var(--background); border-radius:10px; padding:14px 16px; border-left:4px solid ${isSent ? "#10B981" : "#4F46E5"}; ${!m.is_read && !isSent ? "border:1px solid rgba(79,70,229,0.4);" : ""}`;
      const otherEmail = isSent ? m.to_email : m.from_email;

      card.innerHTML = `
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
                    <div style="display:flex; align-items:center; gap:8px;">
                        <span style="font-size:0.7rem; background:${isSent ? "rgba(16,185,129,0.15)" : "rgba(79,70,229,0.15)"}; color:${isSent ? "#10B981" : "#4F46E5"}; padding:2px 8px; border-radius:4px; font-weight:600;">${isSent ? "SENT" : "RECEIVED"}</span>
                        <strong style="font-size:0.9rem;">${otherName.trim()}</strong>
                        <span style="font-size:0.7rem; color:#94A3B8;">${otherRole || ""}</span>
                    </div>
                    <span style="font-size:0.72rem; color:#94A3B8;">${formatDisplayDate(m.created_at)}</span>
                </div>
                ${m.subject ? `<div style="font-size:0.82rem; font-weight:600; margin-bottom:4px; color:var(--text);">${m.subject}</div>` : ""}
                <p style="font-size:0.88rem; color:var(--text); line-height:1.5; margin:0;">${m.content}</p>
                <div style="display:flex; justify-content:space-between; align-items:center; margin-top:10px;">
                    ${!m.is_read && !isSent ? '<div style="font-size:0.65rem; color:var(--primary); font-weight:600;">●  NEW</div>' : "<div></div>"}
                    ${otherEmail ? `<button class="sm-btn secondary" onclick="bridgeStaffEmail('${otherEmail}', '${otherName.trim().replace(/'/g, "\\'")}', '${m.content.replace(/'/g, "\\'")}')"><i class="fa-solid fa-envelope"></i> Send Work Email</button>` : ""}
                </div>
            `;
      // Mark as read on click
      if (!m.is_read && !isSent) {
        card.style.cursor = "pointer";
        card.onclick = async () => {
          await fetchAuth(`${API_URL}/messages/${m.id}/read`, {
            method: "PATCH",
          });
          loadMessages();
        };
      }
      container.appendChild(card);
    });
  } catch (e) {
    console.error("Load messages error:", e);
  }
}

async function renderStaffDirectory() {
  try {
    const res = await fetchAuth(`${API_URL}/employees`);
    const data = await res.json();
    window._staffDirectory = data.employees || [];
    searchStaffDirectory(); // Initial render
  } catch (e) {
    console.error("Directory error:", e);
  }
}

function searchStaffDirectory() {
  const query = document.getElementById("directory-search").value.toLowerCase();
  const tbody = document.getElementById("staff-directory-tbody");
  if (!tbody) return;

  tbody.innerHTML = "";
  const filtered = (window._staffDirectory || []).filter((emp) => {
    if (!emp.is_active) return false;
    const searchStr =
      `${emp.first_name} ${emp.last_name} ${emp.email} ${emp.role} ${emp.department}`.toLowerCase();
    return searchStr.includes(query);
  });

  if (filtered.length === 0) {
    tbody.innerHTML =
      '<tr><td colspan="4" style="text-align:center; padding:30px; color:var(--text-muted);">No staff found matching your search.</td></tr>';
    return;
  }

  filtered.forEach((emp) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
            <td>
                <div style="display:flex; align-items:center; gap:10px;">
                    <div style="width:32px; height:32px; border-radius:50%; background:${emp.profile_color || "var(--primary)"}; display:flex; align-items:center; justify-content:center; color:white; font-size:0.8rem; font-weight:700;">
                        ${emp.first_name[0]}${emp.last_name[0]}
                    </div>
                    <strong>${emp.first_name} ${emp.last_name}</strong>
                </div>
            </td>
            <td>
                <div style="font-size:0.88rem;">${emp.role || "Staff"}</div>
                <div style="font-size:0.7rem; color:var(--text-muted);">${emp.department || "Operations"}</div>
            </td>
            <td>
                <code style="font-size:0.85rem; color:var(--primary);">${emp.email || '<span style="color:var(--danger);">[ No Email Registered ]</span>'}</code>
            </td>
            <td>
                ${emp.email ? `<button class="sm-btn primary" onclick="quickEmail('${emp.email}')"><i class="fa-solid fa-envelope"></i> Email</button>` : ""}
            </td>
        `;
    tbody.appendChild(tr);
  });
}

function quickEmail(email) {
  openNewEmailCapsule();
  document.getElementById("reply-to").value = email;
}

async function handleSendMessage(e) {
  e.preventDefault();
  const payload = {
    to_id: document.getElementById("msg-to-id").value,
    subject: document.getElementById("msg-subject").value,
    content: document.getElementById("msg-content").value,
  };
  try {
    const res = await fetchAuth(`${API_URL}/messages`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
    if (res.ok) {
      alert("Message sent!");
      e.target.reset();
      loadMessages();
    } else {
      const d = await res.json();
      alert("" + (d.error || "Failed to send"));
    }
  } catch (err) {
    alert("Network error");
  }
}

// Dashboard: Load messages from front desk (for non-secretary staff)
async function loadDeskMessages() {
  const panel = document.getElementById("desk-messages-panel");
  if (!panel) return;

  // Only show for non-secretary roles
  if (USER_ROLE === "Receptionist") {
    panel.style.display = "none";
    return;
  }

  try {
    const res = await fetchAuth(`${API_URL}/messages`);
    const data = await res.json();
    const msgs = data.messages || [];

    const userId = parseInt(localStorage.getItem("jomish_user_id"));
    const received = msgs.filter((m) => m.to_id === userId);
    if (received.length === 0) {
      panel.style.display = "none";
      return;
    }

    panel.style.display = "block";
    const unread = received.filter((m) => !m.is_read).length;
    const badge = document.getElementById("dash-msg-badge");
    if (badge) {
      badge.textContent = unread;
      badge.style.display = unread > 0 ? "inline" : "none";
    }

    // Find the receptionist ID for reply
    const receptionists = msgs.filter((m) => m.from_role === "Receptionist");
    if (receptionists.length > 0) _receptionistId = receptionists[0].from_id;

    const list = document.getElementById("dash-messages-list");
    list.innerHTML = "";
    received.forEach((m) => {
      const card = document.createElement("div");
      card.style.cssText = `background:var(--background); border-radius:8px; padding:14px; border-left:3px solid ${m.is_read ? "var(--border)" : "var(--primary)"}; cursor:pointer;`;
      card.innerHTML = `
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
                    <strong style="font-size:0.88rem; color:${m.is_read ? "var(--text-muted)" : "var(--text)"};">${m.from_first || "Front Desk"} ${m.from_last || ""}</strong>
                    <span style="font-size:0.7rem; color:#94A3B8;">${formatDisplayDate(m.created_at)}</span>
                </div>
                ${m.subject ? `<div style="font-size:0.8rem; font-weight:600; color:var(--primary); margin-bottom:4px;">${m.subject}</div>` : ""}
                <p style="font-size:0.85rem; color:var(--text); margin:0; line-height:1.4;">${m.content}</p>
                ${!m.is_read ? '<div style="font-size:0.6rem; color:var(--primary); margin-top:4px; font-weight:700;">●  UNREAD — click to mark as read</div>' : ""}
            `;
      if (!m.is_read) {
        card.onclick = async () => {
          await fetchAuth(`${API_URL}/messages/${m.id}/read`, {
            method: "PATCH",
          });
          loadDeskMessages();
        };
      }
      list.appendChild(card);
    });
  } catch (e) {
    console.error("Desk messages error:", e);
  }
}

async function handleReplyToDesk(e) {
  e.preventDefault();
  if (!_receptionistId) {
    // Try to find the receptionist from employees
    try {
      const res = await fetchAuth(`${API_URL}/employees`);
      const data = await res.json();
      const rec = (data.employees || []).find(
        (emp) => emp.role === "Receptionist" && emp.is_active,
      );
      if (rec) _receptionistId = rec.id;
      else {
        alert("No active Receptionist found in the system.");
        return;
      }
    } catch (e) {
      alert("Could not find Receptionist.");
      return;
    }
  }
  const payload = {
    to_id: _receptionistId,
    subject: document.getElementById("reply-msg-subject").value,
    content: document.getElementById("reply-msg-content").value,
  };
  try {
    const res = await fetchAuth(`${API_URL}/messages`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
    if (res.ok) {
      alert("Reply sent to Front Desk!");
      document.getElementById("reply-msg-modal").classList.add("hidden");
      e.target.reset();
      loadDeskMessages();
    } else {
      const d = await res.json();
      alert("" + (d.error || "Failed to send"));
    }
  } catch (err) {
    alert("Network error");
  }
}

// Register messaging form handlers
document.addEventListener("DOMContentLoaded", () => {
  const sendForm = document.getElementById("form-send-msg");
  if (sendForm) sendForm.addEventListener("submit", handleSendMessage);
  const replyForm = document.getElementById("form-reply-msg");
  if (replyForm) replyForm.addEventListener("submit", handleReplyToDesk);
});

// ===== DATA LOSS WARNING (after restore from backup) =====
async function checkDataLossWarning() {
  try {
    const res = await fetchAuth(`${API_URL}/system-meta/data_loss_warning`);
    if (!res.ok) return;
    const data = await res.json();
    if (!data.value) return;

    // Don't show again if dismissed this session
    if (sessionStorage.getItem("data_loss_dismissed")) return;

    // Show warning banner
    const banner = document.createElement("div");
    banner.id = "data-loss-banner";
    banner.style.cssText = `
            position:fixed;top:0;left:0;right:0;z-index:99998;
            background:linear-gradient(135deg,#dc2626,#b91c1c);color:white;
            padding:16px 24px;font-size:0.9rem;text-align:center;
            box-shadow:0 4px 20px rgba(0,0,0,0.3);display:flex;
            align-items:center;justify-content:center;gap:12px;
        `;
    banner.innerHTML = `
            <span style="font-size:1.4rem"><i class="fa-solid fa-triangle-exclamation"></i></span>
            <span><strong>System Restored from Backup.</strong> ${data.value}</span>
            <button onclick="dismissDataLoss()" style="
                background:rgba(255,255,255,0.2);border:1px solid rgba(255,255,255,0.4);
                color:white;padding:6px 16px;border-radius:8px;cursor:pointer;
                font-size:0.8rem;font-weight:600;margin-left:12px;
            ">Acknowledge</button>
        `;
    document.body.appendChild(banner);
  } catch (e) {
    /* silent */
  }
}

function dismissDataLoss() {
  const el = document.getElementById("data-loss-banner");
  if (el) el.remove();
  sessionStorage.setItem("data_loss_dismissed", "1");
  // Clear the warning from DB
  fetchAuth(`${API_URL}/system-meta/data_loss_warning`, {
    method: "DELETE",
  }).catch(() => {});
}

// ===== SECRETARY GLOBAL BADGE LOGIC =====
window.unreadEmails = 0;

function updateSecretaryGlobalBadge() {
  const badge = document.getElementById("sec-global-badge");
  if (!badge) return;
  const total = window.unreadEmails || 0;
  if (total > 0) {
    badge.textContent = total;
    badge.style.display = "inline";
  } else {
    badge.style.display = "none";
  }
}

async function fetchGlobalUnreadEmails() {
  try {
    const res = await fetchAuth(`${API_URL}/emails`);
    const data = await res.json();
    window.unreadEmails = data.unread_count || 0;
    updateSecretaryGlobalBadge();
  } catch (e) {}
}

document.addEventListener("DOMContentLoaded", () => {
  // Initial fetch for emails if permission allows
  setTimeout(() => {
    if (USER_PERMISSIONS && USER_PERMISSIONS.can_see_secretary) {
      fetchGlobalUnreadEmails();
    }
  }, 1500);

  // WhatsApp unread listener is now bound dynamically when the webview is created.
});

// Global Barcode Scanner Logic (Hardware)
function initGlobalScanner() {

  let barcodeBuffer = "";
  let lastKeyTime = 0;
  let isScanning = false;

  // Use capture phase (true) to intercept keystrokes BEFORE they reach input elements
  window.addEventListener(
    "keydown",
    async (e) => {
      // FIX: Bypass barcode scanner if a webview tab (WhatsApp / Meet) is active.
      // Previously used waView.style.display check which was fragile and could be
      // wrong during display transitions. Now uses a reliable flag set by switchSecretaryView.
      if (window._webviewTabActive) {
        return;
      }

      // Prevent auto-repeat from triggering scanner logic when holding a key
      if (e.repeat) {
        barcodeBuffer = "";
        return;
      }

      // Ignore modifier keys but reset buffer just in case
      if (!e || !e.key) return;
      if (e.key.length !== 1 && e.key !== "Enter") {
        barcodeBuffer = "";
        return;
      }

      const currentTime = Date.now();
      const timeDiff = currentTime - lastKeyTime;
      lastKeyTime = currentTime;

      // Scanners typically fire keys extremely fast (< 40ms apart).
      // If the time diff is > 40ms, it's likely human typing or a new scan.
      if (timeDiff > 40) {
        // Too slow for a scanner, reset buffer
        barcodeBuffer = e.key.length === 1 ? e.key : "";
        return;
      }

      if (e.key !== "Enter") {
        barcodeBuffer += e.key;
      } else {
        if (barcodeBuffer.length >= 3) {
          // We have a barcode!
          e.preventDefault();
          e.stopPropagation();

          const finalCode = barcodeBuffer;
          barcodeBuffer = "";

          // Remove the scanned characters from the focused input if they leaked in
          if (document.activeElement) {
            const el = document.activeElement;
            if (
              (el.tagName === "INPUT" || el.tagName === "TEXTAREA") &&
              !el.readOnly
            ) {
              if (el.value && el.value.length >= finalCode.length) {
                const valStr = String(el.value);
                if (valStr.endsWith(finalCode)) {
                  el.value = valStr.slice(0, -finalCode.length);
                  el.dispatchEvent(new Event("input", { bubbles: true }));
                }
              }
            }
          }

          await handleGlobalBarcode(finalCode);
        } else {
          barcodeBuffer = "";
        }
      }
    },
    true,
  ); // Important: capture phase
}

async function handleGlobalBarcode(code) {

  // 1. Intercept for Scan Session Modal (adding barcodes to a new product)
  const scanSession = document.getElementById("scan-session-modal");
  if (scanSession && !scanSession.classList.contains("hidden")) {
    const inputEl = document.getElementById("scan-input");
    if (inputEl) {
      inputEl.value = code;
      if (typeof window.submitScanInput === "function") {
        window.submitScanInput();
      }
    }
    return;
  }

  // 2. Intercept for Edit Product Modal
  const editModal = document.getElementById("edit-product-modal");
  if (editModal && !editModal.classList.contains("hidden")) {
    const editBarcodeEl = document.getElementById("edit-prod-barcode");
    if (editBarcodeEl) {
      editBarcodeEl.value = code;
    }
    return;
  }

  // Check if POS terminal is the active section
  const isPOSActive = posSection && posSection.classList.contains("active");

  if (isPOSActive) {
    // Route through the local POS handler which validates unique barcodes and manages cart
    await handleBarcodeScan(code);
    return;
  }

  // For non-POS contexts, use the server API (handles employee attendance + product lookup)
  try {
    const res = await fetchAuth(`${API_URL}/scan/global`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });

    if (res.ok) {
      const result = await res.json();

      if (result.type === "EMPLOYEE") {
        // Non-blocking toast for attendance scans
        showToast(
          result.message,
          result.action === "IN" ? "success" : "warning",
        );
        if (USER_PERMISSIONS.can_see_attendance) loadAttendance();
        loadDashboard();
      } else if (result.type === "PRODUCT") {
        const product = result.data;
        showToast(
          `${product.name} — UGX ${Number(product.price).toLocaleString()} (Stock: ${product.stock})`,
          "info",
        );
      }
    } else {
      // Only warn on long codes that are clearly deliberate scans
      if (code.length > 3) console.warn("[SCANNER] Unrecognized code:", code);
    }
  } catch (err) {
    console.error("[SCANNER] Global scan error:", err);
  }
}

async function loadCredits() {
  try {
    const res = await fetchAuth(`${API_URL}/credits`);
    if (res.ok) {
      const data = await res.json();
      const container = document.getElementById("credits-list-container");
      if (!container) return;
      container.innerHTML = "";

      const groups = {};
      data.credits.forEach((c) => {
        const name = c.buyer_name || "Unknown";
        if (!groups[name]) {
          groups[name] = {
            buyer_name: name,
            buyer_phone: c.buyer_phone || "",
            total_balance: 0,
            latest_date: new Date(0),
            transactions: [],
          };
        }
        groups[name].total_balance += Number(c.balance || 0);
        groups[name].transactions.push(c);

        // Track the latest transaction date for sorting and updating phone number
        const d = new Date(String(c.created_at).replace(" ", "T"));
        if (!isNaN(d) && d > groups[name].latest_date) {
          groups[name].latest_date = d;
          if (c.buyer_phone) groups[name].buyer_phone = c.buyer_phone;
        }
      });

      const sortedGroups = Object.values(groups).sort(
        (a, b) => b.latest_date - a.latest_date,
      );
      window.creditGroups = groups; // Store globally for printStatement

      if (sortedGroups.length === 0) {
        container.innerHTML =
          '<div style="text-align:center; padding:30px; color:#94A3B8;">No credit records found.</div>';
        return;
      }

      let grandTotal = 0;
      sortedGroups.forEach((g) => {
        if (g.total_balance > 0) grandTotal += g.total_balance;
      });

      const summaryDiv = document.createElement("div");
      summaryDiv.style.padding = "15px";
      summaryDiv.style.marginBottom = "15px";
      summaryDiv.style.borderRadius = "8px";
      summaryDiv.style.background = "rgba(239, 68, 68, 0.05)";
      summaryDiv.style.border = "1px solid rgba(239, 68, 68, 0.2)";
      summaryDiv.style.display = "flex";
      summaryDiv.style.justifyContent = "space-between";
      summaryDiv.style.alignItems = "center";
      summaryDiv.innerHTML = `
                <div style="font-weight:700; font-size:1.05rem; color:var(--text);">Grand Total Outstanding</div>
                <div style="font-weight:800; font-size:1.25rem; color:#EF4444;">UGX ${grandTotal.toLocaleString()}</div>
            `;
      container.appendChild(summaryDiv);

      sortedGroups.forEach((g) => {
        // If they have zero balance, maybe style it differently, but still allow statement printing
        const balanceColor = g.total_balance > 0 ? "var(--primary)" : "#10B981";
        const balanceText =
          g.total_balance > 0
            ? `UGX ${g.total_balance.toLocaleString()}`
            : "CLEARED";

        let historyHtml = `
                    <table style="width:100%; margin-top:10px; border-collapse:collapse; font-size:0.85rem;">
                        <thead style="background:var(--surface-hover);">
                            <tr>
                                <th style="padding:6px; text-align:left; border-bottom:1px solid var(--border);">Date & Time</th>
                                <th style="padding:6px; text-align:center; border-bottom:1px solid var(--border);">Type</th>
                                <th style="padding:6px; text-align:right; border-bottom:1px solid var(--border);">Total</th>
                                <th style="padding:6px; text-align:right; border-bottom:1px solid var(--border);">Paid</th>
                                <th style="padding:6px; text-align:right; border-bottom:1px solid var(--border);">Balance</th>
                            </tr>
                        </thead>
                        <tbody>
                `;
        g.transactions.forEach((t) => {
          const isPayment = t.pos_order_id === 0 || t.total_amount === 0;
          const rowBg = isPayment ? "rgba(16,185,129,0.06)" : "";
          const typeLabel = isPayment
            ? `<span style="font-size:0.72rem; background:#d1fae5; color:#065f46; padding:2px 7px; border-radius:20px; font-weight:700;">PAYMENT</span>`
            : `<span style="font-size:0.72rem; background:#dbeafe; color:#1e40af; padding:2px 7px; border-radius:20px; font-weight:700;">CREDIT</span>`;
          const balDisplay = isPayment
            ? `<span style="color:#10B981; font-weight:700;">-${Math.abs(Number(t.balance)).toLocaleString()}</span>`
            : `<span style="color:#EF4444;">${Number(t.balance).toLocaleString()}</span>`;
          historyHtml += `
                            <tr style="background:${rowBg}">
                                <td style="padding:6px; border-bottom:1px solid var(--border); white-space:nowrap; font-size:0.82rem;">${formatDisplayDate(t.created_at, true)}</td>
                                <td style="padding:6px; text-align:center; border-bottom:1px solid var(--border);">${typeLabel}</td>
                                <td style="padding:6px; text-align:right; border-bottom:1px solid var(--border);">${isPayment ? "-" : Number(t.total_amount).toLocaleString()}</td>
                                <td style="padding:6px; text-align:right; border-bottom:1px solid var(--border); color:#10B981;">${Number(t.amount_paid).toLocaleString()}</td>
                                <td style="padding:6px; text-align:right; border-bottom:1px solid var(--border);">${balDisplay}</td>
                            </tr>
                    `;
        });
        historyHtml += `</tbody></table>`;

        const item = document.createElement("div");
        item.className = "credit-accordion-item";
        item.innerHTML = `
                    <div class="credit-accordion-header" onclick="this.parentElement.classList.toggle('active')">
                        <div style="font-weight:700; font-size:1.05rem;">${g.buyer_name}</div>
                        <div style="color:${balanceColor}; font-weight:600;">${balanceText}</div>
                    </div>
                    <div class="credit-accordion-content">
                        <div class='credit-detail-row'><span><i class="fa-solid fa-mobile-screen"></i> Phone Number:</span> <strong>${g.buyer_phone || "N/A"}</strong></div>
                        <div class='credit-detail-row'><span><i class="fa-solid fa-rotate"></i> Total Transactions:</span> <strong>${g.transactions.length}</strong></div>
                        
                        <div style="margin-top: 15px;">
                            <strong style="font-size:0.9rem;">Transaction History</strong>
                            ${historyHtml}
                        </div>

                        <div style="margin-top: 20px; display:flex; gap:10px;">
                            <button class="primary-btn" onclick="openCreditPaymentModal('${g.buyer_name.replace(/'/g, "\\'")}',${g.total_balance})" style="flex:1; padding: 12px; font-size:0.95rem; background: linear-gradient(135deg,#10B981,#059669);">
                                <i class="fa-solid fa-credit-card"></i> Make a Payment
                            </button>
                            <button class="primary-btn" onclick="printStatement('${g.buyer_name.replace(/'/g, "\\'")}')"
                                style="flex:1; padding: 12px; font-size:0.95rem;">
                                <i class="fa-solid fa-inbox"></i> Statement
                            </button>
                        </div>
                    </div>
                `;
        container.appendChild(item);
      });
    } else {
      const errContainer = document.getElementById("credits-list-container");
      if (errContainer)
        errContainer.innerHTML =
          '<div style="text-align:center; padding:30px; color:#EF4444;">Failed to load. Please make sure the server has been restarted.</div>';
    }
  } catch (err) {
    console.error("Failed to load credits:", err);
    const errContainer = document.getElementById("credits-list-container");
    if (errContainer)
      errContainer.innerHTML =
        '<div style="text-align:center; padding:30px; color:#EF4444;">Connection error. Is the server running?</div>';
  }
}

function openCreditPaymentModal(buyerName, totalBalance) {
  document.getElementById("credit-payment-buyer").value = buyerName;
  document.getElementById("credit-payment-amount").value = "";
  document.getElementById("credit-payment-note").value = "";
  document.getElementById("credit-payment-subtitle").textContent =
    `Recording payment for ${buyerName} — Outstanding Balance: UGX ${Number(totalBalance).toLocaleString()}`;
  document.getElementById("credit-payment-modal").classList.remove("hidden");
  setTimeout(
    () => document.getElementById("credit-payment-amount").focus(),
    100,
  );
}

async function submitCreditPayment(e) {
  e.preventDefault();
  const buyerName = document.getElementById("credit-payment-buyer").value;
  const amount = Number(document.getElementById("credit-payment-amount").value);
  const note = document.getElementById("credit-payment-note").value.trim();

  if (!amount || amount <= 0)
    return showToast("Please enter a valid amount.", "warning");

  const btn = e.target.querySelector('[type="submit"]');
  btn.disabled = true;
  btn.textContent = "Recording...";

  try {
    const res = await fetchAuth(`${API_URL}/credits/pay`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        buyer_name: buyerName,
        amount_paid: amount,
        note,
      }),
    });
    const data = await res.json();
    if (res.ok) {
      document.getElementById("credit-payment-modal").classList.add("hidden");
      showToast(`${data.message}`, "success");
      loadCredits(); // Refresh the list
    } else {
      showToast(`${data.error}`, "danger");
    }
  } catch (err) {
    console.error(err);
    showToast("Network error. Is the server running?", "danger");
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fa-solid fa-check"></i> Confirm Payment';
  }
}

async function checkAutoStart() {
  try {
    const res = await fetchAuth(`${API_URL}/system/autostart`);
    if (res.ok) {
      const data = await res.json();
      const checkbox = document.getElementById("toggle-autostart");
      if (checkbox) checkbox.checked = data.enabled;
    }
  } catch (e) {
    console.error("Error checking autostart status:", e);
  }
}

async function toggleAutoStart(enable) {
  try {
    const res = await fetchAuth(`${API_URL}/system/autostart`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enable }),
    });
    if (res.ok) {
      const data = await res.json();
      showToast(`${data.message}`, "success");
    } else {
      const err = await res.json();
      showToast(`Error toggling auto-start: ${err.error}`, "error");
      const checkbox = document.getElementById("toggle-autostart");
      if (checkbox) checkbox.checked = !enable;
    }
  } catch (e) {
    console.error("Error setting autostart:", e);
    showToast("Network error while configuring auto-start.", "error");
    const checkbox = document.getElementById("toggle-autostart");
    if (checkbox) checkbox.checked = !enable;
  }
}

async function createDesktopShortcut() {
  try {
    const res = await fetchAuth(`${API_URL}/system/create-shortcut`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    if (res.ok) {
      const data = await res.json();
      showToast(`${data.message}`, "success");
    } else {
      const err = await res.json();
      showToast(`Error creating shortcut: ${err.error}`, "error");
    }
  } catch (e) {
    console.error("Error creating shortcut:", e);
    showToast("Network error while creating shortcut.", "error");
  }
}
window.createDesktopShortcut = createDesktopShortcut;

async function setStaticIP() {
  try {
    const res = await fetchAuth(`${API_URL}/system/set-static-ip`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    if (res.ok) {
      const data = await res.json();
      showToast(`${data.message}`, "success");
    } else {
      const err = await res.json();
      showToast(`Error: ${err.error}`, "error");
    }
  } catch (e) {
    console.error("Error launching static IP script:", e);
    showToast("Network error while launching static IP setup.", "error");
  }
}
window.setStaticIP = setStaticIP;

function printStatement(buyerName) {
  if (!window.creditGroups || !window.creditGroups[buyerName]) {
    alert("Could not find data for this buyer.");
    return;
  }

  const group = window.creditGroups[buyerName];
  const printArea = document.getElementById("statement-print-area");
  if (!printArea) return;

  const bizName = localStorage.getItem("jomish_biz_name") || "JOMISH SUITE";
  const bizContact = localStorage.getItem("jomish_biz_contact") || "";
  const bizLocation =
    localStorage.getItem("jomish_biz_location") || "Kampala, Uganda";
  const bizLogo = localStorage.getItem("jomish_biz_logo") || "";

  let logoHtml = "";
  if (bizLogo) {
    logoHtml = `<div style="text-align:center; margin-bottom: 20px;">
                        <img src="${bizLogo}" style="max-height:80px; max-width:200px;">
                    </div>`;
  }

  let rowsHtml = "";
  group.transactions.forEach((t) => {
    rowsHtml += `
            <tr>
                <td style="padding:10px; border:1px solid #ccc;">${formatDisplayDate(t.created_at, false)}</td>
                <td style="padding:10px; border:1px solid #ccc; text-align:right;">${Number(t.total_amount).toLocaleString()}</td>
                <td style="padding:10px; border:1px solid #ccc; text-align:right;">${Number(t.amount_paid).toLocaleString()}</td>
                <td style="padding:10px; border:1px solid #ccc; text-align:right;">${Number(t.balance).toLocaleString()}</td>
                <td style="padding:10px; border:1px solid #ccc; text-align:right;">${t.promised_date ? formatDisplayDate(t.promised_date, false) : "-"}</td>
            </tr>
        `;
  });

  printArea.innerHTML = `
        ${logoHtml}
        <div style="text-align:center; margin-bottom: 30px;">
            <h1 style="margin:0; font-size:24pt;">${bizName}</h1>
            <p style="margin:5px 0 0 0; font-size:12pt; color:#555;">${bizLocation} ${bizContact ? "| " + bizContact : ""}</p>
            <h2 style="margin:20px 0 0 0; font-size:18pt; text-decoration:underline;">ACCOUNT STATEMENT</h2>
        </div>

        <div style="margin-bottom: 30px; font-size:12pt; display:flex; justify-content:space-between;">
            <div>
                <strong>Customer Name:</strong> ${group.buyer_name}<br>
                <strong>Phone Number:</strong> ${group.buyer_phone || "N/A"}
            </div>
            <div style="text-align:right;">
                <strong>Date Generated:</strong> ${formatDisplayDate(new Date(), false)}<br>
                <strong>Total Balance Owed:</strong> UGX ${group.total_balance.toLocaleString()}
            </div>
        </div>

        <table style="width:100%; border-collapse:collapse; font-size:11pt; margin-bottom:30px;">
            <thead>
                <tr style="background-color:#f8fafc;">
                    <th style="padding:10px; border:1px solid #ccc; text-align:left;">Transaction Date</th>
                    <th style="padding:10px; border:1px solid #ccc; text-align:right;">Order Total (UGX)</th>
                    <th style="padding:10px; border:1px solid #ccc; text-align:right;">Amount Paid (UGX)</th>
                    <th style="padding:10px; border:1px solid #ccc; text-align:right;">Balance (UGX)</th>
                    <th style="padding:10px; border:1px solid #ccc; text-align:right;">Promised Date</th>
                </tr>
            </thead>
            <tbody>
                            ${rowsHtml}
            </tbody>
        </table>

        <div style="margin-top:40px; text-align:center; font-size:10pt; color:#666;">
            <p>Thank you for doing business with us.</p>
            <p style="margin-top:40px; border-top:1px dashed #ccc; padding-top:10px; display:inline-block; width:200px;">Authorized Signature</p>
        </div>
    `;

  clearAllPrintModes();
  document.body.classList.add("print-mode-statement");

  const style = document.createElement("style");
  style.id = "dynamic-print-page-style";
  style.innerHTML = `@page { size: A4 portrait; margin: 15mm; }`;
  document.head.appendChild(style);

  setTimeout(() => {
    window.print();
    document.body.classList.remove("print-mode-statement");
    const s = document.getElementById("dynamic-print-page-style");
    if (s) s.remove();
  }, 500);
}

// â”€â”€ Mobile Hamburger Drawer â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function toggleMobileNav() {
  const sidebar = document.getElementById("main-sidebar");
  const overlay = document.getElementById("sidebar-overlay");
  const btn = document.getElementById("hamburger-btn");
  if (!sidebar) return;
  const isOpen = sidebar.classList.toggle("mobile-open");
  btn.classList.toggle("open", isOpen);
  if (isOpen) {
    overlay.classList.add("active");
    document.body.style.overflow = "hidden"; // prevent background scroll
  } else {
    overlay.classList.remove("active");
    document.body.style.overflow = "";
  }
}

function closeMobileNav() {
  const sidebar = document.getElementById("main-sidebar");
  const overlay = document.getElementById("sidebar-overlay");
  const btn = document.getElementById("hamburger-btn");
  if (!sidebar) return;
  sidebar.classList.remove("mobile-open");
  overlay.classList.remove("active");
  if (btn) btn.classList.remove("open");
  document.body.style.overflow = "";
}

// Auto-close drawer when a nav button is tapped on mobile
document.addEventListener("DOMContentLoaded", () => {
  document.querySelectorAll(".nav-btn[data-target]").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (window.innerWidth <= 768) {
        closeMobileNav();
      }
    });
  });
});

window.toggleMobileNav = toggleMobileNav;
window.closeMobileNav = closeMobileNav;

// ================================================================
// SMART SHIFT TIMETABLE MODULE
// ================================================================

(function () {
  // â”€â”€ State â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  let ttWeekStart = getMondayOfWeek(new Date()); // Monday of current week
  let ttEmployees = []; // full employee list for the override modal
  let ttModal = { date: null, slot: null, startTime: null, endTime: null }; // current modal context

  // â”€â”€ Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  function getMondayOfWeek(d) {
    const copy = new Date(d);
    const day = copy.getDay(); // 0=Sun â€¦ 6=Sat
    const diff = day === 0 ? -6 : 1 - day; // shift to Monday
    copy.setDate(copy.getDate() + diff);
    copy.setHours(0, 0, 0, 0);
    return copy;
  }

  function dateStr(d) {
    return d.toISOString().split("T")[0];
  }

  function addDays(d, n) {
    const c = new Date(d);
    c.setDate(c.getDate() + n);
    return c;
  }

  function fmtShortDate(d) {
    return d.toLocaleDateString("en-UG", {
      weekday: "short",
      month: "short",
      day: "numeric",
    });
  }

  function isToday(d) {
    return dateStr(d) === dateStr(new Date());
  }

  // Helper: render slot icon + label
  window.slotHtml = function slotHtml(meta) {
    return `<i class="${meta.icon}" style="color:${meta.color}; margin-right:5px;"></i>${meta.label}`;
  };

  const CAN_OVERRIDE = () => ["CEO", "HR", "Supervisor"].includes(USER_ROLE);
  const CAN_AUTOGEN = () => ["CEO", "HR"].includes(USER_ROLE);

  // â”€â”€ Week Navigation â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  window.shiftTimetableWeek = function (dir) {
    ttWeekStart = addDays(ttWeekStart, dir * 7);
    loadShiftTimetable();
  };

  window.goToCurrentShiftWeek = function () {
    ttWeekStart = getMondayOfWeek(new Date());
    loadShiftTimetable();
  };

  // â”€â”€ Init (called when Shift Timetable tab activates) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  window.loadShiftTimetable = async function () {
    injectTimetableButtons();
    await loadAllEmployees();
    await renderTimetable();
  };

  function injectTimetableButtons() {
    const actions = document.getElementById("timetable-actions");
    if (!actions) return;

    // Remove previously injected buttons (avoid duplicates on tab re-enter)
    ["tt-btn-autogen", "tt-btn-clear"].forEach((id) => {
      const old = document.getElementById(id);
      if (old) old.remove();
    });

    if (CAN_AUTOGEN()) {
      const autoBtn = document.createElement("button");
      autoBtn.id = "tt-btn-autogen";
      autoBtn.className = "primary-btn";
      autoBtn.innerHTML =
        '<i class="fa-solid fa-wand-magic-sparkles"></i> Auto-Schedule Week';
      autoBtn.onclick = smartAutoSchedule;
      actions.prepend(autoBtn);

      const clearBtn = document.createElement("button");
      clearBtn.id = "tt-btn-clear";
      clearBtn.className = "secondary-btn";
      clearBtn.style.color = "var(--danger)";
      clearBtn.innerHTML = '<i class="fa-solid fa-trash"></i> Clear Week';
      clearBtn.onclick = clearShiftWeek;
      actions.prepend(clearBtn);
    }
  }

  async function loadAllEmployees() {
    try {
      const res = await fetchAuth(`${API_URL}/employees`);
      const data = await res.json();
      ttEmployees = (data.employees || []).filter((e) => e.is_active);
    } catch (e) {
      console.error("[Timetable] loadAllEmployees error:", e);
    }
  }

  // â”€â”€ Render the full weekly grid â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  async function renderTimetable() {
    const weekEnd = addDays(ttWeekStart, 6);
    const from = dateStr(ttWeekStart);
    const to = dateStr(weekEnd);

    // Update week label
    const lbl = document.getElementById("tt-week-label");
    if (lbl) {
      lbl.textContent = `${from}  →  ${to}`;
    }

    // Fetch assignments for the week
    let assignments = [];
    try {
      const res = await fetchAuth(
        `${API_URL}/shift-assignments?from=${from}&to=${to}`,
      );
      const data = await res.json();
      assignments = data.assignments || [];
    } catch (e) {
      console.error("[Timetable] fetch error:", e);
    }

    // Build day columns (Mon–Sun)
    const days = Array.from({ length: 7 }, (_, i) => addDays(ttWeekStart, i));

    // Build header
    const headerRow = document.getElementById("tt-header-row");
    if (headerRow) {
      headerRow.innerHTML = `<th style="padding:12px 16px; text-align:left; font-size:0.72rem; color:#94A3B8; text-transform:uppercase; border-bottom:2px solid var(--border); min-width:110px;">Slot</th>`;
      days.forEach((d) => {
        const todayStyle = isToday(d)
          ? "background:rgba(99,102,241,0.08); color:var(--primary);"
          : "";
        headerRow.innerHTML += `
                    <th style="padding:10px 8px; text-align:center; font-size:0.78rem; border-bottom:2px solid var(--border); min-width:120px; ${todayStyle}">
                        ${fmtShortDate(d)}
                    </th>`;
      });
    }

    // Index assignments: slot → date → [items]
    const idx = {};
    assignments.forEach((a) => {
      const key = `${a.slot}|${a.shift_date}`;
      if (!idx[key]) idx[key] = [];
      idx[key].push(a);
    });

    // Render slot rows
    const tbody = document.getElementById("tt-body");
    if (!tbody) return;
    tbody.innerHTML = "";

    let totalSlots = 0,
      filledSlots = 0;

    GLOBAL_SHIFTS.forEach((shift) => {
      const slot = shift.id;
      const meta = shift;
      const row = document.createElement("tr");

      // Slot label cell — shows time derived from configuration
      const timeRange = `${shift.start_time} - ${shift.end_time}`;

      row.innerHTML = `
                <td style="padding:12px 14px; border-bottom:1px solid var(--border); border-right:2px solid var(--border); background:var(--surface); vertical-align:top;">
                    <div style="font-weight:700; font-size:0.88rem; display:flex; align-items:center;">${slotHtml(meta)}</div>
                    <div style="font-size:0.72rem; color:#94A3B8; margin-top:2px;">${timeRange}</div>
                </td>`;

      days.forEach((d) => {
        const ds = dateStr(d);
        const key = `${slot}|${ds}`;
        const list = idx[key] || [];
        const todayStyle = isToday(d)
          ? "background:rgba(99,102,241,0.04);"
          : "";

        totalSlots++;
        if (list.length > 0) filledSlots++;

        const chips = list
          .map((a) => {
            const roleColor = stringToColor(a.role);
            return `
                        <div style="display:flex; align-items:center; gap:6px; background:${roleColor}22; border:1px solid ${roleColor}44; border-radius:20px; padding:4px 10px; font-size:0.75rem; margin-bottom:4px; cursor:default;" title="${a.role}">
                            <span style="width:7px; height:7px; border-radius:50%; background:${roleColor}; flex-shrink:0;"></span>
                            <span style="font-weight:600; color:var(--text);">${a.first_name} ${a.last_name}</span>
                            ${CAN_OVERRIDE() ? `<span onclick="removeShiftAssignment(${a.id})" style="cursor:pointer; color:#94A3B8; margin-left:4px; font-size:0.9rem;" title="Remove">&times;</span>` : ""}
                        </div>`;
          })
          .join("");

        const addBtn = CAN_OVERRIDE()
          ? `<button onclick="openShiftModal('${ds}','${slot}','${shift.start_time}','${shift.end_time}')"
                         style="font-size:0.7rem; color:var(--primary); background:none; border:1px dashed var(--primary); border-radius:16px; padding:3px 10px; cursor:pointer; margin-top:4px; opacity:0.7; transition:opacity .15s;"
                         onmouseover="this.style.opacity=1" onmouseout="this.style.opacity=0.7">+ Add</button>`
          : "";

        row.innerHTML += `
                    <td style="padding:10px 8px; border-bottom:1px solid var(--border); border-right:1px solid var(--border); vertical-align:top; ${todayStyle}">
                        ${chips}
                        ${addBtn}
                    </td>`;
      });

      tbody.appendChild(row);
    });

    // Update stats
    const uniqueDeployed = new Set(assignments.map((a) => a.employee_id)).size;
    const el = (id) => document.getElementById(id);
    if (el("count-active-shifts"))
      el("count-active-shifts").textContent = `${assignments.length} Shifts`;
    if (el("count-deployed")) el("count-deployed").textContent = uniqueDeployed;
    if (el("count-gaps"))
      el("count-gaps").textContent = totalSlots - filledSlots;
    if (el("count-coverage")) {
      const pct =
        totalSlots > 0 ? Math.round((filledSlots / totalSlots) * 100) : 0;
      el("count-coverage").textContent = `${pct}%`;
      el("count-coverage").style.color =
        pct >= 80 ? "#10B981" : pct >= 50 ? "#F59E0B" : "#EF4444";
    }

    renderFairnessBars(assignments);
  }

  // â”€â”€ Fairness Bars â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  function renderFairnessBars(assignments) {
    const container = document.getElementById("tt-fairness-bars");
    if (!container) return;

    const countMap = {};
    assignments.forEach((a) => {
      const key = `${a.employee_id}|${a.first_name} ${a.last_name}|${a.role}`;
      countMap[key] = (countMap[key] || 0) + 1;
    });

    if (Object.keys(countMap).length === 0) {
      container.innerHTML =
        '<p style="color:var(--text-muted); font-size:0.85rem;">No assignments this week yet.</p>';
      return;
    }

    const maxCount = Math.max(...Object.values(countMap));
    const sorted = Object.entries(countMap).sort((a, b) => b[1] - a[1]);

    container.innerHTML = sorted
      .map(([key, count]) => {
        const [, name, role] = key.split("|");
        const pct = Math.round((count / maxCount) * 100);
        const rc = stringToColor(role);
        const bars =
          "█".repeat(count) + "░".repeat(Math.max(0, maxCount - count));
        return `
                <div style="display:flex; align-items:center; gap:12px;">
                    <div style="width:160px; font-size:0.8rem; font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${name} (${role})">${name}</div>
                    <div style="flex:1; background:var(--background); border-radius:8px; overflow:hidden; height:10px;">
                        <div style="width:${pct}%; background:${rc}; height:100%; border-radius:8px; transition:width .4s;"></div>
                    </div>
                    <div style="font-size:0.78rem; color:#94A3B8; min-width:60px; text-align:right;">${count} shift${count !== 1 ? "s" : ""}</div>
                    <div style="font-size:0.7rem; color:${rc}; min-width:52px;">${role}</div>
                </div>`;
      })
      .join("");
  }

  // â”€â”€ Color from string (deterministic) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  function stringToColor(str) {
    const palette = [
      "#6366F1",
      "#10B981",
      "#F59E0B",
      "#EC4899",
      "#0EA5E9",
      "#8B5CF6",
      "#EF4444",
      "#14B8A6",
    ];
    let hash = 0;
    for (let i = 0; i < (str || "").length; i++)
      hash = str.charCodeAt(i) + ((hash << 5) - hash);
    return palette[Math.abs(hash) % palette.length];
  }

  // â”€â”€ Override Modal â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  window.openShiftModal = async function (date, slot, startTime, endTime) {
    ttModal = { date, slot, startTime, endTime };

    const infoEl = document.getElementById("shift-modal-info");
    if (infoEl) {
      const meta = GLOBAL_SHIFTS.find((s) => s.id === slot) || {
        label: slot,
        icon: "fa-solid fa-clock",
        color: "#94A3B8",
      };
      infoEl.innerHTML = `
                <strong>${slotHtml(meta)}</strong> &nbsp;on&nbsp; <strong>${date}</strong><br>
                <span style="font-size:0.8rem; color:#94A3B8;">${startTime} – ${endTime}</span>`;
    }

    // Always re-fetch employees so the list is guaranteed fresh
    const sel = document.getElementById("shift-modal-employee");
    if (sel) {
      // Pre-populate from cache immediately to avoid blank dropdown
      if (window.EMPLOYEES_CACHE && window.EMPLOYEES_CACHE.length > 0) {
        sel.innerHTML = '<option value="">-- Select Employee --</option>';
        window.EMPLOYEES_CACHE.forEach((e) => {
          const opt = document.createElement("option");
          opt.value = e.id;
          const optName =
            `${e.first_name || ""} ${e.last_name || ""}`.trim() ||
            e.username ||
            e.email ||
            `Staff ${e.id}`;
          opt.textContent = `${optName} (${e.role || "Employee"})`;
          sel.appendChild(opt);
        });
      } else {
        sel.innerHTML =
          '<option value="" disabled selected>Loading employees...</option>';
      }
    }
    try {
      const empRes = await fetchAuth(`${API_URL}/employees`);
      const empData = await empRes.json();
      ttEmployees = empData.employees || [];
      // Update global cache if fresh data arrived
      if (ttEmployees.length > 0) window.EMPLOYEES_CACHE = ttEmployees;
    } catch (e) {
      console.error("[ShiftModal] employee fetch error:", e);
      ttEmployees = [];
    }

    // Fall back to cached employee list if fetch returned nothing
    if (
      ttEmployees.length === 0 &&
      window.EMPLOYEES_CACHE &&
      window.EMPLOYEES_CACHE.length > 0
    ) {
      ttEmployees = window.EMPLOYEES_CACHE;
    }

    // Populate dropdown
    if (sel) {
      sel.innerHTML = '<option value="">-- Select Employee --</option>';
      if (ttEmployees.length === 0) {
        sel.innerHTML +=
          "<option disabled>No active employees found — ensure employees are added in HR tab</option>";
      } else {
        ttEmployees.forEach((e) => {
          const opt = document.createElement("option");
          opt.value = e.id;
          const optName =
            `${e.first_name || ""} ${e.last_name || ""}`.trim() ||
            e.username ||
            e.email ||
            `Staff ${e.id}`;
          opt.textContent = `${optName} (${e.role || "Employee"})`;
          sel.appendChild(opt);
        });
      }
    }

    // Show existing assignees for this cell
    fetchCurrentAssignees(date, slot);

    document.getElementById("shift-override-modal").classList.remove("hidden");
  };

  async function fetchCurrentAssignees(date, slot) {
    const chipsDiv = document.getElementById("shift-modal-chips");
    const listDiv = document.getElementById("shift-modal-existing-list");
    if (!chipsDiv || !listDiv) return;

    try {
      const res = await fetchAuth(
        `${API_URL}/shift-assignments?from=${date}&to=${date}`,
      );
      const data = await res.json();
      const mine = (data.assignments || []).filter((a) => a.slot === slot);

      if (mine.length > 0) {
        listDiv.style.display = "block";
        chipsDiv.innerHTML = mine
          .map(
            (a) => `
                    <div style="display:flex; align-items:center; gap:6px; background:rgba(239,68,68,0.1); border:1px solid rgba(239,68,68,0.3); border-radius:20px; padding:5px 12px; font-size:0.78rem; cursor:pointer;"
                         onclick="removeShiftAssignment(${a.id})">
                        ${a.first_name} ${a.last_name}
                        <span style="color:#EF4444; font-weight:bold;">âœ•</span>
                    </div>`,
          )
          .join("");
      } else {
        listDiv.style.display = "none";
      }
    } catch (e) {
      console.error(e);
    }
  }

  window.closeShiftModal = function () {
    document.getElementById("shift-override-modal").classList.add("hidden");
  };

  window.saveShiftOverride = async function () {
    const empId = document.getElementById("shift-modal-employee").value;
    if (!empId) {
      showToast("Please select an employee.", "warning");
      return;
    }

    try {
      const res = await fetchAuth(`${API_URL}/shift-assignments`, {
        method: "POST",
        body: JSON.stringify({
          employee_id: empId,
          shift_date: ttModal.date,
          slot: ttModal.slot,
          start_time: ttModal.startTime,
          end_time: ttModal.endTime,
        }),
      });
      if (res.ok) {
        showToast("Shift assigned successfully.", "success");
        closeShiftModal();
        renderTimetable();
      } else {
        const d = await res.json();
        showToast(d.error || "Failed to assign shift.", "danger");
      }
    } catch (e) {
      showToast("Network error.", "danger");
    }
  };

  window.removeShiftAssignment = async function (id) {
    if (!confirm("Remove this shift assignment?")) return;
    try {
      const res = await fetchAuth(`${API_URL}/shift-assignments/${id}`, {
        method: "DELETE",
      });
      if (res.ok) {
        showToast("Assignment removed.", "success");
        closeShiftModal();
        renderTimetable();
      } else {
        const d = await res.json();
        showToast(d.error || "Failed to remove.", "danger");
      }
    } catch (e) {
      showToast("Network error.", "danger");
    }
  };

  // â”€â”€ Smart Auto-Schedule â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  window.smartAutoSchedule = async function () {
    const from = dateStr(ttWeekStart);
    if (
      !confirm(
        `Auto-schedule the week of ${from}?\nThis will replace any existing assignments for this week.`,
      )
    )
      return;

    const btn = document.getElementById("tt-btn-autogen");
    if (btn) {
      btn.disabled = true;
      btn.innerHTML =
        '<i class="fa-solid fa-spinner fa-spin"></i> Generating...';
    }

    try {
      const res = await fetchAuth(`${API_URL}/scheduler/smart-generate`, {
        method: "POST",
        body: JSON.stringify({ week_start: from, clear_existing: true }),
      });
      const data = await res.json();
      if (res.ok) {
        let msg = data.message || "Done.";
        if (data.gaps && data.gaps.length > 0) {
          msg += `\n\nWARNING: ${data.gaps.length} staffing gap(s) detected (not enough employees for some roles/slots).`;
        }
        showToast(data.message, "success");
        if (data.gaps?.length) alert(msg);
        renderTimetable();
      } else {
        showToast(data.error || "Auto-schedule failed.", "danger");
      }
    } catch (e) {
      showToast("Network error during auto-schedule.", "danger");
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML =
          '<i class="fa-solid fa-wand-magic-sparkles"></i> Auto-Schedule Week';
      }
    }
  };

  // â”€â”€ Clear Week â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  window.clearShiftWeek = async function () {
    const from = dateStr(ttWeekStart);
    if (!confirm(`Clear ALL shift assignments for the week of ${from}?`))
      return;
    try {
      const res = await fetchAuth(`${API_URL}/shift-assignments/week/${from}`, {
        method: "DELETE",
      });
      const d = await res.json();
      showToast(d.message || "Week cleared.", "success");
      renderTimetable();
    } catch (e) {
      showToast("Network error.", "danger");
    }
  };

  // â”€â”€ Live Sync — refresh timetable when DB updates arrive â”€â”€â”€â”€â”€â”€â”€
  function initShiftSync() {
    if (window._socket) {
      window._socket.on("db_updated", (data) => {
        if (data.module === "shift_assignments") {
          const timetableSection = document.getElementById("schedules");
          if (
            timetableSection &&
            timetableSection.classList.contains("active")
          ) {
            renderTimetable();
          }
        }
      });
    }
  }

  // â”€â”€ Hook into nav: load timetable when tab is clicked â”€â”€â”€â”€â”€â”€â”€â”€â”€
  document.addEventListener("DOMContentLoaded", () => {
    // Timetable now loads via switchSupervisionView('schedules')
    // Init live-sync after socket connects
    setTimeout(initShiftSync, 2000);
  });

  // Expose for dashboard timetable (loads today's from shift_assignments)
  window.loadDayTimetable = async function () {
    const today = dateStr(new Date());
    const tbody = document.querySelector("#dash-timetable tbody");
    if (!tbody) return;

    try {
      const res = await fetchAuth(
        `${API_URL}/shift-assignments?from=${today}&to=${today}`,
      );
      const data = await res.json();
      const rows = data.assignments || [];

      tbody.innerHTML = "";
      if (rows.length === 0) {
        tbody.innerHTML =
          '<tr><td colspan="3" style="text-align:center;padding:20px;color:#94A3B8;">No shifts scheduled today.</td></tr>';
        return;
      }
      rows.forEach((r) => {
        const meta = GLOBAL_SHIFTS.find((s) => s.id === r.slot) || {
          label: r.slot,
          icon: "fa-solid fa-clock",
          color: "#94A3B8",
        };
        const now = new Date();
        const [sh, sm] = r.start_time.split(":").map(Number);
        const [eh, em] = r.end_time.split(":").map(Number);
        const startM = sh * 60 + sm,
          endM = eh * 60 + em,
          nowM = now.getHours() * 60 + now.getMinutes();
        const isActive = nowM >= startM && nowM < endM;
        const badge = isActive
          ? '<span style="background:#10B981;color:#fff;font-size:0.65rem;padding:2px 7px;border-radius:12px;margin-left:6px;">ON DUTY</span>'
          : "";
        const tr = document.createElement("tr");
        tr.innerHTML = `
                    <td>${r.first_name} ${r.last_name}${badge}</td>
                    <td><span style="font-size:0.8rem;color:#94A3B8;">${r.role}</span></td>
                    <td style="font-size:0.82rem;">${slotHtml(meta)}<br><span style="color:#94A3B8;">${r.start_time}–${r.end_time}</span></td>`;
        tbody.appendChild(tr);
      });
    } catch (e) {
      console.error("[DayTimetable]", e);
    }
  };
})();

// ==== COD Floating Bubble & Modal Logic ====
window.openCodModal = function () {
  document.getElementById("cod-modal").classList.remove("hidden");
  loadPendingCOD();
};

window.closeCodModal = function () {
  document.getElementById("cod-modal").classList.add("hidden");
};

window.loadPendingCOD = async function () {
  try {
    const res = await fetchAuth(`${API_URL}/deliveries/pending-cod`);
    if (res.ok) {
      const deliveries = await res.json();
      const bubble = document.getElementById("cod-floating-bubble");
      const badge = document.getElementById("cod-badge-count");
      const listContainer = document.getElementById("cod-list-container");

      if (!bubble) return; // Not on POS view or not added yet

      if (deliveries.length > 0) {
        bubble.style.display = "flex";
        badge.textContent = deliveries.length;
      } else {
        bubble.style.display = "none";
      }

      if (listContainer) {
        if (deliveries.length === 0) {
          listContainer.innerHTML =
            '<p style="text-align:center;color:var(--text-muted);padding:20px;">No pending Cash on Delivery orders.</p>';
          return;
        }

        let html = "";
        deliveries.forEach((d) => {
          html += `
                        <div style="background:var(--surface); border:1px solid var(--border); border-radius:8px; padding:15px; margin-bottom:10px; display:flex; justify-content:space-between; align-items:center;">
                            <div>
                                <h4 style="margin:0 0 5px 0; color:var(--text);">Order #${d.order_id} - ${d.client_name}</h4>
                                <p style="margin:0; font-size:0.85rem; color:var(--text-muted);"><i class="fa-solid fa-location-dot"></i> ${d.client_location || "No address"}</p>
                                <p style="margin:4px 0 0 0; font-weight:bold; color:var(--primary);">Total: UGX ${Number(d.total_amount).toLocaleString()}</p>
                            </div>
                            <button onclick="markCODReceived(${d.pos_order_id})" style="background:var(--success); color:white; border:none; padding:10px 15px; border-radius:6px; cursor:pointer; font-weight:600;"><i class="fa-solid fa-check"></i> Cash Received</button>
                        </div>
                    `;
        });
        listContainer.innerHTML = html;
      }
    }
  } catch (e) {
    console.error("Failed to load pending COD:", e);
  }
};

window.markCODReceived = async function (posOrderId) {
  if (!confirm("Are you sure you have received the cash for this order?"))
    return;

  try {
    const res = await fetchAuth(
      `${API_URL}/pos_orders/${posOrderId}/cod-received`,
      { method: "POST" },
    );
    const data = await res.json();

    if (res.ok) {
      showToast("COD Marked as Received", "success");
      loadPendingCOD();

      // Generate a receipt for the received COD
      if (data.transaction_id && data.total_amount) {
        const deliveryItem = [
          {
            name: `COD Order Delivery`,
            qty: 1,
            price: data.total_amount,
          },
        ];
        const deliveryInfo = `Location: ${data.client_location || "N/A"}`;

        printReceipt(
          deliveryItem,
          data.total_amount,
          data.transaction_id,
          "COD (Received)",
          data.total_amount,
          data.client_name,
          deliveryInfo,
        );
      }
    } else {
      alert("Error: " + data.error);
    }
  } catch (e) {
    console.error("Failed to mark COD received:", e);
  }
};

// Hook into existing events
document.addEventListener("DOMContentLoaded", () => {
  // Initial load
  if (
    window.location.pathname.includes("index") ||
    window.location.pathname === "/"
  ) {
    setTimeout(() => loadPendingCOD(), 1000);
  }
});

// =============================================
// TECH SUPPORT ACCOUNTS MANAGEMENT (Tech Hub)
// =============================================
async function loadTechUsers() {
  try {
    const res = await fetchAuth(`${API_URL}/system/tech_users`);
    if (!res.ok) throw new Error("Failed to load tech users");
    const data = await res.json();

    const tbody = document.getElementById("tech-users-table-body");
    if (!tbody) return;
    tbody.innerHTML = "";

    if (!data.tech_users || data.tech_users.length === 0) {
      tbody.innerHTML =
        '<tr><td colspan="3" style="text-align:center; padding:20px; color:var(--text-muted);">No tech accounts found.</td></tr>';
      return;
    }

    data.tech_users.forEach((u) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
                <td style="font-weight:bold;">${u.username}</td>
                <td>${formatDisplayDate(u.created_at)}</td>
                <td>
                    ${u.username !== window.USER_NAME && u.username !== "tech" ? `<button class="sm-btn danger" onclick="deleteTechUser(${u.id}, '${u.username}')">Delete</button>` : `<span style="font-size:0.8rem; color:var(--text-muted);">(protected)</span>`}
                </td>
            `;
      tbody.appendChild(tr);
    });
  } catch (e) {
    console.error("Error loading tech users:", e);
  }
}

async function createTechUser() {
  const userInp = document.getElementById("new-tech-username");
  const passInp = document.getElementById("new-tech-password");
  const username = userInp.value.trim();
  const password = passInp.value;

  if (!username || !password) {
    return showToast("Username and password are required", "error");
  }

  try {
    const res = await fetchAuth(`${API_URL}/system/tech_users`, {
      method: "POST",
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed to create tech user");

    showToast("Tech account created successfully", "success");
    userInp.value = "";
    passInp.value = "";
    loadTechUsers();
  } catch (e) {
    showToast(e.message, "error");
  }
}

async function deleteTechUser(id, username) {
  if (!confirm(`Are you sure you want to delete tech account '${username}'?`))
    return;
  try {
    const res = await fetchAuth(`${API_URL}/system/tech_users/${id}`, {
      method: "DELETE",
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed to delete tech user");

    showToast("Tech account deleted", "success");
    loadTechUsers();
  } catch (e) {
    showToast(e.message, "error");
  }
}

// =============================================
// MULTI-TENANT COMPANIES MANAGEMENT (Tech Hub)
// =============================================

async function loadCompanies() {
  try {
    const res = await fetch(`${API_URL}/system/companies`, {
      headers: {
        Authorization: `Bearer ${localStorage.getItem("jomish_token")}`,
      },
    });
    const data = await res.json();
    const tbody = document.getElementById("companies-table-body");
    if (!tbody) return;

    if (!data.companies || data.companies.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; color:var(--text-muted); padding:24px;">No companies registered yet. Click "Register Company" to get started.</td></tr>`;
      return;
    }

    tbody.innerHTML = data.companies
      .map((c) => {
        const prefix = c.prefix || "—";
        const schema = `t_${prefix.toLowerCase()}`;
        const loginFormat = `${prefix}00001`;
        const date = c.created_at
          ? new Date(c.created_at).toLocaleDateString()
          : "—";
        const status = c.status || "ACTIVE";
        const statusColor = status === "ACTIVE" ? "#22c55e" : "#ef4444";

        return `<tr>
                <td><span style="background:rgba(79,70,229,0.12); color:#4F46E5; padding:3px 10px; border-radius:6px; font-weight:800; letter-spacing:1px; font-family:'Courier New',monospace;">${prefix}</span></td>
                <td><strong>${c.name || "—"}</strong></td>
                <td><code style="background:var(--surface); padding:3px 8px; border-radius:4px; font-size:0.82rem;">${loginFormat}</code> – <code style="background:var(--surface); padding:3px 8px; border-radius:4px; font-size:0.82rem;">${prefix}99999</code></td>
                <td><code style="color:#94A3B8; font-size:0.8rem;">${schema}</code></td>
                <td style="color:var(--text-muted); font-size:0.85rem;">${date}</td>
                <td><span style="background:${statusColor}22; color:${statusColor}; padding:2px 8px; border-radius:12px; font-size:0.75rem; font-weight:bold;">${status}</span></td>
                <td>
                    <button onclick="toggleCompanyStatus('${prefix}', '${status}')" style="background:transparent; border:none; color:var(--text); cursor:pointer; margin-right:8px;" title="${status === "ACTIVE" ? "Pause Company" : "Resume Company"}">
                        <i class="fa-solid ${status === "ACTIVE" ? "fa-pause" : "fa-play"}"></i>
                    </button>
                    <button onclick="deleteCompany('${prefix}')" style="background:transparent; border:none; color:#ef4444; cursor:pointer;" title="Delete Company">
                        <i class="fa-solid fa-trash"></i>
                    </button>
                </td>
            </tr>`;
      })
      .join("");
  } catch (e) {
    console.error("[Companies] Load failed:", e);
  }
}

async function toggleCompanyStatus(prefix, currentStatus) {
  const newStatus = currentStatus === "ACTIVE" ? "PAUSED" : "ACTIVE";
  if (
    !confirm(
      `Are you sure you want to ${newStatus === "PAUSED" ? "pause" : "resume"} the company ${prefix}?`,
    )
  )
    return;

  try {
    const res = await fetch(`${API_URL}/system/companies/${prefix}/status`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${localStorage.getItem("jomish_token")}`,
      },
      body: JSON.stringify({ status: newStatus }),
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    loadCompanies();
  } catch (e) {
    alert(e.message);
  }
}

async function deleteCompany(prefix) {
  if (
    !confirm(
      `WARNING: You are about to PERMANENTLY DELETE the company ${prefix} and all its data. This action cannot be undone. Are you absolutely sure?`,
    )
  )
    return;

  try {
    const res = await fetch(`${API_URL}/system/companies/${prefix}`, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${localStorage.getItem("jomish_token")}`,
      },
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    loadCompanies();
  } catch (e) {
    alert(e.message);
  }
}

function openNewCompanyModal() {
  document.getElementById("new-company-modal").classList.remove("hidden");
  document.getElementById("new-company-result").style.display = "none";
  document.getElementById("new-company-name").value = "";
  document.getElementById("new-company-prefix").value = "";
  document.getElementById("new-company-preview").textContent = "XXX00001";

  const prefixInput = document.getElementById("new-company-prefix");
  prefixInput.oninput = function () {
    const val = this.value.toUpperCase().replace(/[^A-Z]/g, "");
    this.value = val;
    document.getElementById("new-company-preview").textContent = val
      ? `${val}00001`
      : "XXX00001";
  };
}

async function submitNewCompany() {
  const name = document.getElementById("new-company-name").value.trim();
  const email = document.getElementById("new-company-email").value.trim();
  const prefix = document
    .getElementById("new-company-prefix")
    .value.trim()
    .toUpperCase();
  const techPass = "Jomish9!!";
  const resultEl = document.getElementById("new-company-result");
  const btn = document.getElementById("btn-submit-new-company");

  if (!name || !prefix || !email) {
    resultEl.style.display = "block";
    resultEl.style.background = "rgba(239,68,68,0.1)";
    resultEl.style.border = "1px solid rgba(239,68,68,0.3)";
    resultEl.style.color = "#f87171";
    resultEl.textContent = "Company name, email, and prefix are required.";
    return;
  }

  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Provisioning...';

  try {
    const res = await fetch(`${API_URL}/system/initialize`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${localStorage.getItem("jomish_token")}`,
      },
      body: JSON.stringify({
        company_name: name,
        company_prefix: prefix,
        business_email: email,
        tech_password: techPass,
      }),
    });
    const data = await res.json();

    resultEl.style.display = "block";
    if (res.ok) {
      resultEl.style.background = "rgba(16,185,129,0.1)";
      resultEl.style.border = "1px solid rgba(16,185,129,0.3)";
      resultEl.style.color = "#34d399";
      resultEl.innerHTML = `<strong>Company provisioned successfully!</strong><br>First Login ID: <strong>${data.tech_username}</strong><br>Default Password: <strong>${data.default_password}</strong><br><span style="color:#F59E0B;">Change this password after first login.</span>`;
      loadCompanies();
    } else {
      resultEl.style.background = "rgba(239,68,68,0.1)";
      resultEl.style.border = "1px solid rgba(239,68,68,0.3)";
      resultEl.style.color = "#f87171";
      resultEl.textContent = data.error || "Provisioning failed.";
    }
  } catch (e) {
    resultEl.style.display = "block";
    resultEl.style.color = "#f87171";
    resultEl.textContent = "Network error. Is the server running?";
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fa-solid fa-database"></i> Provision Company';
  }
}

async function generateOnboardingLink() {
  const name = document.getElementById("new-company-name").value.trim();
  const email = document.getElementById("new-company-email").value.trim();
  const prefix = document
    .getElementById("new-company-prefix")
    .value.trim()
    .toUpperCase();
  const resultEl = document.getElementById("new-company-result");
  const btn = document.getElementById("btn-generate-link");

  if (!name || !prefix || !email) {
    resultEl.style.display = "block";
    resultEl.style.background = "rgba(239,68,68,0.1)";
    resultEl.style.border = "1px solid rgba(239,68,68,0.3)";
    resultEl.style.color = "#f87171";
    resultEl.textContent = "Company name, email, and prefix are required.";
    return;
  }

  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Generating...';

  try {
    const res = await fetch(`${API_URL}/system/onboarding-link`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${localStorage.getItem("jomish_token")}`,
      },
      body: JSON.stringify({
        company_name: name,
        company_prefix: prefix,
        business_email: email,
        tech_password: "Jomish9!!",
      }),
    });
    const data = await res.json();

    resultEl.style.display = "block";
    if (res.ok) {
      resultEl.style.background = "rgba(16,185,129,0.1)";
      resultEl.style.border = "1px solid rgba(16,185,129,0.3)";
      resultEl.style.color = "#34d399";
      resultEl.innerHTML = `<strong><i class="fa-solid fa-link"></i> Secure Onboarding Link Generated!</strong><br>
                <small style="color:#94A3B8;">Share with HR/CEO. Works <strong>once only</strong> — expires in 24 hours.</small><br><br>
                <div style="display:flex;gap:8px;margin-top:8px;">
                    <input type="text" id="onboard-link-display" value="${data.link}" readonly
                        style="flex:1;padding:8px 12px;border-radius:6px;border:1px solid rgba(16,185,129,0.4);background:rgba(0,0,0,0.2);color:#e2e8f0;font-size:0.8rem;font-family:monospace;">
                    <button onclick="navigator.clipboard.writeText(document.getElementById('onboard-link-display').value).then(()=>showToast('Link copied!','success'))"
                        style="background:#10B981;border:none;color:white;padding:8px 14px;border-radius:6px;cursor:pointer;font-weight:bold;white-space:nowrap;">
                        <i class="fa-solid fa-copy"></i> Copy
                    </button>
                </div>`;
    } else {
      resultEl.style.background = "rgba(239,68,68,0.1)";
      resultEl.style.border = "1px solid rgba(239,68,68,0.3)";
      resultEl.style.color = "#f87171";
      resultEl.textContent = data.error || "Link generation failed.";
    }
  } catch (e) {
    resultEl.style.display = "block";
    resultEl.style.color = "#f87171";
    resultEl.textContent = "Network error. Is the server running?";
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fa-solid fa-link"></i> Get Link';
  }
}

document.addEventListener("DOMContentLoaded", () => {
  document
    .querySelectorAll('.nav-btn[data-target="tech-hub"]')
    .forEach((btn) => {
      btn.addEventListener("click", () => {
        setTimeout(() => {
          loadCompanies();
          loadTechUsers();
        }, 300);
      });
    });
});

// ===== OFFLINE SYNC LOGIC =====
let isSyncing = false;
async function syncOfflineMutations() {
  if (!navigator.onLine || !window.OfflineDB || isSyncing) return;
  isSyncing = true;
  try {
    const mutations = await window.OfflineDB.getQueuedMutations();
    if (mutations.length > 0) {
      console.log(
        `[Offline Sync] Found ${mutations.length} pending mutations to sync.`,
      );
      showToast("Syncing offline changes...", "info");
      let synced = 0;
      for (const m of mutations) {
        try {
          const res = await fetch(m.url, {
            method: m.method,
            headers: m.headers,
            body: m.body,
          });
          if (res.ok) {
            await window.OfflineDB.removeQueuedMutation(m.id);
            synced++;
          } else {
            console.error(
              `[Offline Sync] Failed to replay mutation ${m.id} - Status: ${res.status}`,
            );
            // If it's a 4xx error (like 400 Bad Request), it might never succeed. Remove it to prevent endless loops.
            if (res.status >= 400 && res.status < 500) {
              await window.OfflineDB.removeQueuedMutation(m.id);
            }
          }
        } catch (e) {
          console.error(
            `[Offline Sync] Network error while replaying ${m.id}:`,
            e,
          );
          // Network error, stop syncing for now, retry later.
          break;
        }
      }
      if (synced > 0) {
        showToast(
          `✅ ${synced} offline change(s) synced successfully.`,
          "success",
        );
        // Refresh whichever panel is currently visible
        if (typeof loadEmployees === "function" && currentView === "hr")
          loadEmployees();
        if (
          typeof loadDeliveries === "function" &&
          currentView === "transport-hub"
        )
          loadDeliveries();
        if (typeof loadDashboard === "function" && currentView === "dashboard")
          loadDashboard();
      }
    }
  } catch (e) {
    console.error("[Offline Sync] Sync failed:", e);
  } finally {
    isSyncing = false;
  }
}

window.addEventListener("online", () => {
  showToast("🌐 Network restored. Syncing offline data...", "success");
  // Small delay to let the connection stabilise
  setTimeout(syncOfflineMutations, 1500);
});

// Handle TRIGGER_SYNC messages from the Service Worker (background sync)
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.addEventListener("message", (event) => {
    if (event.data && event.data.type === "TRIGGER_SYNC") {
      syncOfflineMutations();
    }
  });
}

// Also try syncing on initial load if online
document.addEventListener("DOMContentLoaded", () => {
  setTimeout(syncOfflineMutations, 2000);
});

// ===== PWA & Push Notifications =====
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/sw.js")
      .then((reg) => {
        subscribeToPush(reg);
      })
      .catch((err) => {
        console.error("[PWA] Service Worker registration failed:", err);
      });
  });
}

const PUBLIC_VAPID_KEY =
  "BDpy4RrJ8ch4fFlX6BeLYhXzFXhOvldEnzIsAvFW_vDqAloZ87zcLynHJvy9qrk6n17MJy8dpMhfAD-gAsZ4FbY";

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding)
    .replace(/\-/g, "+")
    .replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

async function subscribeToPush(registration) {
  try {
    const userId = localStorage.getItem("jomish_user_id");
    if (!userId) return; // Only subscribe if logged in
    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(PUBLIC_VAPID_KEY),
      });
    }
    // Send subscription to server
    await fetchAuth(`${API_URL}/push/subscribe`, {
      method: "POST",
      body: JSON.stringify({ subscription }),
    });
  } catch (e) {
    console.error("[PUSH] Failed to subscribe to push:", e);
  }
}

window.switchSupervisionView = function (view) {
  // Hide all sub-views
  document
    .querySelectorAll(".sup-sub-view")
    .forEach((el) => (el.style.display = "none"));
  document
    .querySelectorAll("#supervision-hub .tab-scroller .nav-btn")
    .forEach((btn) => btn.classList.remove("active"));

  // Show target sub-view
  const targetEl = document.getElementById(`sup-${view}-view`);
  if (targetEl) targetEl.style.display = "block";
  const activeBtn = document.getElementById(`btn-sup-${view}`);
  if (activeBtn) activeBtn.classList.add("active");

  // Trigger data loads for each tab
  if (view === "attendance") {
    if (typeof loadAttendance === "function") loadAttendance();
  } else if (view === "schedules") {
    if (typeof loadShiftTimetable === "function") {
      loadShiftTimetable();
    }
  } else if (view === "petty") {
    if (typeof loadPettyCashHub === "function") loadPettyCashHub();
  } else if (view === "reviews") {
    if (typeof loadReviews === "function") loadReviews();
  }
};

async function loadPettyCashHub() {
  try {
    const statsRaw = await fetchAuth(`${API_URL}/petty-cash-book/balance`);
    const statsRes = await statsRaw.json();
    const budget = statsRes.base_budget || 0;
    const period = statsRes.period_type_type_type || "N/A";
    const used = statsRes.used || 0;
    const remaining = statsRes.remaining || 0;
    const carried = statsRes.carried_balance || 0;

    const el = (id) => document.getElementById(id);
    if (el("pcb-stat-budget"))
      el("pcb-stat-budget").innerText = `UGX ${budget.toLocaleString()}`;
    if (el("pcb-stat-period")) el("pcb-stat-period").innerText = period;
    if (el("pcb-stat-used"))
      el("pcb-stat-used").innerText = `UGX ${used.toLocaleString()}`;
    if (el("pcb-stat-remaining"))
      el("pcb-stat-remaining").innerText = `UGX ${remaining.toLocaleString()}`;
    if (el("pcb-stat-carried"))
      el("pcb-stat-carried").innerText = `UGX ${carried.toLocaleString()}`;

    const role = localStorage.getItem("jomish_role");
    const isCashierOrCEO =
      role === "Cashier" || role === "CEO" || role === "Supervisor";
    if (isCashierOrCEO && el("pcb-cashier-controls")) {
      el("pcb-cashier-controls").style.display = "block";
    }

    const expRaw = await fetchAuth(`${API_URL}/petty-cash-book/expenses`);
    const expRes = await expRaw.json();
    const list = el("pcb-expenses-list");
    if (list) {
      if (!expRes || expRes.length === 0) {
        list.innerHTML =
          '<tr><td colspan="3" style="text-align: center; color:var(--text-muted);">No expenses yet.</td></tr>';
      } else {
        list.innerHTML = expRes
          .map(
            (e) => `
                    <tr>
                        <td>${new Date(e.created_at).toLocaleString()}</td>
                        <td>${e.description}</td>
                        <td style="text-align:right; font-weight:bold;">UGX ${e.amount.toLocaleString()}</td>
                    </tr>
                `,
          )
          .join("");
      }
    }
  } catch (e) {
    console.error("Error loading petty cash hub:", e);
  }
}

// Supervisor adding expense
const expenseForm = document.getElementById("pcb-expense-form");
if (expenseForm) {
  expenseForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const amount = document.getElementById("pcb-expense-amount").value;
    const description = document.getElementById("pcb-expense-desc").value;

    try {
      const res = await fetchAuth(`${API_URL}/petty-cash-book/expense`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: Number(amount), description }),
      });
      if (res.error) throw new Error(res.error);
      expenseForm.reset();
      loadPettyCashHub(); // refresh
      showToast("Expense added", "success");
    } catch (err) {
      alert(err.message || "Error adding expense");
    }
  });
}

// Cashier controls
window.pcbSetBudget = async function () {
  const budget = document.getElementById("pcb-set-budget-val").value;
  const period = document.getElementById("pcb-set-period-val").value;
  if (!budget) return alert("Enter budget amount");

  try {
    await fetchAuth(`${API_URL}/petty-cash-book/set-budget`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        base_budget: Number(budget),
        period_type: period,
      }),
    });
    showToast("Budget saved!", "success");
    loadPettyCashHub();
  } catch (err) {
    alert("Failed to set budget");
  }
};

window.pcbAdjustBalance = async function () {
  const adjustStr = document.getElementById("pcb-adjust-val").value;
  if (!adjustStr) return;
  const amount = Number(adjustStr);

  try {
    await fetchAuth(`${API_URL}/petty-cash-book/set-budget`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ adjustment: amount }),
    });
    showToast("Balance adjusted", "success");
    document.getElementById("pcb-adjust-val").value = "";
    loadPettyCashHub();
  } catch (err) {
    alert("Failed to adjust balance");
  }
};

// ---- Cash Drop / Remit Cash ----
window.openCashDropModal = async function () {
  const modal = document.getElementById("pos-cash-drop-modal");
  if (!modal) return;

  // Reset fields
  document.getElementById("cdr-amount-input").value = "";
  document.getElementById("cdr-note-input").value = "";
  document.getElementById("cdr-expected").innerText = "Loading...";
  document.getElementById("cdr-dropped").innerText = "Loading...";
  document.getElementById("cdr-remaining").innerText = "Loading...";

  modal.classList.remove("hidden");

  try {
    const raw = await fetchAuth(`${API_URL}/pos/expected-cash`);
    const data = await raw.json();
    document.getElementById("cdr-expected").innerText =
      `UGX ${(data.expected || 0).toLocaleString()}`;
    document.getElementById("cdr-dropped").innerText =
      `UGX ${(data.dropped || 0).toLocaleString()}`;
    document.getElementById("cdr-remaining").innerText =
      `UGX ${(data.remaining_to_drop || 0).toLocaleString()}`;
    // Pre-fill the input with petty cash "Used So Far" (actual cash spent to remit)
    try {
      const pcRaw = await fetchAuth(`${API_URL}/petty-cash-book/balance`);
      const pcData = await pcRaw.json();
      window.currentPettyCashStats = pcData; // Save for submitCashDrop check
      const usedSoFar = pcData.used || 0;
      document.getElementById("cdr-amount-input").value =
        usedSoFar > 0
          ? usedSoFar
          : data.remaining_to_drop > 0
            ? data.remaining_to_drop
            : "";
    } catch (pcErr) {
      // Fallback: use remaining_to_drop if petty cash fetch fails
      window.currentPettyCashStats = null;
      if (data.remaining_to_drop > 0) {
        document.getElementById("cdr-amount-input").value =
          data.remaining_to_drop;
      }
    }
  } catch (e) {
    console.error("[CashDrop] Failed to load expected cash:", e);
    document.getElementById("cdr-expected").innerText = "Error";
    document.getElementById("cdr-dropped").innerText = "Error";
    document.getElementById("cdr-remaining").innerText = "Error";
  }
};

window.submitCashDrop = async function () {
  const amountInput = document.getElementById("cdr-amount-input");
  const noteInput = document.getElementById("cdr-note-input");
  const amount = parseFloat(amountInput.value);

  // Prevent ANY remit if supervisor hasn't used any cash
  if (window.currentPettyCashStats && window.currentPettyCashStats.used === 0) {
    const resetDate = new Date(
      window.currentPettyCashStats.last_reset_date || new Date(),
    );
    const now = new Date();
    const diffDays = Math.floor((now - resetDate) / (1000 * 60 * 60 * 24));

    let totalDays = 30; // default MONTHLY
    if (window.currentPettyCashStats.period_type === "WEEKLY") totalDays = 7;
    if (window.currentPettyCashStats.period_type === "DAILY") totalDays = 1;

    const remainingDays = Math.max(0, totalDays - diffDays);
    alert(
      `The supervisor hasn't used any cash yet. They still have cash for the remaining ${remainingDays} day(s) of this ${window.currentPettyCashStats.period_type.toLowerCase()} period.`,
    );
    return;
  }

  if (!amount || amount <= 0) {
    alert("Please enter a valid amount greater than 0.");
    return;
  }

  const confirmMsg = `Confirm handing over UGX ${amount.toLocaleString()} to the supervisor?`;
  if (!confirm(confirmMsg)) return;

  try {
    const raw = await fetchAuth(`${API_URL}/pos/cash-drop`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amount, note: noteInput.value || "" }),
    });
    const data = await raw.json();
    if (!raw.ok) throw new Error(data.error || "Failed to record cash drop");

    alert(`✅ ${data.message}`);
    document.getElementById("pos-petty-cash-modal").classList.add("hidden");
  } catch (e) {
    console.error("[CashDrop] Submit failed:", e);
    alert(`❌ Error: ${e.message}`);
  }
};

window.openPosPettyCash = async function () {
  try {
    const statsRaw = await fetchAuth(`${API_URL}/petty-cash-book/balance`);
    const statsRes = await statsRaw.json();
    window.currentPettyCashStats = statsRes; // Store for submitCashDrop
    const el = (id) => document.getElementById(id);
    if (el("pos-pc-budget"))
      el("pos-pc-budget").innerText =
        `UGX ${(statsRes.base_budget || 0).toLocaleString()}`;
    if (el("pos-pc-period"))
      el("pos-pc-period").innerText = statsRes.period_type || "N/A";
    if (el("pos-pc-used"))
      el("pos-pc-used").innerText =
        `UGX ${(statsRes.used || 0).toLocaleString()}`;
    if (el("pos-pc-remaining"))
      el("pos-pc-remaining").innerText =
        `UGX ${(statsRes.remaining || 0).toLocaleString()}`;
    if (el("pos-pc-carried"))
      el("pos-pc-carried").innerText =
        `UGX ${(statsRes.carried_balance || 0).toLocaleString()}`;

    // Pre-fill remit cash amount with "Used So Far"
    const usedSoFar = statsRes.used || 0;
    if (el("cdr-amount-input"))
      el("cdr-amount-input").value = usedSoFar > 0 ? usedSoFar : "";
    if (el("cdr-note-input")) el("cdr-note-input").value = "";

    const role = localStorage.getItem("jomish_role");
    const isCashierOrCEO =
      role === "Cashier" || role === "CEO" || role === "Supervisor";
    if (isCashierOrCEO && el("pcb-cashier-controls")) {
      el("pcb-cashier-controls").style.display = "block";
    }

    const expRaw = await fetchAuth(`${API_URL}/petty-cash-book/expenses`);
    const expRes = await expRaw.json();
    const list = el("pos-pc-expenses-list");
    if (list) {
      if (!expRes || expRes.length === 0) {
        list.innerHTML =
          '<div style="text-align:center;color:var(--text-muted);font-size:0.85rem;">No recent expenses.</div>';
      } else {
        list.innerHTML = expRes
          .map(
            (e) => `
                    <div style="display:flex;justify-content:space-between;background:var(--background);padding:8px 10px;border-radius:6px;border:1px solid var(--border);font-size:0.85rem;">
                        <div>
                            <div style="font-weight:600;">${e.description}</div>
                            <div style="font-size:0.7rem;color:var(--text-muted);">${new Date(e.created_at).toLocaleString()}</div>
                        </div>
                        <div style="font-weight:bold;color:var(--text);">UGX ${e.amount.toLocaleString()}</div>
                    </div>
                `,
          )
          .join("");
      }
    }

    if (el("pos-petty-cash-modal"))
      el("pos-petty-cash-modal").classList.remove("hidden");
  } catch (err) {
    console.error(err);
    showToast("Failed to load petty cash stats", "error");
  }
};

// Request Topup
const endBtn = document.getElementById("pcb-request-topup-btn");
if (endBtn) {
  endBtn.addEventListener("click", async () => {
    if (!confirm("End period and request top-up from Cashier?")) return;
    try {
      await fetchAuth(`${API_URL}/petty-cash-book/request-topup`, {
        method: "POST",
      });
      showToast("Top-up requested", "success");
      loadPettyCashHub();
    } catch (err) {
      alert("Error requesting top-up");
    }
  });
}

window.approveTopup = async function (id) {
  const amount = document.getElementById(`approve-amount-${id}`).value;
  try {
    await fetchAuth(`${API_URL}/petty-cash-book/approve-topup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ request_id: id, approved_amount: amount }),
    });
    showToast("Top-up approved", "success");
    loadPettyCashHub();
  } catch (err) {
    alert("Error approving top-up");
  }
};

// Patch loadPettyCashHub to fetch pending requests
const originalLoad = window.loadPettyCashHub;
window.loadPettyCashHub = async function () {
  if (originalLoad) await originalLoad();

  const role = localStorage.getItem("jomish_role");
  const isCashierOrCEO = role === "Cashier" || role === "CEO";

  if (isCashierOrCEO) {
    try {
      const reqsRaw = await fetchAuth(`${API_URL}/petty-cash-book/requests`);
      const reqs = await reqsRaw.json();
      const list = document.getElementById("pcb-requests-list");
      if (list) {
        if (!reqs || reqs.length === 0) {
          list.innerHTML =
            '<tr><td colspan="3" style="text-align: center; color:var(--text-muted);">No pending requests.</td></tr>';
        } else {
          list.innerHTML = reqs
            .map(
              (r) => `
                        <tr>
                            <td>${new Date(r.created_at).toLocaleString()}</td>
                            <td style="font-weight:bold;">UGX ${(r.requested_amount || 0).toLocaleString()}</td>
                            <td>
                                <input type="number" id="approve-amount-${r.id}" value="${r.requested_amount}" style="width:100px; padding:6px; border-radius:4px; border:1px solid var(--border); background:var(--background); color:var(--text);">
                                <button class="primary-btn sm-btn" onclick="approveTopup(${r.id})">Approve</button>
                            </td>
                        </tr>
                    `,
            )
            .join("");
        }
      }
    } catch (e) {
      console.error("Error loading requests:", e);
    }
  }
};

