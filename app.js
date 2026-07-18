(function () {
  const { PMS_DATA, PMS_RENDERERS } = window;
  const api = window.PMS_API;
  const {
    $,
    renderAll,
    renderKoboTable,
    renderKpiTable,
    renderCalendarSlicer,
    renderCountryDashboard,
    renderAdvancedDashboard,
    renderPoleSummaryTables,
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
      defaultBranch: "Groupe",
    }));
  }

  const reportingBaseline = JSON.parse(JSON.stringify(PMS_DATA.reporting));

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function resetReportingToBaseline() {
    Object.keys(PMS_DATA.reporting).forEach((key) => {
      delete PMS_DATA.reporting[key];
    });
    Object.assign(PMS_DATA.reporting, clone(reportingBaseline));
  }

  function statusLabel(status) {
    if (status === "green") return "Valide";
    if (status === "amber") return "A surveiller";
    if (status === "red") return "Plan requis";
    return "A verifier";
  }

  function scoreFromKpis(kpis) {
    if (!kpis.length) return 0;
    const weights = { green: 100, amber: 70, red: 35, gray: 50 };
    const score = kpis.reduce((sum, kpi) => sum + (weights[kpi.status] || 50), 0) / kpis.length;
    return Math.round(score);
  }

  function normalizeLookup(value) {
    return String(value ?? "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  }

  function resolveFormulaPoleId(direction) {
    const normalized = normalizeLookup(direction).toUpperCase();
    const aliases = {
      "POLE EPC": "EPC",
      EPC: "EPC",
      DCM: "GDC",
      CONSOLIDE: "PAC",
    };
    return aliases[normalized] || normalized;
  }

  function upsertKpiItem(byPole, poleId, item) {
    const items = byPole.get(poleId) || [];
    const itemId = normalizeLookup(item.id).replace(/^form\s+/, "");
    const itemName = normalizeLookup(item.name);
    const existingIndex = items.findIndex((existing) => {
      const existingId = normalizeLookup(existing.id).replace(/^form\s+/, "");
      const existingName = normalizeLookup(existing.name);
      return (itemId && existingId === itemId) || (itemName && existingName === itemName);
    });

    if (existingIndex >= 0) {
      items[existingIndex] = { ...items[existingIndex], ...item };
    } else {
      items.push(item);
    }
    byPole.set(poleId, items);
  }

  function refreshPoleMetrics(poleId, kpis, options = {}) {
    const pole = PMS_DATA.reporting.poles.find((item) => item.id === poleId);
    if (!pole || !kpis.length) return;
    const cadenceProfile = PMS_DATA.collectionCadenceByPole?.[poleId] || {};
    const redCount = kpis.filter((item) => item.status === "red").length;
    const amberCount = kpis.filter((item) => item.status === "amber").length;
    const grayCount = kpis.filter((item) => item.status === "gray").length;
    const score = scoreFromKpis(kpis);
    pole.kpiCount = kpis.length;
    pole.collectionCadence = options.collectionCadence || pole.collectionCadence || cadenceProfile.cadence || "Selon referentiel KPI";
    pole.collectionPrimary = options.collectionPrimary || pole.collectionPrimary || cadenceProfile.primary || "A preciser";
    pole.collectionSourceSheet = options.collectionSourceSheet || pole.collectionSourceSheet || cadenceProfile.sourceSheet || "";
    pole.collectionExpectedDelay = options.collectionExpectedDelay || pole.collectionExpectedDelay || cadenceProfile.expectedDelay || "";
    pole.score = score;
    pole.rag = redCount ? "red" : amberCount ? "amber" : grayCount ? "gray" : "green";
    pole.status = statusLabel(pole.rag);
    pole.lastReport = options.lastReport || pole.lastReport || "Reference fichier collecte";
    pole.quality = options.quality ?? pole.quality ?? 0;
    pole.readiness = options.readiness ?? score;
    pole.lateSubmissions = options.lateSubmissions ?? pole.lateSubmissions ?? 0;
  }

  function seedFormulaDictionaryToReporting() {
    const formulas = Array.isArray(PMS_DATA.formulaDictionary) ? PMS_DATA.formulaDictionary : [];
    const byPole = new Map();

    formulas.forEach((formula) => {
      const poleId = resolveFormulaPoleId(formula.direction);
      if (!PMS_DATA.reporting.poles.some((pole) => pole.id === poleId)) return;
      upsertKpiItem(byPole, poleId, {
        id: `FORM-${formula.id}`,
        name: formula.name,
        value: "En attente Kobo",
        target: formula.target || "A completer",
        trend: formula.frequency || "A synchroniser",
        status: "gray",
        source: formula.source || "GMC_FICHE_COLLECTE_V2.xlsx",
        collectionFrequency: formula.frequency || PMS_DATA.collectionCadenceByPole?.[poleId]?.cadence || "A preciser",
        reportingFrequency: PMS_DATA.collectionCadenceByPole?.[poleId]?.primary || formula.frequency || "A preciser",
        calculated: false,
        pendingCalculation: true,
        period: "A collecter",
        formula: formula.formula || "Formule a completer",
        method: "Reference fichier collecte, donnees Kobo attendues",
        category: formula.category,
      });
    });

    byPole.forEach((kpis, poleId) => {
      PMS_DATA.reporting.kpisByPole[poleId] = kpis;
      refreshPoleMetrics(poleId, kpis, {
        lastReport: "Reference fichier collecte",
        readiness: 0,
      });
    });
  }

  function latestPeriod(results) {
    const latest = [...results]
      .filter((item) => item.period || item.periodEnd)
      .sort((left, right) => periodSortValue(left.periodEnd || left.period) - periodSortValue(right.periodEnd || right.period))
      .pop();
    return latest?.period || "";
  }

  function periodSortValue(period) {
    const value = String(period || "").trim();
    const compactDate = value.match(/\b(20\d{2})(\d{2})(\d{2})\b/);
    if (compactDate) {
      return new Date(Number(compactDate[1]), Number(compactDate[2]) - 1, Number(compactDate[3])).getTime();
    }
    const isoDate = value.match(/\b(20\d{2})[-/](\d{1,2})[-/](\d{1,2})\b/);
    if (isoDate) {
      return new Date(Number(isoDate[1]), Number(isoDate[2]) - 1, Number(isoDate[3])).getTime();
    }
    const week = normalizeLookup(value).match(/\b(?:s|w|semaine)\s*(\d{1,2})\s*(20\d{2})\b/);
    if (week) {
      return new Date(Number(week[2]), 0, 1 + (Number(week[1]) - 1) * 7).getTime();
    }
    const monthIndex = {
      janvier: 0,
      fevrier: 1,
      mars: 2,
      avril: 3,
      mai: 4,
      juin: 5,
      juillet: 6,
      aout: 7,
      septembre: 8,
      octobre: 9,
      novembre: 10,
      decembre: 11,
    };
    const normalized = normalizeLookup(value);
    const monthName = Object.keys(monthIndex).find((month) => normalized.includes(month));
    const year = normalized.match(/\b(20\d{2})\b/);
    if (monthName && year) {
      return new Date(Number(year[1]), monthIndex[monthName], 1).getTime();
    }
    return 0;
  }

  function kpiHistoryKey(item = {}) {
    return `${item.poleId || ""}:${normalizeLookup(item.kpiId || item.kpiName || item.name)}`;
  }

  function toIsoDate(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function fromIsoDate(value) {
    const [year, month, day] = String(value || "")
      .split("-")
      .map((part) => Number(part));
    if (!year || !month || !day) return null;
    return new Date(year, month - 1, day);
  }

  function periodDateFromText(period) {
    const value = String(period || "").trim();
    const compactDate = value.match(/\b(20\d{2})(\d{2})(\d{2})\b/);
    if (compactDate) return new Date(Number(compactDate[1]), Number(compactDate[2]) - 1, Number(compactDate[3]));
    const isoDate = value.match(/\b(20\d{2})[-/](\d{1,2})[-/](\d{1,2})\b/);
    if (isoDate) return new Date(Number(isoDate[1]), Number(isoDate[2]) - 1, Number(isoDate[3]));
    const dmyDate = value.match(/\b(\d{1,2})[-/](\d{1,2})[-/](20\d{2})\b/);
    if (dmyDate) return new Date(Number(dmyDate[3]), Number(dmyDate[2]) - 1, Number(dmyDate[1]));
    return null;
  }

  function resultMatchesCalendar(result = {}, calendar = {}) {
    const calendarStart = fromIsoDate(calendar.start);
    const calendarEnd = fromIsoDate(calendar.end);
    if (!calendarStart || !calendarEnd) return true;

    const startIso = toIsoDate(calendarStart);
    const endIso = toIsoDate(calendarEnd);
    const resultStart = fromIsoDate(result.periodStart);
    const resultEnd = fromIsoDate(result.periodEnd);

    if (resultStart && resultEnd) {
      return toIsoDate(resultStart) === startIso && toIsoDate(resultEnd) === endIso;
    }

    const periodText = String(result.period || "");
    if (periodText.includes(startIso) && periodText.includes(endIso)) return true;
    if (normalizeLookup(periodText) === normalizeLookup(calendar.label)) return true;

    const periodDate = periodDateFromText(result.period);
    if (!periodDate) return false;
    const periodIso = toIsoDate(periodDate);
    if (calendar.preset === "monthToDate") {
      return startIso === endIso && periodIso === startIso;
    }
    return periodIso >= startIso && periodIso <= endIso;
  }

  function calendarScopedResults(results = [], calendar = {}) {
    if (!calendar?.start || !calendar?.end) return results;
    const matches = results.filter((result) => resultMatchesCalendar(result, calendar));
    if (calendar.preset === "monthToDate") {
      const cumulativeMatches = matches.filter((result) => result.periodType === "monthToDate");
      return cumulativeMatches.length ? cumulativeMatches : matches;
    }
    return matches;
  }

  function addCalendarDays(date, days) {
    const next = new Date(date);
    next.setDate(next.getDate() + days);
    return next;
  }

  function endOfMonth(date) {
    return new Date(date.getFullYear(), date.getMonth() + 1, 0);
  }

  function startOfWeek(date) {
    const day = (date.getDay() + 6) % 7;
    return addCalendarDays(date, -day);
  }

  function formatMonthLabel(date) {
    return date.toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
  }

  function parseCompactDate(value) {
    const digits = String(value || "").replace(/\D/g, "");
    if (digits.length !== 8) return null;
    const year = Number(digits.slice(0, 4));
    const month = Number(digits.slice(4, 6));
    const day = Number(digits.slice(6, 8));
    const date = new Date(year, month - 1, day);
    if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
      return null;
    }
    return date;
  }

  function buildCalendarSelection(preset = "month", anchorDate = new Date()) {
    const anchor = new Date(anchorDate.getFullYear(), anchorDate.getMonth(), anchorDate.getDate());
    let start = anchor;
    let end = anchor;
    let label = "Periode personnalisee";

    if (preset === "today") {
      label = "Aujourd'hui";
    } else if (preset === "week") {
      start = startOfWeek(anchor);
      end = addCalendarDays(start, 6);
      label = `Semaine du ${start.toLocaleDateString("fr-FR", { day: "2-digit", month: "short" })}`;
    } else if (preset === "quarter") {
      const quarterStartMonth = Math.floor(anchor.getMonth() / 3) * 3;
      start = new Date(anchor.getFullYear(), quarterStartMonth, 1);
      end = new Date(anchor.getFullYear(), quarterStartMonth + 3, 0);
      label = `T${Math.floor(anchor.getMonth() / 3) + 1} ${anchor.getFullYear()}`;
    } else if (preset === "year") {
      start = new Date(anchor.getFullYear(), 0, 1);
      end = new Date(anchor.getFullYear(), 11, 31);
      label = `Annuel ${anchor.getFullYear()}`;
    } else {
      start = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
      end = endOfMonth(anchor);
      label = formatMonthLabel(anchor).replace(/^\w/, (letter) => letter.toUpperCase());
      preset = "month";
    }

    return {
      preset,
      start: toIsoDate(start),
      end: toIsoDate(end),
      selectedDate: toIsoDate(anchor),
      label,
      viewYear: anchor.getFullYear(),
      viewMonth: anchor.getMonth(),
    };
  }

  function buildMonthToDateSelection(anchorDate = new Date()) {
    const anchor = new Date(anchorDate.getFullYear(), anchorDate.getMonth(), anchorDate.getDate());
    const start = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
    const anchorLabel = anchor.toLocaleDateString("fr-FR", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });

    return {
      preset: "monthToDate",
      start: toIsoDate(start),
      end: toIsoDate(anchor),
      selectedDate: toIsoDate(anchor),
      label: start.getTime() === anchor.getTime() ? `Jour du ${anchorLabel}` : `Cumul du 01 au ${anchorLabel}`,
      viewYear: anchor.getFullYear(),
      viewMonth: anchor.getMonth(),
    };
  }

  function cycleFromCalendarPreset(preset) {
    if (preset === "today" || preset === "monthToDate") return "Journalier";
    if (preset === "week") return "Hebdomadaire";
    if (preset === "quarter") return "Trimestriel";
    if (preset === "year") return "Annuel";
    return "Mensuel";
  }

  function presetFromCycle(cycle) {
    if (cycle === "Journalier") return "today";
    if (cycle === "Hebdomadaire") return "week";
    if (cycle === "Trimestriel") return "quarter";
    if (cycle === "Annuel") return "year";
    return "month";
  }

  function syncPeriodFilterFromCalendar() {
    const select = $("#period-filter");
    if (!select || !state.calendar?.label) return;
    const value = state.calendar.label;
    if (![...select.options].some((option) => option.value === value)) {
      select.add(new Option(value, value), 0);
    }
    select.value = value;
  }

  function applyCalculatedKpisToReporting() {
    resetReportingToBaseline();
    seedFormulaDictionaryToReporting();
    const results = Array.isArray(state.kpiCalculationResults) ? state.kpiCalculationResults : [];
    const referenceKpis = Array.isArray(state.kpiCalculationQuality?.referenceKpis)
      ? state.kpiCalculationQuality.referenceKpis
      : [];
    if (!results.length && !referenceKpis.length) return;

    const sortedResults = [...results].sort(
      (left, right) => periodSortValue(left.periodEnd || left.periodStart || left.period) - periodSortValue(right.periodEnd || right.periodStart || right.period)
    );
    const scopedResults = calendarScopedResults(sortedResults, state.calendar);
    const historyByKpi = new Map();
    sortedResults.forEach((result) => {
      const key = kpiHistoryKey(result);
      if (!key || key === ":") return;
      const history = historyByKpi.get(key) || [];
      history.push({
        period: result.periodEnd || result.period,
        value: result.value,
        valueLabel: result.valueLabel,
        target: result.target,
        status: result.status,
      });
      historyByKpi.set(key, history);
    });

    const byPole = new Map(
      PMS_DATA.reporting.poles.map((pole) => [pole.id, [...(PMS_DATA.reporting.kpisByPole[pole.id] || [])]])
    );
    const calculatedKeys = new Set(scopedResults.map((result) => `${result.poleId}:${result.kpiId}`));
    referenceKpis
      .filter((kpi) => !calculatedKeys.has(`${kpi.poleId}:${kpi.kpiId}`))
      .forEach((kpi) => {
        if (!kpi.poleId) return;
        upsertKpiItem(byPole, kpi.poleId, {
          id: kpi.kpiId,
          name: kpi.kpiName,
          value: kpi.valueLabel || "En attente calcul",
          target: kpi.target || "A completer",
          trend: "Reference Kobo",
          status: "gray",
          source: kpi.source || "KoboCollect",
          collectionFrequency: kpi.collectionFrequency || PMS_DATA.collectionCadenceByPole?.[kpi.poleId]?.cadence || "A preciser",
          reportingFrequency: kpi.reportingFrequency || PMS_DATA.collectionCadenceByPole?.[kpi.poleId]?.primary || "A preciser",
          calculated: false,
          pendingCalculation: true,
          period: "A calculer",
          formula: kpi.formula,
          method: kpi.method || "Donnees de calcul attendues",
          trendHistory: historyByKpi.get(kpiHistoryKey(kpi)) || [],
        });
      });

    scopedResults.forEach((result) => {
      if (!result.poleId) return;
      const selectedEnd = fromIsoDate(state.calendar?.end);
      const scopedHistory = (historyByKpi.get(kpiHistoryKey(result)) || []).filter((point) => {
        const pointDate = periodDateFromText(point.period);
        return !selectedEnd || !pointDate || pointDate <= selectedEnd;
      });
      upsertKpiItem(byPole, result.poleId, {
        id: result.kpiId,
        name: result.kpiName,
        value: result.valueLabel,
        target: result.target || "A completer",
        trend: result.trend || "Calcul Kobo",
        status: result.status || "gray",
        source: result.source || "KoboCollect",
        collectionFrequency: result.collectionFrequency || PMS_DATA.collectionCadenceByPole?.[result.poleId]?.cadence || "A preciser",
        reportingFrequency: result.reportingFrequency || PMS_DATA.collectionCadenceByPole?.[result.poleId]?.primary || "A preciser",
        calculated: true,
        period: state.calendar?.label || result.period,
        formula: result.formula,
        method: result.method,
        elementsCount: result.elementsCount,
        trendHistory: scopedHistory,
      });
    });

    byPole.forEach((kpis, poleId) => {
      PMS_DATA.reporting.kpisByPole[poleId] = kpis;
      const matchRate = Number(state.kpiCalculationQuality?.matchRate);
      const calculationRate = Number(state.kpiCalculationQuality?.calculationRate);
      refreshPoleMetrics(poleId, kpis, {
        quality: Number.isFinite(matchRate) ? matchRate : undefined,
        readiness: Number.isFinite(calculationRate) ? calculationRate : undefined,
        lastReport: latestPeriod(scopedResults.filter((item) => item.poleId === poleId)) || state.calendar?.label || "Reference Kobo",
        lateSubmissions: state.kpiCalculationQuality?.unmatchedCalculationCount || 0,
      });
    });
  }

  const state = {
    koboSubmissions: JSON.parse(JSON.stringify(PMS_DATA.koboSubmissions)),
    validationQueue: JSON.parse(JSON.stringify(PMS_DATA.validationQueue)),
    reportHistory: JSON.parse(JSON.stringify(PMS_DATA.reporting.history)),
    koboActiveForm: null,
    kpiCalculationResults: [],
    kpiCalculationQuality: null,
    kpiObjectives: [],
    calendar: buildMonthToDateSelection(new Date()),
    actorScope: "responsable",
    calendarPoleFilter: PMS_DATA.reporting.defaultPole,
    calendarBranchFilter: "Groupe",
    calendarStatusFilter: "Tous",
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
      branch: "Groupe",
      countryName: "Groupe",
      role: "Manager / Responsable",
      dashboardScope: `Dashboard Suivi KPI - Groupe - ${pole.name}`,
      permission: `Acces limite a Groupe / ${pole.name}`,
      status: "Actif",
      className: "green",
    })),
    currentPoleMonitor: PMS_DATA.reporting.defaultPole,
    currentPoleCycle: PMS_DATA.reporting.defaultCycle,
    currentPoleFrequency: "Tous",
    currentDashboardKpiKey: "",
    currentReportPole: PMS_DATA.reporting.defaultPole,
    currentReportCycle: PMS_DATA.reporting.defaultCycle,
    currentAdminPole: PMS_DATA.reporting.defaultPole,
    currentAdminKpi: null,
    currentAdminTab: "objectives",
    currentAdminAccessPole: PMS_DATA.reporting.defaultPole,
    currentAccessProfile: "Administrateur",
    currentUserAccessUserId: `seed-${PMS_DATA.reporting.defaultPole}`,
    currentUserAccessBranch: "Groupe",
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
        state.currentUserAccessBranch = activeRule.branch || activeRule.countryName || "Groupe";
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
    if (Array.isArray(payload.koboSubmissions)) {
      state.koboSubmissions = payload.koboSubmissions;
    }
    if (Array.isArray(payload.kpiCalculationResults)) {
      state.kpiCalculationResults = payload.kpiCalculationResults;
    }
    if (payload.kpiCalculationQuality) {
      state.kpiCalculationQuality = payload.kpiCalculationQuality;
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
    applyCalculatedKpisToReporting();
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

  function countryOptions() {
    return Array.isArray(PMS_DATA.countries)
      ? PMS_DATA.countries
      : [{ id: "Groupe", code: "GROUPE", name: "Groupe" }];
  }

  function countryValueFromRule(rule = {}) {
    return rule.branch || rule.countryName || rule.country || "Groupe";
  }

  function findCountryName(value) {
    const normalized = normalizeLookup(value || "Groupe");
    return (
      countryOptions().find((country) =>
        [country.id, country.code, country.name].some((item) => normalizeLookup(item) === normalized)
      )?.name || value || "Groupe"
    );
  }

  function isGroupCountryValue(value) {
    return normalizeLookup(value) === "groupe";
  }

  function countryMatches(ruleCountry, activeCountry) {
    const ruleName = findCountryName(ruleCountry);
    const activeName = findCountryName(activeCountry);
    if (isGroupCountryValue(ruleName)) return true;
    if (isGroupCountryValue(activeName)) return false;
    return normalizeLookup(ruleName) === normalizeLookup(activeName);
  }

  function getAuthorizedCountries() {
    if (!state.currentUser || state.currentPermissions?.administration) {
      return countryOptions().map((country) => country.name);
    }
    const scope = Array.isArray(state.userAccessScope) ? state.userAccessScope : [];
    if (!scope.length) return [];
    if (scope.some((rule) => isGroupCountryValue(countryValueFromRule(rule)))) {
      return countryOptions().map((country) => country.name);
    }
    return [
      ...new Set(
        scope
          .map((rule) => findCountryName(countryValueFromRule(rule)))
          .filter((country) => !isGroupCountryValue(country))
      ),
    ];
  }

  function ensureAllowedCountry(countryValue) {
    const country = findCountryName(countryValue || "Groupe");
    const authorizedCountries = getAuthorizedCountries();
    if (!authorizedCountries.length || authorizedCountries.some((item) => normalizeLookup(item) === normalizeLookup(country))) {
      return country;
    }
    return authorizedCountries[0] || country;
  }

  function getAuthorizedPoleIds(countryValue = state.calendarBranchFilter) {
    if (!state.currentUser || state.currentPermissions?.administration) {
      return PMS_DATA.reporting.poles.map((pole) => pole.id);
    }
    const scope = Array.isArray(state.userAccessScope) ? state.userAccessScope : [];
    const activeCountry = ensureAllowedCountry(countryValue);
    return [
      ...new Set(
        scope
          .filter((rule) => countryMatches(countryValueFromRule(rule), activeCountry))
          .map((rule) => rule.poleId)
          .filter(Boolean)
      ),
    ];
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
    state.currentUserAccessBranch = firstAccess.branch || firstAccess.countryName || "Groupe";
    state.calendarBranchFilter = ensureAllowedCountry(state.currentUserAccessBranch);
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
    syncPeriodFilterFromCalendar();
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

  function bindDashboardActions() {
    document.addEventListener("click", (event) => {
      const detailButton = event.target.closest("[data-dashboard-kpi-detail]");
      if (!detailButton) return;
      state.currentDashboardKpiKey = detailButton.dataset.dashboardKpiDetail;
      renderAdvancedDashboard(state);
      document.getElementById("dashboard-detail-preview")?.scrollIntoView({ behavior: "smooth", block: "center" });
      showToast("Detail KPI charge dans le tableau de bord.");
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
        if (Array.isArray(result.kpiCalculationResults)) {
          state.kpiCalculationResults = result.kpiCalculationResults;
        }
        if (result.kpiCalculationQuality) {
          state.kpiCalculationQuality = result.kpiCalculationQuality;
        }
        applyCalculatedKpisToReporting();
        renderAll(state);
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

  function applyCalendarSelection(calendar, toastMessage) {
    state.calendar = calendar;
    const reportingCycle = cycleFromCalendarPreset(calendar.preset);
    state.currentPoleCycle = reportingCycle;
    state.currentReportCycle = reportingCycle;
    syncPeriodFilterFromCalendar();
    applyCalculatedKpisToReporting();
    renderCalendarSlicer(state);
    renderPoleControls(state);
    renderPoleMonitor(state);
    renderReportControls(state);
    renderReportWorkspace(state);
    if (toastMessage) showToast(toastMessage);
  }

  function applyCountryScope(countryValue, toastMessage) {
    state.calendarBranchFilter = ensureAllowedCountry(countryValue || "Groupe");
    renderCalendarSlicer(state);
    renderCountryDashboard(state);
    renderAdvancedDashboard(state);
    renderPoleSummaryTables(state);
    renderPoleControls(state);
    renderPoleMonitor(state);
    renderReportControls(state);
    renderReportWorkspace(state);
    renderKoboTable("", state.koboSubmissions, state.calendarBranchFilter);
    if (toastMessage) showToast(toastMessage.replace(countryValue || "Groupe", state.calendarBranchFilter));
  }

  function setCalendarView(offset) {
    const current = state.calendar || buildCalendarSelection("month", new Date());
    const nextView = new Date(current.viewYear, current.viewMonth + offset, 1);
    state.calendar = {
      ...current,
      viewYear: nextView.getFullYear(),
      viewMonth: nextView.getMonth(),
    };
    renderCalendarSlicer(state);
  }

  function bindCalendarActions() {
    const slicer = $("#calendar-slicer");
    if (!slicer) return;
    const dateInput = $("#calendar-date-input");
    const poleFilter = $("#calendar-pole-filter");
    const branchFilter = $("#calendar-branch-filter");
    const cycleFilter = $("#calendar-cycle-filter");
    const statusFilter = $("#calendar-status-filter");

    document.querySelectorAll("[data-calendar-preset]").forEach((button) => {
      button.addEventListener("click", () => {
        const preset = button.dataset.calendarPreset;
        const anchor =
          preset === "today"
            ? new Date()
            : new Date(state.calendar.viewYear, state.calendar.viewMonth, 1);
        applyCalendarSelection(
          preset === "today" ? buildMonthToDateSelection(anchor) : buildCalendarSelection(preset, anchor),
          `Periode ${button.textContent.trim().toLowerCase()} appliquee au reporting.`
        );
      });
    });

    $("#calendar-prev-month")?.addEventListener("click", () => setCalendarView(-1));
    $("#calendar-next-month")?.addEventListener("click", () => setCalendarView(1));

    document.querySelectorAll("[data-actor-scope]").forEach((button) => {
      button.addEventListener("click", () => {
        state.actorScope = button.dataset.actorScope || "responsable";
        renderCalendarSlicer(state);
        renderAdvancedDashboard(state);
        showToast(
          state.actorScope === "direction"
            ? "Vue acteur: Direction."
            : "Vue acteur: Responsable de pole."
        );
      });
    });

    dateInput?.addEventListener("change", () => {
      const selectedDate = parseCompactDate(dateInput.value);
      if (!selectedDate) {
        showToast("Format attendu pour la date: AAAAMMJJ, exemple 20260715.");
        renderCalendarSlicer(state);
        return;
      }
      applyCalendarSelection(
        buildMonthToDateSelection(selectedDate),
        "Cumul mensuel applique jusqu'a la date selectionnee."
      );
    });

    poleFilter?.addEventListener("change", () => {
      state.calendarPoleFilter = poleFilter.value;
      if (poleFilter.value !== "Tous") {
        const allowedPole = getAllowedPoleFromScope(poleFilter.value);
        state.currentPoleMonitor = allowedPole;
        state.currentReportPole = allowedPole;
      }
      renderCalendarSlicer(state);
      renderPoleControls(state);
      renderPoleMonitor(state);
      renderReportControls(state);
      renderReportWorkspace(state);
      showToast(poleFilter.value === "Tous" ? "Tous les poles sont visibles." : "Filtre pole applique.");
    });

    branchFilter?.addEventListener("change", () => {
      applyCountryScope(branchFilter.value, `Pays / filiale actif: ${branchFilter.value}.`);
    });

    cycleFilter?.addEventListener("change", () => {
      state.currentPoleCycle = cycleFilter.value;
      state.currentReportCycle = cycleFilter.value;
      const anchor = fromIsoDate(state.calendar.start) || new Date();
      applyCalendarSelection(
        cycleFilter.value === "Journalier"
          ? buildMonthToDateSelection(anchor)
          : buildCalendarSelection(presetFromCycle(cycleFilter.value), anchor),
        `Cycle ${cycleFilter.value.toLowerCase()} applique.`
      );
    });

    statusFilter?.addEventListener("change", () => {
      state.calendarStatusFilter = statusFilter.value;
      renderCalendarSlicer(state);
      showToast(
        statusFilter.value === "Tous"
          ? "Tous les statuts sont visibles."
          : `Statut ${statusFilter.value.toLowerCase()} selectionne.`
      );
    });

    document.addEventListener("click", (event) => {
      const countryButton = event.target.closest("[data-country-filter]");
      if (!countryButton || countryButton.disabled) return;
      applyCountryScope(countryButton.dataset.countryFilter, `Pays / filiale actif: ${countryButton.dataset.countryFilter}.`);
    });

    slicer.addEventListener("click", (event) => {
      const dayButton = event.target.closest("[data-calendar-date]");
      if (!dayButton) return;
      const clickedDate = fromIsoDate(dayButton.dataset.calendarDate);
      if (!clickedDate) return;
      applyCalendarSelection(
        buildMonthToDateSelection(clickedDate),
        clickedDate.getDate() === 1
          ? "Donnee du premier jour du mois appliquee."
          : "Cumul mensuel applique jusqu'au jour selectionne."
      );
    });

    $("#calendar-apply")?.addEventListener("click", () => {
      const startInput = $("#calendar-start");
      const endInput = $("#calendar-end");
      const startDate = fromIsoDate(startInput?.value);
      const endDate = fromIsoDate(endInput?.value);
      if (!startDate || !endDate) {
        showToast("Renseignez une date de debut et une date de fin.");
        return;
      }
      const start = startDate <= endDate ? startDate : endDate;
      const end = startDate <= endDate ? endDate : startDate;
      applyCalendarSelection(
        {
          preset: "custom",
          start: toIsoDate(start),
          end: toIsoDate(end),
          label: "Periode personnalisee",
          viewYear: start.getFullYear(),
          viewMonth: start.getMonth(),
        },
        "Plage de dates appliquee au reporting."
      );
    });
  }

  function bindFilters() {
    $("#kpi-search").addEventListener("input", (event) => {
      renderKpiTable(event.target.value);
    });

    $("#branch-filter").addEventListener("change", (event) => {
      applyCountryScope(event.target.value, `Pays / filiale actif: ${event.target.value}.`);
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

    const frequencySelect = $("#pole-frequency-filter");
    if (frequencySelect) {
      frequencySelect.addEventListener("change", (event) => {
        state.currentPoleFrequency = event.target.value || "Tous";
        renderPoleControls(state);
        renderPoleMonitor(state);
        showToast(
          state.currentPoleFrequency === "Tous"
            ? "Toutes les cadences de collecte sont visibles."
            : `Cadence ${state.currentPoleFrequency.toLowerCase()} appliquee au suivi du pole.`
        );
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
    state.currentUserAccessBranch = rule.branch || rule.countryName || "Groupe";
    state.calendarBranchFilter = state.currentUserAccessBranch;
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
    const adminKoboReferenceSyncButton = $("#admin-kobo-reference-sync");
    const adminKoboCalculationSyncButton = $("#admin-kobo-calculation-sync");
    const accessProfile = $("#access-profile");
    const saveAccessButton = $("#save-access-rule");
    const createUserButton = $("#create-user");
    const userAccessResponsible = $("#user-access-responsible");
    const userAccessBranch = $("#user-access-branch");
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
    const setUserAccessBranch = (branch) => {
      state.currentUserAccessBranch = findCountryName(branch || "Groupe");
      renderAdmin(state);
      setAdminTab("access");
    };
    const setUserAccessUser = (userId) => {
      const user = state.platformUsers.find((item) => String(item.id) === String(userId));
      if (!user) return false;
      state.currentUserAccessUserId = user.id;
      state.currentUserAccessProfile = user.profile || state.currentUserAccessProfile;
      state.currentUserAccessBranch = user.defaultBranch || state.currentUserAccessBranch || "Groupe";
      if (user.defaultPoleId) {
        state.currentUserAccessPole = user.defaultPoleId;
      }
      renderAdmin(state);
      setAdminTab("access");
      return true;
    };

    const referenceKoboFields = [
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
    ];
    const calculationKoboFields = [
      { mappedTo: "pole", inputId: "#admin-kobo-calculation-pole-field", defaultValue: "pole_id" },
      { mappedTo: "kpi", inputId: "#admin-kobo-calculation-kpi-field", defaultValue: "id_kpi" },
      { mappedTo: "period", inputId: "#admin-kobo-calculation-period-field", defaultValue: "periode_reporting" },
      { mappedTo: "element", inputId: "#admin-kobo-calculation-element-field", defaultValue: "element_id" },
      { mappedTo: "value", inputId: "#admin-kobo-calculation-value-field", defaultValue: "valeur_element" },
      { mappedTo: "branch", inputId: "#admin-kobo-calculation-branch-field", defaultValue: "filiale" },
      { mappedTo: "date", inputId: "#admin-kobo-calculation-date-field", defaultValue: "date_collecte" },
      { mappedTo: "validation", inputId: "#admin-kobo-calculation-validation-field", defaultValue: "validation_hierarchique" },
    ];

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
      return { serverUrl, formId, mappedFields };
    };

    const syncAdminKoboSource = async (config) => {
      const token = $(config.tokenInputId)?.value.trim();
      if (!token) {
        updateAdminKoboStatus(config.statusId, "warning", "Renseignez le token API Kobo avant la synchronisation.");
        showToast("Token API Kobo requis pour importer les soumissions.");
        return;
      }
      if (!api?.syncKoboForm) {
        updateAdminKoboStatus(config.statusId, "warning", "Synchronisation Kobo indisponible pour le moment.");
        showToast("Synchronisation Kobo indisponible.");
        return;
      }

      const previousText = config.button?.textContent;
      if (config.button) {
        config.button.disabled = true;
        config.button.textContent = "Synchronisation...";
      }
      try {
        const savedSource = await saveAdminKoboSource(config);
        if (!savedSource) return;
        updateAdminKoboStatus(
          config.statusId,
          "warning",
          `<strong>${escapeHtml(savedSource.formId)}</strong><span>Connexion a KoboToolbox et import des soumissions...</span>`
        );
        const result = await api.syncKoboForm({
          serverUrl: savedSource.serverUrl,
          formUid: savedSource.formId,
          token,
        });
        if (Array.isArray(result.kpiCalculationResults)) {
          state.kpiCalculationResults = result.kpiCalculationResults;
        }
        if (result.kpiCalculationQuality) {
          state.kpiCalculationQuality = result.kpiCalculationQuality;
        }
        applyCalculatedKpisToReporting();
        renderAll(state);
        setAdminTab("kobo");
        updateAdminKoboStatus(
          config.statusId,
          result.syncWarning ? "warning" : "success",
          `<strong>${escapeHtml(savedSource.formId)}</strong><span>${result.fieldsDetected || 0} champ(s), ${result.submissionsImported || 0} soumission(s) importee(s).</span>`
        );
        showToast(`${config.successLabel} synchronise: ${result.submissionsImported || 0} soumission(s).`);
      } catch (error) {
        console.warn("Synchronisation admin Kobo impossible.", error);
        updateAdminKoboStatus(config.statusId, "warning", `Synchronisation impossible: ${escapeHtml(error.message)}`);
        showToast(`Synchronisation impossible: ${error.message}`);
      } finally {
        if (config.button) {
          config.button.disabled = false;
          config.button.textContent = previousText;
        }
      }
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
          fields: referenceKoboFields,
        })
      );
    }

    if (adminKoboReferenceSyncButton) {
      adminKoboReferenceSyncButton.addEventListener("click", () =>
        syncAdminKoboSource({
          button: adminKoboReferenceSyncButton,
          role: "referentielKpi",
          stateKey: "objectiveKoboSource",
          statusId: "#admin-kobo-reference-status",
          serverInputId: "#admin-kobo-reference-server",
          formInputId: "#admin-kobo-reference-form-id",
          tokenInputId: "#admin-kobo-reference-token",
          mode: "KoboCollect Referentiel KPI",
          detail: "KPI, objectifs et formules de calcul par pole.",
          successLabel: "Formulaire KPI et formules",
          fieldType: "Champ referentiel KPI",
          fields: referenceKoboFields,
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
          fields: calculationKoboFields,
        })
      );
    }

    if (adminKoboCalculationSyncButton) {
      adminKoboCalculationSyncButton.addEventListener("click", () =>
        syncAdminKoboSource({
          button: adminKoboCalculationSyncButton,
          role: "donneesCalcul",
          stateKey: "calculationKoboSource",
          statusId: "#admin-kobo-calculation-status",
          serverInputId: "#admin-kobo-calculation-server",
          formInputId: "#admin-kobo-calculation-form-id",
          tokenInputId: "#admin-kobo-calculation-token",
          mode: "KoboCollect Donnees de calcul",
          detail: "Elements bruts utilises pour calculer les KPI.",
          successLabel: "Formulaire donnees de calcul",
          fieldType: "Champ donnees de calcul",
          fields: calculationKoboFields,
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
        const branch = findCountryName($("#new-user-branch")?.value || state.currentUserAccessBranch || "Groupe");
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
          defaultBranch: branch,
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
        state.currentUserAccessBranch = savedUser.defaultBranch || branch;
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
          state.currentUserAccessBranch =
            selectedOption?.dataset?.branch || selectedUser.defaultBranch || state.currentUserAccessBranch || "Groupe";
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

    if (userAccessBranch) {
      userAccessBranch.addEventListener("change", (event) => {
        setUserAccessBranch(event.target.value);
        showToast("Pays / filiale selectionne pour affectation.");
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
        const branch = findCountryName($("#user-access-branch")?.value || state.currentUserAccessBranch || "Groupe");
        const poleId = $("#user-access-pole")?.value || state.currentUserAccessPole;
        const pole = PMS_DATA.reporting.poles.find((item) => item.id === poleId);
        const responsibleOption = $("#user-access-responsible")?.selectedOptions?.[0];
        const selectedUserId = $("#user-access-responsible")?.value || state.currentUserAccessUserId;
        const selectedUser = state.platformUsers.find((item) => String(item.id) === String(selectedUserId));
        const responsible =
          selectedUser?.fullName || responsibleOption?.textContent.trim().split(" - ")[0] || pole?.owner || "";
        const role = $("#user-access-profile")?.value || state.currentUserAccessProfile;

        if (!pole || !branch || !responsible || !role) {
          showToast("Choisissez le responsable, le pays / filiale, le pole et le profil avant d'enregistrer.");
          return;
        }

        const existingRule = state.accessRules.find(
          (rule) =>
            rule.poleId === pole.id &&
            findCountryName(rule.branch || rule.countryName || "Groupe") === branch &&
            (String(rule.userId || "") === String(selectedUser?.id || selectedUserId) || rule.responsible === responsible)
        );
        const rule = {
          id: existingRule?.id || `ACC-${branch.replace(/[^A-Za-z0-9]+/g, "")}-${pole.id}-${Date.now().toString().slice(-6)}`,
          userId: selectedUser?.id || selectedUserId,
          responsible,
          email: selectedUser?.email || responsibleOption?.dataset?.email || "",
          phone: selectedUser?.phone || responsibleOption?.dataset?.phone || "",
          branch,
          countryName: branch,
          poleId: pole.id,
          poleName: pole.name,
          role,
          dashboardScope: `Dashboard Suivi KPI - ${branch} - ${pole.name}`,
          permission: `Acces limite a ${branch} / ${pole.name}`,
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
              !(
                item.poleId === savedRule.poleId &&
                findCountryName(item.branch || item.countryName || "Groupe") === findCountryName(savedRule.branch || savedRule.countryName || "Groupe") &&
                item.responsible === savedRule.responsible
              )
          ),
        ];
        state.platformUsers = state.platformUsers.map((user) =>
          String(user.id) === String(savedRule.userId)
            ? {
                ...user,
                profile: savedRule.role,
                defaultBranch: savedRule.branch || savedRule.countryName || branch,
                defaultPoleId: savedRule.poleId,
                defaultPoleName: savedRule.poleName,
                status: "Actif",
              }
            : user
        );
        state.currentUserAccessUserId = savedRule.userId || selectedUserId;
        state.currentUserAccessBranch = savedRule.branch || savedRule.countryName || branch;
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
            ? `Acces enregistre dans la base: ${savedRule.responsible} - ${branch} - ${savedRule.poleName} - ${savedRule.role}.`
            : `Acces enregistre en local: ${responsible} - ${branch} - ${pole.name} - ${role}.`
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
      state.currentUserAccessBranch = rule.branch || rule.countryName || "Groupe";
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
    applyCalculatedKpisToReporting();
    syncPeriodFilterFromCalendar();
    renderAll(state);
    document.body.classList.add("dashboard-mode");
    bindNavigation();
    bindDashboardActions();
    bindAuthActions();
    bindKoboActions();
    renderKoboActiveForm();
    bindCalendarActions();
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
