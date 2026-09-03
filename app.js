(function () {
  const { PMS_DATA, PMS_RENDERERS } = window;
  const api = window.PMS_API;
  const reportingExports = window.PMS_REPORTING || {};
  const {
    $,
    renderAll,
    renderKoboTable,
    renderKpiTable,
    renderCalendarSlicer,
    renderCountryDashboard,
    renderAdvancedDashboard,
    renderManagementDashboard,
    renderInternalTool,
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
    collection: "Collecte de donnees",
    internal: "Outil interne PMS",
    management: "Management performance groupe",
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

  const OPERATIONAL_KOBO_ROLES = new Set(["referentielKpi", "objectifsMensuels", "donneesCalcul"]);
  const defaultKoboSources = Array.isArray(PMS_DATA.koboConfiguredSources) ? PMS_DATA.koboConfiguredSources : [];
  const defaultObjectiveKoboSource = defaultKoboSources.find((source) => source.role === "referentielKpi") || null;
  const defaultMonthlyObjectiveKoboSource = defaultKoboSources.find((source) => source.role === "objectifsMensuels") || null;
  const defaultCalculationKoboSource = defaultKoboSources.find((source) => source.role === "donneesCalcul") || null;
  const KOBO_SOURCE_STORAGE_KEY = "pmsGmcKoboSources";

  function normalizedKoboSource(source) {
    if (!source?.role || !OPERATIONAL_KOBO_ROLES.has(source.role)) return null;
    return {
      role: source.role,
      serverUrl: source.serverUrl || source.origin || "https://kf.kobotoolbox.org",
      formId: source.formId || source.uid || source.name || "",
      title: source.title || source.name || "",
      mode: source.mode || "",
      status: source.status || "Actif",
      mappedFields: source.mappedFields || {},
    };
  }

  function loadStoredKoboSources() {
    try {
      const sources = JSON.parse(window.localStorage.getItem(KOBO_SOURCE_STORAGE_KEY) || "[]");
      return Array.isArray(sources) ? sources.map(normalizedKoboSource).filter(Boolean) : [];
    } catch {
      return [];
    }
  }

  const storedKoboSources = loadStoredKoboSources();

  function initialKoboSource(role, fallback) {
    const storedSource = storedKoboSources.find((source) => source.role === role);
    if (!storedSource) return fallback ? clone(fallback) : null;
    return {
      ...(fallback ? clone(fallback) : {}),
      ...storedSource,
      mappedFields: {
        ...(fallback?.mappedFields || {}),
        ...(storedSource.mappedFields || {}),
      },
    };
  }

  function resetReportingToBaseline() {
    Object.keys(PMS_DATA.reporting).forEach((key) => {
      delete PMS_DATA.reporting[key];
    });
    Object.assign(PMS_DATA.reporting, clone(reportingBaseline));
    PMS_DATA.reporting.kpisByPole = {};
    PMS_DATA.reporting.poles.forEach((pole) => {
      PMS_DATA.reporting.kpisByPole[pole.id] = [];
      refreshPoleMetrics(pole.id, PMS_DATA.reporting.kpisByPole[pole.id] || [], {
        lastReport: "Referentiel KPI attendu",
        lateSubmissions: 0,
        quality: 0,
        readiness: 0,
      });
    });
  }

  function statusLabel(status) {
    if (status === "green") return "Valide";
    if (status === "amber") return "A surveiller";
    if (status === "red") return "Plan requis";
    return "En attente collecte";
  }

  function scoreFromKpis(kpis) {
    const measurableKpis = kpis.filter(
      (kpi) => kpi.calculated && ["green", "amber", "red"].includes(kpi.status)
    );
    if (!measurableKpis.length) return null;
    const weights = { green: 100, amber: 70, red: 35, gray: 50 };
    const score = measurableKpis.reduce((sum, kpi) => sum + (weights[kpi.status] || 0), 0) / measurableKpis.length;
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

  function dataNatureKey(item = {}) {
    const normalized = normalizeLookup(item.dataNature || item.data_nature || item.nature || "Reel");
    if (["test", "donnee test", "donnees test"].includes(normalized)) return "test";
    if (["mixte", "mixed"].includes(normalized)) return "mixed";
    return "real";
  }

  function itemMatchesDataMode(item = {}, mode = "all") {
    const selectedMode = normalizeLookup(mode || "all");
    if (!selectedMode || selectedMode === "all" || selectedMode === "toutes") return true;
    const nature = dataNatureKey(item);
    if (selectedMode === "test") return nature === "test" || nature === "mixed";
    if (selectedMode === "real" || selectedMode === "reel" || selectedMode === "reelles") return nature === "real";
    return true;
  }

  function filterItemsByDataMode(items = [], mode = "all") {
    return (Array.isArray(items) ? items : []).filter((item) => itemMatchesDataMode(item, mode));
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

  function toPendingReferenceKpi(kpi = {}, poleId = "") {
    const pole = PMS_DATA.reporting.poles.find((item) => item.id === poleId) || { id: poleId };
    const profile = getObjectiveCatalogProfile(kpi, pole) || {};
    return {
      ...kpi,
      id: kpi.id || profile.id || kpi.name,
      name: kpi.name || profile.title || profile.name || "KPI a renseigner",
      value: "En attente collecte",
      target: kpi.target || profile.target || "A completer",
      trend: "Donnees attendues",
      status: "gray",
      source: profile.sourceData || kpi.source || "Referentiel KPI",
      collectionFrequency: kpi.collectionFrequency || profile.collectionFrequency || PMS_DATA.collectionCadenceByPole?.[poleId]?.cadence || "A preciser",
      reportingFrequency: kpi.reportingFrequency || profile.reportingFrequency || PMS_DATA.collectionCadenceByPole?.[poleId]?.primary || "A preciser",
      calculated: false,
      pendingCalculation: true,
      period: "A collecter",
      formula: kpi.formula || profile.formula || "Formule a completer",
      method: "Donnees de calcul attendues",
      category: kpi.category || profile.type || "Referentiel KPI",
      trendHistory: [],
    };
  }

  function refreshPoleMetrics(poleId, kpis, options = {}) {
    const pole = PMS_DATA.reporting.poles.find((item) => item.id === poleId);
    if (!pole) return;
    const cadenceProfile = PMS_DATA.collectionCadenceByPole?.[poleId] || {};
    const measuredKpis = kpis.filter((item) => item.calculated && ["green", "amber", "red"].includes(item.status));
    const redCount = measuredKpis.filter((item) => item.status === "red").length;
    const amberCount = measuredKpis.filter((item) => item.status === "amber").length;
    const score = scoreFromKpis(kpis);
    const hasCalculatedData = measuredKpis.length > 0;
    pole.kpiCount = kpis.length;
    pole.calculatedKpiCount = measuredKpis.length;
    pole.pendingKpiCount = Math.max(0, kpis.length - measuredKpis.length);
    pole.hasCalculatedData = hasCalculatedData;
    pole.collectionCadence = options.collectionCadence || pole.collectionCadence || cadenceProfile.cadence || "Selon referentiel KPI";
    pole.collectionPrimary = options.collectionPrimary || pole.collectionPrimary || cadenceProfile.primary || "A preciser";
    pole.collectionSourceSheet = options.collectionSourceSheet || pole.collectionSourceSheet || cadenceProfile.sourceSheet || "";
    pole.collectionExpectedDelay = options.collectionExpectedDelay || pole.collectionExpectedDelay || cadenceProfile.expectedDelay || "";
    pole.score = score;
    pole.rag = hasCalculatedData ? (redCount ? "red" : amberCount ? "amber" : "green") : "gray";
    pole.status = hasCalculatedData ? statusLabel(pole.rag) : "En attente donnees";
    pole.lastReport = options.lastReport || pole.lastReport || "Reference fichier collecte";
    pole.quality = hasCalculatedData ? options.quality ?? pole.quality ?? 0 : 0;
    pole.readiness = hasCalculatedData ? options.readiness ?? score ?? 0 : 0;
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
        value: "En attente collecte",
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
        method: "Reference fichier collecte, donnees de calcul attendues",
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
    return `${normalizeLookup(item.branch || item.country || item.filiale || "Groupe")}:${item.poleId || ""}:${normalizeLookup(item.kpiId || item.kpiName || item.name)}`;
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

  function resultCalendarDateIso(result = {}) {
    const date =
      fromIsoDate(result.periodEnd) ||
      fromIsoDate(result.periodStart) ||
      periodDateFromText(result.period);
    return date ? toIsoDate(date) : "";
  }

  function selectedCountryPoleIds(countryValue = state.calendarBranchFilter) {
    const country = countryOptions().find(
      (item) => normalizeLookup(item.name || item.id || item.code) === normalizeLookup(ensureAllowedCountry(countryValue))
    );
    return PMS_DATA.reporting.poles
      .filter((pole) => poleAvailableForCountry(pole.id, country?.name || countryValue))
      .map((pole) => pole.id);
  }

  function calendarDateScopePoleIds() {
    const authorizedPoleIds = new Set(getAuthorizedPoleIds(state.calendarBranchFilter));
    const countryPoleIds = new Set(selectedCountryPoleIds(state.calendarBranchFilter));
    let poleIds = PMS_DATA.reporting.poles
      .map((pole) => pole.id)
      .filter((poleId) => (!authorizedPoleIds.size || authorizedPoleIds.has(poleId)) && countryPoleIds.has(poleId));
    const selectedPole = document.body?.dataset.activeView === "management"
      ? "Tous"
      : state.calendarPoleFilter || state.currentPoleMonitor;
    if (selectedPole && selectedPole !== "Tous") {
      poleIds = poleIds.filter((poleId) => poleId === selectedPole);
    }
    return new Set(poleIds);
  }

  function alignCalendarPoleFilterWithCountry() {
    const authorizedPoleIds = new Set(getAuthorizedPoleIds(state.calendarBranchFilter));
    const countryPoleIds = new Set(selectedCountryPoleIds(state.calendarBranchFilter));
    const allowedPoleIds = PMS_DATA.reporting.poles
      .map((pole) => pole.id)
      .filter((poleId) => (!authorizedPoleIds.size || authorizedPoleIds.has(poleId)) && countryPoleIds.has(poleId));
    if (!allowedPoleIds.length) return;
    const currentPole = state.calendarPoleFilter || "Tous";
    if (currentPole === "Tous" || allowedPoleIds.includes(currentPole)) return;
    state.calendarPoleFilter = allowedPoleIds.length > 1 ? "Tous" : allowedPoleIds[0];
    state.currentPoleMonitor = allowedPoleIds.includes(state.currentPoleMonitor) ? state.currentPoleMonitor : allowedPoleIds[0];
    state.currentReportPole = allowedPoleIds.includes(state.currentReportPole) ? state.currentReportPole : allowedPoleIds[0];
  }

  function availableCalendarDateIsos({ anchorDate = null, sameMonth = false } = {}) {
    const allowedPoleIds = calendarDateScopePoleIds();
    const activeCountry = ensureAllowedCountry(state.calendarBranchFilter);
    const dates = new Map();
    const dailyDates = filterItemsByDataMode(state.kpiDailyDates, state.dataModeFilter);

    dailyDates.forEach((item) => {
      if (allowedPoleIds.size && item.poleId && !allowedPoleIds.has(item.poleId)) return;
      if (!isGroupCountryValue(activeCountry) && (!item.branch || !countryMatches(item.branch, activeCountry))) return;
      const date = fromIsoDate(item.date);
      if (!date) return;
      if (sameMonth && anchorDate && (date.getFullYear() !== anchorDate.getFullYear() || date.getMonth() !== anchorDate.getMonth())) {
        return;
      }
      dates.set(item.date, date.getTime());
    });

    if (dates.size) {
      return [...dates.entries()]
        .sort((left, right) => right[1] - left[1])
        .map(([iso]) => iso);
    }

    const results = filterItemsByDataMode(state.kpiCalculationResults, state.dataModeFilter);

    results.forEach((result) => {
      if (allowedPoleIds.size && result.poleId && !allowedPoleIds.has(result.poleId)) return;
      if (!resultMatchesCountry(result, activeCountry)) return;
      const iso = resultCalendarDateIso(result);
      if (!iso) return;
      const date = fromIsoDate(iso);
      if (!date) return;
      if (sameMonth && anchorDate && (date.getFullYear() !== anchorDate.getFullYear() || date.getMonth() !== anchorDate.getMonth())) {
        return;
      }
      dates.set(iso, date.getTime());
    });

    return [...dates.entries()]
      .sort((left, right) => right[1] - left[1])
      .map(([iso]) => iso);
  }

  function objectiveAvailableDateIso(objective = {}) {
    const periodValue = String(objective.periodMonth || objective.period || "");
    const monthKey = periodValue.match(/\b(20\d{2})-(\d{2})/);
    if (!monthKey) {
      const timestamp = periodSortValue(periodValue);
      if (!timestamp) return "";
      return toIsoDate(endOfMonth(new Date(timestamp)));
    }
    const year = Number(monthKey[1]);
    const month = Number(monthKey[2]);
    if (!year || !month) return "";
    return toIsoDate(new Date(year, month, 0));
  }

  function latestAvailableDataDateIso() {
    const candidates = [];
    const dailyDates = filterItemsByDataMode(state.kpiDailyDates, state.dataModeFilter);
    dailyDates.forEach((item) => {
      if (fromIsoDate(item.date)) candidates.push(item.date);
    });

    const results = filterItemsByDataMode(state.kpiCalculationResults, state.dataModeFilter);
    results.forEach((result) => {
      const iso = resultCalendarDateIso(result);
      if (iso) candidates.push(iso);
    });

    const monthlyObjectives = filterItemsByDataMode(
      Array.isArray(state.kpiCalculationQuality?.monthlyObjectives)
        ? state.kpiCalculationQuality.monthlyObjectives
        : Array.isArray(state.kpiObjectives)
          ? state.kpiObjectives
          : [],
      state.dataModeFilter
    );
    monthlyObjectives.forEach((objective) => {
      const iso = objectiveAvailableDateIso(objective);
      if (iso) candidates.push(iso);
    });

    return candidates
      .filter(Boolean)
      .sort((left, right) => periodSortValue(left) - periodSortValue(right))
      .pop() || "";
  }

  function hasAvailableCalendarDate(date) {
    if (!date) return false;
    return availableCalendarDateIsos().includes(toIsoDate(date));
  }

  function ensureCalendarDateFromAvailableData() {
    const results = filterItemsByDataMode(state.kpiCalculationResults, state.dataModeFilter);
    const hasDailyDates = filterItemsByDataMode(state.kpiDailyDates, state.dataModeFilter).length;
    const monthlyObjectiveRows = filterItemsByDataMode(
      Array.isArray(state.kpiCalculationQuality?.monthlyObjectives)
        ? state.kpiCalculationQuality.monthlyObjectives
        : Array.isArray(state.kpiObjectives)
          ? state.kpiObjectives
          : [],
      state.dataModeFilter
    );
    const hasMonthlyObjectives = monthlyObjectiveRows.length;
    if (!results.length && !hasDailyDates && !hasMonthlyObjectives) {
      state.calendarDateDropdownOpen = false;
      return false;
    }
    const currentDate = fromIsoDate(state.calendar?.selectedDate || state.calendar?.end || state.calendar?.start);
    const currentIso = currentDate ? toIsoDate(currentDate) : "";
    const monthDates = availableCalendarDateIsos({ anchorDate: currentDate || new Date(), sameMonth: true });
    if (currentIso && monthDates.includes(currentIso)) return true;

    const fallbackIso = monthDates[0] || availableCalendarDateIsos()[0] || latestAvailableDataDateIso();
    if (!fallbackIso) {
      state.calendarDateDropdownOpen = false;
      return false;
    }
    state.calendar = buildMonthToDateSelection(fromIsoDate(fallbackIso));
    return true;
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

  function calendarMonthKey(calendar = {}) {
    const date = fromIsoDate(calendar.end || calendar.selectedDate || calendar.start);
    if (!date) return "";
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
  }

  function monthSortValue(monthKey = "") {
    const match = String(monthKey || "").match(/^(20\d{2})-(\d{2})/);
    return match ? Number(`${match[1]}${match[2]}`) : 0;
  }

  function objectiveMatchesReferenceKpi(objective = {}, reference = {}) {
    const referenceKeys = [
      reference.kpiId,
      reference.id,
      reference.kpiName,
      reference.name,
    ].map(normalizeLookup).filter(Boolean);
    const objectiveKeys = [
      objective.catalogId,
      objective.kpiId,
      objective.idKpi,
      objective.kpiName,
      objective.name,
    ].map(normalizeLookup).filter(Boolean);
    if (!referenceKeys.length || !objectiveKeys.length) return false;
    return objectiveKeys.some((key) => referenceKeys.includes(key));
  }

  function objectiveCountryPriority(objective = {}, activeCountry = "Groupe") {
    const objectiveBranch = objective.branch || objective.countryName || objective.country || "Groupe";
    if (isGroupCountryValue(activeCountry)) {
      return isGroupCountryValue(objectiveBranch) ? 2 : 1;
    }
    if (countryMatches(objectiveBranch, activeCountry)) return 3;
    if (isGroupCountryValue(objectiveBranch)) return 2;
    return 0;
  }

  function objectiveTargetForReference(reference = {}, activeCountry = "Groupe") {
    const monthlyObjectives = Array.isArray(state.kpiCalculationQuality?.monthlyObjectives)
      ? state.kpiCalculationQuality.monthlyObjectives
      : [];
    const candidates = monthlyObjectives
      .filter((objective) => objective.poleId === reference.poleId)
      .filter((objective) => objectiveMatchesReferenceKpi(objective, reference))
      .map((objective) => ({
        ...objective,
        countryPriority: objectiveCountryPriority(objective, activeCountry),
      }))
      .filter((objective) => objective.countryPriority > 0);

    if (!candidates.length) return null;

    const activeMonth = calendarMonthKey(state.calendar);
    const monthCandidates = activeMonth
      ? candidates.filter((objective) => objective.periodMonth === activeMonth)
      : [];
    const pool = monthCandidates.length ? monthCandidates : candidates;
    const maxPriority = Math.max(...pool.map((objective) => objective.countryPriority));
    const priorityPool = pool.filter((objective) => objective.countryPriority === maxPriority);

    if (isGroupCountryValue(activeCountry) && maxPriority === 1) {
      const targets = [...new Set(priorityPool.map((objective) => objective.target).filter(Boolean))];
      if (targets.length === 1) {
        return {
          target: targets[0],
          monthlyTarget: targets[0],
          source: "Objectif pays",
        };
      }
      return {
        target: `${priorityPool.length} objectifs pays disponibles`,
        monthlyTarget: "",
        source: "Objectifs par pays",
      };
    }

    const selected = [...priorityPool]
      .sort((left, right) => monthSortValue(left.periodMonth) - monthSortValue(right.periodMonth))
      .pop();
    if (!selected) return null;
    return {
      target: selected.target,
      monthlyTarget: selected.target,
      source: selected.sourceForm || "Objectif mensuel",
    };
  }

  function targetLabelIsMissing(value) {
    const normalized = normalizeLookup(value);
    if (!normalized) return true;
    return [
      "objectif kobo manquant",
      "objectif manquant",
      "objectif kobo mensuel attendu",
      "a completer",
      "objectif a renseigner",
    ].some((term) => normalized.includes(term));
  }

  function resultHasObjective(result = {}) {
    if (Number.isFinite(Number(result.targetValue))) return true;
    if (result.targetMode && !targetLabelIsMissing(result.targetMode) && normalizeLookup(result.targetMode) !== "manquant") {
      return true;
    }
    return [result.monthlyTarget, result.target].some((value) => value && !targetLabelIsMissing(value));
  }

  function objectiveTargetForResult(result = {}, activeCountry = "Groupe") {
    if (resultHasObjective(result)) {
      return {
        target: result.target || result.monthlyTarget,
        monthlyTarget: result.monthlyTarget || result.target,
        source: result.objectiveSource || "Objectif mensuel",
      };
    }
    return objectiveTargetForReference(
      {
        poleId: result.poleId,
        kpiId: result.kpiId,
        id: result.kpiId,
        kpiName: result.kpiName,
        name: result.kpiName,
      },
      activeCountry
    );
  }

  function applyCalculatedKpisToReporting() {
    resetReportingToBaseline();
    const results = filterItemsByDataMode(state.kpiCalculationResults, state.dataModeFilter);
    const referenceKpis = filterItemsByDataMode(
      Array.isArray(state.kpiCalculationQuality?.referenceKpis)
        ? state.kpiCalculationQuality.referenceKpis
        : [],
      state.dataModeFilter
    );
    ensureCalendarDateFromAvailableData();
    if (!results.length && !referenceKpis.length) return;

    const sortedResults = [...results].sort(
      (left, right) => periodSortValue(left.periodEnd || left.periodStart || left.period) - periodSortValue(right.periodEnd || right.periodStart || right.period)
    );
    const activeCountry = ensureAllowedCountry(state.calendarBranchFilter);
    const countryScopedResults = sortedResults.filter((result) => resultMatchesCountry(result, activeCountry));
    const countryScopedReferences = referenceKpis.filter((kpi) => referenceKpiMatchesCountry(kpi, activeCountry));
    const scopedResults = calendarScopedResults(countryScopedResults, state.calendar);
    const scopedResultRows = scopedResults.map((result) => ({
      result,
      objectiveTarget: objectiveTargetForResult(result, activeCountry) || {
        target: result.target || "Objectif mensuel attendu",
        monthlyTarget: result.monthlyTarget || "",
        source: result.objectiveSource || "Objectif a renseigner",
      },
    }));
    const historyByKpi = new Map();
    const trendResults = countryScopedResults.filter((result) => result.periodType !== "monthToDate");
    (trendResults.length ? trendResults : countryScopedResults).forEach((result) => {
      const key = kpiHistoryKey(result);
      if (!key || key === ":") return;
      const history = historyByKpi.get(key) || [];
      history.push({
        period: result.periodEnd || result.period,
        value: result.actualValue ?? result.value,
        valueLabel: result.actualValueLabel || result.valueLabel,
        target: result.target,
        monthlyTarget: result.monthlyTarget,
        targetValue: result.targetValue,
        targetMode: result.targetMode,
        vsTargetValue: result.vsTargetValue,
        vsTargetLabel: result.vsTargetLabel,
        vsTargetClass: result.vsTargetClass,
        performanceDirection: result.performanceDirection || "",
        status: result.status,
        dataNature: result.dataNature || "Reel",
      });
      historyByKpi.set(key, history);
    });

    const byPole = new Map(
      PMS_DATA.reporting.poles.map((pole) => [pole.id, [...(PMS_DATA.reporting.kpisByPole[pole.id] || [])]])
    );
    const calculatedKeys = new Set(scopedResultRows.map(({ result }) => `${result.poleId}:${result.kpiId}`));
    countryScopedReferences
      .filter((kpi) => !calculatedKeys.has(`${kpi.poleId}:${kpi.kpiId}`))
      .forEach((kpi) => {
        if (!kpi.poleId) return;
        const objectiveTarget = objectiveTargetForReference(kpi, activeCountry) || {
          target: "Objectif mensuel attendu",
          monthlyTarget: "",
          source: "Objectif a renseigner",
        };
        upsertKpiItem(byPole, kpi.poleId, {
          id: kpi.kpiId,
          name: kpi.kpiName,
          branch: kpi.branch || activeCountry || "Groupe",
          value: kpi.valueLabel || "--",
          target: objectiveTarget?.target || "Objectif mensuel attendu",
          monthlyTarget: objectiveTarget?.monthlyTarget || "",
          objectiveSource: objectiveTarget?.source || "",
          trend: "Reference collecte",
          status: "gray",
          source: kpi.source || "Plateforme",
          collectionFrequency: kpi.collectionFrequency || PMS_DATA.collectionCadenceByPole?.[kpi.poleId]?.cadence || "A preciser",
          reportingFrequency: kpi.reportingFrequency || PMS_DATA.collectionCadenceByPole?.[kpi.poleId]?.primary || "A preciser",
          calculated: false,
          pendingCalculation: true,
          period: "A calculer",
          periodLabel: "Periode a calculer",
          formula: kpi.formula,
          performanceDirection: kpi.performanceDirection || "",
          method: kpi.method || "Donnees de calcul attendues",
          dataNature: kpi.dataNature || "Reel",
          trendHistory: historyByKpi.get(kpiHistoryKey(kpi)) || [],
        });
      });

    scopedResultRows.forEach(({ result, objectiveTarget }) => {
      if (!result.poleId) return;
      const selectedEnd = fromIsoDate(state.calendar?.end);
      const scopedHistory = (historyByKpi.get(kpiHistoryKey(result)) || []).filter((point) => {
        const pointDate = periodDateFromText(point.period);
        return !selectedEnd || !pointDate || pointDate <= selectedEnd;
      });
      upsertKpiItem(byPole, result.poleId, {
        id: result.kpiId,
        name: result.kpiName,
        branch: result.branch || activeCountry || "Groupe",
        value: result.monthToDateValueLabel || result.actualValueLabel || result.valueLabel,
        numericValue: result.monthToDateValue ?? result.actualValue ?? result.value,
        dayValue: result.dayValue ?? result.actualValue ?? result.value,
        dayValueLabel: result.dayValueLabel || result.actualValueLabel || result.valueLabel,
        monthToDateValue: result.monthToDateValue ?? result.actualValue ?? result.value,
        monthToDateValueLabel: result.monthToDateValueLabel || result.actualValueLabel || result.valueLabel,
        target: objectiveTarget.target || "Objectif mensuel attendu",
        monthlyTarget: objectiveTarget.monthlyTarget || result.monthlyTarget || "",
        targetValue: result.targetValue,
        targetMode: result.targetMode || "",
        vsTargetValue: result.vsTargetValue,
        vsTargetLabel: result.vsTargetLabel,
        vsTargetClass: result.vsTargetClass,
        aggregationMode: result.aggregationMode || "",
        objectiveSource: objectiveTarget.source || result.objectiveSource || "",
        trend: result.trend || "Calcul plateforme",
        status: result.status || "gray",
        source: result.source || "Plateforme",
        collectionFrequency: result.collectionFrequency || PMS_DATA.collectionCadenceByPole?.[result.poleId]?.cadence || "A preciser",
        reportingFrequency: result.reportingFrequency || PMS_DATA.collectionCadenceByPole?.[result.poleId]?.primary || "A preciser",
        calculated: true,
        period: result.period || state.calendar?.label,
        periodLabel: state.calendar?.label || result.period,
        periodStart: result.periodStart || state.calendar?.start || "",
        periodEnd: result.periodEnd || state.calendar?.end || "",
        periodType: result.periodType || "",
        formula: result.formula,
        performanceDirection: result.performanceDirection || "",
        method: result.method,
        elementsCount: result.elementsCount,
        dataNature: result.dataNature || "Reel",
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
        lastReport: latestPeriod(scopedResultRows.map((item) => item.result).filter((item) => item.poleId === poleId)) || state.calendar?.label || "Reference collecte",
        lateSubmissions: state.kpiCalculationQuality?.unmatchedCalculationCount || 0,
      });
    });
  }

  const state = {
    koboSubmissions: [],
    validationQueue: [],
    reportHistory: [],
    koboActiveForm: null,
    kpiCalculationResults: [],
    kpiDailyDates: [],
    kpiCalculationQuality: null,
    kpiObjectives: [],
    calendar: buildMonthToDateSelection(new Date()),
    calendarDateDropdownOpen: false,
    actorScope: "responsable",
    calendarPoleFilter: "Tous",
    calendarBranchFilter: "Groupe",
    calendarStatusFilter: "Tous",
    dataModeFilter: "all",
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
          management: true,
          administration: true,
        },
      },
      {
        profile: "PDG / Management",
        permissions: {
          consultation: true,
          ajout: false,
          modification: false,
          suppression: false,
          validation: true,
          management: true,
          administration: false,
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
          management: true,
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
          management: false,
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
          management: false,
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
    dashboardScoreDetailOpen: false,
    currentReportPole: PMS_DATA.reporting.defaultPole,
    currentReportCycle: PMS_DATA.reporting.defaultCycle,
    currentAdminPole: PMS_DATA.reporting.defaultPole,
    currentAdminKpi: null,
    currentAdminTab: "kobo",
    currentCollectionTab: "reference",
    currentPlatformReferenceBranch: "Groupe",
    currentPlatformReferencePole: PMS_DATA.reporting.defaultPole,
    currentPlatformObjectiveBranch: "Groupe",
    currentPlatformObjectivePole: PMS_DATA.reporting.defaultPole,
    currentPlatformObjectiveKpi: "",
    currentPlatformCalculationBranch: "Groupe",
    currentPlatformCalculationPole: PMS_DATA.reporting.defaultPole,
    currentPlatformCalculationKpi: "",
    platformCalculationEntryMode: "elements",
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
    objectiveKoboSource: initialKoboSource("referentielKpi", defaultObjectiveKoboSource),
    monthlyObjectiveKoboSource: initialKoboSource("objectifsMensuels", defaultMonthlyObjectiveKoboSource),
    calculationKoboSource: initialKoboSource("donneesCalcul", defaultCalculationKoboSource),
    koboAutoSync: null,
    lastAutoSyncRefreshKey: "",
    koboDataAudit: null,
    koboAnomalies: [],
    databaseOverview: null,
    databaseTablePreview: null,
    currentDatabaseTable: "",
    databaseLoading: false,
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

  function mergeKoboSources(sources) {
    if (!Array.isArray(sources)) return;
    if (!sources.length) {
      state.objectiveKoboSource = null;
      state.monthlyObjectiveKoboSource = null;
      state.calculationKoboSource = null;
      rememberKoboSources();
      return;
    }
    const referenceSource = sources.find((source) => source.role === "referentielKpi");
    const monthlyObjectiveSource = sources.find((source) => source.role === "objectifsMensuels");
    const calculationSource = sources.find((source) => source.role === "donneesCalcul");
    if (referenceSource) {
      state.objectiveKoboSource = referenceSource;
    }
    if (monthlyObjectiveSource) {
      state.monthlyObjectiveKoboSource = monthlyObjectiveSource;
    }
    if (calculationSource) {
      state.calculationKoboSource = calculationSource;
    }
    rememberKoboSources();
  }

  function rememberKoboSources() {
    const sources = [
      state.objectiveKoboSource,
      state.monthlyObjectiveKoboSource,
      state.calculationKoboSource,
    ]
      .map(normalizedKoboSource)
      .filter((source) => source?.formId);
    try {
      window.localStorage.setItem(KOBO_SOURCE_STORAGE_KEY, JSON.stringify(sources));
    } catch (error) {
      console.warn("Sauvegarde locale des UID Kobo indisponible.", error);
    }
  }

  function mergeDatabasePayload(payload) {
    if (!payload) return;
    if (Array.isArray(payload.profiles)) {
      state.platformAccessRoles = payload.profiles;
    }
    if (Array.isArray(payload.users)) {
      state.platformUsers = payload.users;
      const selectedUser =
        state.platformUsers.find((user) => String(user.id) === String(state.currentUserAccessUserId)) ||
        state.platformUsers.find((user) => user.defaultPoleId === state.currentUserAccessPole) ||
        state.platformUsers[0];
      if (selectedUser) {
        state.currentUserAccessUserId = selectedUser.id;
      } else {
        state.currentUserAccessUserId = "";
      }
    }
    if (Array.isArray(payload.userAccess)) {
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
      state.reportHistory = payload.reportHistory.filter((report) => !String(report.id || "").startsWith("RPT-2026-"));
    }
    if (Array.isArray(payload.koboSubmissions)) {
      state.koboSubmissions = payload.koboSubmissions.filter((item) => OPERATIONAL_KOBO_ROLES.has(item.sourceRole));
    }
    if (Array.isArray(payload.kpiCalculationResults)) {
      state.kpiCalculationResults = payload.kpiCalculationResults;
    }
    if (Array.isArray(payload.kpiDailyDates)) {
      state.kpiDailyDates = payload.kpiDailyDates;
    }
    if (payload.kpiCalculationQuality) {
      state.kpiCalculationQuality = payload.kpiCalculationQuality;
    }
    if (Array.isArray(payload.koboAnomalies)) {
      state.koboAnomalies = payload.koboAnomalies;
    } else if (Array.isArray(payload.kpiCalculationQuality?.anomalies)) {
      state.koboAnomalies = payload.kpiCalculationQuality.anomalies;
    }
    if ("activeKoboForm" in payload) {
      state.koboActiveForm = payload.activeKoboForm || null;
    }
    mergeKoboSources(payload.koboSources);
    if (payload.koboAutoSync) {
      state.koboAutoSync = payload.koboAutoSync;
      scheduleAutoSyncRefresh(payload.koboAutoSync);
    }
    if (payload.koboDataAudit) {
      state.koboDataAudit = payload.koboDataAudit;
    }
    ensureCalendarDateFromAvailableData();
    applyCalculatedKpisToReporting();
    state.databaseConnected = true;
  }

  async function hydrateFromDatabase() {
    if (!api?.bootstrap) return false;
    try {
      const payload = await api.bootstrap();
      mergeDatabasePayload(payload);
      return true;
    } catch (error) {
      console.warn("Base plateforme indisponible, mode local active.", error);
      state.databaseConnected = false;
      return false;
    }
  }

  let autoSyncRefreshTimer = null;
  let autoSyncRefreshPolls = 0;
  let autoSyncRefreshKey = "";
  const AUTO_SYNC_REFRESH_DELAY_MS = 7000;
  const AUTO_SYNC_MAX_REFRESH_POLLS = 10;

  function autoSyncKey(autoSync = {}) {
    autoSync = autoSync || {};
    return [autoSync.lastAttemptAt || "", autoSync.lastReason || ""].join("|");
  }

  function scheduleAutoSyncRefresh(autoSync = {}) {
    autoSync = autoSync || {};
    if (!api?.koboAutoStatus || !api?.bootstrap || !state.currentPermissions?.administration || !autoSync.enabled) return;
    const key = autoSyncKey(autoSync);
    if (!autoSync.running && (!key || key === state.lastAutoSyncRefreshKey)) return;
    if (key && key !== autoSyncRefreshKey) {
      autoSyncRefreshKey = key;
      autoSyncRefreshPolls = 0;
    }
    if (autoSyncRefreshTimer) return;
    autoSyncRefreshTimer = window.setTimeout(pollAutoSyncRefresh, AUTO_SYNC_REFRESH_DELAY_MS);
  }

  async function pollAutoSyncRefresh() {
    autoSyncRefreshTimer = null;
    if (!api?.koboAutoStatus || !api?.bootstrap || !state.currentPermissions?.administration) return;
    autoSyncRefreshPolls += 1;
    try {
      const status = await api.koboAutoStatus();
      state.koboAutoSync = status;
      if (status.running && autoSyncRefreshPolls < AUTO_SYNC_MAX_REFRESH_POLLS) {
        scheduleAutoSyncRefresh(status);
        renderAdmin(state);
        return;
      }

      const key = autoSyncKey(status);
      if (key && key !== state.lastAutoSyncRefreshKey) {
        state.lastAutoSyncRefreshKey = key;
        const refreshed = await hydrateFromDatabase();
        if (refreshed) {
          renderAll(state);
          renderKoboActiveForm();
          showToast(status.lastError ? "Synchronisation Kobo terminee avec alerte." : "Synchronisation Kobo automatique terminee.");
        }
      }
    } catch (error) {
      console.warn("Suivi de la synchronisation automatique indisponible.", error);
    }
  }

  function preferredDatabaseTable(tables = []) {
    const names = tables.map((table) => table.name);
    return (
      ["kpi_daily_data", "kobo_submissions", "kpis", "kpi_objectives", "user_access", "users"].find((name) =>
        names.includes(name)
      ) ||
      names[0] ||
      ""
    );
  }

  async function loadDatabaseTable(tableName, options = {}) {
    if (!tableName || !api?.databaseTable) return;
    if (!state.currentPermissions?.administration) {
      showToast("Acces reserve aux administrateurs.");
      return;
    }
    state.currentDatabaseTable = tableName;
    state.databaseLoading = true;
    try {
      state.databaseTablePreview = await api.databaseTable(tableName, 50);
    } catch (error) {
      console.warn("Lecture table base indisponible.", error);
      showToast(`Lecture impossible: ${error.message}`);
    } finally {
      state.databaseLoading = false;
      if (options.render !== false) {
        renderAdmin(state);
        setAdminTab("database");
      }
    }
  }

  async function loadDatabaseOverview(options = {}) {
    if (!api?.databaseOverview) {
      showToast("Visite de la base indisponible pour le moment.");
      return;
    }
    if (!state.currentPermissions?.administration) {
      showToast("Acces reserve aux administrateurs.");
      return;
    }
    state.databaseLoading = true;
    if (options.renderStart) {
      renderAdmin(state);
      setAdminTab("database");
    }
    try {
      const overview = await api.databaseOverview();
      state.databaseOverview = overview;
      const names = (overview.tables || []).map((table) => table.name);
      const selectedTable = names.includes(state.currentDatabaseTable)
        ? state.currentDatabaseTable
        : preferredDatabaseTable(overview.tables || []);
      if (selectedTable) {
        await loadDatabaseTable(selectedTable, { render: false });
      }
      if (options.toast !== false) {
        showToast("Base de donnees actualisee.");
      }
    } catch (error) {
      console.warn("Lecture base indisponible.", error);
      showToast(`Visite de la base impossible: ${error.message}`);
    } finally {
      state.databaseLoading = false;
      renderAdmin(state);
      setAdminTab("database");
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

  function normalizeLoginErrorMessage(error) {
    const message = error?.message || "";
    const lowerMessage = message.toLowerCase();
    if (lowerMessage.includes("utilisateur introuvable")) {
      return "Identifiant introuvable. Verifiez l'email, le nom utilisateur ou demandez la creation du compte.";
    }
    if (lowerMessage.includes("mot de passe incorrect")) {
      return "Mot de passe incorrect. Verifiez la saisie ou demandez une reinitialisation a l'administrateur Hub central.";
    }
    if (lowerMessage.includes("inactif")) {
      return "Compte inactif. Contactez l'administrateur Hub central pour reactiver l'acces.";
    }
    if (lowerMessage.includes("failed to fetch") || lowerMessage.includes("load failed")) {
      return "Serveur indisponible pour le moment. Patientez quelques secondes puis reessayez.";
    }
    return message || "Connexion impossible. Verifiez vos informations puis reessayez.";
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

  function poleAvailableForCountry(poleId, countryValue = state.calendarBranchFilter) {
    const activeCountry = findCountryName(countryValue || "Groupe");
    if (isGroupCountryValue(activeCountry)) return true;
    const scopes = PMS_DATA.poleCountryScopes?.[poleId];
    if (!Array.isArray(scopes) || !scopes.length) return true;
    return scopes.some((country) => countryMatches(country, activeCountry));
  }

  function resultMatchesCountry(result = {}, countryValue = state.calendarBranchFilter) {
    const activeCountry = ensureAllowedCountry(countryValue || "Groupe");
    const resultCountry = result.branch || result.country || result.filiale || result.pays || "Groupe";
    if (isGroupCountryValue(activeCountry)) return true;
    if (isGroupCountryValue(resultCountry)) return false;
    return countryMatches(resultCountry, activeCountry);
  }

  function referenceKpiMatchesCountry(kpi = {}, countryValue = state.calendarBranchFilter) {
    const activeCountry = ensureAllowedCountry(countryValue || "Groupe");
    const referenceCountry = kpi.branch || kpi.country || kpi.filiale || kpi.pays || "Groupe";
    if (isGroupCountryValue(activeCountry)) return true;
    if (isGroupCountryValue(referenceCountry)) return true;
    return countryMatches(referenceCountry, activeCountry);
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

  function canAccessManagement() {
    return Boolean(state.currentPermissions?.management || state.currentPermissions?.administration);
  }

  function hasPermission(permissionCode) {
    const permissions = state.currentPermissions || {};
    return Boolean(permissions.administration || permissions[permissionCode]);
  }

  function canAccessView(view) {
    const permissions = state.currentPermissions || {};
    if (permissions.administration) return true;
    if (view === "collection") return Boolean(permissions.ajout);
    if (view === "admin") return false;
    if (view === "internal") return Boolean(permissions.consultation || permissions.ajout || permissions.validation || permissions.management);
    if (view === "management") return Boolean(permissions.management);
    if (view === "reports") return Boolean(permissions.consultation || permissions.ajout || permissions.validation);
    if (view === "alerts") return Boolean(permissions.consultation || permissions.validation);
    if (view === "dashboard" || view === "poles") return Boolean(permissions.consultation);
    return true;
  }

  function firstAllowedView() {
    return ["dashboard", "collection", "internal", "management", "poles", "alerts", "reports", "admin"].find(canAccessView) || "dashboard";
  }

  function applyNavigationPermissions() {
    document.querySelectorAll(".nav-item").forEach((button) => {
      button.toggleAttribute("hidden", !canAccessView(button.dataset.view));
    });
  }

  function applyActionPermissions() {
    const generationAllowed = hasPermission("ajout");
    const commentAllowed = hasPermission("ajout") || hasPermission("modification");
    const validationAllowed = hasPermission("validation");
    $("#generate-report")?.toggleAttribute("disabled", !generationAllowed);
    $("#save-report-comment")?.toggleAttribute("disabled", !commentAllowed);
    $("#schedule-report")?.toggleAttribute("disabled", !validationAllowed);
  }

  function applyUserAccessScope() {
    const firstAccess = state.userAccessScope?.[0];
    const canAdmin = Boolean(state.currentPermissions?.administration);
    applyNavigationPermissions();
    applyActionPermissions();

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
    scheduleAutoSyncRefresh(state.koboAutoSync);

    if (options.toast !== false) {
      showToast(`Bienvenue ${state.currentUser.fullName}.`);
    }
  }

  function bindAuthActions() {
    const form = $("#login-form");
    const logout = $("#logout-button");
    const passwordInput = $("#login-password");
    const passwordToggle = $("#login-password-toggle");
    const forgotLink = $("#login-forgot-link");

    if (passwordInput && passwordToggle) {
      passwordToggle.addEventListener("click", () => {
        const showPassword = passwordInput.type === "password";
        passwordInput.type = showPassword ? "text" : "password";
        passwordToggle.textContent = showPassword ? "Masquer" : "Voir";
        passwordToggle.setAttribute("aria-label", showPassword ? "Masquer le mot de passe" : "Afficher le mot de passe");
        passwordToggle.setAttribute("aria-pressed", String(showPassword));
        passwordInput.focus();
      });
    }

    if (forgotLink) {
      forgotLink.addEventListener("click", () => {
        setLoginFeedback("Pour reinitialiser votre mot de passe, contactez l'administrateur Hub central.", "info");
      });
    }

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
        setLoginFeedback("Verification de l'acces en cours...", "info");
        try {
          if (!api?.login) {
            throw new Error("Serveur local indisponible. Lancez la plateforme sur http://127.0.0.1:5184/.");
          }
          const session = await api.login(identifier, password);
          saveSession(session);
          const hydrated = await hydrateFromDatabase();
          if (!hydrated) {
            clearSession();
            throw new Error("Connexion valide, mais le chargement securise des donnees a echoue.");
          }
          setLoginFeedback("Connexion reussie.", "success");
          applyAuthenticatedSession(session);
        } catch (error) {
          console.warn("Connexion refusee.", error);
          setLoginFeedback(normalizeLoginErrorMessage(error), "error");
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
        state.platformUsers = [];
        state.accessRules = [];
        state.koboActiveForm = null;
        state.objectiveKoboSource = null;
        state.monthlyObjectiveKoboSource = null;
        state.calculationKoboSource = null;
        state.koboAutoSync = null;
        state.koboDataAudit = null;
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
    if (!canAccessView(view)) {
      showToast("Acces non autorise pour ce profil.");
      view = firstAllowedView();
    }
    document.querySelectorAll(".nav-item").forEach((item) => item.classList.remove("active"));
    document.querySelectorAll(".view").forEach((item) => item.classList.remove("active"));
    document.querySelector(`.nav-item[data-view="${view}"]`)?.classList.add("active");
    document.querySelector(`#${view}`)?.classList.add("active");
    document.body.dataset.activeView = view;
    document.body.classList.toggle("dashboard-mode", view === "dashboard");
    $("#view-title").textContent = viewTitles[view] || "Palladium Africa Hub central";
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

  function getCurrentManagementReportContext() {
    const reporting = PMS_DATA.reporting;
    const activeCountry = ensureAllowedCountry(state.calendarBranchFilter || "Groupe");
    const authorizedPoleIds = new Set(getAuthorizedPoleIds(activeCountry));
    const countryPoleIds = new Set(selectedCountryPoleIds(activeCountry));
    const visiblePoles = reporting.poles.filter(
      (pole) => (!authorizedPoleIds.size || authorizedPoleIds.has(pole.id)) && countryPoleIds.has(pole.id)
    );
    const calculatedStatuses = new Set(["green", "amber", "red"]);
    const visibleKpis = visiblePoles.flatMap((pole) =>
      (reporting.kpisByPole[pole.id] || [])
        .filter((kpi) => itemMatchesDataMode(kpi, state.dataModeFilter))
        .filter((kpi) => referenceKpiMatchesCountry(kpi, activeCountry))
        .map((kpi) => ({
          ...kpi,
          poleId: pole.id,
          poleName: pole.name,
          poleOwner: pole.owner,
          owner: pole.owner,
        }))
    );
    const calculatedKpis = visibleKpis.filter((kpi) => kpi.calculated && calculatedStatuses.has(kpi.status));
    const directionScores = visiblePoles.map((pole) => {
      const poleKpis = visibleKpis.filter((kpi) => kpi.poleId === pole.id);
      const measured = poleKpis.filter((kpi) => kpi.calculated && calculatedStatuses.has(kpi.status));
      const red = measured.filter((kpi) => kpi.status === "red").length;
      const amber = measured.filter((kpi) => kpi.status === "amber").length;
      const green = measured.filter((kpi) => kpi.status === "green").length;
      const score = scoreFromKpis(poleKpis);
      return {
        poleId: pole.id,
        poleName: pole.name,
        owner: pole.owner,
        score,
        total: measured.length,
        red,
        amber,
        green,
        action: !measured.length
          ? "Attente donnees Kobo"
          : red
            ? "Plan de rattrapage"
            : amber
              ? "Suivi rapproche"
              : "Maintenir",
      };
    });
    const priorities = calculatedKpis
      .filter((kpi) => ["red", "amber"].includes(kpi.status))
      .sort((left, right) => {
        if (left.status !== right.status) return left.status === "red" ? -1 : 1;
        return Number(left.vsTargetValue ?? 999) - Number(right.vsTargetValue ?? 999);
      })
      .slice(0, 5);

    return {
      country: activeCountry,
      period: state.calendar?.label || $("#period-filter")?.value || "",
      dataMode: state.dataModeFilter || "all",
      kpis: calculatedKpis,
      directionScores,
      priorities,
      score: scoreFromKpis(calculatedKpis),
      quality: state.kpiCalculationQuality,
    };
  }

  function bindNavigation() {
    document.querySelectorAll(".nav-item").forEach((button) => {
      button.addEventListener("click", () => activateView(button.dataset.view));
    });
  }

  function bindDashboardActions() {
    document.addEventListener("click", (event) => {
      const scoreToggle = event.target.closest("[data-dashboard-score-toggle]");
      if (scoreToggle) {
        state.dashboardScoreDetailOpen = !state.dashboardScoreDetailOpen;
        renderAdvancedDashboard(state);
        if (state.dashboardScoreDetailOpen) {
          document.getElementById("dashboard-score-detail")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
        }
        return;
      }
      const managementButton = event.target.closest("[data-open-management]");
      if (managementButton) {
        activateView("management");
        showToast("Vue Management ouverte pour approfondir le controle groupe.");
        return;
      }
      const viewButton = event.target.closest("[data-open-view]");
      if (viewButton) {
        const targetView = viewButton.dataset.openView;
        if (!targetView || !canAccessView(targetView)) {
          showToast("Acces reserve au profil autorise.");
          return;
        }
        activateView(targetView);
        if (targetView === "admin" && viewButton.dataset.adminTargetTab) {
          setAdminTab(viewButton.dataset.adminTargetTab);
        }
        showToast(`Module ${viewTitles[targetView] || targetView} ouvert.`);
        return;
      }
      const managementExportButton = event.target.closest("#export-management-report");
      if (managementExportButton) {
        if (!canAccessManagement()) {
          showToast("Export reserve au management.");
          return;
        }
        const context = getCurrentManagementReportContext();
        const slug = `${context.country}-${context.period}`.replaceAll(" ", "_");
        reportingExports.exportManagementPowerPoint?.(context, slug, { toast: showToast });
        return;
      }
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
      const hasServerToken = Boolean(state.koboAutoSync?.tokenConfigured);

      if (!serverUrl || !formUid || (!token && !hasServerToken)) {
        setKoboStatus("warning", "Renseignez le serveur, l'ID formulaire et le jeton API, ou configurez PMS_KOBO_API_TOKEN sur Render.");
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
        if (Array.isArray(result.objectives)) {
          state.kpiObjectives = result.objectives;
        }
        if (Array.isArray(result.kpiDailyDates)) {
          state.kpiDailyDates = result.kpiDailyDates;
        }
        if (Array.isArray(result.koboSubmissions)) {
          state.koboSubmissions = result.koboSubmissions.filter((item) => OPERATIONAL_KOBO_ROLES.has(item.sourceRole));
        }
        if (result.kpiCalculationQuality) {
          state.kpiCalculationQuality = result.kpiCalculationQuality;
        }
        if (Array.isArray(result.koboAnomalies)) {
          state.koboAnomalies = result.koboAnomalies;
        } else if (Array.isArray(result.kpiCalculationQuality?.anomalies)) {
          state.koboAnomalies = result.kpiCalculationQuality.anomalies;
        }
        mergeKoboSources(result.koboSources);
        if (result.koboDataAudit) {
          state.koboDataAudit = result.koboDataAudit;
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
      detail: fields.length ? "Formulaire charge localement et pret pour mapping plateforme." : "Formulaire charge, mais aucun champ exploitable n'a ete detecte.",
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
    renderAdvancedDashboard(state);
    renderManagementDashboard(state);
    renderInternalTool(state);
    renderPoleControls(state);
    renderPoleMonitor(state);
    renderReportControls(state);
    renderReportWorkspace(state);
    if (toastMessage) showToast(toastMessage);
  }

  function applyCountryScope(countryValue, toastMessage) {
    state.calendarBranchFilter = ensureAllowedCountry(countryValue || "Groupe");
    alignCalendarPoleFilterWithCountry();
    ensureCalendarDateFromAvailableData();
    applyCalculatedKpisToReporting();
    renderCalendarSlicer(state);
    renderCountryDashboard(state);
    renderAdvancedDashboard(state);
    renderManagementDashboard(state);
    renderInternalTool(state);
    renderPoleSummaryTables(state);
    renderPoleControls(state);
    renderPoleMonitor(state);
    renderReportControls(state);
    renderReportWorkspace(state);
    renderKoboTable("", filterItemsByDataMode(state.koboSubmissions, state.dataModeFilter), state.calendarBranchFilter);
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
    const dateToggle = $("#calendar-date-toggle");
    const poleFilter = $("#calendar-pole-filter");
    const branchFilter = $("#calendar-branch-filter");
    const cycleFilter = $("#calendar-cycle-filter");
    const statusFilter = $("#calendar-status-filter");
    const dataModeFilter = $("#data-mode-filter");

    function scrollActiveDateIntoView() {
      const menu = $("#calendar-date-menu");
      const selectedOption = menu?.querySelector(".date-picker-option.selected");
      if (!menu || !selectedOption || menu.hidden) return;
      menu.scrollTop = Math.max(0, selectedOption.offsetTop - menu.clientHeight / 2 + selectedOption.clientHeight / 2);
    }

    function setDateDropdown(open) {
      state.calendarDateDropdownOpen = open;
      renderCalendarSlicer(state);
      if (open) scrollActiveDateIntoView();
    }

    dateToggle?.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      setDateDropdown(!state.calendarDateDropdownOpen);
    });

    dateInput?.addEventListener("click", (event) => {
      event.stopPropagation();
      setDateDropdown(true);
    });

    dateInput?.addEventListener("focus", () => {
      setDateDropdown(true);
    });

    dateInput?.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        setDateDropdown(false);
        dateInput.blur();
      }
    });

    document.querySelectorAll("[data-calendar-preset]").forEach((button) => {
      button.addEventListener("click", () => {
        const preset = button.dataset.calendarPreset;
        let anchor =
          preset === "today"
            ? new Date()
            : new Date(state.calendar.viewYear, state.calendar.viewMonth, 1);
        if (preset === "today" && !hasAvailableCalendarDate(anchor)) {
          const fallbackIso = availableCalendarDateIsos()[0] || latestAvailableDataDateIso();
          anchor = fromIsoDate(fallbackIso) || anchor;
        }
        applyCalendarSelection(
          preset === "today" ? buildMonthToDateSelection(anchor) : buildCalendarSelection(preset, anchor),
          `Periode ${button.textContent.trim().toLowerCase()} appliquee au reporting.`
        );
      });
    });

    $("#calendar-prev-month")?.addEventListener("click", () => setCalendarView(-1));
    $("#calendar-next-month")?.addEventListener("click", () => setCalendarView(1));

    dateInput?.addEventListener("change", () => {
      const selectedDate = parseCompactDate(dateInput.value);
      if (!selectedDate) {
        showToast("Format attendu pour la date: AAAAMMJJ, exemple 20260715.");
        renderCalendarSlicer(state);
        return;
      }
      if (!hasAvailableCalendarDate(selectedDate)) {
        state.calendarDateDropdownOpen = false;
        ensureCalendarDateFromAvailableData();
        renderCalendarSlicer(state);
        showToast("Aucune donnee Kobo n'a encore ete montee pour cette date.");
        return;
      }
      state.calendarDateDropdownOpen = false;
      applyCalendarSelection(
        buildMonthToDateSelection(selectedDate),
        "Cumul mensuel applique jusqu'a la date selectionnee."
      );
    });

    poleFilter?.addEventListener("change", () => {
      state.calendarPoleFilter = poleFilter.value;
      const allowedPole =
        poleFilter.value === "Tous"
          ? getAllowedPoleFromScope(state.currentPoleMonitor || PMS_DATA.reporting.defaultPole)
          : getAllowedPoleFromScope(poleFilter.value);
      if (poleFilter.value !== "Tous") {
        state.currentPoleMonitor = allowedPole;
        state.currentReportPole = allowedPole;
      }
      ensureCalendarDateFromAvailableData();
      applyCalculatedKpisToReporting();
      renderCalendarSlicer(state);
      renderAdvancedDashboard(state);
      renderManagementDashboard(state);
      renderInternalTool(state);
      renderPoleSummaryTables(state);
      renderPoleControls(state);
      renderPoleMonitor(state);
      renderReportControls(state);
      renderReportWorkspace(state);
      showToast("Filtre pole applique.");
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
      renderAdvancedDashboard(state);
      renderManagementDashboard(state);
      renderInternalTool(state);
      showToast(
        statusFilter.value === "Tous"
          ? "Tous les statuts sont visibles."
          : `Statut ${statusFilter.value.toLowerCase()} selectionne.`
      );
    });

    dataModeFilter?.addEventListener("change", () => {
      state.dataModeFilter = dataModeFilter.value || "all";
      ensureCalendarDateFromAvailableData();
      applyCalculatedKpisToReporting();
      renderCalendarSlicer(state);
      renderCountryDashboard(state);
      renderAdvancedDashboard(state);
      renderManagementDashboard(state);
      renderInternalTool(state);
      renderPoleSummaryTables(state);
      renderPoleControls(state);
      renderPoleMonitor(state);
      renderReportControls(state);
      renderReportWorkspace(state);
      renderKoboTable("", filterItemsByDataMode(state.koboSubmissions, state.dataModeFilter), state.calendarBranchFilter);
      const labels = { all: "toutes les donnees", real: "donnees reelles", test: "donnees test" };
      showToast(`Mode donnees applique: ${labels[state.dataModeFilter] || "toutes les donnees"}.`);
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
      state.calendarDateDropdownOpen = false;
      applyCalendarSelection(
        buildMonthToDateSelection(clickedDate),
        clickedDate.getDate() === 1
          ? "Donnee du premier jour du mois appliquee."
          : "Cumul mensuel applique jusqu'au jour selectionne."
      );
    });

    document.addEventListener("click", (event) => {
      if (!state.calendarDateDropdownOpen) return;
      if (event.target.closest(".powerbi-date-card")) return;
      setDateDropdown(false);
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
      const requestedCountry = poleButton.dataset.countryFilter;
      if (requestedCountry) {
        state.calendarBranchFilter = ensureAllowedCountry(requestedCountry);
      }
      const allowedPole = getAllowedPoleFromScope(requestedPole);
      state.currentPoleMonitor = allowedPole;
      activateView("poles");
      renderCalendarSlicer(state);
      renderCountryDashboard(state);
      renderAdvancedDashboard(state);
      renderManagementDashboard(state);
      renderInternalTool(state);
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
      if (!hasPermission("ajout")) {
        showToast("Droit d'ajout requis pour generer un rapport.");
        return;
      }
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
        branch: state.calendarBranchFilter || "Groupe",
        cycle: state.currentReportCycle,
        period: $("#period-filter").value,
        format,
        status: "Brouillon",
        generatedAt,
        comment: $("#report-comment").value.trim(),
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

    $("#save-report-comment").addEventListener("click", async () => {
      if (!hasPermission("ajout") && !hasPermission("modification")) {
        showToast("Droit de modification requis pour enregistrer un commentaire.");
        return;
      }
      const comment = $("#report-comment").value.trim();
      if (!comment) {
        showToast("Ajoutez un commentaire avant enregistrement.");
        return;
      }
      const poleOption = $("#report-pole-select").selectedOptions[0];
      const poleName = poleOption?.textContent?.trim() || state.currentReportPole;
      const period = $("#period-filter").value;
      const reportId = `COMMENT-${state.currentReportPole}-${state.currentReportCycle}-${period}`
        .replace(/[^A-Za-z0-9-]+/g, "-")
        .replace(/-+/g, "-")
        .slice(0, 80);
      const report = {
        id: reportId,
        pole: state.currentReportPole,
        poleId: state.currentReportPole,
        poleName,
        branch: state.calendarBranchFilter || "Groupe",
        cycle: state.currentReportCycle,
        period,
        format: "Commentaire",
        status: "Commentaire responsable",
        generatedAt: new Date().toISOString(),
        comment,
      };
      let savedReport = report;
      let savedInDatabase = false;
      try {
        if (api?.saveReport) {
          savedReport = await api.saveReport(report);
          savedInDatabase = true;
        }
        state.reportHistory = [
          savedReport,
          ...state.reportHistory.filter((item) => item.id !== savedReport.id),
        ];
        renderReportHistory(state);
        renderReports(state);
        showToast(savedInDatabase ? "Commentaire enregistre dans la base." : "Commentaire enregistre en local.");
      } catch (error) {
        console.warn("Enregistrement commentaire indisponible.", error);
        showToast(error.message || "Impossible d'enregistrer le commentaire.");
      }
    });

    document.querySelectorAll("[data-report-export]").forEach((button) => {
      button.addEventListener("click", () => {
        const context = getCurrentReportContext();
        const slug = `${context.pole.id}-${context.cycle.value}-${context.period}`.replaceAll(" ", "_");
        if (button.dataset.reportExport === "pdf") {
          reportingExports.exportReportPdf?.(context, slug, { toast: showToast });
          return;
        }
        if (button.dataset.reportExport === "excel") {
          reportingExports.exportReportExcel?.(context, slug, { toast: showToast });
          return;
        }
        if (button.dataset.reportExport === "powerpoint") {
          reportingExports.exportReportPowerPoint?.(context, slug, { toast: showToast });
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
        reportingExports.exportJson?.(`rapport-${slug}.json`, payload, { toast: showToast });
      });
    });

    $("#schedule-report").addEventListener("click", () => {
      if (!hasPermission("validation")) {
        showToast("Droit de validation requis pour planifier la diffusion.");
        return;
      }
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
    const canManageAdministration = !state.currentUser || state.currentPermissions?.administration;
    const activeTab = canManageAdministration || tab === "kobo" ? tab : "kobo";
    state.currentAdminTab = activeTab;
    document.querySelectorAll("[data-admin-tab]").forEach((button) => {
      button.classList.toggle("active", button.dataset.adminTab === activeTab);
    });
    document.querySelectorAll("[data-admin-panel]").forEach((panel) => {
      panel.classList.toggle("active", panel.dataset.adminPanel === activeTab);
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
        if (button.dataset.adminTab === "database" && !state.databaseOverview) {
          loadDatabaseOverview({ toast: false, renderStart: true });
        }
      });
    });
    setAdminTab(state.currentAdminTab);
    document.querySelectorAll("[data-collection-tab]").forEach((button) => {
      button.addEventListener("click", () => {
        state.currentCollectionTab = button.dataset.collectionTab || "reference";
        renderAdmin(state);
      });
    });

    const adminKoboReferenceButton = $("#admin-kobo-reference-save");
    const adminKoboMonthlyObjectiveButton = $("#admin-kobo-monthly-objective-save");
    const adminKoboCalculationButton = $("#admin-kobo-calculation-save");
    const adminKoboReferenceSyncButton = $("#admin-kobo-reference-sync");
    const adminKoboMonthlyObjectiveSyncButton = $("#admin-kobo-monthly-objective-sync");
    const adminKoboCalculationSyncButton = $("#admin-kobo-calculation-sync");
    const accessProfile = $("#access-profile");
    const saveAccessButton = $("#save-access-rule");
    const createUserButton = $("#create-user");
    const userAccessResponsible = $("#user-access-responsible");
    const userAccessBranch = $("#user-access-branch");
    const userAccessPole = $("#user-access-pole");
    const userAccessProfile = $("#user-access-profile");
    const saveUserAccessButton = $("#save-user-access");
    const refreshDatabaseButton = $("#refresh-database-overview");
    const databaseTableSelect = $("#database-table-select");
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
    const fieldValue = (selector) => $(selector)?.value?.trim() || "";
    const selectedPoleById = (poleId) =>
      PMS_DATA.reporting.poles.find((pole) => pole.id === poleId) || PMS_DATA.reporting.poles[0] || { id: poleId, name: poleId };
    const setPlatformStatus = (selector, statusClass, content) => {
      const status = $(selector);
      if (!status) return;
      status.className = `connector-status ${statusClass}`;
      status.innerHTML = content;
    };
    const withLoading = async (button, label, task) => {
      const previousText = button?.textContent;
      if (button) {
        button.disabled = true;
        button.textContent = label;
      }
      try {
        return await task();
      } finally {
        if (button) {
          button.disabled = false;
          button.textContent = previousText;
        }
      }
    };
    const applyCollectionResponse = (payload, statusSelector, successMessage) => {
      mergeDatabasePayload(payload);
      ensureCalendarDateFromAvailableData();
      applyCalculatedKpisToReporting();
      renderAll(state);
      setAdminTab("kobo");
      const saved = payload?.savedCollection || {};
      setPlatformStatus(
        statusSelector,
        "success",
        `<strong>Enregistre</strong><span>${escapeHtml(saved.formUid || "Collecte plateforme")} - ${escapeHtml(saved.submissionUid || "ligne mise a jour")}</span>`
      );
      showToast(successMessage);
    };
    const nextPlatformKpiId = () => {
      const ids = [
        ...(state.kpiCalculationQuality?.referenceKpis || []).map((kpi) => kpi.kpiId || kpi.catalogId || kpi.id),
        ...Object.values(PMS_DATA.reporting.kpisByPole || {}).flatMap((items) => (items || []).map((kpi) => kpi.id || kpi.kpiId)),
      ];
      const maxId = ids.reduce((max, id) => {
        const match = String(id || "").match(/KPI[-_\s]*(\d+)/i);
        return match ? Math.max(max, Number(match[1]) || 0) : max;
      }, 0);
      return `KPI-${String(maxId + 1).padStart(3, "0")}`;
    };
    const refreshPlatformCollectionPanel = () => {
      renderAdmin(state);
      setAdminTab("kobo");
    };
    const updatePlatformCalculationMode = () => {
      state.platformCalculationEntryMode = fieldValue("#platform-calculation-entry-mode") || "elements";
      document.querySelectorAll("[data-platform-calculation-mode]").forEach((node) => {
        const isElements = node.dataset.platformCalculationMode === "elements";
        node.hidden = isElements ? state.platformCalculationEntryMode !== "elements" : state.platformCalculationEntryMode === "elements";
      });
    };
    [
      ["#platform-reference-branch", "currentPlatformReferenceBranch"],
      ["#platform-reference-pole", "currentPlatformReferencePole"],
      ["#platform-objective-branch", "currentPlatformObjectiveBranch"],
      ["#platform-objective-pole", "currentPlatformObjectivePole"],
      ["#platform-objective-kpi", "currentPlatformObjectiveKpi"],
      ["#platform-calculation-branch", "currentPlatformCalculationBranch"],
      ["#platform-calculation-pole", "currentPlatformCalculationPole"],
      ["#platform-calculation-kpi", "currentPlatformCalculationKpi"],
    ].forEach(([selector, stateKey]) => {
      const input = $(selector);
      input?.addEventListener("change", () => {
        state[stateKey] = input.value;
        refreshPlatformCollectionPanel();
        updatePlatformCalculationMode();
      });
    });
    $("#platform-calculation-entry-mode")?.addEventListener("change", updatePlatformCalculationMode);
    updatePlatformCalculationMode();

    $("#platform-reference-form")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!api?.savePlatformReferenceKpi) {
        showToast("Collecte integree indisponible sur ce serveur.");
        return;
      }
      const pole = selectedPoleById(fieldValue("#platform-reference-pole") || state.currentPlatformReferencePole);
      const catalogId = fieldValue("#platform-reference-kpi-id") || nextPlatformKpiId();
      const kpiName = fieldValue("#platform-reference-kpi-name");
      if (!pole?.id || !kpiName) {
        setPlatformStatus("#platform-reference-status", "warning", "Renseignez au minimum le pole et l'intitule du KPI.");
        return;
      }
      $("#platform-reference-kpi-id").value = catalogId;
      await withLoading($("#platform-reference-save"), "Enregistrement...", async () => {
        try {
          const response = await api.savePlatformReferenceKpi({
            branch: fieldValue("#platform-reference-branch") || state.calendarBranchFilter || "Groupe",
            poleId: pole.id,
            poleName: pole.name,
            catalogId,
            kpiName,
            unit: fieldValue("#platform-reference-unit"),
            frequency: fieldValue("#platform-reference-frequency"),
            collectionFrequency: fieldValue("#platform-reference-frequency"),
            reportingFrequency: fieldValue("#platform-reference-frequency"),
            performanceDirection: fieldValue("#platform-reference-performance-direction"),
            target: fieldValue("#platform-reference-target"),
            formula: fieldValue("#platform-reference-formula"),
            responsible: fieldValue("#platform-reference-responsible") || pole.owner || "",
            dataNature: fieldValue("#platform-reference-data-nature") || "Reel",
            validation: "En attente",
            sourceData: "Saisie interne Hub central",
          });
          applyCollectionResponse(response, "#platform-reference-status", `KPI ${catalogId} enregistre dans le referentiel.`);
        } catch (error) {
          console.warn("Saisie referentiel indisponible.", error);
          setPlatformStatus("#platform-reference-status", "warning", `Enregistrement impossible: ${escapeHtml(error.message)}`);
          showToast(error.message || "Impossible d'enregistrer le KPI.");
        }
      });
    });

    $("#platform-objective-form")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!api?.savePlatformObjective) {
        showToast("Collecte integree indisponible sur ce serveur.");
        return;
      }
      const pole = selectedPoleById(fieldValue("#platform-objective-pole") || state.currentPlatformObjectivePole);
      const kpiId = fieldValue("#platform-objective-kpi");
      const target = fieldValue("#platform-objective-target");
      if (!pole?.id || !kpiId || !fieldValue("#platform-objective-period") || !target) {
        setPlatformStatus("#platform-objective-status", "warning", "Renseignez le mois, le pays, le pole, le KPI et l'objectif.");
        return;
      }
      await withLoading($("#platform-objective-save"), "Enregistrement...", async () => {
        try {
          const response = await api.savePlatformObjective({
            branch: fieldValue("#platform-objective-branch") || state.calendarBranchFilter || "Groupe",
            poleId: pole.id,
            poleName: pole.name,
            catalogId: kpiId,
            period: fieldValue("#platform-objective-period"),
            target,
            unit: fieldValue("#platform-objective-unit"),
            frequency: fieldValue("#platform-objective-frequency"),
            distributionMode: fieldValue("#platform-objective-distribution"),
            responsible: fieldValue("#platform-objective-responsible") || pole.owner || "",
            validation: fieldValue("#platform-objective-validation") || "En attente",
            dataNature: fieldValue("#platform-objective-data-nature") || "Reel",
            sourceData: "Saisie interne Hub central",
          });
          applyCollectionResponse(response, "#platform-objective-status", `Objectif ${kpiId} enregistre.`);
        } catch (error) {
          console.warn("Saisie objectif indisponible.", error);
          setPlatformStatus("#platform-objective-status", "warning", `Enregistrement impossible: ${escapeHtml(error.message)}`);
          showToast(error.message || "Impossible d'enregistrer l'objectif.");
        }
      });
    });

    $("#platform-calculation-form")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!api?.savePlatformCalculation) {
        showToast("Collecte integree indisponible sur ce serveur.");
        return;
      }
      const pole = selectedPoleById(fieldValue("#platform-calculation-pole") || state.currentPlatformCalculationPole);
      const kpiId = fieldValue("#platform-calculation-kpi");
      const entryMode = fieldValue("#platform-calculation-entry-mode") || "elements";
      const entryModeLabel = $("#platform-calculation-entry-mode")?.selectedOptions?.[0]?.textContent?.trim() || entryMode;
      const elements = [1, 2, 3].map((index) => ({
        label: fieldValue(`#platform-calculation-element-${index}`),
        value: fieldValue(`#platform-calculation-value-${index}`),
      }));
      if (!pole?.id || !kpiId || !fieldValue("#platform-calculation-date")) {
        setPlatformStatus("#platform-calculation-status", "warning", "Renseignez la date, le pays, le pole et le KPI.");
        return;
      }
      await withLoading($("#platform-calculation-save"), "Enregistrement...", async () => {
        try {
          const response = await api.savePlatformCalculation({
            branch: fieldValue("#platform-calculation-branch") || state.calendarBranchFilter || "Groupe",
            poleId: pole.id,
            poleName: pole.name,
            catalogId: kpiId,
            date: fieldValue("#platform-calculation-date"),
            entryMode,
            entryModeLabel,
            directValue: fieldValue("#platform-calculation-direct-value"),
            elements,
            validation: fieldValue("#platform-calculation-validation") || "En attente",
            dataNature: fieldValue("#platform-calculation-data-nature") || "Reel",
          });
          applyCollectionResponse(response, "#platform-calculation-status", `Donnee ${kpiId} enregistree.`);
        } catch (error) {
          console.warn("Saisie donnees de calcul indisponible.", error);
          setPlatformStatus("#platform-calculation-status", "warning", `Enregistrement impossible: ${escapeHtml(error.message)}`);
          showToast(error.message || "Impossible d'enregistrer la donnee.");
        }
      });
    });

    const referenceKoboFields = [
      { mappedTo: "id", inputId: "#admin-kobo-reference-id-field", defaultValue: "id_kpi_final" },
      { mappedTo: "branch", inputId: "#admin-kobo-reference-branch-field", defaultValue: "pays_filiale" },
      { mappedTo: "category", inputId: "#admin-kobo-reference-category-field", defaultValue: "categorie" },
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
      { mappedTo: "performanceDirection", inputId: "#admin-kobo-reference-performance-direction-field", defaultValue: "sens_performance" },
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
      { mappedTo: "branch", inputId: "#admin-kobo-calculation-branch-field", defaultValue: "pays_filiale" },
      { mappedTo: "pole", inputId: "#admin-kobo-calculation-pole-field", defaultValue: "pole_id" },
      { mappedTo: "kpi", inputId: "#admin-kobo-calculation-kpi-field", defaultValue: "id_kpi" },
      { mappedTo: "period", inputId: "#admin-kobo-calculation-period-field", defaultValue: "periode_reporting" },
      { mappedTo: "date", inputId: "#admin-kobo-calculation-date-field", defaultValue: "date_collecte" },
      { mappedTo: "entryMode", inputId: "#admin-kobo-calculation-entry-mode-field", defaultValue: "mode_saisie_donnee" },
      { mappedTo: "directValue", inputId: "#admin-kobo-calculation-direct-value-field", defaultValue: "valeur_realisee" },
      { mappedTo: "element1", inputId: "#admin-kobo-calculation-element1-field", defaultValue: "element_id_1" },
      { mappedTo: "value1", inputId: "#admin-kobo-calculation-value1-field", defaultValue: "valeur_element_1" },
      { mappedTo: "element2", inputId: "#admin-kobo-calculation-element2-field", defaultValue: "element_id_2" },
      { mappedTo: "value2", inputId: "#admin-kobo-calculation-value2-field", defaultValue: "valeur_element_2" },
      { mappedTo: "element3", inputId: "#admin-kobo-calculation-element3-field", defaultValue: "element_id_3" },
      { mappedTo: "value3", inputId: "#admin-kobo-calculation-value3-field", defaultValue: "valeur_element_3" },
      { mappedTo: "element", inputId: "#admin-kobo-calculation-element-field", defaultValue: "element_id" },
      { mappedTo: "value", inputId: "#admin-kobo-calculation-value-field", defaultValue: "valeur_element" },
      { mappedTo: "validation", inputId: "#admin-kobo-calculation-validation-field", defaultValue: "validation_hierarchique" },
    ];
    const monthlyObjectiveKoboFields = [
      { mappedTo: "branch", inputId: "#admin-kobo-monthly-objective-branch-field", defaultValue: "pays_filiale" },
      { mappedTo: "pole", inputId: "#admin-kobo-monthly-objective-pole-field", defaultValue: "pole" },
      { mappedTo: "kpi", inputId: "#admin-kobo-monthly-objective-kpi-field", defaultValue: "id_kpi" },
      { mappedTo: "period", inputId: "#admin-kobo-monthly-objective-period-field", defaultValue: "periode_objectif" },
      { mappedTo: "target", inputId: "#admin-kobo-monthly-objective-target-field", defaultValue: "objectif_mensuel" },
      { mappedTo: "unit", inputId: "#admin-kobo-monthly-objective-unit-field", defaultValue: "unite" },
      { mappedTo: "frequency", inputId: "#admin-kobo-monthly-objective-frequency-field", defaultValue: "frequence" },
      { mappedTo: "distributionMode", inputId: "#admin-kobo-monthly-objective-distribution-field", defaultValue: "mode_repartition" },
      { mappedTo: "sourceData", inputId: "#admin-kobo-monthly-objective-source-field", defaultValue: "source_objectif" },
      { mappedTo: "responsible", inputId: "#admin-kobo-monthly-objective-responsible-field", defaultValue: "responsable_objectif" },
      { mappedTo: "validation", inputId: "#admin-kobo-monthly-objective-validation-field", defaultValue: "validation_direction" },
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
      state[stateKey] = { role, serverUrl, formId, mappedFields, mode, status: "Actif", detail };
      rememberKoboSources();
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
      const hasServerToken = Boolean(state.koboAutoSync?.tokenConfigured);
      if (!token && !hasServerToken) {
        updateAdminKoboStatus(
          config.statusId,
          "warning",
          "Renseignez le token API Kobo ou configurez PMS_KOBO_API_TOKEN sur Render."
        );
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
        if (Array.isArray(result.objectives)) {
          state.kpiObjectives = result.objectives;
        }
        if (Array.isArray(result.kpiDailyDates)) {
          state.kpiDailyDates = result.kpiDailyDates;
        }
        if (Array.isArray(result.koboSubmissions)) {
          state.koboSubmissions = result.koboSubmissions.filter((item) => OPERATIONAL_KOBO_ROLES.has(item.sourceRole));
        }
        if (result.kpiCalculationQuality) {
          state.kpiCalculationQuality = result.kpiCalculationQuality;
        }
        if (Array.isArray(result.koboAnomalies)) {
          state.koboAnomalies = result.koboAnomalies;
        } else if (Array.isArray(result.kpiCalculationQuality?.anomalies)) {
          state.koboAnomalies = result.kpiCalculationQuality.anomalies;
        }
        mergeKoboSources(result.koboSources);
        if (result.koboDataAudit) {
          state.koboDataAudit = result.koboDataAudit;
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
          detail: "KPI et formules de calcul par pole.",
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
          detail: "KPI et formules de calcul par pole.",
          successLabel: "Formulaire KPI et formules",
          fieldType: "Champ referentiel KPI",
          fields: referenceKoboFields,
        })
      );
    }

    if (adminKoboMonthlyObjectiveButton) {
      adminKoboMonthlyObjectiveButton.addEventListener("click", () =>
        saveAdminKoboSource({
          role: "objectifsMensuels",
          stateKey: "monthlyObjectiveKoboSource",
          statusId: "#admin-kobo-monthly-objective-status",
          serverInputId: "#admin-kobo-monthly-objective-server",
          formInputId: "#admin-kobo-monthly-objective-form-id",
          mode: "KoboCollect Objectifs mensuels",
          detail: "Objectifs mensuels par pays / filiale, pole, KPI et mois.",
          successLabel: "Formulaire objectifs mensuels",
          fieldType: "Champ objectifs mensuels",
          fields: monthlyObjectiveKoboFields,
        })
      );
    }

    if (adminKoboMonthlyObjectiveSyncButton) {
      adminKoboMonthlyObjectiveSyncButton.addEventListener("click", () =>
        syncAdminKoboSource({
          button: adminKoboMonthlyObjectiveSyncButton,
          role: "objectifsMensuels",
          stateKey: "monthlyObjectiveKoboSource",
          statusId: "#admin-kobo-monthly-objective-status",
          serverInputId: "#admin-kobo-monthly-objective-server",
          formInputId: "#admin-kobo-monthly-objective-form-id",
          tokenInputId: "#admin-kobo-monthly-objective-token",
          mode: "KoboCollect Objectifs mensuels",
          detail: "Objectifs mensuels par pays / filiale, pole, KPI et mois.",
          successLabel: "Formulaire objectifs mensuels",
          fieldType: "Champ objectifs mensuels",
          fields: monthlyObjectiveKoboFields,
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

    if (refreshDatabaseButton) {
      refreshDatabaseButton.addEventListener("click", () => {
        loadDatabaseOverview({ renderStart: true });
      });
    }

    if (databaseTableSelect) {
      databaseTableSelect.addEventListener("change", (event) => {
        loadDatabaseTable(event.target.value);
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

    document.addEventListener("click", async (event) => {
      const previewButton = event.target.closest("[data-preview-user]");
      if (!previewButton) return;
      const user = state.platformUsers.find((item) => String(item.id) === String(previewButton.dataset.previewUser));
      if (!user) {
        showToast("Utilisateur introuvable.");
        return;
      }
      state.currentUserAccessUserId = user.id;
      state.currentUserAccessProfile = user.profile || state.currentUserAccessProfile;
      state.currentUserAccessBranch = user.defaultBranch || state.currentUserAccessBranch || "Groupe";
      state.currentUserAccessPole = user.defaultPoleId || state.currentUserAccessPole;
      const matchingRule = state.accessRules.find(
        (rule) => String(rule.userId || "") === String(user.id) || rule.responsible === user.fullName || rule.email === user.email
      );
      state.activeAccessRuleId = matchingRule?.id || null;
      renderAdmin(state);
      setAdminTab("access");
      showToast(`Vue de ${user.fullName} chargee.`);
    });

    document.addEventListener("click", async (event) => {
      const statusButton = event.target.closest("[data-user-status]");
      if (!statusButton) return;
      const userId = statusButton.dataset.userStatus;
      const nextStatus = statusButton.dataset.nextStatus || "Actif";
      const user = state.platformUsers.find((item) => String(item.id) === String(userId));
      if (!user) {
        showToast("Utilisateur introuvable.");
        return;
      }
      let savedUser = { ...user, status: nextStatus };
      try {
        if (api?.updateUserStatus) {
          savedUser = { ...savedUser, ...(await api.updateUserStatus(userId, nextStatus)) };
        }
        state.platformUsers = state.platformUsers.map((item) =>
          String(item.id) === String(userId) ? savedUser : item
        );
        renderAdmin(state);
        setAdminTab("access");
        showToast(`${savedUser.fullName} est maintenant ${nextStatus}.`);
      } catch (error) {
        console.warn("Mise a jour statut utilisateur indisponible.", error);
        showToast(error.message || "Impossible de modifier le statut utilisateur.");
      }
    });

    document.addEventListener("click", async (event) => {
      const resetButton = event.target.closest("[data-reset-user-password]");
      if (!resetButton) return;
      const userId = resetButton.dataset.resetUserPassword;
      const user = state.platformUsers.find((item) => String(item.id) === String(userId));
      if (!user) {
        showToast("Utilisateur introuvable.");
        return;
      }
      const password = window.prompt(
        `Nouveau mot de passe temporaire pour ${user.fullName}`,
        "Palladium@2026!"
      );
      if (password === null) return;
      if (!password || password.length < 8) {
        showToast("Le mot de passe temporaire doit contenir au moins 8 caracteres.");
        return;
      }
      try {
        const response = api?.resetUserPassword
          ? await api.resetUserPassword(userId, password)
          : { ...user, temporaryPassword: password };
        state.platformUsers = state.platformUsers.map((item) =>
          String(item.id) === String(userId) ? { ...item, ...response } : item
        );
        renderAdmin(state);
        setAdminTab("access");
        showToast(`Mot de passe reinitialise: ${response.temporaryPassword || password}`);
      } catch (error) {
        console.warn("Reinitialisation mot de passe indisponible.", error);
        showToast(error.message || "Impossible de reinitialiser le mot de passe.");
      }
    });

    document.addEventListener("click", (event) => {
      const button = event.target.closest("[data-database-table]");
      if (!button) return;
      loadDatabaseTable(button.dataset.databaseTable);
    });
  }

  function mountPlatformCollectionPanel() {
    const target = $("#platform-collection-root");
    const panel = $("#platform-collection-panel");
    if (!target || !panel || panel.parentElement === target) return;
    target.appendChild(panel);
  }

  async function init() {
    const savedSession = loadSavedSession();
    let restoredSession = false;
    if (savedSession?.user) {
      state.currentUser = savedSession.user;
      state.currentPermissions = savedSession.permissions || {};
      state.userAccessScope = savedSession.access || [];
      restoredSession = await hydrateFromDatabase();
      if (!restoredSession) {
        clearSession();
        state.currentUser = null;
        state.currentPermissions = {};
        state.userAccessScope = [];
      }
    }
    applyCalculatedKpisToReporting();
    syncPeriodFilterFromCalendar();
    mountPlatformCollectionPanel();
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
    if (savedSession && restoredSession) {
      applyAuthenticatedSession(savedSession, { toast: false });
    } else {
      showLogin();
    }
  }

  init();
})();
