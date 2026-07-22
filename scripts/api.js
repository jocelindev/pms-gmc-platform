(function () {
  const API_BASE = window.PMS_API_BASE || `${window.location.origin}/api`;

  function getSessionHeaders() {
    try {
      const session = JSON.parse(window.sessionStorage.getItem("pmsSession") || "null");
      return session?.sessionToken ? { Authorization: `Bearer ${session.sessionToken}` } : {};
    } catch {
      return {};
    }
  }

  async function request(path, options = {}) {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), options.timeout || 10000);
    try {
      const response = await fetch(`${API_BASE}${path}`, {
        method: options.method || "GET",
        headers: {
          "Content-Type": "application/json",
          ...getSessionHeaders(),
          ...(options.headers || {}),
        },
        body: options.body ? JSON.stringify(options.body) : undefined,
        signal: controller.signal,
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.ok === false) {
        throw new Error(payload.error || `Erreur API ${response.status}`);
      }
      return payload.data;
    } catch (error) {
      if (error?.name === "AbortError") {
        throw new Error("Le serveur met plus de temps que prevu. Patientez quelques secondes puis reessayez.");
      }
      throw error;
    } finally {
      window.clearTimeout(timeout);
    }
  }

  window.PMS_API = {
    baseUrl: API_BASE,
    login(identifier, password) {
      return request("/auth/login", {
        method: "POST",
        body: { identifier, password },
        timeout: 20000,
      });
    },
    createUser(user) {
      return request("/users", {
        method: "POST",
        body: user,
      });
    },
    bootstrap() {
      return request("/bootstrap", { timeout: 15000 });
    },
    saveProfilePermissions(profile, permissions) {
      return request("/access/profile-permissions", {
        method: "POST",
        body: { profile, permissions },
      });
    },
    saveUserAccess(rule) {
      return request("/access/user-access", {
        method: "POST",
        body: rule,
      });
    },
    saveObjective(objective) {
      return request("/objectives", {
        method: "POST",
        body: objective,
      });
    },
    saveReport(report) {
      return request("/reports", {
        method: "POST",
        body: report,
      });
    },
    saveKoboForm(form) {
      return request("/kobo/forms", {
        method: "POST",
        body: form,
      });
    },
    syncKoboForm(form) {
      return request("/kobo/sync", {
        method: "POST",
        body: form,
        timeout: 20000,
      });
    },
    koboAutoStatus() {
      return request("/kobo/auto-status", { timeout: 5000 });
    },
    databaseOverview() {
      return request("/database/overview", { timeout: 5000 });
    },
    databaseTable(name, limit = 50) {
      return request(`/database/table?name=${encodeURIComponent(name)}&limit=${encodeURIComponent(limit)}`, {
        timeout: 5000,
      });
    },
  };
})();
