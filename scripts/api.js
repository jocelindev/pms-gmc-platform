(function () {
  const API_BASE = window.PMS_API_BASE || `${window.location.origin}/api`;

  async function request(path, options = {}) {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), options.timeout || 2500);
    try {
      const response = await fetch(`${API_BASE}${path}`, {
        method: options.method || "GET",
        headers: {
          "Content-Type": "application/json",
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
      });
    },
    createUser(user) {
      return request("/users", {
        method: "POST",
        body: user,
      });
    },
    bootstrap() {
      return request("/bootstrap", { timeout: 3500 });
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
  };
})();
