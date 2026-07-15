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
    $("#branch-bars").innerHTML = PMS_DATA.branchScores
      .map(
        (branch) => `
          <div class="branch-bar-row">
            <strong>${escapeHtml(branch.name)}</strong>
            <div class="bar-track"><div class="bar-fill" style="width:${branch.score}%"></div></div>
            <span>${branch.score}</span>
          </div>
        `
      )
      .join("");
  }

  function renderExecutiveAlerts() {
    $("#executive-alerts").innerHTML = PMS_DATA.alerts
      .slice(0, 3)
      .map(
        (alert) => `
          <article class="alert-item">
            <div>
              <strong>${escapeHtml(alert.title)}</strong>
              <p>${escapeHtml(alert.scope)} - ${escapeHtml(alert.detail)}</p>
            </div>
            ${statusPill(alert.level === "red" ? "Critique" : alert.level === "amber" ? "Vigilance" : "Manquant", alert.level)}
          </article>
        `
      )
      .join("");
  }

  function renderSparkline() {
    const values = [72, 75, 78, 77, 80, 82];
    $("#ipg-sparkline").innerHTML = values
      .map((value) => `<div class="spark-bar" data-value="${value}" style="height:${value}%"></div>`)
      .join("");
  }

  function renderCatalogStats() {
    const summary = PMS_DATA.catalogSummary;
    $("#catalog-stat-kpis").textContent = summary.kpiCount;
    $("#catalog-stat-formulas").textContent = summary.formulaCount;
    $("#catalog-stat-groups").textContent = summary.groupCount;
    $("#catalog-stat-forms").textContent = summary.collectionDomains;

    $("#category-breakdown").innerHTML = summary.categories
      .map(
        (item) => `
          <div class="breakdown-row">
            <span>${escapeHtml(item.name)}</span>
            <strong>${item.count}</strong>
          </div>
        `
      )
      .join("");

    $("#frequency-breakdown").innerHTML = summary.frequencies
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

  function ragLabel(status) {
    if (status === "green") return "Vert";
    if (status === "red") return "Rouge";
    if (status === "amber") return "Orange";
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

    const sessionRules = Array.isArray(state.userAccessScope)
      ? state.userAccessScope.filter((rule) => rule?.poleId)
      : [];
    const fallbackRule = (state.accessRules || []).find((rule) => rule.id === state.activeAccessRuleId);
    const rules = sessionRules.length ? sessionRules : fallbackRule ? [fallbackRule] : [];
    const poleIds = [...new Set(rules.map((rule) => rule.poleId))];
    const poles = reporting.poles.filter((pole) => poleIds.includes(pole.id));
    const activeRule = rules.find((rule) => rule.id === state.activeAccessRuleId) || rules[0] || null;

    return {
      activeRule,
      poles: poles.length ? poles : reporting.poles,
      isRestricted: poles.length > 0,
    };
  }

  function renderPoleSummaryRows(selector, state) {
    const target = $(selector);
    if (!target) return;
    const accessContext = getPoleAccessContext(state);
    const dashboardCount = selector === "#dashboard-pole-summary-table" ? $("#dashboard-pole-count") : null;
    if (dashboardCount) {
      dashboardCount.className = `status-pill ${accessContext.isRestricted ? "green" : "amber"}`;
      dashboardCount.textContent = `${accessContext.poles.length} pole${accessContext.poles.length > 1 ? "s" : ""} suivi${accessContext.poles.length > 1 ? "s" : ""}`;
    }
    target.innerHTML = accessContext.poles
      .map((pole) => {
        const { greenCount, amberCount, redCount } = getPoleKpiStatus(pole.id);
        return `
          <tr>
            <td>${escapeHtml(pole.category || "Non classe")}</td>
            <td><strong>${escapeHtml(pole.name)}</strong><br><small>${escapeHtml(pole.id)}</small></td>
            <td>${escapeHtml(pole.owner)}</td>
            <td><strong>${pole.score}</strong></td>
            <td>
              <span class="mini-rag-count"><i class="green"></i>${greenCount}</span>
              <span class="mini-rag-count"><i class="amber"></i>${amberCount}</span>
              <span class="mini-rag-count"><i class="red"></i>${redCount}</span>
            </td>
            <td>${pole.quality}%</td>
            <td>${statusPill(pole.status, reportStatusClass(pole.status))}</td>
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
    const reporting = PMS_DATA.reporting;
    const categories = [...new Set(reporting.poles.map((pole) => pole.category || "Non classe"))];

    $("#dashboard-pole-kpis").innerHTML = categories
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
    const priorityKpis = [...kpis]
      .sort((left, right) => {
        const order = { red: 0, amber: 1, green: 2 };
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
          ${statusPill(ragLabel(pole.rag), pole.rag)}
        </div>
        <div class="pole-score-row">
          <div>
            <span>Score pole</span>
            <strong>${pole.score}</strong>
          </div>
          <div>
            <span>Qualite Kobo</span>
            <strong>${pole.quality}%</strong>
          </div>
          <div>
            <span>Rapport pret</span>
            <strong>${pole.readiness}%</strong>
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
          <span>${pole.lateSubmissions} retard(s) Kobo - ${pole.actionCount} action(s)</span>
          <button class="ghost-action" data-open-pole="${escapeHtml(pole.id)}">Voir le pole</button>
        </div>
      </article>
    `;
  }

  function renderKoboTable(filter = "", submissions = PMS_DATA.koboSubmissions) {
    const table = $("#kobo-table");
    if (!table) return;
    const rows = filterRows(submissions, filter, ["form", "branch", "kpi", "collector", "status"]);
    table.innerHTML = rows
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
      .join("");
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
              <p>${escapeHtml(form.cadence)}</p>
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

  function renderKoboPipeline() {
    const container = $("#kobo-pipeline");
    if (!container) return;
    container.innerHTML = PMS_DATA.koboPipeline
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

  function renderValidationQueue(queue = PMS_DATA.validationQueue) {
    const table = $("#validation-queue-table");
    if (!table) return;
    table.innerHTML = queue
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
      .join("");
  }

  function renderKpiTable(filter = "") {
    const rows = filterRows(PMS_DATA.formulaDictionary, filter, ["id", "direction", "name", "category", "frequency", "target"]);
    $("#kpi-table").innerHTML = rows
      .map((item) => {
        const status = item.target.includes("<=") || item.target.includes(">=") ? "green" : "amber";
        return `
          <tr>
            <td><strong>${escapeHtml(item.name)}</strong><br><small>${escapeHtml(item.category)}</small></td>
            <td>${escapeHtml(item.direction)}</td>
            <td>${escapeHtml(item.frequency)}</td>
            <td>${escapeHtml(item.target)}</td>
            <td>${escapeHtml(item.source)} #${escapeHtml(item.id)}</td>
            <td>${statusPill(status === "green" ? "Cadre defini" : "Cible a preciser", status)}</td>
          </tr>
        `;
      })
      .join("");
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

  function renderAlertBoard() {
    $("#alert-board").innerHTML = PMS_DATA.alerts
      .map(
        (alert) => `
          <article class="alert-card ${alert.level === "red" ? "critical" : alert.level === "amber" ? "warning" : ""}">
            ${statusPill(alert.level === "red" ? "Critique" : alert.level === "amber" ? "Vigilance" : "Donnee manquante", alert.level)}
            <h3>${escapeHtml(alert.title)}</h3>
            <strong>${escapeHtml(alert.scope)}</strong>
            <p>${escapeHtml(alert.detail)}</p>
          </article>
        `
      )
      .join("");
  }

  function renderActions() {
    $("#action-grid").innerHTML = PMS_DATA.actionPlans
      .map(
        (plan) => `
          <article class="action-card">
            <p class="eyebrow">${escapeHtml(plan.owner)}</p>
            <h3>${escapeHtml(plan.title)}</h3>
            <p>${escapeHtml(plan.detail)}</p>
            <p><strong>Echeance:</strong> ${escapeHtml(plan.due)}</p>
            <div class="progress" aria-label="Avancement ${plan.progress}%">
              <span style="width:${plan.progress}%"></span>
            </div>
          </article>
        `
      )
      .join("");
  }

  function renderImprovement() {
    const directions = ["Finance", "WFM", "BPO", "RH", "DSI", "Qualite"];
    const states = ["AC+", "AC=", "AC-", "ACV", "AC+", "AC="];
    const classes = ["cell-green", "cell-amber", "cell-red", "cell-gray", "cell-green", "cell-amber"];
    const months = ["P-5", "P-4", "P-3", "P-2", "P-1", "P"];
    const header = `<div class="heat-row"><span></span>${months.map((m) => `<strong class="heat-label">${m}</strong>`).join("")}</div>`;
    const rows = directions
      .map((direction, index) => {
        const cells = months
          .map((_, cellIndex) => {
            const pick = (index + cellIndex) % states.length;
            return `<div class="heat-cell ${classes[pick]}">${states[pick]}</div>`;
          })
          .join("");
        return `<div class="heat-row"><strong class="heat-label">${escapeHtml(direction)}</strong>${cells}</div>`;
      })
      .join("");
    $("#improvement-heatmap").innerHTML = header + rows;
  }

  function renderHourChart() {
    const values = [[72, 80], [75, 82], [68, 80], [83, 85], [88, 86], [79, 84], [71, 82], [66, 80], [77, 84], [82, 86], [74, 82], [69, 80]];
    $("#hour-chart").innerHTML = values
      .map(
        ([actual, target]) => `
          <div class="hour-bar" title="CA/h ${actual} vs cible ${target}">
            <span class="target" style="height:${target}%"></span>
            <span class="actual" style="height:${actual}%"></span>
          </div>
        `
      )
      .join("");
  }

  function renderLosses() {
    const losses = [
      ["Occupation insuffisante", 36],
      ["Performance horaire", 28],
      ["Appels non facturables", 22],
      ["Absenteisme", 14],
    ];
    $("#loss-stack").innerHTML = losses
      .map(
        ([label, value]) => `
          <div class="loss-row">
            <strong>${escapeHtml(label)} - ${value}%</strong>
            <div><span style="width:${value}%"></span></div>
          </div>
        `
      )
      .join("");
  }

  function renderTimeHeatmap() {
    const slots = ["00", "02", "04", "06", "08", "10", "12", "14", "16", "18", "20", "22"];
    const days = ["Lun", "Mar", "Mer", "Jeu", "Ven"];
    const header = `<div class="time-row"><span></span>${slots.map((slot) => `<strong class="time-label">${slot}h</strong>`).join("")}</div>`;
    const rows = days
      .map((day, dayIndex) => {
        const cells = slots
          .map((_, slotIndex) => {
            const value = 68 + ((dayIndex * 7 + slotIndex * 4) % 24);
            const status = value < 72 ? "cell-red" : value < 80 ? "cell-amber" : "cell-green";
            return `<div class="time-cell ${status}">${value}%</div>`;
          })
          .join("");
        return `<div class="time-row"><strong class="time-label">${day}</strong>${cells}</div>`;
      })
      .join("");
    $("#time-heatmap").innerHTML = header + rows;
  }

  function renderReports() {
    $("#report-grid").innerHTML = PMS_DATA.reports
      .map(
        (report) => `
          <article class="report-card">
            <p class="eyebrow">${escapeHtml(report.format)}</p>
            <h3>${escapeHtml(report.title)}</h3>
            <p>${escapeHtml(report.detail)}</p>
            <button class="ghost-action">Preparer</button>
          </article>
        `
      )
      .join("");
  }

  function renderPoleControls(state) {
    const reporting = PMS_DATA.reporting;
    const poleSelect = $("#pole-monitor-select");
    const cycleSelect = $("#pole-cycle-select");
    if (!poleSelect) return;

    const accessContext = getPoleAccessContext(state);
    const authorizedPoles = accessContext.poles.length ? accessContext.poles : reporting.poles;
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

    const accessScope = $("#pole-access-scope");
    if (accessScope) {
      accessScope.textContent = accessContext.isRestricted
        ? `Acces: ${accessContext.activeRule?.responsible || "Utilisateur"} - ${authorizedPoles.map((pole) => pole.name).join(", ")}`
        : "Acces: tous les poles";
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
    if (status === "gray") return "A verifier";
    return "Orange";
  }

  function renderCalculationEnginePanel(state) {
    const panel = $("#kpi-engine-panel");
    if (!panel) return;
    const quality = state.kpiCalculationQuality || {};
    const results = Array.isArray(state.kpiCalculationResults) ? state.kpiCalculationResults : [];
    const status = $("#kpi-engine-status");
    const summary = $("#kpi-engine-summary");
    const proposals = $("#kpi-engine-proposals");
    const selectedPoleResults = results.filter((item) => item.poleId === state.currentPoleMonitor);
    const configured = Boolean(quality.configured);
    const calculated = quality.calculatedCount || results.length || 0;
    const calculationGroups = quality.calculationGroups || 0;
    const matchRate = quality.matchRate || 0;

    if (status) {
      status.className = `status-pill ${configured ? (calculated ? "green" : "amber") : "gray"}`;
      status.textContent = configured ? (calculated ? "Calcul actif" : "A synchroniser") : "A configurer";
    }

    if (summary) {
      const cards = [
        { label: "KPI calcules", value: calculated, hint: "tous poles" },
        { label: "KPI du pole", value: selectedPoleResults.length, hint: "filtre actif" },
        { label: "Rapprochement", value: `${matchRate}%`, hint: `${quality.matchedCalculationGroups || 0}/${calculationGroups} groupes` },
        { label: "Ecarts", value: quality.unmatchedCalculationCount || 0, hint: "pole, KPI ou periode" },
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
        : ["Configurer puis synchroniser les deux formulaires KoboCollect pour activer le calcul automatique."];
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
    const authorizedPoles = accessContext.poles.length ? accessContext.poles : reporting.poles;
    if (!authorizedPoles.some((pole) => pole.id === state.currentPoleMonitor)) {
      state.currentPoleMonitor = authorizedPoles[0]?.id || reporting.defaultPole;
    }
    const selectedPole =
      authorizedPoles.find((item) => item.id === state.currentPoleMonitor) || authorizedPoles[0] || reporting.poles[0];
    const selectedKpis = reporting.kpisByPole[selectedPole.id] || [];
    if (poleSelect) poleSelect.value = selectedPole.id;
    if (title) title.textContent = `KPI - ${selectedPole.name}`;
    if (total) total.textContent = `${selectedKpis.length} KPI`;

    directory.innerHTML = [selectedPole]
      .map((pole) => {
        const kpis = reporting.kpisByPole[pole.id] || [];
        const greenCount = kpis.filter((item) => item.status === "green").length;
        const amberCount = kpis.filter((item) => item.status === "amber").length;
        const redCount = kpis.filter((item) => item.status === "red").length;
        const poleStatus = redCount ? "red" : amberCount ? "amber" : "green";

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
                            <dl>
                              <div><dt>Objectif</dt><dd>${escapeHtml(kpi.target)}</dd></div>
                              <div><dt>Tendance</dt><dd>${escapeHtml(kpi.trend)}</dd></div>
                              <div><dt>Source Kobo</dt><dd>${escapeHtml(kpi.source)}</dd></div>
                              ${
                                kpi.calculated
                                  ? `<div><dt>Periode</dt><dd>${escapeHtml(kpi.period || "Kobo")}</dd></div>
                                     <div><dt>Methode</dt><dd>${escapeHtml(kpi.method || "Calcul PMS")}</dd></div>`
                                  : ""
                              }
                            </dl>
                          </section>
                        `
                      )
                      .join("")
                  : `<div class="empty-kpi-state">Aucun KPI n'est encore rattache a ce pole.</div>`
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
    const kpis = reporting.kpisByPole[pole.id] || [];
    const redCount = kpis.filter((item) => item.status === "red").length;
    const amberCount = kpis.filter((item) => item.status === "amber").length;
    const greenCount = kpis.filter((item) => item.status === "green").length;

    const selectedHeading = $("#selected-pole-heading");
    if (!selectedHeading) return;

    selectedHeading.textContent = `${pole.name} - KPIs ${cycle.value.toLowerCase()}`;
    $("#selected-pole-kpi-count").className = `status-pill ${redCount ? "red" : amberCount ? "amber" : "green"}`;
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
        <strong>${escapeHtml(pole.lastReport)} - ${escapeHtml(pole.status)}</strong>
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
                <div class="selected-kpi-meta">
                  <span>Objectif: ${escapeHtml(kpi.target)}</span>
                  <span>Tendance: ${escapeHtml(kpi.trend)}</span>
                  <span>Source: ${escapeHtml(kpi.source)}</span>
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
        <strong>${pole.score}</strong>
        <span class="trend ${pole.rag === "red" ? "negative" : "positive"}">${statusPill(pole.rag === "green" ? "Vert" : pole.rag === "red" ? "Rouge" : "Orange", pole.rag)}</span>
      </article>
      <article class="metric-card">
        <span class="metric-label">Qualite Kobo</span>
        <strong>${pole.quality}%</strong>
        <span class="trend positive">Controle completude</span>
      </article>
      <article class="metric-card">
        <span class="metric-label">Rapport pret</span>
        <strong>${pole.readiness}%</strong>
        <span class="trend ${pole.readiness < 70 ? "negative" : "positive"}">${escapeHtml(pole.status)}</span>
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
                <td>${statusPill(kpiStatusText(kpi.status), kpi.status)}</td>
              </tr>
            `
          )
          .join("")
      : `<tr><td colspan="6">Aucun KPI n'est encore rattache a ce pole.</td></tr>`;

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

  function renderReportCalendar() {
    const table = $("#report-calendar-table");
    if (!table) return;
    table.innerHTML = PMS_DATA.reporting.calendar
      .map(
        (item) => `
          <tr>
            <td><strong>${escapeHtml(item.pole)}</strong></td>
            <td>${escapeHtml(item.cycle)}</td>
            <td>${escapeHtml(item.period)}</td>
            <td>${escapeHtml(item.due)}</td>
            <td>${escapeHtml(item.owner)}</td>
            <td>${statusPill(item.status, reportStatusClass(item.status))}</td>
          </tr>
        `
      )
      .join("");
  }

  function renderReportHistory(state) {
    $("#report-history-table").innerHTML = state.reportHistory
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
      .join("");
  }

  function renderDistributionList() {
    $("#distribution-list").innerHTML = PMS_DATA.reporting.distribution
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
      .join("");
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
    const authorizedPoles = accessContext.poles.length ? accessContext.poles : reporting.poles;
    if (!authorizedPoles.some((pole) => pole.id === state.currentReportPole)) {
      state.currentReportPole = authorizedPoles[0]?.id || reporting.defaultPole;
    }

    const poleSelect = $("#report-pole-select");
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
    const authorizedPoles = accessContext.poles.length ? accessContext.poles : reporting.poles;
    if (!authorizedPoles.some((item) => item.id === state.currentReportPole)) {
      state.currentReportPole = authorizedPoles[0]?.id || reporting.defaultPole;
    }
    const pole = authorizedPoles.find((item) => item.id === state.currentReportPole) || authorizedPoles[0] || reporting.poles[0];
    const cycle = reporting.cycles.find((item) => item.value === state.currentReportCycle) || reporting.cycles[0];
    const kpis = reporting.kpisByPole[pole.id] || [];
    const statusClass = reportStatusClass(pole.status);
    const redCount = kpis.filter((item) => item.status === "red").length;
    const amberCount = kpis.filter((item) => item.status === "amber").length;
    const greenCount = kpis.filter((item) => item.status === "green").length;

    $("#report-preview-title").textContent = `${cycle.value} - ${pole.name}`;
    $("#report-status-pill").className = `status-pill ${statusClass}`;
    $("#report-status-pill").textContent = pole.status;

    $("#report-summary").innerHTML = `
      <article class="report-kpi-card">
        <span>Score pole</span>
        <strong>${pole.score}</strong>
        ${statusPill(pole.rag === "green" ? "Vert" : pole.rag === "red" ? "Rouge" : "Orange", pole.rag)}
      </article>
      <article class="report-kpi-card">
        <span>KPIs suivis</span>
        <strong>${pole.kpiCount}</strong>
        <small>${greenCount} verts, ${amberCount} orange, ${redCount} rouges</small>
      </article>
      <article class="report-kpi-card">
        <span>Qualite Kobo</span>
        <strong>${pole.quality}%</strong>
        <small>Completude et controles</small>
      </article>
      <article class="report-kpi-card">
        <span>Deadline</span>
        <strong>${escapeHtml(cycle.deadline)}</strong>
        <small>${escapeHtml(cycle.scope)}</small>
      </article>
    `;

    $("#report-preview").innerHTML = `
      <div class="report-cover">
        <div>
          <p class="eyebrow">Rapport ${escapeHtml(cycle.value)}</p>
          <h4>${escapeHtml(pole.name)}</h4>
          <p>Responsable: ${escapeHtml(pole.owner)} | Dernier rapport: ${escapeHtml(pole.lastReport)}</p>
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
                    <td>${statusPill(kpi.status === "green" ? "Vert" : kpi.status === "red" ? "Rouge" : "Orange", kpi.status)}</td>
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
          Le rapport ${escapeHtml(cycle.value.toLowerCase())} du ${escapeHtml(pole.name)} consolide les donnees Kobo,
          les ecarts aux objectifs, les alertes RAG et les plans d'action. Les KPI rouges doivent obligatoirement
          etre commentes avant validation N+1.
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
    const countFields = (objectiveTemplate.requiredFields?.length || 0) + (objectiveTemplate.calculationFields?.length || 0);
    const referenceSource = state.objectiveKoboSource;
    const calculationSource = state.calculationKoboSource;
    const sourceProfile = objectiveTemplate.sourceWorkbookProfile || {};
    const objectiveSummary = $("#objective-summary-cards");

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
          <small>sur les deux formulaires Kobo</small>
        </div>
        <div class="admin-summary-card">
          <span>Catalogue source</span>
          <strong>${sourceProfile.kpiCount || 0}</strong>
          <small>${sourceProfile.groupCount || 0} groupes / ${sourceProfile.categoryCount || 0} categories</small>
        </div>
        <div class="admin-summary-card">
          <span>Controle qualite</span>
          <strong>${sourceProfile.formulaMissing || 0}</strong>
          <small>formule manquante / ${sourceProfile.targetMissing || 0} cible(s) a completer</small>
        </div>
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
        { title: "Formulaire 2 - Elements de calcul", fields: objectiveTemplate.calculationFields || [] },
      ];
      fieldList.innerHTML = fieldGroups
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
          <small>dashboards limites par pole</small>
        </div>
        <div class="admin-summary-card">
          <span>Profils</span>
          <strong>${accessProfiles.length}</strong>
          <small>${escapeHtml(currentAccessRole?.profile || "Aucun profil actif")}</small>
        </div>
        <div class="admin-summary-card">
          <span>Selection</span>
          <strong>${escapeHtml(currentUser?.fullName || "Utilisateur")}</strong>
          <small>${escapeHtml(currentUser?.defaultPoleName || "Pole a affecter")}</small>
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

    document.querySelectorAll("[data-permission-key]").forEach((checkbox) => {
      checkbox.checked = Boolean(currentAccessRole?.permissions?.[checkbox.dataset.permissionKey]);
    });

    const selectedUserPole =
      reporting.poles.find((pole) => pole.id === state.currentUserAccessPole) || reporting.poles[0];
    const userResponsibleSelect = $("#user-access-responsible");
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
              <option value="${escapeHtml(pole.id)}" data-pole-id="${escapeHtml(pole.id)}" ${pole.id === selectedUserPole.id ? "selected" : ""}>
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
      userDashboardInput.value = `Dashboard Suivi KPI - ${selectedUserPole.name}`;
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
                <td>${escapeHtml(user.defaultPoleName || user.defaultPoleId || "A affecter")}</td>
                <td>${statusPill(user.status || "Actif", userStatusClass(user.status || "Actif"))}</td>
              </tr>
            `
            )
            .join("")
        : `<tr><td colspan="6">Aucun utilisateur cree pour le moment.</td></tr>`;
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
        : `<tr><td colspan="6">Aucune affectation par pole configuree.</td></tr>`;
    }
  }

  function renderAll(state) {
    renderBranches();
    renderExecutiveAlerts();
    renderSparkline();
    renderCatalogStats();
    renderPoleSummaryTables(state);
    renderPoleControls(state);
    renderPoleMonitor(state);
    renderReportCalendar();
    renderKoboTable("", state.koboSubmissions);
    renderCollectionForms();
    renderMethodologyControls();
    renderKoboPipeline();
    renderValidationQueue(state.validationQueue);
    renderKpiTable();
    renderGroups();
    renderAlertBoard();
    renderActions();
    renderImprovement();
    renderHourChart();
    renderLosses();
    renderTimeHeatmap();
    renderReports();
    renderReportControls(state);
    renderReportWorkspace(state);
    renderDistributionList();
    renderReportHistory(state);
    renderAdmin(state);
  }

  window.PMS_RENDERERS = {
    $,
    renderAll,
    renderPoleControls,
    renderKoboTable,
    renderKpiTable,
    renderPoleMonitor,
    renderValidationQueue,
    renderReportControls,
    renderReportWorkspace,
    renderReportHistory,
    renderAdmin,
    getObjectiveCatalogProfile,
  };
})();
