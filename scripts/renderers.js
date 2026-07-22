(function () {
  const { PMS_DATA } = window;

  function $(selector) {
    return document.querySelector(selector);
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function statusPill(label, status) {
    return `<span class="rag-pill ${escapeHtml(status)}">${escapeHtml(label)}</span>`;
  }

  function filterRows(rows, query, fields) {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return rows;
    return rows.filter((row) =>
      fields.some((field) => String(row[field] ?? "").toLowerCase().includes(normalized))
    );
  }

  function normalizeLookup(value) {
    return String(value ?? "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  }

  function getCountryOptions() {
    const countries = Array.isArray(PMS_DATA.countries) ? PMS_DATA.countries : [];
    if (countries.length) return countries;
    return [
      { id: "Groupe", code: "GROUPE", name: "Groupe", score: 82, quality: 88, readiness: 74, kpiCount: 0, activePoles: 0, lateSubmissions: 0, status: "Consolide", className: "green" },
      ...(PMS_DATA.branchScores || []).map((branch) => ({
        id: branch.name,
        code: branch.name,
        name: branch.name,
        score: branch.score,
        quality: branch.score,
        readiness: branch.score,
        kpiCount: 0,
        activePoles: PMS_DATA.reporting?.poles?.length || 0,
        lateSubmissions: 0,
        status: "A verifier",
        className: "gray",
      })),
    ];
  }

  function ruleCountryValue(rule = {}) {
    return rule.branch || rule.countryName || rule.country || "Groupe";
  }

  function countryFilterValue(country = {}) {
    return country.name || country.id || "Groupe";
  }

  function isGroupCountry(country = {}) {
    const normalized = normalizeLookup(country.id || country.name);
    return normalized === "groupe" || normalized === "groupe consolide";
  }

  function findCountryByValue(value) {
    const normalized = normalizeLookup(value || "Groupe");
    return (
      getCountryOptions().find((country) =>
        [country.id, country.code, country.name].some((item) => normalizeLookup(item) === normalized)
      ) || getCountryOptions()[0]
    );
  }

  function accessRuleMatchesCountry(rule = {}, country = {}) {
    const ruleCountry = findCountryByValue(ruleCountryValue(rule));
    if (isGroupCountry(ruleCountry)) return true;
    if (isGroupCountry(country)) return false;
    return matchesCountryScope(ruleCountry.name, country);
  }

  function getAccessRulesForState(state = {}) {
    if (!state.currentUser || state.currentPermissions?.administration) return [];
    const sessionRules = Array.isArray(state.userAccessScope)
      ? state.userAccessScope.filter((rule) => rule?.poleId)
      : [];
    const fallbackRule = (state.accessRules || []).find((rule) => rule.id === state.activeAccessRuleId);
    return sessionRules.length ? sessionRules : fallbackRule ? [fallbackRule] : [];
  }

  function getAuthorizedCountryOptions(state = {}) {
    if (!state.currentUser || state.currentPermissions?.administration) return getCountryOptions();
    const rules = getAccessRulesForState(state);
    if (!rules.length) return [];
    if (rules.some((rule) => isGroupCountry(findCountryByValue(ruleCountryValue(rule))))) {
      return getCountryOptions();
    }
    const options = getCountryOptions().filter((country) =>
      !isGroupCountry(country) &&
      rules.some((rule) => matchesCountryScope(ruleCountryValue(rule), country))
    );
    return options;
  }

  function getActiveCountry(state = {}) {
    const authorizedCountries = getAuthorizedCountryOptions(state);
    const requestedCountry = findCountryByValue(state.calendarBranchFilter || $("#branch-filter")?.value || "Groupe");
    if (!authorizedCountries.length) return requestedCountry;
    if (authorizedCountries.some((country) => country.name === requestedCountry.name)) {
      return requestedCountry;
    }
    return authorizedCountries[0];
  }

  function countryOptionsHtml(selectedValue, state = {}) {
    const selectedCountry = getActiveCountry({ ...state, calendarBranchFilter: selectedValue });
    const selected = countryFilterValue(selectedCountry);
    return getAuthorizedCountryOptions(state)
      .map((country) => {
        const value = countryFilterValue(country);
        return `<option value="${escapeHtml(value)}" ${value === selected ? "selected" : ""}>${escapeHtml(country.name)}</option>`;
      })
      .join("");
  }

  function countryStatusClass(country = {}) {
    if (country.className) return country.className;
    if (country.score >= 80) return "green";
    if (country.score >= 70) return "amber";
    return "red";
  }

  function matchesCountryScope(value, country = {}) {
    if (isGroupCountry(country)) return true;
    const normalizedValue = normalizeLookup(value);
    if (!normalizedValue) return false;
    return [country.id, country.code, country.name].some((item) => {
      const normalizedCountry = normalizeLookup(item);
      return normalizedValue === normalizedCountry || normalizedValue.includes(normalizedCountry) || normalizedCountry.includes(normalizedValue);
    });
  }

  function poleAvailableForCountry(pole = {}, country = {}) {
    if (isGroupCountry(country)) return true;
    const scopes = PMS_DATA.poleCountryScopes?.[pole.id];
    if (!Array.isArray(scopes) || !scopes.length) return true;
    return scopes.some((scopeCountry) => matchesCountryScope(scopeCountry, country));
  }

  function getCountryScopedPoles(state = {}, poles = []) {
    const country = getActiveCountry(state);
    const sourcePoles = arguments.length >= 2 ? poles : PMS_DATA.reporting.poles;
    return sourcePoles.filter((pole) => poleAvailableForCountry(pole, country));
  }

  function filterRowsByCountry(rows = [], country = {}) {
    if (isGroupCountry(country)) return rows;
    return rows.filter((row) => matchesCountryScope(row.branch || row.country || row.filiale || row.pays, country));
  }

  function cadenceProfileForPole(pole = {}) {
    return (
      PMS_DATA.collectionCadenceByPole?.[pole.id] || {
        cadence: pole.collectionCadence || "Selon referentiel KPI",
        primary: pole.collectionPrimary || "A preciser",
        sourceSheet: pole.collectionSourceSheet || "",
        expectedDelay: pole.collectionExpectedDelay || "",
        detail: "Cadence issue du referentiel KPI ou a confirmer dans KoboCollect.",
      }
    );
  }

  function normalizeCadence(value) {
    const normalized = normalizeLookup(value);
    if (normalized.includes("horaire")) return "Horaire";
    if (normalized.includes("jour") || normalized.includes("quotid")) return "Journalier";
    if (normalized.includes("hebdo") || normalized.includes("semaine")) return "Hebdomadaire";
    if (normalized.includes("mens")) return "Mensuel";
    if (normalized.includes("trimes")) return "Trimestriel";
    if (normalized.includes("ann")) return "Annuel";
    return value || "A preciser";
  }

  function cadenceClass(value) {
    const cadence = normalizeCadence(value);
    if (cadence === "Horaire" || cadence === "Journalier") return "green";
    if (cadence === "Hebdomadaire") return "amber";
    if (cadence === "Mensuel" || cadence === "Trimestriel") return "gray";
    return "gray";
  }

  function kpiCollectionFrequency(kpi = {}, pole = {}) {
    const cadence = kpi.collectionFrequency || kpi.frequency || "";
    if (cadence) return cadence;
    const source = normalizeLookup(kpi.source);
    if (source.includes("horaire")) return "Horaire";
    if (source.includes("jour")) return "Journalier";
    if (source.includes("hebd")) return "Hebdomadaire";
    if (source.includes("mens")) return "Mensuel";
    return cadenceProfileForPole(pole).cadence || "A preciser";
  }

  function matchesCadenceFilter(value, filterValue) {
    if (!filterValue || filterValue === "Tous") return true;
    const normalizedValue = normalizeLookup(value);
    const normalizedFilter = normalizeLookup(filterValue);
    if (normalizedFilter === "journalier") {
      return normalizedValue.includes("jour") || normalizedValue.includes("quotid") || normalizedValue.includes("horaire");
    }
    if (normalizedFilter === "hebdomadaire") {
      return normalizedValue.includes("hebdo") || normalizedValue.includes("semaine");
    }
    if (normalizedFilter === "mensuel") {
      return normalizedValue.includes("mens");
    }
    if (normalizedFilter === "horaire") {
      return normalizedValue.includes("horaire");
    }
    return normalizedValue.includes(normalizedFilter);
  }

  function filteredKpisByCadence(kpis = [], pole = {}, filterValue = "Tous") {
    return kpis.filter((kpi) => matchesCadenceFilter(kpiCollectionFrequency(kpi, pole), filterValue));
  }

  function cadenceOptionsHtml(selectedValue = "Tous") {
    return ["Tous", "Horaire", "Journalier", "Hebdomadaire", "Mensuel"]
      .map(
        (option) => `<option value="${escapeHtml(option)}" ${option === selectedValue ? "selected" : ""}>${escapeHtml(option)}</option>`
      )
      .join("");
  }

  const LOWER_BETTER_TERMS = [
    "abandon",
    "absence",
    "absenteisme",
    "anomalie",
    "creance",
    "cout",
    "defaut",
    "delai",
    "dmt",
    "duree",
    "erreur",
    "escalade",
    "incident",
    "indisponibilite",
    "malus",
    "mttr",
    "oos",
    "out of stock",
    "perte",
    "retard",
    "risque",
    "rupture",
    "turnover",
  ];

  function parseMetricNumber(value) {
    const text = String(value ?? "").trim().toLowerCase().replace(",", ".");
    const hourMatch = text.match(/(-?\d+(?:\.\d+)?)\s*h(?:\s*(\d{1,2}))?/);
    if (hourMatch) {
      return Number(hourMatch[1]) * 60 + Number(hourMatch[2] || 0);
    }
    const numberMatch = text.replace(/\s+/g, "").match(/-?\d+(?:\.\d+)?/);
    return numberMatch ? Number(numberMatch[0]) : null;
  }

  function extractTargetNumbers(value) {
    return (String(value ?? "").match(/-?\d[\d\s]*(?:[,.]\d+)?/g) || [])
      .map((item) => Number(item.replace(/\s+/g, "").replace(",", ".")))
      .filter((item) => Number.isFinite(item));
  }

  function isLowerBetterKpi(kpi = {}) {
    const direction = normalizeLookup(kpi.performanceDirection || kpi.sensPerformance || kpi.orientationPerformance || "");
    if (direction.includes("lowerbetter") || direction.includes("baisse") || direction.includes("plus bas") || direction.includes("moins mieux")) {
      return true;
    }
    if (direction.includes("higherbetter") || direction.includes("hausse") || direction.includes("plus haut")) {
      return false;
    }
    const target = String(kpi.target || "");
    const normalized = normalizeLookup(`${kpi.name || ""} ${kpi.category || ""} ${kpi.formula || ""} ${target}`);
    return target.includes("<") || target.includes("≤") || LOWER_BETTER_TERMS.some((term) => normalized.includes(term));
  }

  function targetValueForKpi(kpi = {}) {
    if (/\d+(?:[,.]\d+)?\s*h/i.test(String(kpi.target || ""))) {
      return parseMetricNumber(kpi.target);
    }
    const numbers = extractTargetNumbers(kpi.target);
    if (!numbers.length) return null;
    if (String(kpi.target || "").includes(">") && numbers.length >= 2) return Math.min(...numbers);
    if (String(kpi.target || "").includes("<") && numbers.length >= 2) return Math.max(...numbers);
    if (numbers.length >= 2 && !isLowerBetterKpi(kpi)) return Math.min(...numbers);
    return numbers[0];
  }

  function formatDeltaPercent(value) {
    if (!Number.isFinite(value)) return "--";
    const absolute = Math.abs(value).toLocaleString("fr-FR", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    if (Math.abs(value) < 0.005) return "0,00%";
    return `${value > 0 ? "+" : "-"}${absolute}%`;
  }

  function formatRatioPercent(value) {
    if (!Number.isFinite(value)) return "--";
    return `${value.toLocaleString("fr-FR", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}%`;
  }

  function formatSignedNumber(value) {
    if (!Number.isFinite(value)) return "--";
    const absolute = Math.abs(value).toLocaleString("fr-FR", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    });
    if (Math.abs(value) < 0.005) return "0";
    return `${value > 0 ? "+" : "-"}${absolute}`;
  }

  function trendMetricClass(rawChange, lowerBetter) {
    if (!Number.isFinite(rawChange) || Math.abs(rawChange) < 0.005) return "neutral";
    const improved = lowerBetter ? rawChange < 0 : rawChange > 0;
    return improved ? "positive" : "negative";
  }

  function trendPeriodDate(period) {
    const value = String(period || "").trim();
    const compactDate = value.match(/\b(20\d{2})(\d{2})(\d{2})\b/);
    if (compactDate) return new Date(Number(compactDate[1]), Number(compactDate[2]) - 1, Number(compactDate[3]));
    const isoDate = value.match(/\b(20\d{2})[-/](\d{1,2})[-/](\d{1,2})\b/);
    if (isoDate) return new Date(Number(isoDate[1]), Number(isoDate[2]) - 1, Number(isoDate[3]));
    const week = normalizeLookup(value).match(/\b(?:s|w|semaine)\s*(\d{1,2})\s*(20\d{2})\b/);
    if (week) return new Date(Number(week[2]), 0, 1 + (Number(week[1]) - 1) * 7);
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
    return monthName && year ? new Date(Number(year[1]), monthIndex[monthName], 1) : null;
  }

  function trendPointRank(point, index) {
    const date = trendPeriodDate(point.period);
    return date ? date.getTime() : index;
  }

  function normalizeTrendHistory(kpi = {}) {
    return (Array.isArray(kpi.trendHistory) ? kpi.trendHistory : [])
      .map((point, index) => ({
        period: point.period,
        value: Number.isFinite(Number(point.value)) ? Number(point.value) : parseMetricNumber(point.valueLabel),
        rank: trendPointRank(point, index),
      }))
      .filter((point) => Number.isFinite(point.value))
      .sort((left, right) => left.rank - right.rank);
  }

  function metricFromPoints(label, latest, previous, lowerBetter) {
    if (!latest || !previous || !Number.isFinite(latest.value) || !Number.isFinite(previous.value) || previous.value === 0) {
      return { label, display: "--", className: "empty" };
    }
    const rawChange = ((latest.value - previous.value) / Math.abs(previous.value)) * 100;
    return {
      label,
      display: formatDeltaPercent(rawChange),
      className: trendMetricClass(rawChange, lowerBetter),
    };
  }

  function priorPointByDays(points, latest, days) {
    const latestDate = trendPeriodDate(latest?.period);
    if (!latestDate) return null;
    const targetTime = latestDate.getTime() - days * 24 * 60 * 60 * 1000;
    return [...points]
      .reverse()
      .find((point) => {
        const date = trendPeriodDate(point.period);
        return date && date.getTime() <= targetTime;
      });
  }

  function currentMetricValue(kpi = {}) {
    const history = normalizeTrendHistory(kpi);
    if (history.length) return history[history.length - 1].value;
    if (Number.isFinite(Number(kpi.value))) return Number(kpi.value);
    return parseMetricNumber(kpi.value);
  }

  function metricFromTarget(kpi = {}) {
    if (kpi.vsTargetLabel && kpi.vsTargetLabel !== "--") {
      const ratio = Number(kpi.vsTargetValue);
      return {
        label: "Vs Target",
        display: kpi.vsTargetLabel,
        className: kpi.vsTargetClass || (Number.isFinite(ratio) ? (ratio >= 100 ? "positive" : "negative") : "empty"),
      };
    }
    const current = Number.isFinite(Number(kpi.monthToDateValue))
      ? Number(kpi.monthToDateValue)
      : Number.isFinite(Number(kpi.numericValue))
        ? Number(kpi.numericValue)
        : currentMetricValue(kpi);
    const target = Number.isFinite(Number(kpi.targetValue)) ? Number(kpi.targetValue) : targetValueForKpi(kpi);
    if (!Number.isFinite(current) || !Number.isFinite(target)) {
      return { label: "Vs Target", display: "--", className: "empty" };
    }
    const lowerBetter = isLowerBetterKpi(kpi);
    const ratio = lowerBetter
      ? current === 0
        ? target >= 0 ? 100 : null
        : (target / current) * 100
      : target === 0
        ? current === 0 ? 100 : null
        : (current / target) * 100;
    if (!Number.isFinite(ratio)) {
      return { label: "Vs Target", display: "--", className: "empty" };
    }
    return {
      label: "Vs Target",
      display: formatRatioPercent(ratio),
      className: ratio >= 100 ? "positive" : "negative",
    };
  }

  function fallbackTrendMetric(kpi = {}, pole = {}, label) {
    const trend = String(kpi.trend || "").trim();
    if (!trend || ["calcul kobo", "reference kobo", "a synchroniser", "stable"].includes(normalizeLookup(trend))) {
      return { label, display: "--", className: trend && normalizeLookup(trend) === "stable" ? "neutral" : "empty" };
    }
    const cadence = normalizeLookup(`${kpiCollectionFrequency(kpi, pole)} ${kpi.source || ""}`);
    const matchesLabel =
      (label === "DoD" && (cadence.includes("jour") || cadence.includes("horaire"))) ||
      (label === "WoW" && (cadence.includes("hebd") || cadence.includes("semaine"))) ||
      (label === "MoM" && cadence.includes("mens"));
    if (!matchesLabel) return { label, display: "--", className: "empty" };
    const rawChange = parseMetricNumber(trend);
    return {
      label,
      display: trend,
      className: trendMetricClass(rawChange, isLowerBetterKpi(kpi)),
    };
  }

  function kpiTrendMetrics(kpi = {}, pole = {}) {
    const history = normalizeTrendHistory(kpi);
    const lowerBetter = isLowerBetterKpi(kpi);
    const latest = history[history.length - 1];
    const previous = history[history.length - 2];
    const cadence = normalizeLookup(kpiCollectionFrequency(kpi, pole));
    const dod = cadence.includes("jour") || cadence.includes("horaire")
      ? metricFromPoints("DoD", latest, previous, lowerBetter)
      : { label: "DoD", display: "--", className: "empty" };
    const wowReference =
      cadence.includes("jour") || cadence.includes("horaire")
        ? priorPointByDays(history, latest, 7)
        : previous;
    const momReference =
      cadence.includes("jour") || cadence.includes("horaire")
        ? priorPointByDays(history, latest, 30)
        : cadence.includes("hebd") || cadence.includes("semaine")
          ? history[Math.max(0, history.length - 5)]
          : previous;
    const wow = cadence.includes("mens")
      ? { label: "WoW", display: "--", className: "empty" }
      : metricFromPoints("WoW", latest, wowReference, lowerBetter);
    const mom = metricFromPoints("MoM", latest, momReference, lowerBetter);
    return [dod, wow, mom, metricFromTarget(kpi)].map((metric) =>
      metric.display === "--" && metric.label !== "Vs Target" ? fallbackTrendMetric(kpi, pole, metric.label) : metric
    );
  }

  function renderTrendStrip(kpi = {}, pole = {}) {
    return `
      <div class="kpi-trend-strip" aria-label="Tendances KPI">
        ${kpiTrendMetrics(kpi, pole)
          .map(
            (metric) => `
              <div class="kpi-trend-cell ${escapeHtml(metric.className)}">
                <span>${escapeHtml(metric.label)}</span>
                <strong>${escapeHtml(metric.display)}</strong>
              </div>
            `
          )
          .join("")}
      </div>
    `;
  }

  function getObjectiveCatalogProfile(kpi, pole = {}) {
    const template = PMS_DATA.objectiveKoboTemplate || {};
    const profiles = template.catalogProfiles || [];
    const kpiName = typeof kpi === "string" ? kpi : kpi?.name;
    const normalizedName = normalizeLookup(kpiName);
    const matchedProfile = profiles.find((profile) =>
      (profile.aliases || [profile.title]).some((alias) => {
        const normalizedAlias = normalizeLookup(alias);
        return normalizedAlias === normalizedName || normalizedName.includes(normalizedAlias) || normalizedAlias.includes(normalizedName);
      })
    );

    if (matchedProfile) return { ...matchedProfile, fromCatalog: true };

    const formulaProfile = (PMS_DATA.formulaDictionary || []).find((item) => {
      const normalizedFormulaName = normalizeLookup(item.name);
      return normalizedFormulaName === normalizedName || normalizedFormulaName.includes(normalizedName) || normalizedName.includes(normalizedFormulaName);
    });

    if (formulaProfile) {
      return {
        id: `FORM-${formulaProfile.id}`,
        title: formulaProfile.name,
        definition: formulaProfile.usage || "Reference issue de la fiche de collecte GMC.",
        type: formulaProfile.category || "KPI metier",
        unit: formulaProfile.target?.includes("%") || formulaProfile.name?.includes("%") ? "% (Pourcentage)" : "Selon formule",
        formula: formulaProfile.formula || "A completer",
        target: formulaProfile.target || "A completer",
        collectionFrequency: formulaProfile.frequency || "A preciser",
        reportingFrequency: formulaProfile.frequency || "A preciser",
        dataSource: formulaProfile.source || "GMC_FICHE_COLLECTE_V2.xlsx",
        responsible: pole.owner || "Responsable KPI",
        respondent: pole.owner || "Producteur donnee",
        respondentFunction: "Responsable du pole",
        year: "2026",
        hierarchicalValidation: "Sous reserve",
        validator: "N+1",
        reference: formulaProfile.source || "FORMULE",
        documentStatus: "Reference fichier collecte",
        attention: "Valeur calculee automatiquement lorsque le formulaire donnees de calcul est synchronise.",
        fromCatalog: true,
      };
    }

    return {
      id: "A definir",
      title: kpiName || "KPI a selectionner",
      definition: "A completer depuis le formulaire KoboCollect objectifs.",
      type: "A preciser",
      unit: kpi?.value?.includes("%") || kpi?.target?.includes("%") ? "% (Pourcentage)" : "Autre",
      formula: "A completer dans la fiche KPI.",
      target: kpi?.target || "",
      collectionFrequency: "A preciser",
      reportingFrequency: "A preciser",
      dataSource: kpi?.source || "A renseigner",
      responsible: pole.owner || "Responsable KPI",
      respondent: pole.owner || "Producteur donnee",
      respondentFunction: "A preciser",
      year: "2026",
      hierarchicalValidation: "Sous reserve",
      validator: "N+1",
      reference: template.sourceFile || "Catalogue KPI",
      documentStatus: "A preciser",
      attention: "Fiche catalogue a completer ou a rapprocher du fichier source.",
      fromCatalog: false,
    };
  }

  function renderBranches() {
    const target = $("#branch-bars");
    if (!target) return;
    const branches = getCountryOptions()
      .filter((country) => !isGroupCountry(country))
      .map((country) => countryDataProfile(country));
    target.innerHTML = branches
      .map(
        (branch) => `
          <div class="branch-bar-row">
            <strong>${escapeHtml(branch.name)}</strong>
            <div class="bar-track"><div class="bar-fill ${escapeHtml(branch.hasData ? scoreClass(branch.score) : "gray")}" style="width:${branch.hasData ? branch.score : 0}%"></div></div>
            <span>${branch.hasData ? branch.score : "--"}</span>
          </div>
        `
      )
      .join("");
  }

  function countryPoleScope(country = {}) {
    const poles = PMS_DATA.reporting?.poles || [];
    return poles.filter((pole) => poleAvailableForCountry(pole, country));
  }

  function countryDataProfile(country = {}) {
    const poles = countryPoleScope(country);
    const dataPoles = poles.filter(hasPoleData);
    const hasData = dataPoles.length > 0;
    const score = hasData ? averageNumber(dataPoles.map((pole) => pole.score)) : null;
    const quality = hasData ? averageNumber(dataPoles.map((pole) => pole.quality)) : null;
    const lateSubmissions = dataPoles.reduce((sum, pole) => sum + Number(pole.lateSubmissions || 0), 0);
    const kpiCount = poles.reduce((sum, pole) => sum + Number(pole.kpiCount || 0), 0);
    return {
      ...country,
      score,
      quality,
      kpiCount,
      lateSubmissions,
      activePoles: poles.length,
      hasData,
      status: hasData ? (lateSubmissions ? "A surveiller" : "Alimente") : "En attente Kobo",
      className: hasData ? (lateSubmissions ? "amber" : scoreClass(score)) : "gray",
    };
  }

  function renderCountryDashboard(state = {}) {
    const cards = $("#country-summary-cards");
    const table = $("#country-performance-table");
    const scope = $("#country-active-scope");
    if (!cards && !table && !scope) return;

    const activeCountry = getActiveCountry(state);
    const isGroup = isGroupCountry(activeCountry);
    const countries = getAuthorizedCountryOptions(state).filter((country) => !isGroupCountry(country));
    const visibleCountries = (isGroup ? countries : countries.filter((country) => country.name === activeCountry.name)).map(countryDataProfile);
    const safeCountries = (visibleCountries.length ? visibleCountries : countries.map(countryDataProfile));
    const dataCountries = safeCountries.filter((country) => country.hasData);
    const average = (field) => (dataCountries.length ? averageNumber(dataCountries.map((country) => country[field])) : null);
    const totalKpis = safeCountries.reduce((sum, country) => sum + Number(country.kpiCount || 0), 0);
    const totalLate = safeCountries.reduce((sum, country) => sum + Number(country.lateSubmissions || 0), 0);
    const activeCountryProfile = countryDataProfile(activeCountry);
    const scopeClass = isGroup ? (dataCountries.length ? "green" : "gray") : activeCountryProfile.className;

    if (scope) {
      scope.className = `status-pill ${scopeClass}`;
      scope.textContent = isGroup ? "Groupe consolide" : activeCountry.name;
    }

    if (cards) {
      const summaryCards = [
        { label: isGroup ? "Pays suivis" : "Pays actif", value: isGroup ? safeCountries.length : activeCountry.code, hint: isGroup ? "perimetre consolide" : activeCountry.name },
        { label: "Score moyen", value: dataCountries.length ? average("score") : "--", hint: dataCountries.length ? "performance calculee" : "donnees Kobo attendues" },
        { label: "KPI attendus", value: totalKpis, hint: isGroup ? "tous pays" : "perimetre actif" },
        { label: "Retards Kobo", value: totalLate, hint: totalLate ? "a traiter" : "aucun retard" },
      ];
      cards.innerHTML = summaryCards
        .map(
          (card) => `
            <article class="country-score-card">
              <span>${escapeHtml(card.label)}</span>
              <strong>${escapeHtml(card.value)}</strong>
              <small>${escapeHtml(card.hint)}</small>
            </article>
          `
        )
        .join("");
    }

    if (table) {
      table.innerHTML = safeCountries.length
        ? safeCountries
            .map((country) => {
          const isSelected = country.name === activeCountry.name && !isGroup;
          const statusClass = country.className || countryStatusClass(country);
          return `
            <tr>
              <td>
                <strong>${escapeHtml(country.name)}</strong>
                <small class="country-code">${escapeHtml(country.code)}</small>
              </td>
              <td><strong>${escapeHtml(country.hasData ? country.score : "--")}</strong></td>
              <td>${escapeHtml(country.kpiCount)}</td>
              <td>${escapeHtml(country.hasData ? `${country.quality}%` : "--")}</td>
              <td>${statusPill(country.status, statusClass)}</td>
              <td>${escapeHtml(country.lateSubmissions)}</td>
              <td>
                <button class="ghost-action" type="button" data-country-filter="${escapeHtml(countryFilterValue(country))}" ${isSelected ? "disabled" : ""}>
                  ${isSelected ? "Selectionne" : "Choisir"}
                </button>
              </td>
            </tr>
          `;
            })
            .join("")
        : `<tr><td colspan="7">Aucun pays / filiale autorise pour ce profil.</td></tr>`;
    }
  }

  function renderExecutiveAlerts(state = {}) {
    const target = $("#executive-alerts");
    if (!target) return;
    const context = getDashboardContext(state);
    const alerts = dashboardCriticalRows(context, 3).filter((row) => hasKpiData(row.kpi));
    target.innerHTML = alerts.length
      ? alerts
          .map(
            (row) => `
              <article class="alert-item">
                <div>
                  <strong>${escapeHtml(row.kpi.name)}</strong>
                  <p>${escapeHtml(row.pole.name)} - ${escapeHtml(row.kpi.value)} vs cible ${escapeHtml(row.kpi.target)}</p>
                </div>
                ${statusPill(row.kpi.status === "red" ? "Critique" : "Vigilance", row.kpi.status)}
              </article>
            `
          )
          .join("")
      : `<div class="empty-kpi-state">Aucune alerte tant que les KPI ne sont pas calcules depuis Kobo.</div>`;
  }

  function renderSparkline(state = {}) {
    const target = $("#ipg-sparkline");
    if (!target) return;
    const context = getDashboardPoleContext(state);
    const values = scopedKpiDataRows(context.kpiRows)
      .flatMap((row) => (row.kpi.trendHistory || []).map((point) => Number(point.value)).filter(Number.isFinite))
      .slice(-6);
    target.innerHTML = values.length
      ? values
          .map((value) => {
            const height = Math.max(8, Math.min(100, Math.abs(value)));
            return `<div class="spark-bar" data-value="${escapeHtml(value)}" style="height:${height}%"></div>`;
          })
          .join("")
      : `<div class="spark-empty">En attente Kobo</div>`;
  }

  function renderCatalogStats() {
    const summary = PMS_DATA.catalogSummary;
    const kpiCount = $("#catalog-stat-kpis");
    const formulaCount = $("#catalog-stat-formulas");
    const groupCount = $("#catalog-stat-groups");
    const formCount = $("#catalog-stat-forms");
    const categories = $("#category-breakdown");
    const frequencies = $("#frequency-breakdown");

    if (kpiCount) kpiCount.textContent = summary.kpiCount;
    if (formulaCount) formulaCount.textContent = summary.formulaCount;
    if (groupCount) groupCount.textContent = summary.groupCount;
    if (formCount) formCount.textContent = summary.collectionDomains;

    if (categories) {
      categories.innerHTML = summary.categories
        .map(
          (item) => `
            <div class="breakdown-row">
              <span>${escapeHtml(item.name)}</span>
              <strong>${item.count}</strong>
            </div>
          `
        )
        .join("");
    }

    if (frequencies) {
      frequencies.innerHTML = summary.frequencies
        .map(
          (item) => `
            <div class="loss-row">
              <strong>${escapeHtml(item.name)} - ${item.count}</strong>
              <div><span style="width:${Math.min(item.count * 2, 100)}%"></span></div>
            </div>
          `
        )
        .join("");
    }
  }

  function parseIsoDate(value) {
    const [year, month, day] = String(value || "")
      .split("-")
      .map((part) => Number(part));
    if (!year || !month || !day) return null;
    return new Date(year, month - 1, day);
  }

  function dateToIso(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function addDays(date, days) {
    const next = new Date(date);
    next.setDate(next.getDate() + days);
    return next;
  }

  function formatDisplayDate(value) {
    const date = parseIsoDate(value);
    if (!date) return "A definir";
    return date.toLocaleDateString("fr-FR", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  }

  function calendarPeriodLabel(calendar = {}) {
    const start = formatDisplayDate(calendar.start);
    const end = formatDisplayDate(calendar.end);
    return start === end ? start : `${start} - ${end}`;
  }

  function compactDateValue(date) {
    return dateToIso(date).replaceAll("-", "");
  }

  function parseCalendarDateFromText(value) {
    const text = String(value || "").trim();
    const compactDate = text.match(/\b(20\d{2})(\d{2})(\d{2})\b/);
    if (compactDate) return new Date(Number(compactDate[1]), Number(compactDate[2]) - 1, Number(compactDate[3]));
    const isoDate = text.match(/\b(20\d{2})[-/](\d{1,2})[-/](\d{1,2})\b/);
    if (isoDate) return new Date(Number(isoDate[1]), Number(isoDate[2]) - 1, Number(isoDate[3]));
    const dmyDate = text.match(/\b(\d{1,2})[-/](\d{1,2})[-/](20\d{2})\b/);
    if (dmyDate) return new Date(Number(dmyDate[3]), Number(dmyDate[2]) - 1, Number(dmyDate[1]));
    return null;
  }

  function resultCalendarDate(result = {}) {
    return (
      parseIsoDate(result.periodEnd) ||
      parseIsoDate(result.periodStart) ||
      parseCalendarDateFromText(result.period)
    );
  }

  function getCalendarDateScopePoleIds(state = {}) {
    const activeCountry = getActiveCountry(state);
    const scopedPoles = getCountryScopedPoles(state, PMS_DATA.reporting.poles || []);
    let poleIds = scopedPoles.map((pole) => pole.id);
    const selectedPole = state.calendarPoleFilter || state.currentPoleMonitor;
    if (selectedPole && selectedPole !== "Tous") {
      poleIds = poleIds.filter((poleId) => poleId === selectedPole);
    }
    return new Set(isGroupCountry(activeCountry) && (!selectedPole || selectedPole === "Tous") ? poleIds : poleIds);
  }

  function availableKoboDatesForCalendar(state = {}, calendar = {}) {
    const selectedDate = parseIsoDate(calendar.selectedDate || calendar.end || calendar.start) || new Date();
    const selectedMonth = selectedDate.getMonth();
    const selectedYear = selectedDate.getFullYear();
    const allowedPoleIds = getCalendarDateScopePoleIds(state);
    const activeCountry = getActiveCountry(state);
    const dates = new Map();
    const dailyDates = Array.isArray(state.kpiDailyDates) ? state.kpiDailyDates : [];

    dailyDates.forEach((item) => {
      if (allowedPoleIds.size && item.poleId && !allowedPoleIds.has(item.poleId)) return;
      if (!isGroupCountry(activeCountry) && (!item.branch || !matchesCountryScope(item.branch, activeCountry))) return;
      const date = parseIsoDate(item.date);
      if (!date || date.getMonth() !== selectedMonth || date.getFullYear() !== selectedYear) return;
      dates.set(item.date, date);
    });

    if (dates.size) {
      return [...dates.values()].sort((left, right) => right.getTime() - left.getTime());
    }

    const results = Array.isArray(state.kpiCalculationResults) ? state.kpiCalculationResults : [];

    results.forEach((result) => {
      if (allowedPoleIds.size && result.poleId && !allowedPoleIds.has(result.poleId)) return;
      const date = resultCalendarDate(result);
      if (!date || date.getMonth() !== selectedMonth || date.getFullYear() !== selectedYear) return;
      const iso = dateToIso(date);
      dates.set(iso, date);
    });

    return [...dates.values()].sort((left, right) => right.getTime() - left.getTime());
  }

  function renderDateDropdownOptions(state = {}, calendar = {}) {
    const selectedDate = parseIsoDate(calendar.selectedDate || calendar.end || calendar.start) || new Date();
    const selectedIso = dateToIso(selectedDate);
    const availableDates = availableKoboDatesForCalendar(state, calendar);

    if (!availableDates.length) {
      return `
        <div class="date-picker-empty">
          Aucune donnee Kobo montee pour ce mois.
        </div>
      `;
    }

    return availableDates.map((date) => {
      const iso = dateToIso(date);
      const selected = iso === selectedIso;
      return `
        <button
          class="date-picker-option${selected ? " selected" : ""}"
          type="button"
          data-calendar-date="${iso}"
          role="option"
          aria-selected="${selected ? "true" : "false"}"
        >
          <span class="date-picker-radio" aria-hidden="true"></span>
          <strong>${compactDateValue(date)}</strong>
        </button>
      `;
    }).join("");
  }

  function renderCalendarSlicer(state = {}) {
    const panel = $("#calendar-slicer");
    if (!panel) return;
    const calendar = state.calendar || {};
    const viewYear = Number(calendar.viewYear) || 2026;
    const viewMonth = Number.isInteger(calendar.viewMonth) ? calendar.viewMonth : 6;
    const selectedStart = parseIsoDate(calendar.start);
    const selectedEnd = parseIsoDate(calendar.end);
    const todayIso = dateToIso(new Date());
    const monthTitle = $("#calendar-month-title");
    const startInput = $("#calendar-start");
    const endInput = $("#calendar-end");
    const dateInput = $("#calendar-date-input");
    const dateToggle = $("#calendar-date-toggle");
    const dateMenu = $("#calendar-date-menu");
    const summary = $("#calendar-summary");
    const activePeriod = $("#calendar-active-period");
    const grid = $("#calendar-grid");
    const poleFilter = $("#calendar-pole-filter");
    const branchFilter = $("#calendar-branch-filter");
    const cycleFilter = $("#calendar-cycle-filter");
    const statusFilter = $("#calendar-status-filter");

    if (monthTitle) {
      monthTitle.textContent = new Date(viewYear, viewMonth, 1).toLocaleDateString("fr-FR", {
        month: "long",
        year: "numeric",
      });
    }
    if (startInput) startInput.value = calendar.start || "";
    if (endInput) endInput.value = calendar.end || "";
    if (dateInput) {
      const availableDates = availableKoboDatesForCalendar(state, calendar);
      const selectedDate = parseIsoDate(calendar.selectedDate || calendar.end || calendar.start);
      const selectedIso = selectedDate ? dateToIso(selectedDate) : "";
      dateInput.value = availableDates.some((date) => dateToIso(date) === selectedIso)
        ? selectedIso.replaceAll("-", "")
        : "";
      dateInput.placeholder = availableDates.length ? "Date Kobo disponible" : "Aucune date Kobo";
      dateInput.setAttribute("aria-expanded", state.calendarDateDropdownOpen ? "true" : "false");
    }
    if (dateToggle) {
      dateToggle.setAttribute("aria-expanded", state.calendarDateDropdownOpen ? "true" : "false");
    }
    if (dateMenu) {
      dateMenu.hidden = !state.calendarDateDropdownOpen;
      dateMenu.innerHTML = renderDateDropdownOptions(state, calendar);
    }
    if (summary) {
      summary.textContent = calendarPeriodLabel(calendar);
    }
    if (activePeriod) {
      activePeriod.innerHTML = `
        <span>Selection active</span>
        <strong>${escapeHtml(calendarPeriodLabel(calendar))}</strong>
        <small>${escapeHtml(calendar.label || "Filtre calendrier")}</small>
      `;
    }

    document.querySelectorAll("[data-calendar-preset]").forEach((button) => {
      button.classList.toggle("active", button.dataset.calendarPreset === calendar.preset);
    });
    document.querySelectorAll("[data-actor-scope]").forEach((button) => {
      button.classList.toggle("active", button.dataset.actorScope === (state.actorScope || "responsable"));
    });

    if (poleFilter) {
      const accessContext = getPoleAccessContext(state);
      const authorizedPoles = accessContext.isRestricted ? accessContext.poles : PMS_DATA.reporting.poles;
      const selectedPoleId =
        authorizedPoles.find((pole) => pole.id === state.calendarPoleFilter)?.id ||
        authorizedPoles.find((pole) => pole.id === state.currentPoleMonitor)?.id ||
        authorizedPoles[0]?.id ||
        "";
      if (selectedPoleId) {
        state.calendarPoleFilter = selectedPoleId;
        state.currentPoleMonitor = selectedPoleId;
      }
      poleFilter.innerHTML = authorizedPoles.length
        ? authorizedPoles
            .map(
              (pole) => `<option value="${escapeHtml(pole.id)}" ${pole.id === selectedPoleId ? "selected" : ""}>${escapeHtml(pole.name)}</option>`
            )
            .join("")
        : `<option>Aucun pole autorise</option>`;
      poleFilter.disabled = accessContext.isRestricted && !authorizedPoles.length;
      if (authorizedPoles.length) {
        poleFilter.value = selectedPoleId;
      }
    }

    const activeCountry = getActiveCountry(state);
    const activeCountryValue = countryFilterValue(activeCountry);
    const countrySelectOptions = countryOptionsHtml(activeCountryValue, state);
    const topbarBranchFilter = $("#branch-filter");

    if (topbarBranchFilter) {
      topbarBranchFilter.innerHTML = countrySelectOptions;
      topbarBranchFilter.value = activeCountryValue;
    }

    if (branchFilter) {
      branchFilter.innerHTML = countrySelectOptions;
      branchFilter.value = activeCountryValue;
    }

    if (cycleFilter) {
      cycleFilter.value = state.currentReportCycle || state.currentPoleCycle || "Mensuel";
    }

    if (statusFilter) {
      statusFilter.value = state.calendarStatusFilter || "Tous";
    }

    if (!grid) return;
    const firstDay = new Date(viewYear, viewMonth, 1);
    const firstOffset = (firstDay.getDay() + 6) % 7;
    const gridStart = addDays(firstDay, -firstOffset);
    const startTime = selectedStart?.getTime();
    const endTime = selectedEnd?.getTime();

    grid.innerHTML = Array.from({ length: 42 }, (_, index) => {
      const date = addDays(gridStart, index);
      const iso = dateToIso(date);
      const time = date.getTime();
      const isCurrentMonth = date.getMonth() === viewMonth;
      const isInRange = startTime && endTime && time >= Math.min(startTime, endTime) && time <= Math.max(startTime, endTime);
      const isRangeEdge = iso === calendar.start || iso === calendar.end;
      const classes = [
        "calendar-day",
        isCurrentMonth ? "" : "muted",
        iso === todayIso ? "today" : "",
        isInRange ? "selected" : "",
        isRangeEdge ? "edge" : "",
      ]
        .filter(Boolean)
        .join(" ");
      return `<button class="${classes}" type="button" data-calendar-date="${iso}">${date.getDate()}</button>`;
    }).join("");
  }

  function ragLabel(status) {
    if (status === "green") return "Vert";
    if (status === "red") return "Rouge";
    if (status === "amber") return "Orange";
    if (status === "gray") return "En attente Kobo";
    return status;
  }

  function getPoleKpiStatus(poleId) {
    const kpis = PMS_DATA.reporting.kpisByPole[poleId] || [];
    return {
      kpis,
      greenCount: kpis.filter((item) => item.status === "green").length,
      amberCount: kpis.filter((item) => item.status === "amber").length,
      redCount: kpis.filter((item) => item.status === "red").length,
      totalShown: kpis.length || 1,
    };
  }

  function getPoleAccessContext(state = {}) {
    const reporting = PMS_DATA.reporting;
    if (!state.currentUser || state.currentPermissions?.administration) {
      return { activeRule: null, poles: reporting.poles, isRestricted: false };
    }

    const activeCountry = getActiveCountry(state);
    const rules = getAccessRulesForState(state);
    const countryRules = rules.filter((rule) => accessRuleMatchesCountry(rule, activeCountry));
    const scopedRules = countryRules.length ? countryRules : [];
    const poleIds = [...new Set(scopedRules.map((rule) => rule.poleId))];
    const poles = reporting.poles.filter((pole) => poleIds.includes(pole.id));
    const activeRule = scopedRules.find((rule) => rule.id === state.activeAccessRuleId) || scopedRules[0] || null;

    return {
      activeRule,
      poles,
      isRestricted: true,
    };
  }

  function averageNumber(values = []) {
    const validValues = values.map(Number).filter((value) => Number.isFinite(value));
    if (!validValues.length) return 0;
    return Math.round(validValues.reduce((sum, value) => sum + value, 0) / validValues.length);
  }

  function parseNumber(value) {
    const text = String(value ?? "").replace(",", ".");
    const match = text.match(/[-+]?\d+(?:\.\d+)?/);
    return match ? Number(match[0]) : null;
  }

  function scoreClass(score) {
    const numericScore = Number(score);
    if (!Number.isFinite(numericScore)) return "gray";
    if (numericScore >= 80) return "green";
    if (numericScore >= 70) return "amber";
    return "red";
  }

  function hasKpiData(kpi = {}) {
    return Boolean(kpi.calculated && ["green", "amber", "red"].includes(kpi.status));
  }

  function poleDataKpis(pole = {}) {
    if (!pole) return [];
    return (PMS_DATA.reporting.kpisByPole[pole.id] || []).filter(hasKpiData);
  }

  function hasPoleData(pole = {}) {
    if (!pole) return false;
    return Boolean(pole.hasCalculatedData || Number(pole.calculatedKpiCount || 0) > 0 || poleDataKpis(pole).length);
  }

  function metricValueOrPending(pole = {}, value, suffix = "") {
    return hasPoleData(pole) && Number.isFinite(Number(value)) ? `${value}${suffix}` : "--";
  }

  function metricStatusOrPending(pole = {}) {
    return hasPoleData(pole) ? pole.status || ragLabel(pole.rag || "gray") : "En attente Kobo";
  }

  function metricClassOrPending(pole = {}, value) {
    return hasPoleData(pole) ? scoreClass(value) : "gray";
  }

  function scopedKpiDataRows(rows = []) {
    return rows.filter((row) => hasKpiData(row.kpi));
  }

  function dashboardKpiKey(pole = {}, kpi = {}, index = 0) {
    return `${pole.id || "POLE"}:${normalizeLookup(kpi.id || kpi.name)}:${index}`;
  }

  function statusWeight(status) {
    if (status === "red") return 4;
    if (status === "amber") return 3;
    if (status === "gray") return 2;
    return 1;
  }

  function getDashboardContext(state = {}) {
    const activeCountry = getActiveCountry(state);
    const isGroup = isGroupCountry(activeCountry);
    const accessContext = getPoleAccessContext(state);
    const visiblePoles = getCountryScopedPoles(state, accessContext.poles);
    const authorizedCountries = getAuthorizedCountryOptions(state).filter((country) => !isGroupCountry(country));
    const visibleCountries = isGroup
      ? authorizedCountries
      : authorizedCountries.filter((country) => country.name === activeCountry.name);
    const safeCountries = visibleCountries.length ? visibleCountries : authorizedCountries;
    const kpiRows = visiblePoles.flatMap((pole) =>
      (PMS_DATA.reporting.kpisByPole[pole.id] || []).map((kpi, index) => ({
        key: dashboardKpiKey(pole, kpi, index),
        pole,
        kpi,
        index,
      }))
    );
    return {
      activeCountry,
      isGroup,
      accessContext,
      visiblePoles,
      visibleCountries: safeCountries,
      kpiRows,
    };
  }

  function getDashboardPoleContext(state = {}) {
    const context = getDashboardContext(state);
    const requestedPole =
      state.calendarPoleFilter && state.calendarPoleFilter !== "Tous"
        ? state.calendarPoleFilter
        : state.currentPoleMonitor;
    const selectedPole =
      context.visiblePoles.find((pole) => pole.id === requestedPole) ||
      context.visiblePoles[0] ||
      null;
    const kpiRows = selectedPole
      ? (PMS_DATA.reporting.kpisByPole[selectedPole.id] || []).map((kpi, index) => ({
          key: dashboardKpiKey(selectedPole, kpi, index),
          pole: selectedPole,
          kpi,
          index,
        }))
      : [];
    return {
      ...context,
      selectedPole,
      visiblePoles: selectedPole ? [selectedPole] : [],
      kpiRows,
    };
  }

  function latestTrendPoint(kpi = {}) {
    const history = Array.isArray(kpi.trendHistory) ? kpi.trendHistory : [];
    return history
      .map((point, index) => ({ ...point, rank: trendPointRank(point, index) }))
      .filter((point) => point.period || point.valueLabel || point.value)
      .sort((left, right) => left.rank - right.rank)
      .pop();
  }

  function dayValueLabel(kpi = {}) {
    if (kpi.dayValueLabel) return kpi.dayValueLabel;
    if (Number.isFinite(Number(kpi.dayValue))) return String(kpi.dayValue);
    const latest = latestTrendPoint(kpi);
    if (latest?.valueLabel) return latest.valueLabel;
    if (Number.isFinite(Number(latest?.value))) return String(latest.value);
    return kpi.calculated ? kpi.value || "Calcule" : "En attente Kobo";
  }

  function monthToDateValueLabel(kpi = {}) {
    if (kpi.monthToDateValueLabel) return kpi.monthToDateValueLabel;
    if (Number.isFinite(Number(kpi.monthToDateValue))) return String(kpi.monthToDateValue);
    return kpi.value || dayValueLabel(kpi);
  }

  function trendSummaryLabel(kpi = {}, pole = {}) {
    const visibleMetrics = kpiTrendMetrics(kpi, pole).filter((metric) => metric.display !== "--");
    return visibleMetrics.length
      ? visibleMetrics.map((metric) => `${metric.label} ${metric.display}`).join(" | ")
      : "Tendance a calculer";
  }

  function kpiRiskScore(row) {
    const trends = kpiTrendMetrics(row.kpi, row.pole);
    const negativeTrends = trends.filter((metric) => metric.className === "negative").length;
    const targetMetric = metricFromTarget(row.kpi);
    return statusWeight(row.kpi.status) * 20 + negativeTrends * 9 + (targetMetric.className === "negative" ? 15 : 0);
  }

  function targetKnown(row) {
    return metricFromTarget(row.kpi).className !== "empty";
  }

  function targetReached(row) {
    const metric = metricFromTarget(row.kpi);
    return metric.className === "positive" || metric.className === "neutral";
  }

  function averageTargetAchievement(rows = []) {
    const values = rows
      .map((row) => {
        const explicit = Number(row.kpi.vsTargetValue);
        if (Number.isFinite(explicit)) return explicit;
        const metric = metricFromTarget(row.kpi);
        return parseMetricNumber(metric.display);
      })
      .filter((value) => Number.isFinite(value));
    if (!values.length) return null;
    return values.reduce((sum, value) => sum + value, 0) / values.length;
  }

  function dashboardCellScore(pole = {}, country = {}) {
    if (!poleAvailableForCountry(pole, country)) {
      return null;
    }
    if (!hasPoleData(pole)) return null;
    return Math.max(0, Math.min(100, Math.round(Number(pole.score || 0))));
  }

  function renderDashboardControlCards(context) {
    const target = $("#dashboard-control-cards");
    if (!target) return;
    const selectedPole = context.selectedPole;
    const title = $("#dashboard-focus-title");
    const status = $("#dashboard-pole-status");
    if (title) {
      title.textContent = selectedPole
        ? `Resume performance - ${selectedPole.name}`
        : "Resume du pole selectionne";
    }
    if (status) {
      status.className = `status-pill ${escapeHtml(selectedPole?.rag || "gray")}`;
      status.textContent = selectedPole ? ragLabel(selectedPole.rag) : "Aucun pole";
    }
    const totalKpis = context.kpiRows.length;
    const redCount = context.kpiRows.filter((row) => row.kpi.status === "red").length;
    const amberCount = context.kpiRows.filter((row) => row.kpi.status === "amber").length;
    const pendingCount = context.kpiRows.filter((row) => row.kpi.pendingCalculation || row.kpi.status === "gray").length;
    const knownTargets = context.kpiRows.filter(targetKnown);
    const reachedTargets = knownTargets.filter(targetReached).length;
    const objectiveRate = knownTargets.length ? Math.round((reachedTargets / knownTargets.length) * 100) : 0;
    const targetAchievement = averageTargetAchievement(knownTargets);
    const targetAchievementClass = !Number.isFinite(targetAchievement)
      ? "gray"
      : targetAchievement >= 100
        ? "green"
        : targetAchievement >= 90
          ? "amber"
          : "red";
    const hasData = selectedPole ? hasPoleData(selectedPole) : false;
    const score = hasData ? Number(selectedPole.score || 0) : null;
    const quality = hasData ? Number(selectedPole.quality || 0) : null;
    const lateSubmissions = selectedPole ? Number(selectedPole.lateSubmissions || 0) : 0;
    const cards = [
      {
        label: "Score du pole",
        value: metricValueOrPending(selectedPole, score),
        hint: hasData ? selectedPole?.owner || "Responsable a definir" : "donnees Kobo attendues",
        className: metricClassOrPending(selectedPole, score),
      },
      { label: "KPI suivis", value: totalKpis, hint: `${pendingCount} en attente Kobo`, className: pendingCount ? "amber" : "green" },
      { label: "KPI critiques", value: redCount, hint: `${amberCount} KPI orange`, className: redCount ? "red" : amberCount ? "amber" : "green" },
      {
        label: "Cibles atteintes",
        value: hasData ? `${reachedTargets}/${knownTargets.length || 0}` : "--",
        hint: hasData ? `${objectiveRate}% des KPI avec cible` : "calcul apres collecte",
        className: hasData ? (objectiveRate >= 80 ? "green" : objectiveRate >= 65 ? "amber" : "red") : "gray",
      },
      {
        label: "Atteinte moyenne",
        value: hasData && Number.isFinite(targetAchievement) ? formatRatioPercent(targetAchievement) : "--",
        hint: hasData ? "moyenne des Vs Target" : "calcul apres collecte",
        className: hasData ? targetAchievementClass : "gray",
      },
      {
        label: "Qualite Kobo",
        value: metricValueOrPending(selectedPole, quality, "%"),
        hint: hasData ? (lateSubmissions ? `${lateSubmissions} retard(s)` : "collecte a jour") : "aucune soumission calculee",
        className: hasData ? (lateSubmissions ? "amber" : scoreClass(quality)) : "gray",
      },
    ];
    const ipgScore = $("#dashboard-ipg-score");
    const ipgLabel = $("#dashboard-ipg-label");
    if (ipgScore) ipgScore.textContent = hasData ? score || "--" : "--";
    if (ipgLabel) ipgLabel.textContent = `${context.activeCountry.name} - ${totalKpis} KPI visibles`;
    target.innerHTML = cards
      .map(
        (card) => `
          <article class="dashboard-control-card status-${escapeHtml(card.className)}">
            <span>${escapeHtml(card.label)}</span>
            <strong>${escapeHtml(card.value)}</strong>
            <small>${escapeHtml(card.hint)}</small>
          </article>
        `
      )
      .join("");
  }

  function dashboardCriticalRows(context, limit = 6) {
    return [...context.kpiRows]
      .filter((row) => hasKpiData(row.kpi))
      .map((row) => ({ ...row, riskScore: kpiRiskScore(row) }))
      .filter((row) => row.riskScore >= 60)
      .sort((left, right) => right.riskScore - left.riskScore)
      .slice(0, limit);
  }

  function renderDashboardDirectorMode(context, state = {}) {
    const brief = $("#dashboard-director-mode");
    const badge = $("#dashboard-director-badge");
    if (!brief && !badge) return;
    const criticalRows = dashboardCriticalRows(context, 4);
    const dataPoles = context.visiblePoles.filter(hasPoleData);
    const score = dataPoles.length ? averageNumber(dataPoles.map((pole) => pole.score)) : null;
    const lateSubmissions = dataPoles.reduce((sum, pole) => sum + Number(pole.lateSubmissions || 0), 0);
    const actionCount = dataPoles.reduce((sum, pole) => sum + Number(pole.actionCount || 0), 0);
    const mode = state.actorScope === "direction" ? "Direction" : "Responsable";
    if (badge) {
      badge.className = `status-pill ${dataPoles.length ? (criticalRows.length ? "amber" : "green") : "gray"}`;
      badge.textContent = mode;
    }
    if (!brief) return;
    const topRisk = criticalRows[0];
    brief.innerHTML = `
      <div class="director-score status-${escapeHtml(scoreClass(score))}">
        <span>Score pilotage</span>
        <strong>${escapeHtml(dataPoles.length ? score || "--" : "--")}</strong>
        <small>${escapeHtml(dataPoles.length ? context.activeCountry.name : "donnees Kobo attendues")}</small>
      </div>
      <div class="director-decisions">
        <strong>${mode === "Direction" ? "Decisions a prendre" : "Priorites du responsable"}</strong>
        <p>${dataPoles.length ? (criticalRows.length ? `${criticalRows.length} KPI a suivre en priorite, dont ${escapeHtml(topRisk.kpi.name)} sur ${escapeHtml(topRisk.pole.name)}.` : "Aucune alerte critique sur le perimetre actif.") : "Aucune performance calculee tant que Kobo n'a pas renvoye de soumissions."}</p>
        <p>${dataPoles.length ? (lateSubmissions ? `${lateSubmissions} collecte(s) Kobo en retard a relancer.` : "Collectes Kobo sous controle sur le perimetre actif.") : "Les alertes seront produites apres synchronisation de donnees."}</p>
        <p>${dataPoles.length ? `${actionCount} action(s) ouverte(s) a suivre avant la prochaine validation.` : "Les plans d'action seront crees depuis les ecarts reels."}</p>
      </div>
    `;
  }

  function renderDashboardAlerts(context, state = {}) {
    const target = $("#dashboard-alerts-list");
    if (!target) return;
    const rows = dashboardCriticalRows(context, 5);
    const pendingRows = context.kpiRows.filter((row) => row.kpi.pendingCalculation || row.kpi.status === "gray").slice(0, 2);
    if (!rows.length) {
      target.innerHTML = pendingRows.length
        ? pendingRows
            .map(
              (row) => `
                <article class="dashboard-alert-row status-gray">
                  <div>
                    <strong>${escapeHtml(row.kpi.name)}</strong>
                    <span>${escapeHtml(row.pole.name)} - donnees Kobo attendues pour calculer le KPI.</span>
                  </div>
                  ${statusPill("A alimenter", "gray")}
                </article>
              `
            )
            .join("")
        : `<div class="empty-kpi-state">Aucune alerte KPI critique sur le pole selectionne.</div>`;
      return;
    }
    target.innerHTML = rows
      .map((row) => {
        const trends = kpiTrendMetrics(row.kpi, row.pole).filter((metric) => metric.className === "negative");
        const reason = trends.length
          ? `${trends.map((metric) => metric.label).join(", ")} defavorable`
          : row.kpi.status === "red"
            ? "Sous seuil critique"
            : "A surveiller";
        return `
          <article class="dashboard-alert-row status-${escapeHtml(row.kpi.status)}">
            <div>
              <strong>${escapeHtml(row.kpi.name)}</strong>
              <span>${escapeHtml(row.pole.name)} - ${escapeHtml(reason)}</span>
            </div>
            ${statusPill("A traiter", row.kpi.status || "amber")}
          </article>
        `;
      })
      .join("");
    if (!state.currentDashboardKpiKey || !context.kpiRows.some((row) => row.key === state.currentDashboardKpiKey)) {
      state.currentDashboardKpiKey = rows[0]?.key || context.kpiRows[0]?.key || "";
    }
  }

  function renderDashboardHeatmap(context) {
    const target = $("#dashboard-heatmap");
    if (!target) return;
    const countries = context.visibleCountries.slice(0, 8);
    if (!countries.length || !context.visiblePoles.length) {
      target.innerHTML = `<div class="empty-kpi-state">Aucune donnee pays / pole disponible.</div>`;
      return;
    }
    target.innerHTML = `
      <table class="dashboard-heatmap-table">
        <thead>
          <tr>
            <th>Pole</th>
            ${countries.map((country) => `<th>${escapeHtml(country.code || country.name)}</th>`).join("")}
          </tr>
        </thead>
        <tbody>
          ${context.visiblePoles
            .map(
              (pole) => `
                <tr>
                  <td><strong>${escapeHtml(pole.id)}</strong><small>${escapeHtml(pole.name)}</small></td>
                  ${countries
                    .map((country) => {
                      const score = dashboardCellScore(pole, country);
                      return score === null
                        ? `<td class="heat-cell empty">--</td>`
                        : `<td class="heat-cell ${escapeHtml(scoreClass(score))}" title="${escapeHtml(pole.name)} - ${escapeHtml(country.name)}">${score}</td>`;
                    })
                    .join("")}
                </tr>
              `
            )
            .join("")}
        </tbody>
      </table>
    `;
  }

  function renderDashboardRanking(context) {
    const target = $("#dashboard-pole-ranking");
    if (!target) return;
    const dataPoles = context.visiblePoles.filter(hasPoleData);
    if (!dataPoles.length) {
      target.innerHTML = `<div class="empty-kpi-state">Classement disponible apres reception de donnees Kobo calculees.</div>`;
      return;
    }
    const best = [...dataPoles].sort((left, right) => right.score - left.score).slice(0, 3);
    const risk = [...dataPoles].sort((left, right) => left.score - right.score).slice(0, 3);
    const rows = [
      ...best.map((pole) => ({ pole, label: "Top", className: "green" })),
      ...risk.map((pole) => ({ pole, label: "Risque", className: scoreClass(pole.score) })),
    ];
    target.innerHTML = rows.length
      ? rows
          .map(
            ({ pole, label, className }) => `
              <div class="dashboard-ranking-row">
                <span class="status-pill ${escapeHtml(className)}">${escapeHtml(label)}</span>
                <div>
                  <strong>${escapeHtml(pole.name)}</strong>
                  <small>${escapeHtml(pole.owner)}</small>
                </div>
                <b>${escapeHtml(metricValueOrPending(pole, pole.score))}</b>
              </div>
            `
          )
          .join("")
      : `<div class="empty-kpi-state">Aucun pole autorise.</div>`;
  }

  function renderDashboardQuality(context, state = {}) {
    const target = $("#dashboard-quality-list");
    if (!target) return;
    const activeCountry = context.activeCountry;
    const submissions = filterRowsByCountry(state.koboSubmissions || [], activeCountry);
    const rows = [...context.visiblePoles].filter(hasPoleData)
      .sort((left, right) => Number(right.lateSubmissions || 0) - Number(left.lateSubmissions || 0) || left.quality - right.quality)
      .slice(0, 5);
    target.innerHTML = `
      <div class="quality-summary-line">
        <strong>${escapeHtml(submissions.length)}</strong>
        <span>soumission(s) Kobo visibles - ${escapeHtml(activeCountry.name)}</span>
      </div>
      ${rows
        .map(
          (pole) => `
            <div class="quality-row">
              <div>
                <strong>${escapeHtml(pole.id)}</strong>
                <small>${escapeHtml(pole.lateSubmissions || 0)} retard(s)</small>
              </div>
              <div class="bar-track"><div class="bar-fill ${escapeHtml(scoreClass(pole.quality))}" style="width:${Math.max(0, Math.min(100, pole.quality))}%"></div></div>
              <b>${escapeHtml(pole.quality)}%</b>
            </div>
          `
        )
        .join("") || `<div class="empty-kpi-state">Qualite Kobo calculee apres import de donnees.</div>`}
    `;
  }

  function renderDashboardObjectives(context) {
    const target = $("#dashboard-objective-summary");
    if (!target) return;
    const dataRows = scopedKpiDataRows(context.kpiRows);
    const knownRows = dataRows.filter(targetKnown);
    const reached = knownRows.filter(targetReached);
    const missing = dataRows.length - knownRows.length;
    const rate = knownRows.length ? Math.round((reached.length / knownRows.length) * 100) : 0;
    const redObjectives = knownRows.filter((row) => metricFromTarget(row.kpi).className === "negative").slice(0, 3);
    if (!dataRows.length) {
      target.innerHTML = `<div class="empty-kpi-state">Atteinte des objectifs disponible apres calcul des KPI Kobo.</div>`;
      return;
    }
    target.innerHTML = `
      <div class="objective-rate-card status-${escapeHtml(scoreClass(rate))}">
        <span>Taux d'atteinte</span>
        <strong>${escapeHtml(rate)}%</strong>
        <small>${escapeHtml(reached.length)}/${escapeHtml(knownRows.length)} cibles atteintes</small>
      </div>
      <div class="bar-track objective-track"><div class="bar-fill ${escapeHtml(scoreClass(rate))}" style="width:${rate}%"></div></div>
      <div class="objective-mini-list">
        ${redObjectives
          .map((row) => `<span>${escapeHtml(row.pole.id)} - ${escapeHtml(row.kpi.name)}</span>`)
          .join("") || "<span>Aucune cible critique detectee.</span>"}
        ${missing ? `<span>${missing} KPI sans cible numerique exploitable.</span>` : ""}
      </div>
    `;
  }

  function renderDashboardCadence(context) {
    const target = $("#dashboard-cadence-view");
    if (!target) return;
    const groups = ["Horaire", "Journalier", "Hebdomadaire", "Mensuel"].map((cadence) => {
      const rows = context.kpiRows.filter((row) => matchesCadenceFilter(kpiCollectionFrequency(row.kpi, row.pole), cadence));
      return {
        cadence,
        total: rows.length,
        red: rows.filter((row) => row.kpi.status === "red").length,
        amber: rows.filter((row) => row.kpi.status === "amber").length,
      };
    });
    target.innerHTML = groups
      .map(
        (group) => `
          <div class="cadence-card status-${escapeHtml(group.red ? "red" : group.amber ? "amber" : "green")}">
            <span>${escapeHtml(group.cadence)}</span>
            <strong>${escapeHtml(group.total)}</strong>
            <small>${escapeHtml(group.red)} rouge(s), ${escapeHtml(group.amber)} orange(s)</small>
          </div>
        `
      )
      .join("");
  }

  function renderDashboardActions(context) {
    const target = $("#dashboard-actions-list");
    if (!target) return;
    const criticalRows = dashboardCriticalRows(context, 4);
    const dataRows = criticalRows.filter((row) => hasKpiData(row.kpi));
    const plans = dataRows.length
      ? dataRows.map((row) => ({
          title: `Redresser ${row.kpi.name}`,
          owner: row.pole.owner,
          due: cadenceProfileForPole(row.pole).expectedDelay || "Prochaine validation",
          progress: 0,
          detail: `${row.pole.name} - valeur ${row.kpi.value}, cible ${row.kpi.target}.`,
          key: row.key,
        }))
      : [];
    if (!plans.length) {
      target.innerHTML = `<div class="empty-kpi-state">Actions generees apres detection d'ecarts reels dans Kobo.</div>`;
      return;
    }
    target.innerHTML = plans
      .map(
        (plan) => `
          <article class="dashboard-action-card">
            <div>
              <strong>${escapeHtml(plan.title)}</strong>
              <p>${escapeHtml(plan.detail)}</p>
            </div>
            <div class="dashboard-action-meta">
              <span>${escapeHtml(plan.owner)}</span>
              <span>${escapeHtml(plan.due)}</span>
            </div>
            <div class="bar-track"><div class="bar-fill ${plan.progress >= 70 ? "green" : plan.progress >= 45 ? "amber" : "red"}" style="width:${Math.max(0, Math.min(100, plan.progress))}%"></div></div>
          </article>
        `
      )
      .join("");
  }

  function renderDashboardForecast(context) {
    const target = $("#dashboard-forecast-list");
    if (!target) return;
    const rows = context.kpiRows
      .filter((row) => hasKpiData(row.kpi) && row.kpi.status !== "red" && kpiTrendMetrics(row.kpi, row.pole).some((metric) => metric.className === "negative"))
      .sort((left, right) => kpiRiskScore(right) - kpiRiskScore(left))
      .slice(0, 4);
    target.innerHTML = rows.length
      ? rows
          .map(
            (row) => `
              <div class="forecast-row">
                <span class="status-pill ${escapeHtml(row.kpi.status || "amber")}">Alerte</span>
                <div>
                  <strong>${escapeHtml(row.kpi.name)}</strong>
                  <small>${escapeHtml(row.pole.name)} - tendance defavorable avant cloture.</small>
                </div>
              </div>
            `
          )
          .join("")
      : `<div class="empty-kpi-state">Aucun risque anticipe sur les tendances visibles.</div>`;
  }

  function renderDashboardValidationLog(context, state = {}) {
    const target = $("#dashboard-validation-log");
    if (!target) return;
    const queue = (state.validationQueue || [])
      .filter((item) => context.visiblePoles.some((pole) => pole.id === item.pole))
      .slice(0, 4);
    target.innerHTML = queue.length
      ? queue.map(
        (item) => `
          <div class="audit-row">
            <span class="status-pill ${escapeHtml(item.className || "amber")}">${escapeHtml(item.status)}</span>
            <div>
              <strong>${escapeHtml(item.form)}</strong>
              <small>${escapeHtml(item.issue)} - ${escapeHtml(item.owner)}</small>
            </div>
          </div>
        `
      ).join("")
      : `<div class="empty-kpi-state">Aucune anomalie de validation issue des donnees pour le moment.</div>`;
  }

  function renderDashboardKpiDetail(context, state = {}) {
    const target = $("#dashboard-detail-preview");
    const badge = $("#dashboard-kpi-detail-badge");
    if (!target) return;
    const selected =
      context.kpiRows.find((row) => row.key === state.currentDashboardKpiKey) ||
      dashboardCriticalRows(context, 1)[0] ||
      context.kpiRows[0];
    if (!selected) {
      target.innerHTML = `<div class="empty-kpi-state">Aucun KPI disponible.</div>`;
      return;
    }
    state.currentDashboardKpiKey = selected.key;
    if (badge) {
      badge.className = `status-pill ${escapeHtml(selected.kpi.status || "gray")}`;
      badge.textContent = ragLabel(selected.kpi.status || "gray");
    }
    const profile = getObjectiveCatalogProfile(selected.kpi, selected.pole);
    target.innerHTML = `
      <div class="dashboard-kpi-detail-head">
        <div>
          <span class="code-chip">${escapeHtml(selected.pole.id)}</span>
          <h4>${escapeHtml(selected.kpi.name)}</h4>
          <p>${escapeHtml(selected.pole.name)} - ${escapeHtml(selected.pole.owner)}</p>
        </div>
        <div class="kpi-detail-value">
          <span>Valeur</span>
          <strong>${escapeHtml(selected.kpi.value)}</strong>
        </div>
      </div>
      ${renderTrendStrip(selected.kpi, selected.pole)}
      <div class="kpi-detail-grid">
        <div><span>Objectif a date</span><strong>${escapeHtml(selected.kpi.target)}</strong></div>
        <div><span>Objectif mensuel</span><strong>${escapeHtml(selected.kpi.monthlyTarget || selected.kpi.target || "A completer")}</strong></div>
        <div><span>Source Kobo</span><strong>${escapeHtml(selected.kpi.source)}</strong></div>
        <div><span>Collecte</span><strong>${escapeHtml(kpiCollectionFrequency(selected.kpi, selected.pole))}</strong></div>
        <div><span>Validation</span><strong>${escapeHtml(profile.hierarchicalValidation || "Sous reserve")}</strong></div>
      </div>
      <div class="kpi-detail-formula">
        <strong>Formule</strong>
        <p>${escapeHtml(selected.kpi.formula || profile.formula || "A completer")}</p>
      </div>
      <button class="primary-action" type="button" data-open-pole="${escapeHtml(selected.pole.id)}">Ouvrir le suivi du pole</button>
    `;
  }

  function renderDashboardKpiTable(context) {
    const table = $("#dashboard-kpi-detail-table");
    const count = $("#dashboard-kpi-table-count");
    if (!table) return;
    const rows = context.kpiRows || [];
    if (count) {
      const dataRows = scopedKpiDataRows(rows);
      count.className = `status-pill ${dataRows.length ? "green" : rows.length ? "amber" : "gray"}`;
      count.textContent = dataRows.length
        ? `${dataRows.length}/${rows.length} KPI calcule${dataRows.length > 1 ? "s" : ""}`
        : `${rows.length} KPI en attente`;
    }
    if (!rows.length) {
      table.innerHTML = `<tr><td colspan="8">Aucun KPI disponible pour le pole selectionne.</td></tr>`;
      return;
    }
    table.innerHTML = rows
      .map((row) => {
        const targetMetric = metricFromTarget(row.kpi);
        return `
          <tr>
            <td>
              <strong>${escapeHtml(row.kpi.name)}</strong>
              <br><small>${escapeHtml(row.kpi.id || row.pole.id)}</small>
            </td>
            <td>${escapeHtml(dayValueLabel(row.kpi))}</td>
            <td><strong>${escapeHtml(monthToDateValueLabel(row.kpi))}</strong></td>
            <td>${escapeHtml(row.kpi.target || "A completer")}</td>
            <td><strong class="${escapeHtml(targetMetric.className)}">${escapeHtml(targetMetric.display)}</strong></td>
            <td>${escapeHtml(trendSummaryLabel(row.kpi, row.pole))}</td>
            <td>${escapeHtml(row.kpi.source || "KoboCollect")}</td>
            <td>${statusPill(ragLabel(row.kpi.status || "gray"), row.kpi.status || "gray")}</td>
          </tr>
        `;
      })
      .join("");
  }

  function renderAdvancedDashboard(state = {}) {
    const context = getDashboardPoleContext(state);
    renderDashboardControlCards(context);
    renderDashboardAlerts(context, state);
    renderDashboardKpiTable(context);
  }

  function renderPoleSummaryRows(selector, state) {
    const target = $(selector);
    if (!target) return;
    const accessContext = getPoleAccessContext(state);
    const activeCountry = getActiveCountry(state);
    const visiblePoles = getCountryScopedPoles(state, accessContext.poles);
    const dashboardCount = selector === "#dashboard-pole-summary-table" ? $("#dashboard-pole-count") : null;
    if (dashboardCount) {
      dashboardCount.className = `status-pill ${accessContext.isRestricted ? "green" : "amber"}`;
      dashboardCount.textContent = `${visiblePoles.length} pole${visiblePoles.length > 1 ? "s" : ""} suivi${visiblePoles.length > 1 ? "s" : ""} - ${activeCountry.name}`;
    }
    if (!visiblePoles.length) {
      target.innerHTML = `<tr><td colspan="9">Aucun pole autorise pour ${escapeHtml(activeCountry.name)} avec ce profil.</td></tr>`;
      return;
    }
    target.innerHTML = visiblePoles
      .map((pole) => {
        const { greenCount, amberCount, redCount } = getPoleKpiStatus(pole.id);
        const cadenceProfile = cadenceProfileForPole(pole);
        const primaryCadence = cadenceProfile.primary || normalizeCadence(cadenceProfile.cadence);
        const hasData = hasPoleData(pole);
        return `
          <tr>
            <td>${escapeHtml(pole.category || "Non classe")}</td>
            <td><strong>${escapeHtml(pole.name)}</strong><br><small>${escapeHtml(pole.id)}</small></td>
            <td>
              ${statusPill(primaryCadence, cadenceClass(primaryCadence))}
              <br><small>${escapeHtml(cadenceProfile.cadence)}</small>
            </td>
            <td>${escapeHtml(pole.owner)}</td>
            <td><strong>${escapeHtml(metricValueOrPending(pole, pole.score))}</strong></td>
            <td>
              <span class="mini-rag-count"><i class="green"></i>${greenCount}</span>
              <span class="mini-rag-count"><i class="amber"></i>${amberCount}</span>
              <span class="mini-rag-count"><i class="red"></i>${redCount}</span>
            </td>
            <td>${escapeHtml(metricValueOrPending(pole, pole.quality, "%"))}</td>
            <td>${statusPill(metricStatusOrPending(pole), hasData ? reportStatusClass(pole.status) : "gray")}</td>
            <td><button class="ghost-action" data-open-pole="${escapeHtml(pole.id)}">Voir</button></td>
          </tr>
        `;
      })
      .join("");
  }

  function renderPoleSummaryTables(state) {
    renderPoleSummaryRows("#dashboard-pole-summary-table", state);
    renderPoleSummaryRows("#all-poles-table", state);
  }

  function renderDashboardPoleKpis() {
    const target = $("#dashboard-pole-kpis");
    if (!target) return;
    const reporting = PMS_DATA.reporting;
    const categories = [...new Set(reporting.poles.map((pole) => pole.category || "Non classe"))];

    target.innerHTML = categories
      .map((category) => {
        const poles = reporting.poles.filter((pole) => (pole.category || "Non classe") === category);
        return `
          <section class="pole-category-block">
            <div class="pole-category-header">
              <div>
                <p class="eyebrow">${escapeHtml(category)}</p>
                <h4>${poles.length} pole(s)</h4>
              </div>
            </div>
            <div class="pole-dashboard-grid">
              ${poles.map((pole) => renderDashboardPoleCard(pole)).join("")}
            </div>
          </section>
        `;
      })
      .join("");
  }

  function renderDashboardPoleCard(pole) {
    const { kpis, greenCount, amberCount, redCount, totalShown } = getPoleKpiStatus(pole.id);
    const hasData = hasPoleData(pole);
    const priorityKpis = [...kpis]
      .sort((left, right) => {
        const order = { red: 0, amber: 1, gray: 2, green: 3 };
        return order[left.status] - order[right.status];
      })
      .slice(0, 3);

    return `
      <article class="pole-dashboard-card">
        <div class="pole-card-head">
          <div>
            <span class="code-chip">${escapeHtml(pole.id)}</span>
            <h4>${escapeHtml(pole.name)}</h4>
            <p>${escapeHtml(pole.owner)}${pole.note ? ` - ${escapeHtml(pole.note)}` : ""}</p>
          </div>
          ${statusPill(hasData ? ragLabel(pole.rag) : "En attente Kobo", hasData ? pole.rag : "gray")}
        </div>
        <div class="pole-score-row">
          <div>
            <span>Score pole</span>
            <strong>${escapeHtml(metricValueOrPending(pole, pole.score))}</strong>
          </div>
          <div>
            <span>Qualite Kobo</span>
            <strong>${escapeHtml(metricValueOrPending(pole, pole.quality, "%"))}</strong>
          </div>
          <div>
            <span>Rapport pret</span>
            <strong>${escapeHtml(metricValueOrPending(pole, pole.readiness, "%"))}</strong>
          </div>
        </div>
        <div class="rag-stack" aria-label="Repartition RAG ${escapeHtml(pole.name)}">
          <span class="stack-green" style="width:${(greenCount / totalShown) * 100}%"></span>
          <span class="stack-amber" style="width:${(amberCount / totalShown) * 100}%"></span>
          <span class="stack-red" style="width:${(redCount / totalShown) * 100}%"></span>
        </div>
        <div class="pole-rag-counts">
          <span><i class="green"></i>${greenCount} vert</span>
          <span><i class="amber"></i>${amberCount} orange</span>
          <span><i class="red"></i>${redCount} rouge</span>
        </div>
        <div class="pole-priority-list">
          ${priorityKpis
            .map(
              (kpi) => `
                <div>
                  <strong>${escapeHtml(kpi.name)}</strong>
                  <span>${escapeHtml(kpi.value)} / ${escapeHtml(kpi.target)}</span>
                  ${statusPill(ragLabel(kpi.status), kpi.status)}
                </div>
              `
            )
            .join("")}
        </div>
        <div class="pole-card-actions">
          <span>${hasData ? `${pole.lateSubmissions} retard(s) Kobo - ${pole.actionCount} action(s)` : "Donnees Kobo attendues"}</span>
          <button class="ghost-action" data-open-pole="${escapeHtml(pole.id)}">Voir le pole</button>
        </div>
      </article>
    `;
  }

  function renderKoboTable(filter = "", submissions = [], countryFilter = "Groupe") {
    const table = $("#kobo-table");
    if (!table) return;
    const activeCountry = findCountryByValue(countryFilter);
    const scopedSubmissions = filterRowsByCountry(submissions, activeCountry);
    const rows = filterRows(scopedSubmissions, filter, ["form", "branch", "kpi", "collector", "status"]);
    table.innerHTML = rows.length
      ? rows
          .map(
            (item) => `
          <tr>
            <td><strong>${escapeHtml(item.form)}</strong></td>
            <td>${escapeHtml(item.branch)}</td>
            <td>${escapeHtml(item.kpi)}</td>
            <td>${escapeHtml(item.collector)}</td>
            <td>${statusPill(item.status, item.className)}</td>
            <td><button class="ghost-action">Verifier</button></td>
          </tr>
        `
          )
          .join("")
      : `<tr><td colspan="6">Aucune soumission Kobo visible pour ${escapeHtml(activeCountry.name)}.</td></tr>`;
  }

  function renderCollectionForms() {
    const container = $("#collection-forms");
    if (!container) return;
    container.innerHTML = PMS_DATA.collectionForms
      .map(
        (form) => `
          <article class="mini-card">
            <div>
              <span class="code-chip">${escapeHtml(form.code)}</span>
              <strong>${escapeHtml(form.title)}</strong>
              <p>${escapeHtml(form.cadence)}${form.sourceSheet ? ` - Onglet ${escapeHtml(form.sourceSheet)}` : ""}</p>
            </div>
            <ul>
              ${form.sections.map((section) => `<li>${escapeHtml(section)}</li>`).join("")}
            </ul>
          </article>
        `
      )
      .join("");
  }

  function renderMethodologyControls() {
    const container = $("#methodology-controls");
    if (!container) return;
    container.innerHTML = PMS_DATA.methodologyControls
      .map(
        (control) => `
          <article class="control-card">
            <span class="code-chip">${escapeHtml(control.dimension)}</span>
            <strong>${escapeHtml(control.question)}</strong>
            <p>${escapeHtml(control.proof)}</p>
            <small>${escapeHtml(control.frequency)}</small>
          </article>
        `
      )
      .join("");
  }

  function renderKoboPipeline(state = {}) {
    const container = $("#kobo-pipeline");
    if (!container) return;
    const submissions = Array.isArray(state.koboSubmissions) ? state.koboSubmissions : [];
    const calculated = Array.isArray(state.kpiCalculationResults) ? state.kpiCalculationResults : [];
    const referenceCount = Number(state.kpiCalculationQuality?.referenceCount || 0);
    const validationCount = Array.isArray(state.validationQueue) ? state.validationQueue.length : 0;
    const reportsCount = Array.isArray(state.reportHistory) ? state.reportHistory.length : 0;
    const steps = [
      {
        title: "Reception Kobo",
        detail: "Soumissions recues depuis les formulaires connectes.",
        count: submissions.length,
        status: submissions.length ? "Actif" : "En attente",
        className: submissions.length ? "green" : "gray",
      },
      {
        title: "Zone de controle",
        detail: "Anomalies et validations issues des donnees recues.",
        count: validationCount,
        status: validationCount ? "A traiter" : "RAS",
        className: validationCount ? "amber" : "green",
      },
      {
        title: "Mapping KPI",
        detail: "Rattachement formulaire, pole, filiale, periode et code KPI.",
        count: referenceCount,
        status: referenceCount ? "Reference" : "En attente",
        className: referenceCount ? "green" : "gray",
      },
      {
        title: "Calcul PMS",
        detail: "Application des formules et seuils RAG du catalogue.",
        count: calculated.length,
        status: calculated.length ? "Calcule" : "En attente",
        className: calculated.length ? "green" : "gray",
      },
      {
        title: "Publication",
        detail: "Rapports generes depuis les KPI calcules.",
        count: reportsCount,
        status: reportsCount ? "Publie" : "Aucun",
        className: reportsCount ? "green" : "gray",
      },
    ];
    container.innerHTML = steps
      .map(
        (step, index) => `
          <article class="pipeline-step">
            <div class="pipeline-index">${index + 1}</div>
            <div>
              <strong>${escapeHtml(step.title)}</strong>
              <p>${escapeHtml(step.detail)}</p>
              <div class="pipeline-meta">
                <span>${escapeHtml(step.count)}</span>
                ${statusPill(step.status, step.className)}
              </div>
            </div>
          </article>
        `
      )
      .join("");
  }

  function renderValidationQueue(queue = []) {
    const table = $("#validation-queue-table");
    if (!table) return;
    table.innerHTML = queue.length
      ? queue
          .map(
            (item) => `
          <tr>
            <td><strong>${escapeHtml(item.id)}</strong></td>
            <td>${escapeHtml(item.form)}</td>
            <td>${escapeHtml(item.pole)}</td>
            <td>${escapeHtml(item.issue)}</td>
            <td>${escapeHtml(item.owner)}</td>
            <td>${statusPill(item.status, item.className)}</td>
            <td><button class="ghost-action" data-validate-id="${escapeHtml(item.id)}">Marquer OK</button></td>
          </tr>
        `
          )
          .join("")
      : `<tr><td colspan="7">Aucune anomalie de validation issue des donnees pour le moment.</td></tr>`;
  }

  function renderKpiTable(filter = "") {
    const rows = Object.entries(PMS_DATA.reporting.kpisByPole || {}).flatMap(([poleId, kpis]) => {
      const pole = PMS_DATA.reporting.poles.find((item) => item.id === poleId) || { id: poleId, name: poleId };
      return (kpis || []).map((kpi) => ({
        ...kpi,
        poleId,
        direction: pole.name,
        frequency: kpi.collectionFrequency || kpi.reportingFrequency || "",
      }));
    });
    const filteredRows = filterRows(rows, filter, ["id", "direction", "name", "category", "formula", "frequency", "target"]);
    $("#kpi-table").innerHTML = filteredRows.length
      ? filteredRows
          .map((item) => {
        const target = item.target || "";
        const status = item.calculated ? item.status : "gray";
        return `
          <tr>
            <td><strong>${escapeHtml(item.name)}</strong><br><small>${escapeHtml(item.category)}</small></td>
            <td>${escapeHtml(item.direction)}</td>
            <td>${escapeHtml(item.frequency)}</td>
            <td>${escapeHtml(target || "A completer")}</td>
            <td>${escapeHtml(item.formula || "Formule a completer")}</td>
            <td>${escapeHtml(item.source || "KoboCollect")} #${escapeHtml(item.id || "")}</td>
            <td>${statusPill(item.calculated ? ragLabel(status) : "Reference Kobo", status)}</td>
          </tr>
        `;
      })
      .join("")
      : `<tr><td colspan="7">Aucun KPI disponible. Le formulaire 1 Kobo doit d'abord alimenter le referentiel.</td></tr>`;
  }

  function renderGroups() {
    $("#group-table").innerHTML = PMS_DATA.groups
      .map(
        (group) => `
          <tr>
            <td><strong>${escapeHtml(group.name)}</strong></td>
            <td>${group.count}</td>
            <td>${escapeHtml(group.validation)}</td>
            <td>${statusPill(group.priority, group.priority === "RAS" ? "green" : "amber")}</td>
          </tr>
        `
      )
      .join("");
  }

  function renderAlertBoard(state = {}) {
    const target = $("#alert-board");
    if (!target) return;
    const context = getDashboardContext(state);
    const rows = dashboardCriticalRows(context, 8).filter((row) => hasKpiData(row.kpi));
    target.innerHTML = rows.length
      ? rows
          .map(
            (row) => `
              <article class="alert-card ${row.kpi.status === "red" ? "critical" : row.kpi.status === "amber" ? "warning" : ""}">
                ${statusPill(row.kpi.status === "red" ? "Critique" : "Vigilance", row.kpi.status)}
                <h3>${escapeHtml(row.kpi.name)}</h3>
                <strong>${escapeHtml(row.pole.name)} - ${escapeHtml(row.kpi.period || "Periode Kobo")}</strong>
                <p>Valeur ${escapeHtml(row.kpi.value)} pour une cible ${escapeHtml(row.kpi.target)}. Source: ${escapeHtml(row.kpi.source || "KoboCollect")}.</p>
              </article>
            `
          )
          .join("")
      : `<div class="empty-kpi-state">Aucune notification de performance tant que les KPI ne sont pas calcules depuis Kobo.</div>`;
  }

  function renderActions(state = {}) {
    const target = $("#action-grid");
    if (!target) return;
    const context = getDashboardContext(state);
    const rows = dashboardCriticalRows(context, 6).filter((row) => hasKpiData(row.kpi));
    target.innerHTML = rows.length
      ? rows
          .map(
            (row) => `
              <article class="action-card">
                <p class="eyebrow">${escapeHtml(row.pole.owner)}</p>
                <h3>Plan d'action - ${escapeHtml(row.kpi.name)}</h3>
                <p>${escapeHtml(row.pole.name)} : ecart detecte sur la valeur ${escapeHtml(row.kpi.value)} vs cible ${escapeHtml(row.kpi.target)}.</p>
                <p><strong>Echeance:</strong> ${escapeHtml(cadenceProfileForPole(row.pole).expectedDelay || "Prochaine validation")}</p>
                <div class="progress" aria-label="Avancement 0%">
                  <span style="width:0%"></span>
                </div>
              </article>
            `
          )
          .join("")
      : `<div class="empty-kpi-state">Les plans d'action seront proposes automatiquement apres detection d'ecarts reels.</div>`;
  }

  function renderImprovement(state = {}) {
    const target = $("#improvement-heatmap");
    if (!target) return;
    const context = getDashboardContext(state);
    const rows = scopedKpiDataRows(context.kpiRows).filter((row) => Array.isArray(row.kpi.trendHistory) && row.kpi.trendHistory.length);
    if (!rows.length) {
      target.innerHTML = `<div class="empty-kpi-state">La matrice d'amelioration sera alimentee par l'historique Kobo des KPI.</div>`;
      return;
    }
    const periods = [...new Set(rows.flatMap((row) => row.kpi.trendHistory.map((point) => point.period).filter(Boolean)))].slice(-6);
    const header = `<div class="heat-row"><span></span>${periods.map((period) => `<strong class="heat-label">${escapeHtml(period)}</strong>`).join("")}</div>`;
    const body = rows.slice(0, 8).map((row) => {
      const byPeriod = new Map(row.kpi.trendHistory.map((point) => [point.period, point.status || row.kpi.status]));
      const cells = periods
        .map((period) => {
          const status = byPeriod.get(period) || "gray";
          return `<div class="heat-cell cell-${escapeHtml(status)}">${escapeHtml(status === "green" ? "OK" : status === "red" ? "KO" : status === "amber" ? "Vig." : "--")}</div>`;
        })
        .join("");
      return `<div class="heat-row"><strong class="heat-label">${escapeHtml(row.pole.id)}</strong>${cells}</div>`;
    }).join("");
    target.innerHTML = header + body;
  }

  function renderHourChart(state = {}) {
    const target = $("#hour-chart");
    if (!target) return;
    const results = Array.isArray(state.kpiCalculationResults) ? state.kpiCalculationResults : [];
    const hourlyResults = results.filter((item) => normalizeLookup(item.collectionFrequency || item.reportingFrequency || "").includes("horaire"));
    if (!hourlyResults.length) {
      target.innerHTML = `<div class="empty-kpi-state">Analyse horaire disponible apres collecte horaire Kobo.</div>`;
      return;
    }
    target.innerHTML = hourlyResults.slice(0, 12)
      .map((item) => {
        const actual = Math.max(0, Math.min(100, Number(item.value) || 0));
        const targetValue = Math.max(0, Math.min(100, Number(item.target) || actual));
        return `
          <div class="hour-bar" title="${escapeHtml(item.kpiName)} ${actual} vs cible ${targetValue}">
            <span class="target" style="height:${targetValue}%"></span>
            <span class="actual" style="height:${actual}%"></span>
          </div>
        `;
      })
      .join("");
  }

  function renderLosses(state = {}) {
    const target = $("#loss-stack");
    if (!target) return;
    const context = getDashboardContext(state);
    const rows = scopedKpiDataRows(context.kpiRows)
      .map((row) => ({ row, metric: metricFromTarget(row.kpi) }))
      .filter((item) => item.metric.className === "negative")
      .slice(0, 5);
    target.innerHTML = rows.length
      ? rows
          .map(
            ({ row, metric }) => `
              <div class="loss-row">
                <strong>${escapeHtml(row.pole.id)} - ${escapeHtml(row.kpi.name)} - ${escapeHtml(metric.display)}</strong>
                <div><span style="width:${Math.min(100, Math.abs(parseNumber(metric.display) || 0))}%"></span></div>
              </div>
            `
          )
          .join("")
      : `<div class="empty-kpi-state">Les pertes et ecarts seront calcules depuis les donnees Kobo validees.</div>`;
  }

  function renderTimeHeatmap(state = {}) {
    const target = $("#time-heatmap");
    if (!target) return;
    const dates = Array.isArray(state.kpiDailyDates) ? state.kpiDailyDates : [];
    if (!dates.length) {
      target.innerHTML = `<div class="empty-kpi-state">La heatmap temps sera disponible apres reception de donnees journalieres Kobo.</div>`;
      return;
    }
    const grouped = dates.slice(0, 25).map((item) => ({
      label: `${item.date || "Date"} / ${item.poleId || "Pole"}`,
      status: Number(item.count || 0) > 3 ? "cell-green" : Number(item.count || 0) > 0 ? "cell-amber" : "cell-gray",
      count: item.count || 0,
    }));
    target.innerHTML = grouped
      .map((item) => `<div class="time-cell ${escapeHtml(item.status)}" title="${escapeHtml(item.label)}">${escapeHtml(item.count)}</div>`)
      .join("");
  }

  function renderReports(state = {}) {
    const target = $("#report-grid");
    if (!target) return;
    const reports = Array.isArray(state.reportHistory) ? state.reportHistory : [];
    target.innerHTML = reports.length
      ? reports.slice(0, 6)
          .map(
            (report) => `
              <article class="report-card">
                <p class="eyebrow">${escapeHtml(report.format || "Rapport")}</p>
                <h3>${escapeHtml(report.cycle)} - ${escapeHtml(report.pole)}</h3>
                <p>${escapeHtml(report.period)} - ${escapeHtml(report.status)}</p>
                <button class="ghost-action">Consulter</button>
              </article>
            `
          )
          .join("")
      : `<div class="empty-kpi-state">Aucun rapport genere dans la base pour le moment.</div>`;
  }

  function renderPoleControls(state) {
    const reporting = PMS_DATA.reporting;
    const poleSelect = $("#pole-monitor-select");
    const cycleSelect = $("#pole-cycle-select");
    const frequencySelect = $("#pole-frequency-filter");
    if (!poleSelect) return;

    const accessContext = getPoleAccessContext(state);
    const activeCountry = getActiveCountry(state);
    const authorizedPoles = getCountryScopedPoles(state, accessContext.isRestricted ? accessContext.poles : reporting.poles);
    if (!authorizedPoles.length) {
      poleSelect.innerHTML = `<option>Aucun pole autorise</option>`;
      poleSelect.disabled = true;
      if (frequencySelect) {
        frequencySelect.innerHTML = cadenceOptionsHtml("Tous");
        frequencySelect.value = "Tous";
        frequencySelect.disabled = true;
      }
      const accessScope = $("#pole-access-scope");
      if (accessScope) {
        accessScope.textContent = `Acces: aucun pole autorise pour ${activeCountry.name}`;
      }
      if (cycleSelect) {
        cycleSelect.innerHTML = reporting.cycles
          .map((cycle) => `<option value="${escapeHtml(cycle.value)}" ${cycle.value === state.currentPoleCycle ? "selected" : ""}>${escapeHtml(cycle.value)}</option>`)
          .join("");
      }
      return;
    }
    if (!authorizedPoles.some((pole) => pole.id === state.currentPoleMonitor)) {
      state.currentPoleMonitor = authorizedPoles[0]?.id || reporting.defaultPole;
    }

    poleSelect.innerHTML = authorizedPoles
      .map(
        (pole) => `
          <option value="${escapeHtml(pole.id)}" ${pole.id === state.currentPoleMonitor ? "selected" : ""}>
            ${escapeHtml(pole.name)}
          </option>
        `
      )
      .join("");
    poleSelect.disabled = accessContext.isRestricted && authorizedPoles.length === 1;
    if (frequencySelect) {
      const selectedFrequency = state.currentPoleFrequency || "Tous";
      frequencySelect.innerHTML = cadenceOptionsHtml(selectedFrequency);
      frequencySelect.value = selectedFrequency;
      frequencySelect.disabled = false;
    }

    const accessScope = $("#pole-access-scope");
    if (accessScope) {
      accessScope.textContent = accessContext.isRestricted
        ? `Acces: ${accessContext.activeRule?.responsible || "Utilisateur"} - ${authorizedPoles.map((pole) => pole.name).join(", ")} - ${activeCountry.name}`
        : `Acces: tous les poles - ${activeCountry.name}`;
    }

    if (!cycleSelect) return;

    cycleSelect.innerHTML = reporting.cycles
      .map(
        (cycle) => `
          <option value="${escapeHtml(cycle.value)}" ${cycle.value === state.currentPoleCycle ? "selected" : ""}>
            ${escapeHtml(cycle.value)}
          </option>
        `
      )
      .join("");
  }

  function kpiStatusText(status) {
    if (status === "green") return "Vert";
    if (status === "red") return "Rouge";
    if (status === "gray") return "En attente Kobo";
    return "Orange";
  }

  function renderCalculationEnginePanel(state) {
    const panel = $("#kpi-engine-panel");
    if (!panel) return;
    const quality = state.kpiCalculationQuality || {};
    const results = Array.isArray(state.kpiCalculationResults) ? state.kpiCalculationResults : [];
    const activeCountry = getActiveCountry(state);
    const countryResults = filterRowsByCountry(results, activeCountry);
    const status = $("#kpi-engine-status");
    const summary = $("#kpi-engine-summary");
    const proposals = $("#kpi-engine-proposals");
    const selectedPoleResults = countryResults.filter((item) => item.poleId === state.currentPoleMonitor);
    const selectedPole = PMS_DATA.reporting.poles.find((pole) => pole.id === state.currentPoleMonitor) || {};
    const cadenceProfile = cadenceProfileForPole(selectedPole);
    const configured = Boolean(quality.configured);
    const calculated = isGroupCountry(activeCountry) ? quality.calculatedCount || results.length || 0 : countryResults.length;
    const calculationGroups = quality.calculationGroups || 0;
    const matchRate = quality.matchRate || 0;

    if (status) {
      status.className = `status-pill ${configured ? (calculated ? "green" : "amber") : "gray"}`;
      status.textContent = configured ? (calculated ? "Calcul actif" : "A synchroniser") : "A configurer";
    }

    if (summary) {
      const cards = [
        { label: "KPI calcules", value: calculated, hint: activeCountry.name },
        { label: "KPI du pole", value: selectedPoleResults.length, hint: "filtre actif" },
        { label: "Collecte attendue", value: cadenceProfile.primary || normalizeCadence(cadenceProfile.cadence), hint: cadenceProfile.expectedDelay || cadenceProfile.cadence },
        { label: "Rapprochement", value: `${matchRate}%`, hint: `${quality.matchedCalculationGroups || 0}/${calculationGroups} groupes` },
        { label: "Ecarts", value: (quality.unmatchedCalculationCount || 0) + (quality.unmatchedObjectiveCount || 0), hint: "objectif, pole, KPI ou periode" },
      ];
      summary.innerHTML = cards
        .map(
          (card) => `
            <div class="kpi-engine-stat">
              <span>${escapeHtml(card.label)}</span>
              <strong>${escapeHtml(card.value)}</strong>
              <small>${escapeHtml(card.hint)}</small>
            </div>
          `
        )
        .join("");
    }

    if (proposals) {
      const items = quality.proposals?.length
        ? quality.proposals
        : ["Configurer puis synchroniser les trois sources KoboCollect pour activer le calcul automatique."];
      proposals.innerHTML = items
        .slice(0, 3)
        .map((item) => `<span>${escapeHtml(item)}</span>`)
        .join("");
    }
  }

  function renderPoleKpiDirectory(state) {
    const reporting = PMS_DATA.reporting;
    const directory = $("#pole-kpi-directory");
    const total = $("#pole-kpi-total");
    const title = $("#pole-kpi-directory-title");
    const poleSelect = $("#pole-monitor-select");
    if (!directory) return;

    renderCalculationEnginePanel(state);

    const accessContext = getPoleAccessContext(state);
    const activeCountry = getActiveCountry(state);
    const authorizedPoles = getCountryScopedPoles(state, accessContext.isRestricted ? accessContext.poles : reporting.poles);
    if (!authorizedPoles.length) {
      if (poleSelect) {
        poleSelect.innerHTML = `<option>Aucun pole autorise</option>`;
        poleSelect.disabled = true;
      }
      if (title) title.textContent = `Aucun KPI disponible - ${activeCountry.name}`;
      if (total) total.textContent = "0 KPI";
      directory.innerHTML = `<div class="empty-kpi-state">Aucun pole n'est autorise pour ${escapeHtml(activeCountry.name)} avec ce profil.</div>`;
      return;
    }
    if (!authorizedPoles.some((pole) => pole.id === state.currentPoleMonitor)) {
      state.currentPoleMonitor = authorizedPoles[0]?.id || reporting.defaultPole;
    }
    const selectedPole =
      authorizedPoles.find((item) => item.id === state.currentPoleMonitor) || authorizedPoles[0] || reporting.poles[0];
    const selectedFrequency = state.currentPoleFrequency || "Tous";
    const rawSelectedKpis = reporting.kpisByPole[selectedPole.id] || [];
    const selectedKpis = filteredKpisByCadence(rawSelectedKpis, selectedPole, selectedFrequency);
    if (poleSelect) poleSelect.value = selectedPole.id;
    if (title) title.textContent = `KPI - ${selectedPole.name} - ${activeCountry.name}`;
    if (total) total.textContent = selectedFrequency === "Tous" ? `${selectedKpis.length} KPI` : `${selectedKpis.length}/${rawSelectedKpis.length} KPI`;

    directory.innerHTML = [selectedPole]
      .map((pole) => {
        const rawKpis = reporting.kpisByPole[pole.id] || [];
        const kpis = filteredKpisByCadence(rawKpis, pole, selectedFrequency);
        const dataKpis = kpis.filter(hasKpiData);
        const greenCount = dataKpis.filter((item) => item.status === "green").length;
        const amberCount = dataKpis.filter((item) => item.status === "amber").length;
        const redCount = dataKpis.filter((item) => item.status === "red").length;
        const poleStatus = dataKpis.length ? (redCount ? "red" : amberCount ? "amber" : "green") : "gray";
        const cadenceProfile = cadenceProfileForPole(pole);
        const cadenceLabel = selectedFrequency === "Tous"
          ? cadenceProfile.primary || normalizeCadence(cadenceProfile.cadence)
          : selectedFrequency;

        return `
          <article class="pole-kpi-block" id="pole-block-${escapeHtml(pole.id)}">
            <div class="pole-kpi-block-header">
              <div>
                <p class="eyebrow">${escapeHtml(pole.category || "Non classe")}</p>
                <h3>${escapeHtml(pole.name)}</h3>
                <p>${escapeHtml(pole.owner)} - ${escapeHtml(pole.id)}</p>
              </div>
              <div class="pole-kpi-counts">
                <span class="status-pill ${poleStatus}">${kpis.length} KPI</span>
                <span class="status-pill ${cadenceClass(cadenceLabel)}">Collecte: ${escapeHtml(cadenceLabel)}</span>
                <span class="status-pill ${countryStatusClass(activeCountry)}">Pays: ${escapeHtml(activeCountry.name)}</span>
                <span><i class="green"></i>${greenCount} vert(s)</span>
                <span><i class="amber"></i>${amberCount} orange(s)</span>
                <span><i class="red"></i>${redCount} rouge(s)</span>
              </div>
            </div>
            <div class="pole-kpi-items">
              ${
                kpis.length
                  ? kpis
                      .map(
                        (kpi) => `
                          <section class="pole-kpi-item status-${escapeHtml(kpi.status)}">
                            <div class="pole-kpi-item-head">
                              <strong>${escapeHtml(kpi.name)}</strong>
                              ${statusPill(kpiStatusText(kpi.status), kpi.status)}
                            </div>
                            <div class="pole-kpi-value">${escapeHtml(kpi.value)}</div>
                            ${renderTrendStrip(kpi, pole)}
                            <dl>
                              <div><dt>Categorie</dt><dd>${escapeHtml(kpi.category || "Non classe")}</dd></div>
                              <div><dt>Objectif</dt><dd>${escapeHtml(kpi.target)}</dd></div>
                              <div><dt>Tendance</dt><dd>${escapeHtml(kpi.trend)}</dd></div>
                              <div><dt>Source Kobo</dt><dd>${escapeHtml(kpi.source)}</dd></div>
                              <div><dt>Frequence collecte</dt><dd>${escapeHtml(kpiCollectionFrequency(kpi, pole))}</dd></div>
                              <div><dt>Periode</dt><dd>${escapeHtml(kpi.period || "Kobo")}</dd></div>
                              <div><dt>Methode</dt><dd>${escapeHtml(kpi.method || (kpi.pendingCalculation ? "Donnees de calcul attendues" : "Calcul PMS"))}</dd></div>
                              <div><dt>Formule</dt><dd>${escapeHtml(kpi.formula || "A completer")}</dd></div>
                            </dl>
                          </section>
                        `
                      )
                      .join("")
                  : `<div class="empty-kpi-state">${
                      rawKpis.length
                        ? `Aucun KPI ${escapeHtml(selectedFrequency.toLowerCase())} pour ce pole. Changez le filtre de collecte pour voir les autres KPI.`
                        : "Aucun KPI n'est encore rattache a ce pole."
                    }</div>`
              }
            </div>
          </article>
        `;
      })
      .join("");
  }

  function renderPoleMonitor(state) {
    if ($("#pole-kpi-directory")) {
      renderPoleKpiDirectory(state);
      return;
    }

    const reporting = PMS_DATA.reporting;
    const pole = reporting.poles.find((item) => item.id === state.currentPoleMonitor) || reporting.poles[0];
    const cycle = reporting.cycles.find((item) => item.value === state.currentPoleCycle) || reporting.cycles[0];
    const rawKpis = reporting.kpisByPole[pole.id] || [];
    const kpis = filteredKpisByCadence(rawKpis, pole, state.currentPoleFrequency || "Tous");
    const dataKpis = kpis.filter(hasKpiData);
    const redCount = dataKpis.filter((item) => item.status === "red").length;
    const amberCount = dataKpis.filter((item) => item.status === "amber").length;
    const greenCount = dataKpis.filter((item) => item.status === "green").length;
    const hasData = hasPoleData(pole);

    const selectedHeading = $("#selected-pole-heading");
    if (!selectedHeading) return;

    selectedHeading.textContent = `${pole.name} - KPIs ${cycle.value.toLowerCase()}`;
    $("#selected-pole-kpi-count").className = `status-pill ${hasData ? (redCount ? "red" : amberCount ? "amber" : "green") : "gray"}`;
    $("#selected-pole-kpi-count").textContent = `${kpis.length} KPI`;
    $("#selected-pole-summary").innerHTML = `
      <div>
        <span>Categorie</span>
        <strong>${escapeHtml(pole.category)}</strong>
      </div>
      <div>
        <span>Responsable</span>
        <strong>${escapeHtml(pole.owner)}</strong>
      </div>
      <div>
        <span>Etat KPI</span>
        <strong>${greenCount} vert(s), ${amberCount} orange(s), ${redCount} rouge(s)</strong>
      </div>
      <div>
        <span>Rapport</span>
        <strong>${escapeHtml(hasData ? `${pole.lastReport} - ${pole.status}` : "En attente donnees Kobo")}</strong>
      </div>
    `;
    $("#selected-kpi-cards").innerHTML = kpis.length
      ? kpis
          .map(
            (kpi) => `
              <article class="selected-kpi-card status-${escapeHtml(kpi.status)}">
                <div class="selected-kpi-head">
                  <strong>${escapeHtml(kpi.name)}</strong>
                  ${statusPill(kpiStatusText(kpi.status), kpi.status)}
                </div>
                <div class="selected-kpi-value">
                  <span>Valeur</span>
                  <strong>${escapeHtml(kpi.value)}</strong>
                </div>
                ${renderTrendStrip(kpi, pole)}
                <div class="selected-kpi-meta">
                  <span>Objectif: ${escapeHtml(kpi.target)}</span>
                  <span>Tendance: ${escapeHtml(kpi.trend)}</span>
                  <span>Source: ${escapeHtml(kpi.source)}</span>
                  <span>Collecte: ${escapeHtml(kpiCollectionFrequency(kpi, pole))}</span>
                </div>
              </article>
            `
          )
          .join("")
      : `<div class="empty-kpi-state">Aucun KPI n'est encore rattache a ce pole.</div>`;

    $("#pole-kpi-title").textContent = `Table detaillee - ${pole.name}`;
    $("#pole-scorecards").innerHTML = `
      <article class="metric-card">
        <span class="metric-label">Score performance</span>
        <strong>${escapeHtml(metricValueOrPending(pole, pole.score))}</strong>
        <span class="trend ${pole.rag === "red" ? "negative" : "positive"}">${statusPill(hasData ? ragLabel(pole.rag) : "En attente Kobo", hasData ? pole.rag : "gray")}</span>
      </article>
      <article class="metric-card">
        <span class="metric-label">Qualite Kobo</span>
        <strong>${escapeHtml(metricValueOrPending(pole, pole.quality, "%"))}</strong>
        <span class="trend ${hasData ? "positive" : "neutral"}">${hasData ? "Controle completude" : "Donnees attendues"}</span>
      </article>
      <article class="metric-card">
        <span class="metric-label">Rapport pret</span>
        <strong>${escapeHtml(metricValueOrPending(pole, pole.readiness, "%"))}</strong>
        <span class="trend ${hasData && pole.readiness < 70 ? "negative" : "positive"}">${escapeHtml(metricStatusOrPending(pole))}</span>
      </article>
      <article class="metric-card">
        <span class="metric-label">Points a traiter</span>
        <strong>${redCount + amberCount}</strong>
        <span class="trend ${redCount + amberCount ? "negative" : "positive"}">${pole.lateSubmissions} retard(s), ${pole.actionCount} action(s)</span>
      </article>
    `;

    $("#pole-kpi-table").innerHTML = kpis.length
      ? kpis
          .map(
            (kpi) => `
              <tr>
                <td><strong>${escapeHtml(kpi.name)}</strong></td>
                <td>${escapeHtml(kpi.value)}</td>
                <td>${escapeHtml(kpi.target)}</td>
                <td>${escapeHtml(kpi.trend)}</td>
                <td>${escapeHtml(kpi.source)}</td>
                <td>${escapeHtml(kpiCollectionFrequency(kpi, pole))}</td>
                <td>${statusPill(kpiStatusText(kpi.status), kpi.status)}</td>
              </tr>
            `
          )
          .join("")
      : `<tr><td colspan="7">Aucun KPI ne correspond au filtre de collecte selectionne.</td></tr>`;

    $("#pole-checklist").innerHTML = reporting.checklist
      .map((item, index) => {
        const done = index < Math.round((pole.readiness / 100) * reporting.checklist.length);
        return `
          <div class="checklist-item ${done ? "done" : ""}">
            <span>${done ? "OK" : "..."}</span>
            <div>
              <strong>${escapeHtml(item.key)}</strong>
              <p>${escapeHtml(item.owner)}</p>
            </div>
          </div>
        `;
      })
      .join("");
  }

  function renderReportCalendar(state = {}) {
    const table = $("#report-calendar-table");
    if (!table) return;
    const reports = Array.isArray(state.reportHistory) ? state.reportHistory : [];
    table.innerHTML = reports.length
      ? reports
          .slice(0, 8)
          .map((item) => {
            const pole = PMS_DATA.reporting.poles.find((candidate) => candidate.id === item.pole);
            return `
          <tr>
            <td><strong>${escapeHtml(item.pole)}</strong></td>
            <td>${escapeHtml(item.cycle)}</td>
            <td>${escapeHtml(item.period)}</td>
            <td>${escapeHtml(item.generatedAt || "Genere")}</td>
            <td>${escapeHtml(pole?.owner || "Responsable pole")}</td>
            <td>${statusPill(item.status, reportStatusClass(item.status))}</td>
          </tr>
        `;
          })
          .join("")
      : `<tr><td colspan="6">Aucun rapport planifie ou genere depuis les donnees pour le moment.</td></tr>`;
  }

  function renderReportHistory(state) {
    const reports = Array.isArray(state.reportHistory) ? state.reportHistory : [];
    $("#report-history-table").innerHTML = reports.length
      ? reports
          .map(
            (item) => `
          <tr>
            <td><strong>${escapeHtml(item.id)}</strong></td>
            <td>${escapeHtml(item.pole)}</td>
            <td>${escapeHtml(item.cycle)}</td>
            <td>${escapeHtml(item.period)}</td>
            <td>${escapeHtml(item.format)}</td>
            <td>${statusPill(item.status, reportStatusClass(item.status))}</td>
            <td>${escapeHtml(item.generatedAt)}</td>
          </tr>
        `
          )
          .join("")
      : `<tr><td colspan="7">Aucun rapport genere depuis les donnees pour le moment.</td></tr>`;
  }

  function renderDistributionList(state = {}) {
    const target = $("#distribution-list");
    if (!target) return;
    const reports = Array.isArray(state.reportHistory) ? state.reportHistory : [];
    target.innerHTML = reports.length
      ? PMS_DATA.reporting.distribution
          .map(
            (item) => `
          <article class="distribution-item">
            <div>
              <strong>${escapeHtml(item.audience)}</strong>
              <p>${escapeHtml(item.channel)} - ${escapeHtml(item.timing)}</p>
            </div>
            ${statusPill(item.status, item.className)}
          </article>
        `
          )
          .join("")
      : `<div class="empty-kpi-state">La diffusion sera disponible apres generation d'un rapport base sur les donnees Kobo.</div>`;
  }

  function reportStatusClass(status) {
    if (status === "Valide") return "green";
    if (status === "Plan requis") return "red";
    if (status === "A valider" || status === "A completer") return "amber";
    return "gray";
  }

  function renderReportControls(state) {
    const reporting = PMS_DATA.reporting;
    const accessContext = getPoleAccessContext(state);
    const authorizedPoles = accessContext.isRestricted ? accessContext.poles : reporting.poles;
    const poleSelect = $("#report-pole-select");
    if (!authorizedPoles.length) {
      if (poleSelect) {
        poleSelect.innerHTML = `<option>Aucun pole autorise</option>`;
        poleSelect.disabled = true;
      }
      const cycleSelect = $("#report-cycle-select");
      if (cycleSelect) {
        cycleSelect.innerHTML = reporting.cycles
          .map((cycle) => `<option value="${escapeHtml(cycle.value)}" ${cycle.value === state.currentReportCycle ? "selected" : ""}>${escapeHtml(cycle.value)}</option>`)
          .join("");
      }
      return;
    }
    if (!authorizedPoles.some((pole) => pole.id === state.currentReportPole)) {
      state.currentReportPole = authorizedPoles[0]?.id || reporting.defaultPole;
    }

    poleSelect.innerHTML = authorizedPoles
      .map(
        (pole) => `
          <option value="${escapeHtml(pole.id)}" ${pole.id === state.currentReportPole ? "selected" : ""}>
            ${escapeHtml(pole.name)}
          </option>
        `
      )
      .join("");
    poleSelect.disabled = accessContext.isRestricted && authorizedPoles.length === 1;

    $("#report-cycle-select").innerHTML = reporting.cycles
      .map(
        (cycle) => `
          <option value="${escapeHtml(cycle.value)}" ${cycle.value === state.currentReportCycle ? "selected" : ""}>
            ${escapeHtml(cycle.value)}
          </option>
        `
      )
      .join("");
  }

  function renderReportWorkspace(state) {
    const reporting = PMS_DATA.reporting;
    const accessContext = getPoleAccessContext(state);
    const authorizedPoles = accessContext.isRestricted ? accessContext.poles : reporting.poles;
    if (!authorizedPoles.length) {
      $("#report-preview-title").textContent = "Aucun rapport disponible";
      $("#report-status-pill").className = "status-pill gray";
      $("#report-status-pill").textContent = "Acces limite";
      $("#report-summary").innerHTML = `<article class="report-kpi-card"><span>Acces</span><strong>0 pole</strong><small>Aucun pole autorise pour ce pays / filiale.</small></article>`;
      $("#report-preview").innerHTML = `<div class="empty-kpi-state">Aucun rapport n'est visible pour ce pays / filiale avec ce profil.</div>`;
      const reportActions = $("#report-actions");
      if (reportActions) reportActions.innerHTML = "";
      return;
    }
    if (!authorizedPoles.some((item) => item.id === state.currentReportPole)) {
      state.currentReportPole = authorizedPoles[0]?.id || reporting.defaultPole;
    }
    const pole = authorizedPoles.find((item) => item.id === state.currentReportPole) || authorizedPoles[0] || reporting.poles[0];
    const cycle = reporting.cycles.find((item) => item.value === state.currentReportCycle) || reporting.cycles[0];
    const kpis = reporting.kpisByPole[pole.id] || [];
    const dataKpis = kpis.filter(hasKpiData);
    const hasData = hasPoleData(pole);
    const statusClass = hasData ? reportStatusClass(pole.status) : "gray";
    const redCount = dataKpis.filter((item) => item.status === "red").length;
    const amberCount = dataKpis.filter((item) => item.status === "amber").length;
    const greenCount = dataKpis.filter((item) => item.status === "green").length;
    const activePeriod = state.calendar?.label || $("#period-filter")?.value || cycle.value;

    $("#report-preview-title").textContent = `${cycle.value} - ${pole.name}`;
    $("#report-status-pill").className = `status-pill ${statusClass}`;
    $("#report-status-pill").textContent = metricStatusOrPending(pole);

    $("#report-summary").innerHTML = `
      <article class="report-kpi-card">
        <span>Score pole</span>
        <strong>${escapeHtml(metricValueOrPending(pole, pole.score))}</strong>
        ${statusPill(hasData ? ragLabel(pole.rag) : "En attente Kobo", hasData ? pole.rag : "gray")}
      </article>
      <article class="report-kpi-card">
        <span>KPIs suivis</span>
        <strong>${pole.kpiCount}</strong>
        <small>${greenCount} verts, ${amberCount} orange, ${redCount} rouges</small>
      </article>
      <article class="report-kpi-card">
        <span>Qualite Kobo</span>
        <strong>${escapeHtml(metricValueOrPending(pole, pole.quality, "%"))}</strong>
        <small>${hasData ? "Completude et controles" : "Aucune donnee calculee"}</small>
      </article>
      <article class="report-kpi-card">
        <span>Periode</span>
        <strong>${escapeHtml(activePeriod)}</strong>
        <small>Deadline: ${escapeHtml(cycle.deadline)}</small>
      </article>
    `;

    $("#report-preview").innerHTML = `
      <div class="report-cover">
        <div>
          <p class="eyebrow">Rapport ${escapeHtml(cycle.value)}</p>
          <h4>${escapeHtml(pole.name)}</h4>
          <p>Periode: ${escapeHtml(activePeriod)} | Responsable: ${escapeHtml(pole.owner)} | Donnees: ${escapeHtml(hasData ? pole.lastReport : "en attente Kobo")}</p>
        </div>
        <button class="ghost-action" id="submit-report">Soumettre validation</button>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>KPI</th>
              <th>Valeur</th>
              <th>Objectif</th>
              <th>Tendance</th>
              <th>Source Kobo</th>
              <th>Statut</th>
            </tr>
          </thead>
          <tbody>
            ${kpis
              .map(
                (kpi) => `
                  <tr>
                    <td><strong>${escapeHtml(kpi.name)}</strong></td>
                    <td>${escapeHtml(kpi.value)}</td>
                    <td>${escapeHtml(kpi.target)}</td>
                    <td>${escapeHtml(kpi.trend)}</td>
                    <td>${escapeHtml(kpi.source)}</td>
                    <td>${statusPill(kpiStatusText(kpi.status), kpi.status)}</td>
                  </tr>
                `
              )
              .join("")}
          </tbody>
        </table>
      </div>
      <div class="report-narrative">
        <strong>Synthese automatique</strong>
        <p>
          ${
            hasData
              ? `Le rapport ${escapeHtml(cycle.value.toLowerCase())} du ${escapeHtml(pole.name)} sur ${escapeHtml(activePeriod)} consolide les donnees Kobo, les ecarts aux objectifs, les alertes RAG et les plans d'action. Les KPI rouges doivent obligatoirement etre commentes avant validation N+1.`
              : `Le rapport ${escapeHtml(cycle.value.toLowerCase())} du ${escapeHtml(pole.name)} est pret a recevoir les donnees Kobo. Les indicateurs de performance seront generes automatiquement des que des soumissions seront importees.`
          }
        </p>
      </div>
    `;

    $("#report-workflow").innerHTML = reporting.workflow
      .map(
        (item, index) => `
          <div class="workflow-step">
            <span>${index + 1}</span>
            <div>
              <strong>${escapeHtml(item.step)}</strong>
              <p>${escapeHtml(item.detail)}</p>
            </div>
          </div>
        `
      )
      .join("");
  }

  function renderDatabaseBrowser(state) {
    const summary = $("#database-summary-cards");
    if (!summary) return;

    const overview = state.databaseOverview;
    const tables = overview?.tables || [];
    const selectedName = state.currentDatabaseTable || tables[0]?.name || "";
    const selectedTable = tables.find((table) => table.name === selectedName) || tables[0];
    const preview = state.databaseTablePreview?.name === selectedName ? state.databaseTablePreview : null;
    const formatCount = (value) => new Intl.NumberFormat("fr-FR").format(Number(value) || 0);
    const dailyTable = tables.find((table) => table.name === "kpi_daily_data");
    const koboTable = tables.find((table) => table.name === "kobo_submissions");

    if (!overview) {
      summary.innerHTML = `
        <div class="admin-summary-card">
          <span>Base</span>
          <strong>A charger</strong>
          <small>Cliquez sur Actualiser pour voir les donnees.</small>
        </div>
        <div class="admin-summary-card">
          <span>Mode</span>
          <strong>Lecture seule</strong>
          <small>Aucune modification depuis cet ecran.</small>
        </div>
      `;
      const select = $("#database-table-select");
      if (select) {
        select.innerHTML = `<option value="">Actualiser la base</option>`;
      }
      const list = $("#database-table-list");
      if (list) {
        list.innerHTML = `<div class="database-empty">Les tables s'afficheront apres actualisation.</div>`;
      }
      const title = $("#database-preview-title");
      if (title) title.textContent = "Aucune table chargee";
      const status = $("#database-table-status");
      if (status) {
        status.className = `status-pill ${state.databaseLoading ? "amber" : "gray"}`;
        status.textContent = state.databaseLoading ? "Chargement" : "Lecture seule";
      }
      const head = $("#database-preview-head");
      const body = $("#database-preview-body");
      if (head) head.innerHTML = "";
      if (body) body.innerHTML = `<tr><td>Actualisez pour afficher les donnees de la base.</td></tr>`;
      return;
    }

    summary.innerHTML = `
      <div class="admin-summary-card">
        <span>Fichier base</span>
        <strong>${escapeHtml(overview.database || "SQLite")}</strong>
        <small>Derniere lecture: ${escapeHtml(overview.updatedAt || "")}</small>
      </div>
      <div class="admin-summary-card">
        <span>Tables / vues</span>
        <strong>${formatCount(tables.length)}</strong>
        <small>${formatCount(overview.totalRows)} lignes au total</small>
      </div>
      <div class="admin-summary-card">
        <span>Donnees journalieres</span>
        <strong>${formatCount(dailyTable?.rowCount || 0)}</strong>
        <small>Table kpi_daily_data</small>
      </div>
      <div class="admin-summary-card">
        <span>Soumissions Kobo</span>
        <strong>${formatCount(koboTable?.rowCount || 0)}</strong>
        <small>Table kobo_submissions</small>
      </div>
    `;

    const select = $("#database-table-select");
    if (select) {
      select.innerHTML = tables
        .map(
          (table) => `
            <option value="${escapeHtml(table.name)}" ${table.name === selectedTable?.name ? "selected" : ""}>
              ${escapeHtml(table.label)} - ${formatCount(table.rowCount)} ligne(s)
            </option>
          `
        )
        .join("");
    }

    const tableList = $("#database-table-list");
    if (tableList) {
      tableList.innerHTML = tables.length
        ? tables
            .map(
              (table) => `
                <button
                  class="database-table-item ${table.name === selectedTable?.name ? "active" : ""}"
                  type="button"
                  data-database-table="${escapeHtml(table.name)}"
                >
                  <strong>${escapeHtml(table.label)}</strong>
                  <span>${escapeHtml(table.name)} - ${formatCount(table.rowCount)} ligne(s) - ${formatCount(table.columnCount)} champ(s)</span>
                </button>
              `
            )
            .join("")
        : `<div class="database-empty">Aucune table trouvee.</div>`;
    }

    const title = $("#database-preview-title");
    if (title) title.textContent = selectedTable?.label || "Selectionnez une table";

    const status = $("#database-table-status");
    if (status) {
      status.className = `status-pill ${state.databaseLoading ? "amber" : "green"}`;
      status.textContent = state.databaseLoading
        ? "Chargement"
        : `${formatCount(preview?.rowCount || selectedTable?.rowCount || 0)} ligne(s)`;
    }

    const head = $("#database-preview-head");
    const body = $("#database-preview-body");
    if (!head || !body) return;

    if (!preview) {
      head.innerHTML = "";
      body.innerHTML = `<tr><td>Choisissez une table pour afficher ses donnees.</td></tr>`;
      return;
    }

    const columns = preview.columns || [];
    head.innerHTML = `
      <tr>
        ${columns
          .map(
            (column) => `
              <th>
                ${escapeHtml(column.name)}
                ${column.sensitive ? `<small>masque</small>` : ""}
              </th>
            `
          )
          .join("")}
      </tr>
    `;

    body.innerHTML = preview.rows?.length
      ? preview.rows
          .map(
            (row) => `
              <tr>
                ${columns.map((column) => `<td>${escapeHtml(row[column.name])}</td>`).join("")}
              </tr>
            `
          )
          .join("")
      : `<tr><td colspan="${Math.max(columns.length, 1)}">Aucune donnee dans cette table pour le moment.</td></tr>`;
  }

  function renderAdmin(state) {
    const objectiveTable = $("#objective-table");
    if (!objectiveTable) return;

    const reporting = PMS_DATA.reporting;
    const selectedPole = reporting.poles.find((pole) => pole.id === state.currentAdminPole) || reporting.poles[0];
    const kpis = reporting.kpisByPole[selectedPole.id] || [];
    const selectedKpi = state.currentAdminKpi || kpis[0]?.name || "";
    const selectedKpiItem = kpis.find((kpi) => kpi.name === selectedKpi) || kpis[0] || null;
    const catalogProfile = getObjectiveCatalogProfile(selectedKpiItem, selectedPole);
    const objectiveTemplate = PMS_DATA.objectiveKoboTemplate || {};
    const objectives = state.kpiObjectives || [];
    const countFields =
      (objectiveTemplate.requiredFields?.length || 0) +
      (objectiveTemplate.objectiveFields?.length || 0) +
      (objectiveTemplate.calculationFields?.length || 0);
    const referenceSource = state.objectiveKoboSource;
    const monthlyObjectiveSource = state.monthlyObjectiveKoboSource;
    const calculationSource = state.calculationKoboSource;
    const sourceProfile = objectiveTemplate.sourceWorkbookProfile || {};
    const collectionProfile = objectiveTemplate.collectionWorkbookProfile || {};
    const objectiveSummary = $("#objective-summary-cards");
    const autoSync = state.koboAutoSync || {};

    const setKoboQuickCard = (selector, source, title, fallback, detail) => {
      const card = $(selector);
      if (!card) return;
      card.innerHTML = `
        <span>${escapeHtml(title)}</span>
        <strong>${escapeHtml(source?.formId || fallback)}</strong>
        <small>${escapeHtml(source?.serverUrl || detail)}</small>
      `;
    };
    setKoboQuickCard(
      "#admin-kobo-reference-quick",
      referenceSource,
      "Formulaire 1",
      "A connecter",
      "Referentiel KPI et formules."
    );
    setKoboQuickCard(
      "#admin-kobo-objective-quick",
      monthlyObjectiveSource,
      "Objectifs mensuels",
      "A connecter",
      "Cibles mensuelles officielles."
    );
    setKoboQuickCard(
      "#admin-kobo-calculation-quick",
      calculationSource,
      "Donnees de calcul",
      "A connecter",
      "Donnees journalieres et elements de calcul."
    );

    if (objectiveSummary) {
      const selectedPoleObjectives = objectives.filter((objective) => objective.poleId === selectedPole.id).length;
      objectiveSummary.innerHTML = `
        <div class="admin-summary-card">
          <span>Formulaire 1</span>
          <strong>KPI + formules</strong>
          <small>${escapeHtml(referenceSource?.formId || "A connecter")}</small>
        </div>
        <div class="admin-summary-card">
          <span>Formulaire 2</span>
          <strong>Objectifs mensuels</strong>
          <small>${escapeHtml(monthlyObjectiveSource?.formId || "A connecter")}</small>
        </div>
        <div class="admin-summary-card">
          <span>Formulaire 3</span>
          <strong>Donnees calcul</strong>
          <small>${escapeHtml(calculationSource?.formId || "A connecter")}</small>
        </div>
        <div class="admin-summary-card">
          <span>Reference KPI</span>
          <strong>${kpis.length}</strong>
          <small>${escapeHtml(selectedPole.name)}</small>
        </div>
        <div class="admin-summary-card">
          <span>Objectifs importes</span>
          <strong>${objectives.length}</strong>
          <small>${selectedPoleObjectives} depuis Kobo pour le pole actif</small>
        </div>
        <div class="admin-summary-card">
          <span>Champs attendus</span>
          <strong>${countFields}</strong>
          <small>sur les trois formulaires Kobo</small>
        </div>
        <div class="admin-summary-card">
          <span>Catalogue source</span>
          <strong>${sourceProfile.kpiCount || 0}</strong>
          <small>${sourceProfile.groupCount || 0} groupes / ${sourceProfile.categoryCount || 0} categories</small>
        </div>
        <div class="admin-summary-card">
          <span>Fiche collecte</span>
          <strong>${collectionProfile.formulaCount || 0}</strong>
          <small>${collectionProfile.collectionSheets || 0} onglets metier depuis ${escapeHtml(collectionProfile.fileName || "GMC")}</small>
        </div>
        <div class="admin-summary-card">
          <span>Controle qualite</span>
          <strong>${sourceProfile.formulaMissing || 0}</strong>
          <small>formule manquante / ${sourceProfile.targetMissing || 0} cible(s) a completer</small>
        </div>
      `;
    }

    const autoSummary = $("#admin-kobo-auto-summary");
    if (autoSummary) {
      const formatSyncDate = (value) => {
        if (!value) return "Jamais";
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return "Jamais";
        return date.toLocaleString("fr-FR", {
          day: "2-digit",
          month: "short",
          hour: "2-digit",
          minute: "2-digit",
        });
      };
      const intervalMinutes = Math.max(1, Math.round((autoSync.intervalSeconds || 900) / 60));
      const statusLabel = autoSync.running
        ? "Synchronisation en cours"
        : autoSync.enabled
          ? `Active toutes les ${intervalMinutes} min`
          : autoSync.tokenConfigured
            ? "Intervalle automatique inactif"
            : "Token Render a configurer";
      const detail = autoSync.lastError
        ? `Derniere erreur: ${autoSync.lastError}`
        : autoSync.lastSyncAt
          ? `Derniere synchro: ${formatSyncDate(autoSync.lastSyncAt)}`
          : autoSync.tokenConfigured
            ? "Premiere synchronisation en attente."
            : "Ajouter PMS_KOBO_API_TOKEN dans Render pour automatiser.";
      autoSummary.innerHTML = `
        <span>Synchronisation automatique</span>
        <strong>${escapeHtml(statusLabel)}</strong>
        <small>${escapeHtml(detail)}</small>
      `;
    }

    const fillKoboSourceForm = (source, config) => {
      if (!source) return;
      const setValue = (selector, value) => {
        const input = $(selector);
        if (input && value) input.value = value;
      };
      setValue(config.server, source.serverUrl);
      setValue(config.form, source.formId);
      Object.entries(config.fields).forEach(([mappedTo, selector]) => {
        setValue(selector, source.mappedFields?.[mappedTo]);
      });
    };

    fillKoboSourceForm(referenceSource, {
      server: "#admin-kobo-reference-server",
      form: "#admin-kobo-reference-form-id",
      fields: {
        id: "#admin-kobo-reference-id-field",
        branch: "#admin-kobo-reference-branch-field",
        category: "#admin-kobo-reference-category-field",
        entity: "#admin-kobo-reference-entity-field",
        subEntity: "#admin-kobo-reference-subentity-field",
        pole: "#admin-kobo-reference-pole-field",
        path: "#admin-kobo-reference-path-field",
        title: "#admin-kobo-reference-title-field",
        definition: "#admin-kobo-reference-definition-field",
        type: "#admin-kobo-reference-type-field",
        unit: "#admin-kobo-reference-unit-field",
        formula: "#admin-kobo-reference-formula-field",
        target: "#admin-kobo-reference-target-field",
        performanceDirection: "#admin-kobo-reference-performance-direction-field",
        collectionFrequency: "#admin-kobo-reference-collection-frequency-field",
        reportingFrequency: "#admin-kobo-reference-reporting-frequency-field",
        sourceData: "#admin-kobo-reference-source-field",
        owner: "#admin-kobo-reference-owner-field",
        respondent: "#admin-kobo-reference-respondent-field",
        respondentFunction: "#admin-kobo-reference-respondent-function-field",
        year: "#admin-kobo-reference-year-field",
        validation: "#admin-kobo-reference-validation-field",
        validator: "#admin-kobo-reference-validator-field",
        comments: "#admin-kobo-reference-comments-field",
        submittedAt: "#admin-kobo-reference-submitted-at-field",
        sourceReference: "#admin-kobo-reference-source-reference-field",
        documentStatus: "#admin-kobo-reference-document-status-field",
        attention: "#admin-kobo-reference-attention-field",
      },
    });
    fillKoboSourceForm(calculationSource, {
      server: "#admin-kobo-calculation-server",
      form: "#admin-kobo-calculation-form-id",
      fields: {
        pole: "#admin-kobo-calculation-pole-field",
        kpi: "#admin-kobo-calculation-kpi-field",
        period: "#admin-kobo-calculation-period-field",
        element: "#admin-kobo-calculation-element-field",
        value: "#admin-kobo-calculation-value-field",
        branch: "#admin-kobo-calculation-branch-field",
        date: "#admin-kobo-calculation-date-field",
        validation: "#admin-kobo-calculation-validation-field",
      },
    });
    fillKoboSourceForm(monthlyObjectiveSource, {
      server: "#admin-kobo-monthly-objective-server",
      form: "#admin-kobo-monthly-objective-form-id",
      fields: {
        branch: "#admin-kobo-monthly-objective-branch-field",
        pole: "#admin-kobo-monthly-objective-pole-field",
        kpi: "#admin-kobo-monthly-objective-kpi-field",
        period: "#admin-kobo-monthly-objective-period-field",
        target: "#admin-kobo-monthly-objective-target-field",
        unit: "#admin-kobo-monthly-objective-unit-field",
        frequency: "#admin-kobo-monthly-objective-frequency-field",
        distributionMode: "#admin-kobo-monthly-objective-distribution-field",
        sourceData: "#admin-kobo-monthly-objective-source-field",
        responsible: "#admin-kobo-monthly-objective-responsible-field",
        validation: "#admin-kobo-monthly-objective-validation-field",
      },
    });

    const setKoboSourceStatus = (selector, source, fallback) => {
      const status = $(selector);
      if (!status) return;
      if (!source) {
        status.className = "connector-status empty";
        status.textContent = fallback;
        return;
      }
      status.className = "connector-status success";
      status.innerHTML = `<strong>${escapeHtml(source.formId)}</strong><span>${escapeHtml(source.serverUrl)}</span>`;
    };
    setKoboSourceStatus(
      "#admin-kobo-reference-status",
      referenceSource,
      "Aucun formulaire KPI/formules configure."
    );
    setKoboSourceStatus(
      "#admin-kobo-monthly-objective-status",
      monthlyObjectiveSource,
      "Aucun formulaire objectifs mensuels configure."
    );
    setKoboSourceStatus(
      "#admin-kobo-calculation-status",
      calculationSource,
      "Aucun formulaire de donnees de calcul configure."
    );

    const catalogStatus = $("#objective-catalog-status");
    if (catalogStatus) {
      catalogStatus.className = `status-pill ${catalogProfile.fromCatalog ? "green" : "amber"}`;
      catalogStatus.textContent = catalogProfile.fromCatalog ? `${catalogProfile.id} trouve` : "A completer";
    }

    const catalogProfileContainer = $("#objective-catalog-profile");
    if (catalogProfileContainer) {
      catalogProfileContainer.innerHTML = `
        <div class="objective-profile-main">
          <div>
            <span>ID catalogue</span>
            <strong>${escapeHtml(catalogProfile.id)}</strong>
          </div>
          <div>
            <span>Type</span>
            <strong>${escapeHtml(catalogProfile.type)}</strong>
          </div>
          <div>
            <span>Unite</span>
            <strong>${escapeHtml(catalogProfile.unit)}</strong>
          </div>
          <div>
            <span>Cible catalogue</span>
            <strong>${escapeHtml(catalogProfile.target)}</strong>
          </div>
          <div>
            <span>Collecte</span>
            <strong>${escapeHtml(catalogProfile.collectionFrequency)}</strong>
          </div>
          <div>
            <span>Reporting</span>
            <strong>${escapeHtml(catalogProfile.reportingFrequency)}</strong>
          </div>
        </div>
        <div class="objective-profile-detail">
          <strong>Definition</strong>
          <p>${escapeHtml(catalogProfile.definition)}</p>
          <strong>Formule</strong>
          <p>${escapeHtml(catalogProfile.formula)}</p>
          <strong>Source & responsabilite</strong>
          <p>${escapeHtml(catalogProfile.dataSource)} - ${escapeHtml(catalogProfile.responsible)} / ${escapeHtml(catalogProfile.respondent)}</p>
          <strong>Validation</strong>
          <p>${escapeHtml(catalogProfile.hierarchicalValidation)} - ${escapeHtml(catalogProfile.validator || "Validateur a renseigner")} - ${escapeHtml(catalogProfile.documentStatus)}</p>
          <strong>Points d'attention</strong>
          <p>${escapeHtml(catalogProfile.attention)}</p>
        </div>
      `;
    }

    const fieldCount = $("#objective-field-count");
    if (fieldCount) {
      fieldCount.textContent = `${countFields} champ${countFields > 1 ? "s" : ""}`;
    }

    const fieldList = $("#objective-kobo-fields");
    if (fieldList) {
      const fieldGroups = [
        { title: "Formulaire 1 - KPI et formules", fields: objectiveTemplate.requiredFields || [] },
        { title: "Formulaire Objectifs - Cibles mensuelles", fields: objectiveTemplate.objectiveFields || [] },
        { title: "Formulaire Donnees - Elements de calcul", fields: objectiveTemplate.calculationFields || [] },
      ];
      const fieldGroupsMarkup = fieldGroups
        .map(
          (group) => `
            <div class="objective-field-section">
              <h4>${escapeHtml(group.title)}</h4>
              <div class="objective-field-section-grid">
                ${group.fields
                  .map(
                    (field) => `
                      <div class="objective-field-item">
                        <strong>${escapeHtml(field.key)}</strong>
                        <span>${escapeHtml(field.label)}</span>
                        <small>${escapeHtml(field.block)} - ${escapeHtml(field.source)}</small>
                      </div>
                    `
                  )
                  .join("")}
              </div>
            </div>
          `
        )
        .join("");
      const workbookMarkup = (collectionProfile.sheets || []).length
        ? `
          <div class="objective-field-section">
            <h4>Structure issue de ${escapeHtml(collectionProfile.fileName || "la fiche de collecte")}</h4>
            <div class="collection-sheet-grid">
              ${(collectionProfile.sheets || [])
                .map(
                  (sheet) => `
                    <article class="collection-sheet-card">
                      <div>
                        <span>${escapeHtml(sheet.code)}</span>
                        <strong>${escapeHtml(sheet.title)}</strong>
                        <small>${escapeHtml(sheet.cadence)}</small>
                      </div>
                      <p>${escapeHtml((sheet.expectedFields || []).slice(0, 8).join(", "))}</p>
                    </article>
                  `
                )
                .join("")}
            </div>
          </div>
        `
        : "";
      fieldList.innerHTML = fieldGroupsMarkup + workbookMarkup;
    }

    const controlList = $("#objective-control-list");
    if (controlList) {
      controlList.innerHTML = `
        <div class="objective-control-group">
          ${(objectiveTemplate.koboLogicSteps || objectiveTemplate.publicationChecklist || [])
            .map((item) => `<span>${escapeHtml(item)}</span>`)
            .join("")}
        </div>
      `;
    }

    const count = $("#objective-count");
    if (count) {
      count.className = `status-pill ${objectives.length ? "green" : "gray"}`;
      count.textContent = `${objectives.length} objectif${objectives.length > 1 ? "s" : ""}`;
    }

    objectiveTable.innerHTML = objectives.length
      ? objectives
          .map(
            (objective) => `
              <tr>
                <td><strong>${escapeHtml(objective.poleName)}</strong><br><small>${escapeHtml(objective.poleId)}</small></td>
                <td><strong>${escapeHtml(objective.catalogId || "A definir")}</strong></td>
                <td>${escapeHtml(objective.kpiName)}</td>
                <td><strong>${escapeHtml(objective.target)}</strong>${objective.unit && !objective.target.includes(objective.unit) ? `<br><small>${escapeHtml(objective.unit)}</small>` : ""}</td>
                <td>${escapeHtml(objective.period)}</td>
                <td>${escapeHtml(objective.frequency)}</td>
                <td>${escapeHtml(objective.responsible || "")}</td>
                <td>${escapeHtml(objective.validation || "")}</td>
                <td>${statusPill(objective.documentStatus || "A preciser", objective.documentStatus === "Documente" || objective.documentStatus === "Actif" ? "green" : "amber")}</td>
                <td>
                  <strong>${escapeHtml(objective.sourceForm)}</strong><br>
                  <small>${escapeHtml(objective.sourceData || objective.sourceFields.kpi)} / ${escapeHtml(objective.sourceFields.target)}</small>
                </td>
              </tr>
            `
          )
          .join("")
      : `<tr><td colspan="10">Aucun objectif KPI importe depuis KoboCollect pour le moment.</td></tr>`;

    const accessTable = $("#access-table");
    const poleAccessTable = $("#pole-access-table");

    const accessProfiles = state.platformAccessRoles || [];
    const currentAccessRole = accessProfiles.find((role) => role.profile === state.currentAccessProfile) || accessProfiles[0];
    const profileSelect = $("#access-profile");
    const newUserProfileSelect = $("#new-user-profile");
    const newUserBranchSelect = $("#new-user-branch");
    const newUserPoleSelect = $("#new-user-pole");
    const userTable = $("#user-table");
    const users = state.platformUsers || [];
    const accessRules = state.accessRules || [];
    const accessSummary = $("#access-summary-cards");
    const currentUser =
      users.find((user) => String(user.id) === String(state.currentUserAccessUserId)) ||
      users.find((user) => user.defaultPoleId === state.currentUserAccessPole) ||
      users[0];
    if (currentUser) {
      state.currentUserAccessUserId = currentUser.id;
    }

    if (accessSummary) {
      accessSummary.innerHTML = `
        <div class="admin-summary-card">
          <span>Utilisateurs</span>
          <strong>${users.length}</strong>
          <small>${users.filter((user) => user.status === "Actif").length} comptes actifs</small>
        </div>
        <div class="admin-summary-card">
          <span>Affectations</span>
          <strong>${accessRules.length}</strong>
          <small>dashboards limites par pays + pole</small>
        </div>
        <div class="admin-summary-card">
          <span>Profils</span>
          <strong>${accessProfiles.length}</strong>
          <small>${escapeHtml(currentAccessRole?.profile || "Aucun profil actif")}</small>
        </div>
        <div class="admin-summary-card">
          <span>Selection</span>
          <strong>${escapeHtml(currentUser?.fullName || "Utilisateur")}</strong>
          <small>${escapeHtml(currentUser?.defaultBranch || "Groupe")} - ${escapeHtml(currentUser?.defaultPoleName || "Pole a affecter")}</small>
        </div>
      `;
    }
    if (profileSelect) {
      profileSelect.innerHTML = accessProfiles
        .map(
          (role) => `
            <option value="${escapeHtml(role.profile)}" ${role.profile === currentAccessRole?.profile ? "selected" : ""}>
              ${escapeHtml(role.profile)}
            </option>
          `
        )
        .join("");
    }

    if (newUserProfileSelect) {
      const profile = state.currentUserAccessProfile || "Manager / Responsable";
      newUserProfileSelect.innerHTML = accessProfiles
        .map(
          (role) => `
            <option value="${escapeHtml(role.profile)}" ${role.profile === profile ? "selected" : ""}>
              ${escapeHtml(role.profile)}
            </option>
          `
        )
        .join("");
    }

    if (newUserPoleSelect) {
      newUserPoleSelect.innerHTML = reporting.poles
        .map(
          (pole) => `
            <option value="${escapeHtml(pole.id)}" ${pole.id === state.currentUserAccessPole ? "selected" : ""}>
              ${escapeHtml(pole.name)}
            </option>
          `
        )
        .join("");
    }

    if (newUserBranchSelect) {
      const branch = state.currentUserAccessBranch || currentUser?.defaultBranch || "Groupe";
      newUserBranchSelect.innerHTML = countryOptionsHtml(branch, {});
      newUserBranchSelect.value = countryFilterValue(findCountryByValue(branch));
    }

    document.querySelectorAll("[data-permission-key]").forEach((checkbox) => {
      checkbox.checked = Boolean(currentAccessRole?.permissions?.[checkbox.dataset.permissionKey]);
    });

    const selectedUserPole =
      reporting.poles.find((pole) => pole.id === state.currentUserAccessPole) || reporting.poles[0];
    const userResponsibleSelect = $("#user-access-responsible");
    const userBranchSelect = $("#user-access-branch");
    const userPoleSelect = $("#user-access-pole");
    const userProfileSelect = $("#user-access-profile");
    const userDashboardInput = $("#user-access-dashboard");

    if (userResponsibleSelect) {
      userResponsibleSelect.innerHTML = users.length
        ? users
            .map(
              (user) => `
            <option
              value="${escapeHtml(user.id)}"
              data-pole-id="${escapeHtml(user.defaultPoleId || "")}"
              data-branch="${escapeHtml(user.defaultBranch || "Groupe")}"
              data-email="${escapeHtml(user.email || "")}"
              data-phone="${escapeHtml(user.phone || "")}"
              ${String(user.id) === String(currentUser?.id) ? "selected" : ""}
            >
              ${escapeHtml(user.fullName)}${user.email ? ` - ${escapeHtml(user.email)}` : ""}
            </option>
          `
            )
            .join("")
        : reporting.poles
            .map(
              (pole) => `
              <option value="${escapeHtml(pole.id)}" data-pole-id="${escapeHtml(pole.id)}" data-branch="Groupe" ${pole.id === selectedUserPole.id ? "selected" : ""}>
                ${escapeHtml(pole.owner)}
              </option>
            `
            )
            .join("");
    }

    if (userPoleSelect) {
      userPoleSelect.innerHTML = reporting.poles
        .map(
          (pole) => `
            <option value="${escapeHtml(pole.id)}" ${pole.id === selectedUserPole.id ? "selected" : ""}>
              ${escapeHtml(pole.name)}
            </option>
          `
        )
        .join("");
    }

    if (userBranchSelect) {
      const branch = state.currentUserAccessBranch || currentUser?.defaultBranch || "Groupe";
      userBranchSelect.innerHTML = countryOptionsHtml(branch, {});
      userBranchSelect.value = countryFilterValue(findCountryByValue(branch));
    }

    if (userProfileSelect) {
      const profile = state.currentUserAccessProfile || "Manager / Responsable";
      userProfileSelect.innerHTML = accessProfiles
        .map(
          (role) => `
            <option value="${escapeHtml(role.profile)}" ${role.profile === profile ? "selected" : ""}>
              ${escapeHtml(role.profile)}
            </option>
          `
        )
        .join("");
    }

    if (userDashboardInput) {
      const branch = state.currentUserAccessBranch || currentUser?.defaultBranch || "Groupe";
      userDashboardInput.value = `Dashboard Suivi KPI - ${countryFilterValue(findCountryByValue(branch))} - ${selectedUserPole.name}`;
    }

    const userCount = $("#user-count");
    if (userCount) {
      userCount.className = `status-pill ${users.length ? "green" : "gray"}`;
      userCount.textContent = `${users.length} utilisateur${users.length > 1 ? "s" : ""}`;
    }

    if (userTable) {
      const userStatusClass = (status) => (status === "Actif" ? "green" : status === "Suspendu" ? "amber" : "gray");
      userTable.innerHTML = users.length
        ? users
            .map(
              (user) => `
              <tr>
                <td><strong>${escapeHtml(user.fullName)}</strong></td>
                <td>${escapeHtml(user.email || "")}</td>
                <td>${escapeHtml(user.phone || "")}</td>
                <td>${escapeHtml(user.profile || "")}</td>
                <td>${escapeHtml(user.defaultBranch || "Groupe")}</td>
                <td>${escapeHtml(user.defaultPoleName || user.defaultPoleId || "A affecter")}</td>
                <td>${statusPill(user.status || "Actif", userStatusClass(user.status || "Actif"))}</td>
              </tr>
            `
            )
            .join("")
        : `<tr><td colspan="7">Aucun utilisateur cree pour le moment.</td></tr>`;
    }

    const permissionLabels = [
      ["consultation", "Consultation"],
      ["ajout", "Ajout"],
      ["modification", "Modification"],
      ["suppression", "Suppression"],
      ["validation", "Validation"],
      ["administration", "Administration"],
    ];

    const permissionMark = (allowed) =>
      `<span class="permission-mark ${allowed ? "allowed" : "denied"}" aria-label="${allowed ? "Autorise" : "Refuse"}">
        ${allowed ? "&#10003;" : "&#10005;"}
      </span>`;

    const accessCount = $("#access-count");
    if (accessCount) {
      accessCount.className = `status-pill ${accessProfiles.length ? "green" : "gray"}`;
      accessCount.textContent = `${accessProfiles.length} profil${accessProfiles.length > 1 ? "s" : ""}`;
    }
    const activeAccessScope = $("#active-access-scope");
    if (activeAccessScope) {
      activeAccessScope.className = `status-pill ${currentAccessRole ? "green" : "amber"}`;
      activeAccessScope.textContent = currentAccessRole ? `Profil actif: ${currentAccessRole.profile}` : "Profil non selectionne";
    }

    if (accessTable) {
      accessTable.innerHTML = accessProfiles.length
        ? accessProfiles
            .map(
              (role) => {
                const isActive = role.profile === currentAccessRole?.profile;
                return `
                <tr class="${isActive ? "active-permission-row" : ""}">
                  <td><strong>${escapeHtml(role.profile)}</strong></td>
                  ${permissionLabels.map(([key]) => `<td>${permissionMark(Boolean(role.permissions?.[key]))}</td>`).join("")}
                  <td>
                    <button class="access-action ${isActive ? "active" : ""}" type="button" data-select-access-profile="${escapeHtml(role.profile)}">
                      ${isActive ? "Selectionne" : "Modifier"}
                    </button>
                  </td>
                </tr>
              `;
              }
            )
            .join("")
        : `<tr><td colspan="8">Aucun profil configure pour le moment.</td></tr>`;
    }

    if (poleAccessTable) {
      poleAccessTable.innerHTML = accessRules.length
        ? accessRules
            .map(
              (rule) => {
                const isSelected = rule.id === state.activeAccessRuleId;
                return `
                <tr>
                  <td><strong>${escapeHtml(rule.responsible)}</strong></td>
                  <td>${escapeHtml(rule.branch || rule.countryName || "Groupe")}</td>
                  <td><strong>${escapeHtml(rule.poleName)}</strong><br><small>${escapeHtml(rule.poleId)}</small></td>
                  <td>${escapeHtml(rule.role)}</td>
                  <td>
                    <strong>${escapeHtml(rule.dashboardScope)}</strong><br>
                    <small>${escapeHtml(rule.permission)}</small>
                  </td>
                  <td>${statusPill(isSelected ? "Selectionne" : rule.status, isSelected ? "green" : rule.className)}</td>
                  <td>
                    <button class="access-action ${isSelected ? "active" : ""}" type="button" data-edit-user-access="${escapeHtml(rule.id)}">
                      Modifier
                    </button>
                  </td>
                </tr>
              `;
              }
            )
            .join("")
        : `<tr><td colspan="7">Aucune affectation par pole configuree.</td></tr>`;
    }

    renderDatabaseBrowser(state);
  }

  function renderAll(state) {
    renderBranches();
    renderExecutiveAlerts(state);
    renderSparkline(state);
    renderCatalogStats();
    renderCalendarSlicer(state);
    renderCountryDashboard(state);
    renderAdvancedDashboard(state);
    renderPoleSummaryTables(state);
    renderPoleControls(state);
    renderPoleMonitor(state);
    renderReportCalendar(state);
    renderKoboTable("", state.koboSubmissions, state.calendarBranchFilter);
    renderCollectionForms();
    renderMethodologyControls();
    renderKoboPipeline(state);
    renderValidationQueue(state.validationQueue);
    renderKpiTable();
    renderGroups();
    renderAlertBoard(state);
    renderActions(state);
    renderImprovement(state);
    renderHourChart(state);
    renderLosses(state);
    renderTimeHeatmap(state);
    renderReports(state);
    renderReportControls(state);
    renderReportWorkspace(state);
    renderDistributionList(state);
    renderReportHistory(state);
    renderAdmin(state);
  }

  window.PMS_RENDERERS = {
    $,
    renderAll,
    renderPoleControls,
    renderPoleSummaryTables,
    renderKoboTable,
    renderKpiTable,
    renderCalendarSlicer,
    renderCountryDashboard,
    renderAdvancedDashboard,
    renderPoleMonitor,
    renderValidationQueue,
    renderReportControls,
    renderReportWorkspace,
    renderReportHistory,
    renderAdmin,
    getObjectiveCatalogProfile,
  };
})();
