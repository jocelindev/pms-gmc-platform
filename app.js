(function () {
  const { PMS_DATA, PMS_RENDERERS } = window;
  const api = window.PMS_API;
  const {
    $,
    renderAll,
    renderKoboTable,
    renderKpiTable,
    renderPoleControls,
    renderPoleMonitor,
    renderValidationQueue,
    renderReportControls,
    renderReportWorkspace,
    renderReportHistory,
    renderAdmin,
    getObjectiveCatalogProfile,
  } = PMS_RENDERERS;

  const viewTitles = {
    dashboard: "Dashboard KPI par pole",
    poles: "Suivi des performances par pole",
    kpis: "Referentiel KPI",
    alerts: "Notifications",
    actions: "Plans d'action",
    improvement: "Amelioration continue",
    losses: "Analyse horaire & pertes CA",
    reports: "Reporting periodique par pole",
    admin: "Administration & droits",
  };

  function makeLocalEmail(name) {
    return `${String(name || "utilisateur")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ".")
      .replace(/^\.+|\.+$/g, "")}@palladium.local`;
  }

  function buildSeedUsers() {
    return PMS_DATA.reporting.poles.map((pole) => ({
      id: `seed-${pole.id}`,
      fullName: pole.owner,
      email: makeLocalEmail(pole.owner),
      phone: "",
      profile: "Manager / Responsable",
      status: "Actif",
      defaultPoleId: pole.id,
      defaultPoleName: pole.name,
    }));
  }

  const state = {
    koboSubmissions: JSON.parse(JSON.stringify(PMS_DATA.koboSubmissions)),
    validationQueue: JSON.parse(JSON.stringify(PMS_DATA.validationQueue)),
    reportHistory: JSON.parse(JSON.stringify(PMS_DATA.reporting.history)),
    koboActiveForm: null,
    kpiObjectives: [],
    platformUsers: buildSeedUsers(),
    platformAccessRoles: [
      {
        profile: "Administrateur",
        permissions: {
          consultation: true,
          ajout: true,
          modification: true,
          suppression: true,
          validation: true,
          administration: true,
        },
      },
      {
        profile: "Direction",
        permissions: {
          consultation: true,
          ajout: false,
          modification: false,
          suppression: false,
          validation: true,
          administration: false,
        },
      },
      {
        profile: "Manager / Responsable",
        permissions: {
          consultation: true,
          ajout: true,
          modification: true,
          suppression: false,
          validation: true,
          administration: false,
        },
      },
      {
        profile: "Analyste BI",
        permissions: {
          consultation: true,
          ajout: true,
          modification: true,
          suppression: false,
          validation: false,
          administration: false,
        },
      },
    ],
    accessRules: PMS_DATA.reporting.poles.map((pole) => ({
      id: `ACC-${pole.id}`,
      responsible: pole.owner,
      poleId: pole.id,
      poleName: pole.name,
      role: "Manager / Responsable",
      dashboardScope: `Dashboard Suivi KPI - ${pole.name}`,
      permission: "Acces limite au dashboard de son pole",
      status: "Actif",
      className: "green",
    })),
    currentPoleMonitor: PMS_DATA.reporting.defaultPole,
    currentPoleCycle: PMS_DATA.reporting.defaultCycle,
    currentReportPole: PMS_DATA.reporting.defaultPole,
    currentReportCycle: PMS_DATA.reporting.defaultCycle,
    currentAdminPole: PMS_DATA.reporting.defaultPole,
    currentAdminKpi: null,
    currentAdminTab: "objectives",
    currentAdminAccessPole: PMS_DATA.reporting.defaultPole,
    currentAccessProfile: "Administrateur",
    currentUserAccessUserId: `seed-${PMS_DATA.reporting.defaultPole}`,
    currentUserAccessPole: PMS_DATA.reporting.defaultPole,
    currentUserAccessProfile: "Manager / Responsable",
    activeAccessRuleId: `ACC-${PMS_DATA.reporting.defaultPole}`,
    databaseConnected: false,
    currentUser: null,
    currentPermissions: {},
    userAccessScope: [],
    objectiveKoboSource: null,
    calculationKoboSource: null,
  };

  function showToast(message) {
    const toast = $("#toast");
    toast.textContent = message;
    toast.classList.add("show");
    window.setTimeout(() => toast.classList.remove("show"), 2600);
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function mergeDatabasePayload(payload) {
    if (!payload) return;
    if (Array.isArray(payload.profiles) && payload.profiles.length) {
      state.platformAccessRoles = payload.profiles;
    }
    if (Array.isArray(payload.users) && payload.users.length) {
      state.platformUsers = payload.users;
      const selectedUser =
        state.platformUsers.find((user) => String(user.id) === String(state.currentUserAccessUserId)) ||
        state.platformUsers.find((user) => user.defaultPoleId === state.currentUserAccessPole) ||
        state.platformUsers[0];
      if (selectedUser) {
        state.currentUserAccessUserId = selectedUser.id;
      }
    }
    if (Array.isArray(payload.userAccess) && payload.userAccess.length) {
      state.accessRules = payload.userAccess;
      const activeRule =
        state.accessRules.find((rule) => rule.id === state.activeAccessRuleId) ||
        state.accessRules.find((rule) => rule.poleId === state.currentPoleMonitor) ||
        state.accessRules[0];
      if (activeRule) {
        state.activeAccessRuleId = activeRule.id;
        state.currentUserAccessPole = activeRule.poleId;
        state.currentUserAccessProfile = activeRule.role;
      }
    }
    if (Array.isArray(payload.objectives)) {
      state.kpiObjectives = payload.objectives;
    }
    if (Array.isArray(payload.reportHistory)) {
      state.reportHistory = payload.reportHistory;
    }
    if (payload.activeKoboForm) {
      state.koboActiveForm = payload.activeKoboForm;
    }
    if (Array.isArray(payload.koboSources)) {
      const referenceSource = payload.koboSources.find((source) => source.role === "referentielKpi");
      const calculationSource = payload.koboSources.find((source) => source.role === "donneesCalcul");
      if (referenceSource) {
        state.objectiveKoboSource = referenceSource;
      }
      if (calculationSource) {
        state.calculationKoboSource = calculationSource;
      }
    }
    state.databaseConnected = true;
  }

  async function hydrateFromDatabase() {
    if (!api?.bootstrap) return;
    try {
      const payload = await api.bootstrap();
      mergeDatabasePayload(payload);
    } catch (error) {
      console.warn("Base PMS indisponible, mode local active.", error);
      state.databaseConnected = false;
    }
  }

  async function persistKoboActiveForm(successMessage) {
    if (!state.koboActiveForm || !api?.saveKoboForm) {
      showToast(successMessage);
      return;
    }

    try {
      const savedForm = await api.saveKoboForm(state.koboActiveForm);
      if (savedForm) {
        state.koboActiveForm = savedForm;
        renderKoboActiveForm();
      }
      showToast(`${successMessage} Base de donnees mise a jour.`);
    } catch (error) {
      console.warn("Enregistrement Kobo indisponible.", error);
      showToast(`${successMessage} Enregistrement local uniquement.`);
    }
  }

  function setLoginFeedback(message, type = "") {
    const feedback = $("#login-feedback");
    if (!feedback) return;
    feedback.textContent = message;
    feedback.className = `login-feedback ${type}`.trim();
  }

  function loadSavedSession() {
    try {
      return JSON.parse(window.sessionStorage.getItem("pmsSession") || "null");
    } catch {
      return null;
    }
  }

  function saveSession(session) {
    window.sessionStorage.setItem("pmsSession", JSON.stringify(session));
  }

  function clearSession() {
    window.sessionStorage.removeItem("pmsSession");
  }

  function showLogin() {
    document.body.classList.add("login-mode");
    document.body.classList.remove("authenticated");
    $("#login-password").value = "";
    $("#login-identifier")?.focus();
  }

  function showApplication() {
    document.body.classList.remove("login-mode");
    document.body.classList.add("authenticated");
  }

  function updateSessionChip() {
    const chip = $("#session-chip");
    const logout = $("#logout-button");
    const userName = $("#session-user-name");
    const userProfile = $("#session-user-profile");
    if (!chip || !logout || !state.currentUser) return;

    userName.textContent = state.currentUser.fullName;
    userProfile.textContent = state.currentUser.profile;
    chip.hidden = false;
    logout.hidden = false;
  }

  function getAuthorizedPoleIds() {
    if (state.currentPermissions?.administration) {
      return PMS_DATA.reporting.poles.map((pole) => pole.id);
    }
    const scope = Array.isArray(state.userAccessScope) ? state.userAccessScope : [];
    return [...new Set(scope.map((rule) => rule.poleId).filter(Boolean))];
  }

  function getAllowedPoleFromScope(requestedPoleId) {
    const authorizedPoleIds = getAuthorizedPoleIds();
    if (!authorizedPoleIds.length || authorizedPoleIds.includes(requestedPoleId)) {
      return requestedPoleId;
    }
    return authorizedPoleIds[0] || requestedPoleId;
  }

  function applyUserAccessScope() {
    const firstAccess = state.userAccessScope?.[0];
    const canAdmin = Boolean(state.currentPermissions?.administration);

    document.querySelector('.nav-item[data-view="admin"]')?.toggleAttribute("hidden", !canAdmin);

    if (canAdmin) {
      state.activeAccessRuleId = null;
      state.currentPoleMonitor = state.currentPoleMonitor || PMS_DATA.reporting.defaultPole;
      state.currentReportPole = state.currentReportPole || PMS_DATA.reporting.defaultPole;
      return;
    }

    if (!firstAccess) return;
    state.activeAccessRuleId = firstAccess.id;
    state.currentPoleMonitor = firstAccess.poleId;
    state.currentReportPole = firstAccess.poleId;
    state.currentAdminPole = firstAccess.poleId;
    state.currentUserAccessPole = firstAccess.poleId;
    state.currentUserAccessProfile = firstAccess.role;
  }

  function applyAuthenticatedSession(session, options = {}) {
    if (!session?.user) {
      showLogin();
      return;
    }

    state.currentUser = session.user;
    state.currentPermissions = session.permissions || {};
    state.userAccessScope = session.access || [];
    applyUserAccessScope();
    updateSessionChip();
    renderAll(state);
    renderKoboActiveForm();
    showApplication();
    activateView("dashboard");

    if (options.toast !== false) {
      showToast(`Bienvenue ${state.currentUser.fullName}.`);
    }
  }

  function bindAuthActions() {
    const form = $("#login-form");
    const logout = $("#logout-button");

    if (form) {
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const identifier = $("#login-identifier").value.trim();
        const password = $("#login-password").value.trim();
        if (!identifier || !password) {
          setLoginFeedback("Renseignez l'identifiant et le mot de passe.", "error");
          return;
        }

        $("#login-submit").disabled = true;
        setLoginFeedback("Verification de l'acces en cours...", "");
        try {
          if (!api?.login) {
            throw new Error("Serveur local indisponible. Lancez la plateforme sur http://127.0.0.1:5184/.");
          }
          const session = await api.login(identifier, password);
          saveSession(session);
          setLoginFeedback("Connexion reussie.", "success");
          applyAuthenticatedSession(session);
        } catch (error) {
          console.warn("Connexion refusee.", error);
          setLoginFeedback(error.message || "Connexion impossible.", "error");
        } finally {
          $("#login-submit").disabled = false;
        }
      });
    }

    if (logout) {
      logout.addEventListener("click", () => {
        clearSession();
        state.currentUser = null;
        state.currentPermissions = {};
        state.userAccessScope = [];
        $("#session-chip").hidden = true;
        logout.hidden = true;
        showLogin();
        setLoginFeedback("Session fermee. Saisissez votre mot de passe utilisateur.");
      });
    }
  }

  function formatBytes(bytes) {
    if (!bytes) return "0 Ko";
    const units = ["o", "Ko", "Mo", "Go"];
    const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
  }

  function activateView(view) {
    if (view === "admin" && !state.currentPermissions?.administration) {
      showToast("Acces reserve aux administrateurs.");
      view = "dashboard";
    }
    document.querySelectorAll(".nav-item").forEach((item) => item.classList.remove("active"));
    document.querySelectorAll(".view").forEach((item) => item.classList.remove("active"));
    document.querySelector(`.nav-item[data-view="${view}"]`)?.classList.add("active");
    document.querySelector(`#${view}`)?.classList.add("active");
    document.body.classList.toggle("dashboard-mode", view === "dashboard");
    $("#view-title").textContent = viewTitles[view] || "PMS GMC Group";
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function getCurrentReportContext() {
    const reporting = PMS_DATA.reporting;
    const pole = reporting.poles.find((item) => item.id === state.currentReportPole) || reporting.poles[0];
    const cycle = reporting.cycles.find((item) => item.value === state.currentReportCycle) || reporting.cycles[0];
    const kpis = reporting.kpisByPole[pole.id] || [];
    return {
      pole,
      cycle,
      kpis,
      period: $("#period-filter").value,
      format: $("#report-format-select").value,
      comment: $("#report-comment").value.trim(),
    };
  }

  function downloadTextFile(filename, content, type) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function csvCell(value) {
    return `"${String(value ?? "").replaceAll('"', '""')}"`;
  }

  function buildKpiCsv({ pole, cycle, period, kpis }) {
    const header = ["Pole", "Cycle", "Periode", "KPI", "Valeur", "Objectif", "Tendance", "Source Kobo", "Statut"];
    const rows = kpis.map((kpi) => [
      pole.name,
      cycle.value,
      period,
      kpi.name,
      kpi.value,
      kpi.target,
      kpi.trend,
      kpi.source,
      kpi.status,
    ]);
    return [header, ...rows].map((row) => row.map(csvCell).join(";")).join("\n");
  }

  function bindNavigation() {
    document.querySelectorAll(".nav-item").forEach((button) => {
      button.addEventListener("click", () => activateView(button.dataset.view));
    });
  }

  function bindKoboActions() {
    const serverInput = $("#kobo-server-url");
    const uidInput = $("#kobo-form-uid");
    const tokenInput = $("#kobo-api-token");
    const connectButton = $("#connect-kobo-form");
    const clearButton = $("#clear-kobo-form");
    const fileInput = $("#kobo-form-file");
    const dropZone = $("#kobo-drop-zone");
    const tokenToggle = $("#toggle-kobo-token");
    const statusBox = $("#kobo-connection-status");

    const setKoboStatus = (className, content) => {
      statusBox.className = `connector-status ${className}`;
      statusBox.innerHTML = content;
    };

    const readKoboConnection = () => {
      const serverUrl = normalizeKoboServerUrl(serverInput.value || state.koboActiveForm?.origin || "");
      const formUid = (uidInput.value || state.koboActiveForm?.uid || "").trim();
      const token = tokenInput.value.trim();
      return { serverUrl, formUid, token };
    };

    const syncKoboForm = async (triggerButton) => {
      const { serverUrl, formUid, token } = readKoboConnection();

      if (!serverUrl || !formUid || !token) {
        setKoboStatus("warning", "Renseignez le serveur, l'ID formulaire et le jeton API.");
        showToast("Synchronisation Kobo incomplete: informations manquantes.");
        return;
      }

      if (/\s/.test(formUid)) {
        setKoboStatus("warning", "L'ID formulaire ne doit pas contenir d'espace.");
        showToast("ID formulaire Kobo a verifier.");
        return;
      }

      if (!api?.syncKoboForm) {
        setKoboStatus("warning", "Le service de synchronisation Kobo n'est pas disponible.");
        showToast("Synchronisation Kobo indisponible pour le moment.");
        return;
      }

      const previousText = triggerButton?.textContent;
      if (triggerButton) {
        triggerButton.disabled = true;
        triggerButton.textContent = "Synchronisation...";
      }
      setKoboStatus("warning", `<strong>${escapeHtml(formUid)}</strong><span>Connexion a KoboToolbox en cours...</span>`);

      try {
        const result = await api.syncKoboForm({ serverUrl, formUid, token });
        serverInput.value = serverUrl;
        uidInput.value = result.activeForm?.uid || formUid;
        state.koboActiveForm = result.activeForm;
        renderKoboActiveForm();

        const fieldsDetected = result.fieldsDetected ?? state.koboActiveForm?.fields?.length ?? 0;
        const submissionsImported = result.submissionsImported ?? 0;
        const warning = result.syncWarning
          ? `<span class="status-note">${escapeHtml(result.syncWarning)}</span>`
          : "";
        setKoboStatus(
          result.syncWarning ? "warning" : "success",
          `<strong>${escapeHtml(uidInput.value)}</strong><span>${fieldsDetected} champ(s) detecte(s) - ${submissionsImported} soumission(s) lue(s)</span>${warning}`
        );
        showToast(`Kobo synchronise: ${fieldsDetected} champ(s), ${submissionsImported} soumission(s).`);
      } catch (error) {
        console.warn("Synchronisation Kobo impossible.", error);
        setKoboStatus("warning", `Synchronisation impossible: ${escapeHtml(error.message)}`);
        showToast(`Synchronisation Kobo impossible: ${error.message}`);
      } finally {
        if (triggerButton) {
          triggerButton.disabled = false;
          triggerButton.textContent = previousText;
        }
      }
    };

    tokenToggle.addEventListener("click", () => {
      const showToken = tokenInput.type === "password";
      tokenInput.type = showToken ? "text" : "password";
      tokenToggle.textContent = showToken ? "Masquer" : "Afficher";
    });

    connectButton.addEventListener("click", () => syncKoboForm(connectButton));

    clearButton.addEventListener("click", () => {
      serverInput.value = "";
      uidInput.value = "";
      tokenInput.value = "";
      tokenInput.type = "password";
      tokenToggle.textContent = "Afficher";
      fileInput.value = "";
      dropZone.classList.remove("drag-over");
      $("#kobo-connection-status").className = "connector-status empty";
      $("#kobo-connection-status").textContent = "Aucun formulaire Kobo connecte.";
      $("#kobo-upload-summary").className = "upload-summary empty";
      $("#kobo-upload-summary").textContent = "Aucun formulaire charge.";
      state.koboActiveForm = null;
      renderKoboActiveForm();
      showToast("Configuration Kobo reinitialisee.");
    });

    fileInput.addEventListener("change", (event) => {
      const file = event.target.files?.[0];
      if (!file) return;
      handleKoboFormFile(file);
    });

    ["dragenter", "dragover"].forEach((eventName) => {
      dropZone.addEventListener(eventName, (event) => {
        event.preventDefault();
        dropZone.classList.add("drag-over");
      });
    });

    ["dragleave", "drop"].forEach((eventName) => {
      dropZone.addEventListener(eventName, (event) => {
        event.preventDefault();
        dropZone.classList.remove("drag-over");
      });
    });

    dropZone.addEventListener("drop", (event) => {
      const file = event.dataTransfer?.files?.[0];
      if (!file) return;
      handleKoboFormFile(file);
    });
  }

  function normalizeKoboServerUrl(rawUrl) {
    const value = rawUrl.trim();
    if (!value) return "";
    try {
      const candidate = /^https?:\/\//i.test(value) ? value : `https://${value}`;
      const url = new URL(candidate);
      return `${url.origin}${url.pathname.replace(/\/$/, "")}`;
    } catch {
      return "";
    }
  }

  function renderKoboActiveForm() {
    const status = $("#kobo-active-status");
    const card = $("#kobo-active-form");
    const table = $("#kobo-form-fields-table");
    const fieldCount = $("#kobo-field-count");
    const form = state.koboActiveForm;

    if (!form) {
      status.className = "status-pill gray";
      status.textContent = "Non configure";
      fieldCount.className = "field-count-pill";
      fieldCount.textContent = "0 champ";
      card.className = "active-form-card empty";
      card.innerHTML = `
        <div class="active-empty-state">
          <strong>Aucune source active</strong>
          <span>Connecter un formulaire KoboToolbox ou charger un fichier KoboCollect pour afficher les champs detectes.</span>
        </div>
      `;
      table.innerHTML = `<tr><td colspan="3">Aucun champ detecte pour le moment.</td></tr>`;
      return;
    }

    status.className = `status-pill ${form.statusClass}`;
    status.textContent = form.status;
    fieldCount.className = `field-count-pill ${form.fields.length ? "ready" : "empty"}`;
    fieldCount.textContent = `${form.fields.length} champ${form.fields.length > 1 ? "s" : ""}`;
    card.className = "active-form-card ready";
    card.innerHTML = `
      <div class="active-form-grid">
        <div><span>Mode</span><strong>${escapeHtml(form.mode)}</strong></div>
        <div><span>Formulaire</span><strong>${escapeHtml(form.name)}</strong></div>
        <div><span>Source</span><strong>${escapeHtml(form.origin)}</strong></div>
        <div><span>Statut</span><strong>${escapeHtml(form.detail)}</strong></div>
      </div>
    `;

    table.innerHTML = form.fields.length
      ? form.fields
          .map(
            (field) => `
              <tr>
                <td><strong>${escapeHtml(field.name)}</strong></td>
                <td>${escapeHtml(field.type)}</td>
                <td>${escapeHtml(field.label)}</td>
              </tr>
            `
          )
          .join("")
      : `<tr><td colspan="3">Aucun champ detecte dans ce fichier.</td></tr>`;
  }

  function handleKoboFormFile(file) {
    const extension = file.name.split(".").pop().toLowerCase();
    const acceptedExtensions = ["xlsx", "xls", "xml", "xform", "csv"];
    const summary = $("#kobo-upload-summary");

    if (!acceptedExtensions.includes(extension)) {
      summary.className = "upload-summary warning";
      summary.textContent = "Format non accepte. Utilisez .xlsx, .xls, .xml, .xform ou .csv.";
      showToast("Format de formulaire Kobo non accepte.");
      return;
    }

    summary.className = "upload-summary";
    summary.textContent = `Analyse de ${file.name}...`;

    if (["xml", "xform", "csv"].includes(extension)) {
      const reader = new FileReader();
      reader.addEventListener("load", () => {
        const content = String(reader.result || "");
        const fields = extension === "csv" ? extractCsvFields(content) : extractXmlFields(content);
        activateUploadedKoboForm(file, fields, extension.toUpperCase());
      });
      reader.addEventListener("error", () => {
        summary.className = "upload-summary warning";
        summary.textContent = "Impossible de lire le fichier selectionne.";
        showToast("Lecture du formulaire Kobo impossible.");
      });
      reader.readAsText(file);
      return;
    }

    activateUploadedKoboForm(
      file,
      [
        { name: "survey", type: "Onglet XLSForm", label: "Structure du formulaire a analyser au branchement backend." },
        { name: "choices", type: "Onglet XLSForm", label: "Listes de choix KoboCollect." },
        { name: "settings", type: "Onglet XLSForm", label: "Parametres du formulaire." },
      ],
      "XLSForm"
    );
  }

  function activateUploadedKoboForm(file, fields, formType) {
    state.koboActiveForm = {
      mode: "Fichier charge",
      name: file.name,
      origin: `${formType} - ${formatBytes(file.size)}`,
      detail: fields.length ? "Formulaire charge localement et pret pour mapping PMS." : "Formulaire charge, mais aucun champ exploitable n'a ete detecte.",
      status: fields.length ? "Charge" : "A verifier",
      statusClass: fields.length ? "green" : "amber",
      fields,
    };
    $("#kobo-upload-summary").className = "upload-summary success";
    $("#kobo-upload-summary").innerHTML = `<strong>${escapeHtml(file.name)}</strong><span>${escapeHtml(formType)} - ${formatBytes(file.size)}</span>`;
    renderKoboActiveForm();
    persistKoboActiveForm("Formulaire KoboCollect charge dans la plateforme.");
  }

  function extractXmlFields(content) {
    const parser = new DOMParser();
    const xml = parser.parseFromString(content, "text/xml");
    const parseError = xml.getElementsByTagName("parsererror")[0];
    if (parseError) {
      return [{ name: "Erreur XML", type: "Lecture", label: "Le fichier ne semble pas etre un XForm valide." }];
    }

    return Array.from(xml.getElementsByTagName("*"))
      .filter((node) => ["input", "select", "select1", "upload", "range", "trigger"].includes(node.localName))
      .slice(0, 40)
      .map((node) => {
        const rawName = node.getAttribute("ref") || node.getAttribute("nodeset") || node.getAttribute("name") || node.localName;
        const label = Array.from(node.children).find((child) => child.localName === "label")?.textContent?.trim() || "Champ KoboCollect";
        return {
          name: rawName.split("/").filter(Boolean).pop() || rawName,
          type: node.localName,
          label,
        };
      });
  }

  function extractCsvFields(content) {
    const firstLine = content.split(/\r?\n/).find((line) => line.trim());
    if (!firstLine) return [];
    return firstLine
      .split(/[;,]/)
      .map((header) => header.trim().replace(/^"|"$/g, ""))
      .filter(Boolean)
      .slice(0, 40)
      .map((header) => ({ name: header, type: "Colonne CSV", label: "Champ importe depuis le fichier CSV" }));
  }

  function bindFilters() {
    $("#kpi-search").addEventListener("input", (event) => {
      renderKpiTable(event.target.value);
    });

    $("#branch-filter").addEventListener("change", (event) => {
      showToast(`Perimetre actif: ${event.target.value}. Pret pour branchement API Kobo/PMS.`);
    });
  }

  function bindPoleMonitoring() {
    document.addEventListener("click", (event) => {
      const poleButton = event.target.closest("[data-open-pole]");
      if (!poleButton) return;
      const requestedPole = poleButton.dataset.openPole;
      const allowedPole = getAllowedPoleFromScope(requestedPole);
      state.currentPoleMonitor = allowedPole;
      activateView("poles");
      renderPoleControls(state);
      renderPoleMonitor(state);
      const targetBlock = document.getElementById(`pole-block-${state.currentPoleMonitor}`);
      targetBlock?.scrollIntoView({ behavior: "smooth", block: "start" });
      showToast(
        allowedPole === requestedPole
          ? "KPIs du pole affiches dans la vue par pole."
          : "Acces limite: ce responsable voit uniquement son pole autorise."
      );
    });

    const poleSelect = $("#pole-monitor-select");
    if (poleSelect) {
      poleSelect.addEventListener("change", (event) => {
        const requestedPole = event.target.value;
        const allowedPole = getAllowedPoleFromScope(requestedPole);
        state.currentPoleMonitor = allowedPole;
        renderPoleControls(state);
        renderPoleMonitor(state);
        showToast(
          allowedPole === requestedPole
            ? "Vue performance du pole mise a jour."
            : "Acces limite: le suivi KPI reste sur le pole autorise."
        );
      });
    }

    const cycleSelect = $("#pole-cycle-select");
    if (cycleSelect) {
      cycleSelect.addEventListener("change", (event) => {
        state.currentPoleCycle = event.target.value;
        renderPoleMonitor(state);
        showToast(`Cycle ${event.target.value.toLowerCase()} applique au suivi du pole.`);
      });
    }

    const reportButton = $("#open-pole-report");
    if (reportButton) {
      reportButton.addEventListener("click", () => {
        state.currentReportPole = state.currentPoleMonitor;
        state.currentReportCycle = state.currentPoleCycle;
        $("#report-pole-select").value = state.currentReportPole;
        $("#report-cycle-select").value = state.currentReportCycle;
        renderReportWorkspace(state);
        activateView("reports");
        showToast("Rapport prepare a partir du pole selectionne.");
      });
    }
  }

  function bindReporting() {
    $("#report-pole-select").addEventListener("change", (event) => {
      const requestedPole = event.target.value;
      const allowedPole = getAllowedPoleFromScope(requestedPole);
      state.currentReportPole = allowedPole;
      event.target.value = allowedPole;
      renderReportWorkspace(state);
      showToast(
        allowedPole === requestedPole
          ? "Apercu du rapport mis a jour pour le pole selectionne."
          : "Acces limite: le rapport reste sur le pole autorise."
      );
    });

    $("#report-cycle-select").addEventListener("change", (event) => {
      state.currentReportCycle = event.target.value;
      renderReportWorkspace(state);
      showToast(`Periodicite ${event.target.value.toLowerCase()} appliquee au rapport.`);
    });

    $("#generate-report").addEventListener("click", async () => {
      state.currentReportPole = getAllowedPoleFromScope(state.currentReportPole);
      renderReportControls(state);
      renderReportWorkspace(state);
      const format = $("#report-format-select").value;
      const poleOption = $("#report-pole-select").selectedOptions[0];
      const pole = poleOption.textContent.trim();
      const generatedAt = new Date().toLocaleString("fr-FR", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
      const report = {
        id: `RPT-${Date.now().toString().slice(-6)}-${state.currentReportPole}`,
        pole: state.currentReportPole,
        poleName: pole,
        cycle: state.currentReportCycle,
        period: $("#period-filter").value,
        format,
        status: "Brouillon",
        generatedAt,
      };
      let savedReport = report;
      let savedInDatabase = false;
      if (api?.saveReport) {
        try {
          savedReport = await api.saveReport(report);
          savedInDatabase = true;
        } catch (error) {
          console.warn("Enregistrement rapport indisponible.", error);
        }
      }
      state.reportHistory = [
        savedReport,
        ...state.reportHistory,
      ];
      renderReportHistory(state);
      showToast(
        savedInDatabase
          ? `Generation ${format} lancee pour ${pole}. Rapport enregistre dans la base.`
          : `Generation ${format} lancee pour ${pole}. Historique local mis a jour.`
      );
    });

    document.addEventListener("click", (event) => {
      if (event.target?.id === "submit-report") {
        showToast("Rapport soumis au circuit de validation N+1.");
      }
    });

    $("#save-report-comment").addEventListener("click", () => {
      const comment = $("#report-comment").value.trim();
      showToast(comment ? "Commentaire de rapport enregistre." : "Ajoutez un commentaire avant enregistrement.");
    });

    document.querySelectorAll("[data-report-export]").forEach((button) => {
      button.addEventListener("click", () => {
        const context = getCurrentReportContext();
        const slug = `${context.pole.id}-${context.cycle.value}-${context.period}`.replaceAll(" ", "_");
        if (button.dataset.reportExport === "csv") {
          downloadTextFile(`rapport-kpi-${slug}.csv`, buildKpiCsv(context), "text/csv;charset=utf-8");
          showToast("Export CSV des KPI genere.");
          return;
        }
        const payload = {
          pole: context.pole,
          cycle: context.cycle,
          period: context.period,
          format: context.format,
          comment: context.comment,
          kpis: context.kpis,
          generatedAt: new Date().toISOString(),
        };
        downloadTextFile(`rapport-${slug}.json`, JSON.stringify(payload, null, 2), "application/json;charset=utf-8");
        showToast("Export JSON du rapport genere.");
      });
    });

    $("#schedule-report").addEventListener("click", () => {
      const context = getCurrentReportContext();
      showToast(`Diffusion planifiee pour ${context.pole.name} selon le cycle ${context.cycle.value.toLowerCase()}.`);
    });
  }

  function updateAdminKoboStatus(statusId, statusClass, content) {
    const status = $(statusId);
    if (!status) return;
    status.className = `connector-status ${statusClass}`;
    status.innerHTML = content;
  }

  function setAdminTab(tab) {
    state.currentAdminTab = tab;
    document.querySelectorAll("[data-admin-tab]").forEach((button) => {
      button.classList.toggle("active", button.dataset.adminTab === tab);
    });
    document.querySelectorAll("[data-admin-panel]").forEach((panel) => {
      panel.classList.toggle("active", panel.dataset.adminPanel === tab);
    });
  }

  function applyAccessRule(rule) {
    state.activeAccessRuleId = rule.id;
    state.currentPoleMonitor = rule.poleId;
    renderPoleControls(state);
    renderPoleMonitor(state);
    renderAdmin(state);
    setAdminTab("access");
  }

  function bindAdminActions() {
    document.querySelectorAll("[data-admin-tab]").forEach((button) => {
      button.addEventListener("click", () => {
        setAdminTab(button.dataset.adminTab);
      });
    });
    setAdminTab(state.currentAdminTab);

    const adminKoboReferenceButton = $("#admin-kobo-reference-save");
    const adminKoboCalculationButton = $("#admin-kobo-calculation-save");
    const accessProfile = $("#access-profile");
    const saveAccessButton = $("#save-access-rule");
    const createUserButton = $("#create-user");
    const userAccessResponsible = $("#user-access-responsible");
    const userAccessPole = $("#user-access-pole");
    const userAccessProfile = $("#user-access-profile");
    const saveUserAccessButton = $("#save-user-access");
    const getPermissionFormValues = () => {
      const permissions = {};
      document.querySelectorAll("[data-permission-key]").forEach((checkbox) => {
        permissions[checkbox.dataset.permissionKey] = checkbox.checked;
      });
      return permissions;
    };
    const setUserAccessPole = (poleId) => {
      const pole = PMS_DATA.reporting.poles.find((item) => item.id === poleId);
      if (!pole) return;
      state.currentUserAccessPole = pole.id;
      renderAdmin(state);
      setAdminTab("access");
    };
    const setUserAccessUser = (userId) => {
      const user = state.platformUsers.find((item) => String(item.id) === String(userId));
      if (!user) return false;
      state.currentUserAccessUserId = user.id;
      state.currentUserAccessProfile = user.profile || state.currentUserAccessProfile;
      if (user.defaultPoleId) {
        state.currentUserAccessPole = user.defaultPoleId;
      }
      renderAdmin(state);
      setAdminTab("access");
      return true;
    };

    const saveAdminKoboSource = async ({
      role,
      stateKey,
      statusId,
      serverInputId,
      formInputId,
      mode,
      detail,
      successLabel,
      fieldType,
      fields,
    }) => {
      const serverUrl = normalizeKoboServerUrl($(serverInputId).value);
      const formId = $(formInputId).value.trim();
      const mappedFields = Object.fromEntries(
        fields.map((field) => [field.mappedTo, $(field.inputId).value.trim() || field.defaultValue])
      );

      if (!serverUrl || !formId) {
        updateAdminKoboStatus(statusId, "warning", "Renseignez le serveur Kobo et l'ID du formulaire.");
        showToast(`${successLabel} incomplet.`);
        return;
      }

      $(serverInputId).value = serverUrl;
      state[stateKey] = { role, serverUrl, formId, mappedFields };
      if (api?.saveKoboForm) {
        try {
          await api.saveKoboForm({
            mode,
            name: formId,
            origin: serverUrl,
            detail,
            status: "Actif",
            statusClass: "green",
            fields: Object.entries(mappedFields).map(([mappedTo, name]) => ({
              name,
              label: mappedTo,
              type: fieldType,
              mappedTo,
            })),
          });
        } catch (error) {
          console.warn("Enregistrement de la source Kobo indisponible.", error);
        }
      }
      updateAdminKoboStatus(
        statusId,
        "success",
        `<strong>${escapeHtml(formId)}</strong><span>${escapeHtml(serverUrl)} - ${escapeHtml(detail)}</span>`
      );
      renderAdmin(state);
      setAdminTab("kobo");
      showToast(`${successLabel} enregistre.`);
    };

    if (adminKoboReferenceButton) {
      adminKoboReferenceButton.addEventListener("click", () =>
        saveAdminKoboSource({
          role: "referentielKpi",
          stateKey: "objectiveKoboSource",
          statusId: "#admin-kobo-reference-status",
          serverInputId: "#admin-kobo-reference-server",
          formInputId: "#admin-kobo-reference-form-id",
          mode: "KoboCollect Referentiel KPI",
          detail: "KPI, objectifs et formules de calcul par pole.",
          successLabel: "Formulaire KPI et formules",
          fieldType: "Champ referentiel KPI",
          fields: [
            { mappedTo: "id", inputId: "#admin-kobo-reference-id-field", defaultValue: "id_kpi" },
            { mappedTo: "category", inputId: "#admin-kobo-reference-category-field", defaultValue: "categorie_organisationnelle" },
            { mappedTo: "entity", inputId: "#admin-kobo-reference-entity-field", defaultValue: "entite_direction" },
            { mappedTo: "subEntity", inputId: "#admin-kobo-reference-subentity-field", defaultValue: "sous_entite_pole_filiale" },
            { mappedTo: "pole", inputId: "#admin-kobo-reference-pole-field", defaultValue: "groupe_de_rattachement" },
            { mappedTo: "path", inputId: "#admin-kobo-reference-path-field", defaultValue: "chemin_organisationnel" },
            { mappedTo: "title", inputId: "#admin-kobo-reference-title-field", defaultValue: "intitule_du_kpi" },
            { mappedTo: "definition", inputId: "#admin-kobo-reference-definition-field", defaultValue: "description_definition" },
            { mappedTo: "type", inputId: "#admin-kobo-reference-type-field", defaultValue: "type_de_kpi" },
            { mappedTo: "unit", inputId: "#admin-kobo-reference-unit-field", defaultValue: "unite_de_mesure" },
            { mappedTo: "formula", inputId: "#admin-kobo-reference-formula-field", defaultValue: "formule_de_calcul" },
            { mappedTo: "target", inputId: "#admin-kobo-reference-target-field", defaultValue: "valeur_cible" },
            { mappedTo: "collectionFrequency", inputId: "#admin-kobo-reference-collection-frequency-field", defaultValue: "frequence_de_collecte" },
            { mappedTo: "reportingFrequency", inputId: "#admin-kobo-reference-reporting-frequency-field", defaultValue: "periodicite_du_reporting" },
            { mappedTo: "sourceData", inputId: "#admin-kobo-reference-source-field", defaultValue: "source_de_la_donnee" },
            { mappedTo: "owner", inputId: "#admin-kobo-reference-owner-field", defaultValue: "responsable_du_kpi" },
            { mappedTo: "respondent", inputId: "#admin-kobo-reference-respondent-field", defaultValue: "repondant" },
            { mappedTo: "respondentFunction", inputId: "#admin-kobo-reference-respondent-function-field", defaultValue: "fonction_du_repondant" },
            { mappedTo: "year", inputId: "#admin-kobo-reference-year-field", defaultValue: "annee" },
            { mappedTo: "validation", inputId: "#admin-kobo-reference-validation-field", defaultValue: "validation_hierarchique" },
            { mappedTo: "validator", inputId: "#admin-kobo-reference-validator-field", defaultValue: "validateur" },
            { mappedTo: "comments", inputId: "#admin-kobo-reference-comments-field", defaultValue: "commentaires" },
            { mappedTo: "submittedAt", inputId: "#admin-kobo-reference-submitted-at-field", defaultValue: "date_de_soumission" },
            { mappedTo: "sourceReference", inputId: "#admin-kobo-reference-source-reference-field", defaultValue: "reference_source" },
            { mappedTo: "documentStatus", inputId: "#admin-kobo-reference-document-status-field", defaultValue: "statut_documentaire" },
            { mappedTo: "attention", inputId: "#admin-kobo-reference-attention-field", defaultValue: "points_d_attention" },
          ],
        })
      );
    }

    if (adminKoboCalculationButton) {
      adminKoboCalculationButton.addEventListener("click", () =>
        saveAdminKoboSource({
          role: "donneesCalcul",
          stateKey: "calculationKoboSource",
          statusId: "#admin-kobo-calculation-status",
          serverInputId: "#admin-kobo-calculation-server",
          formInputId: "#admin-kobo-calculation-form-id",
          mode: "KoboCollect Donnees de calcul",
          detail: "Elements bruts utilises pour calculer les KPI.",
          successLabel: "Formulaire donnees de calcul",
          fieldType: "Champ donnees de calcul",
          fields: [
            { mappedTo: "pole", inputId: "#admin-kobo-calculation-pole-field", defaultValue: "pole_id" },
            { mappedTo: "kpi", inputId: "#admin-kobo-calculation-kpi-field", defaultValue: "id_kpi" },
            { mappedTo: "period", inputId: "#admin-kobo-calculation-period-field", defaultValue: "periode_reporting" },
            { mappedTo: "element", inputId: "#admin-kobo-calculation-element-field", defaultValue: "element_id" },
            { mappedTo: "value", inputId: "#admin-kobo-calculation-value-field", defaultValue: "valeur_element" },
            { mappedTo: "branch", inputId: "#admin-kobo-calculation-branch-field", defaultValue: "filiale" },
            { mappedTo: "date", inputId: "#admin-kobo-calculation-date-field", defaultValue: "date_collecte" },
            { mappedTo: "validation", inputId: "#admin-kobo-calculation-validation-field", defaultValue: "validation_hierarchique" },
          ],
        })
      );
    }

    if (accessProfile) {
      accessProfile.addEventListener("change", (event) => {
        state.currentAccessProfile = event.target.value;
        renderAdmin(state);
        showToast(`Profil ${event.target.value} selectionne.`);
      });
    }

    if (saveAccessButton) {
      saveAccessButton.addEventListener("click", async () => {
        const profile = accessProfile?.value || state.currentAccessProfile;
        if (!profile) {
          showToast("Selectionnez un profil avant d'enregistrer les droits.");
          return;
        }

        const permissions = getPermissionFormValues();
        const existingRole = state.platformAccessRoles.some((role) => role.profile === profile);
        state.platformAccessRoles = existingRole
          ? state.platformAccessRoles.map((role) => (role.profile === profile ? { ...role, permissions } : role))
          : [...state.platformAccessRoles, { profile, permissions }];
        state.currentAccessProfile = profile;
        let savedInDatabase = false;
        if (api?.saveProfilePermissions) {
          try {
            const savedProfiles = await api.saveProfilePermissions(profile, permissions);
            if (Array.isArray(savedProfiles) && savedProfiles.length) {
              state.platformAccessRoles = savedProfiles;
            }
            savedInDatabase = true;
          } catch (error) {
            console.warn("Enregistrement des droits indisponible.", error);
          }
        }

        renderAdmin(state);
        setAdminTab("access");
        showToast(
          savedInDatabase
            ? `Droits du profil ${profile} enregistres dans la base.`
            : `Droits du profil ${profile} enregistres en local.`
        );
      });
    }

    if (createUserButton) {
      createUserButton.addEventListener("click", async () => {
        const fullName = $("#new-user-full-name")?.value.trim();
        const email = $("#new-user-email")?.value.trim();
        const phone = $("#new-user-phone")?.value.trim();
        const password = $("#new-user-password")?.value.trim();
        const profile = $("#new-user-profile")?.value || state.currentUserAccessProfile;
        const status = $("#new-user-status")?.value || "Actif";
        const poleId = $("#new-user-pole")?.value || state.currentUserAccessPole;
        const pole = PMS_DATA.reporting.poles.find((item) => item.id === poleId) || PMS_DATA.reporting.poles[0];

        if (!fullName) {
          showToast("Renseignez le nom complet de l'utilisateur.");
          return;
        }

        if (!password || password.length < 8) {
          showToast("Definissez un mot de passe temporaire d'au moins 8 caracteres.");
          return;
        }

        if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          showToast("Email utilisateur a verifier.");
          return;
        }

        const user = {
          id: `local-${Date.now().toString().slice(-6)}`,
          fullName,
          email,
          phone,
          profile,
          status,
          defaultPoleId: pole.id,
          defaultPoleName: pole.name,
        };
        let savedUser = user;
        let savedInDatabase = false;
        if (api?.createUser) {
          try {
            const response = await api.createUser({ ...user, password });
            savedUser = {
              ...user,
              ...response,
              defaultPoleId: response.defaultPoleId || user.defaultPoleId,
              defaultPoleName: response.defaultPoleName || user.defaultPoleName,
            };
            savedInDatabase = true;
          } catch (error) {
            console.warn("Creation utilisateur indisponible.", error);
          }
        }

        state.platformUsers = [
          savedUser,
          ...state.platformUsers.filter(
            (item) =>
              String(item.id) !== String(savedUser.id) &&
              (!savedUser.email || String(item.email).toLowerCase() !== String(savedUser.email).toLowerCase())
          ),
        ];
        state.currentUserAccessUserId = savedUser.id;
        state.currentUserAccessPole = savedUser.defaultPoleId || pole.id;
        state.currentUserAccessProfile = savedUser.profile || profile;

        $("#new-user-full-name").value = "";
        $("#new-user-email").value = "";
        $("#new-user-phone").value = "";
        $("#new-user-password").value = "";
        renderAdmin(state);
        setAdminTab("access");
        showToast(
          savedInDatabase
            ? `Utilisateur cree dans la base: ${savedUser.fullName}.`
            : `Utilisateur cree en local: ${savedUser.fullName}.`
        );
      });
    }

    if (userAccessResponsible) {
      userAccessResponsible.addEventListener("change", (event) => {
        const selectedOption = event.target.selectedOptions?.[0];
        const selectedUser = state.platformUsers.find((item) => String(item.id) === String(event.target.value));
        if (selectedUser) {
          state.currentUserAccessUserId = selectedUser.id;
          state.currentUserAccessProfile = selectedUser.profile || state.currentUserAccessProfile;
          const poleId = selectedOption?.dataset?.poleId || selectedUser.defaultPoleId;
          if (poleId) {
            state.currentUserAccessPole = poleId;
          }
          renderAdmin(state);
          setAdminTab("access");
        } else {
          setUserAccessPole(event.target.value);
        }
        showToast("Responsable selectionne pour affectation.");
      });
    }

    if (userAccessPole) {
      userAccessPole.addEventListener("change", (event) => {
        setUserAccessPole(event.target.value);
        showToast("Pole selectionne pour affectation.");
      });
    }

    if (userAccessProfile) {
      userAccessProfile.addEventListener("change", (event) => {
        state.currentUserAccessProfile = event.target.value;
        renderAdmin(state);
        setAdminTab("access");
        showToast(`Profil ${event.target.value} choisi pour le responsable.`);
      });
    }

    if (saveUserAccessButton) {
      saveUserAccessButton.addEventListener("click", async () => {
        const poleId = $("#user-access-pole")?.value || state.currentUserAccessPole;
        const pole = PMS_DATA.reporting.poles.find((item) => item.id === poleId);
        const responsibleOption = $("#user-access-responsible")?.selectedOptions?.[0];
        const selectedUserId = $("#user-access-responsible")?.value || state.currentUserAccessUserId;
        const selectedUser = state.platformUsers.find((item) => String(item.id) === String(selectedUserId));
        const responsible =
          selectedUser?.fullName || responsibleOption?.textContent.trim().split(" - ")[0] || pole?.owner || "";
        const role = $("#user-access-profile")?.value || state.currentUserAccessProfile;

        if (!pole || !responsible || !role) {
          showToast("Choisissez le responsable, le pole et le profil avant d'enregistrer.");
          return;
        }

        const existingRule = state.accessRules.find(
          (rule) =>
            rule.poleId === pole.id &&
            (String(rule.userId || "") === String(selectedUser?.id || selectedUserId) || rule.responsible === responsible)
        );
        const rule = {
          id: existingRule?.id || `ACC-${pole.id}-${Date.now().toString().slice(-6)}`,
          userId: selectedUser?.id || selectedUserId,
          responsible,
          email: selectedUser?.email || responsibleOption?.dataset?.email || "",
          phone: selectedUser?.phone || responsibleOption?.dataset?.phone || "",
          poleId: pole.id,
          poleName: pole.name,
          role,
          dashboardScope: `Dashboard Suivi KPI - ${pole.name}`,
          permission: "Acces limite au dashboard de son pole",
          status: "Actif",
          className: "green",
        };
        let savedRule = rule;
        let savedInDatabase = false;
        if (api?.saveUserAccess) {
          try {
            savedRule = { ...rule, ...(await api.saveUserAccess(rule)) };
            savedInDatabase = true;
          } catch (error) {
            console.warn("Enregistrement de l'affectation indisponible.", error);
          }
        }

        state.accessRules = [
          savedRule,
          ...state.accessRules.filter(
            (item) =>
              item.id !== savedRule.id &&
              !(item.poleId === savedRule.poleId && item.responsible === savedRule.responsible)
          ),
        ];
        state.platformUsers = state.platformUsers.map((user) =>
          String(user.id) === String(savedRule.userId)
            ? {
                ...user,
                profile: savedRule.role,
                defaultPoleId: savedRule.poleId,
                defaultPoleName: savedRule.poleName,
                status: "Actif",
              }
            : user
        );
        state.currentUserAccessUserId = savedRule.userId || selectedUserId;
        state.currentUserAccessPole = savedRule.poleId;
        state.currentUserAccessProfile = savedRule.role;
        state.activeAccessRuleId = savedRule.id;
        renderPoleControls(state);
        renderPoleMonitor(state);
        renderReportControls(state);
        renderAdmin(state);
        setAdminTab("access");
        showToast(
          savedInDatabase
            ? `Acces enregistre dans la base: ${savedRule.responsible} - ${savedRule.poleName} - ${savedRule.role}.`
            : `Acces enregistre en local: ${responsible} - ${pole.name} - ${role}.`
        );
      });
    }

    document.addEventListener("click", (event) => {
      const button = event.target.closest("[data-select-access-profile]");
      if (!button) return;
      const profile = button.dataset.selectAccessProfile;
      const role = state.platformAccessRoles.find((item) => item.profile === profile);
      if (!role) {
        showToast("Profil d'acces introuvable.");
        return;
      }
      state.currentAccessProfile = role.profile;
      renderAdmin(state);
      setAdminTab("access");
      showToast(`Profil ${role.profile} pret pour modification.`);
    });

    document.addEventListener("click", (event) => {
      const button = event.target.closest("[data-edit-user-access]");
      if (!button) return;
      const rule = state.accessRules.find((item) => item.id === button.dataset.editUserAccess);
      if (!rule) {
        showToast("Affectation utilisateur introuvable.");
        return;
      }
      state.currentUserAccessPole = rule.poleId;
      state.currentUserAccessProfile = rule.role;
      state.activeAccessRuleId = rule.id;
      renderPoleControls(state);
      renderPoleMonitor(state);
      renderAdmin(state);
      setAdminTab("access");
      showToast(`Affectation chargee: ${rule.responsible}.`);
    });
  }

  async function init() {
    await hydrateFromDatabase();
    renderAll(state);
    document.body.classList.add("dashboard-mode");
    bindNavigation();
    bindAuthActions();
    bindKoboActions();
    renderKoboActiveForm();
    bindFilters();
    bindPoleMonitoring();
    bindReporting();
    bindAdminActions();
    const savedSession = loadSavedSession();
    if (savedSession) {
      applyAuthenticatedSession(savedSession, { toast: false });
    } else {
      showLogin();
    }
  }

  init();
})();
