/* eslint-disable no-undef */
(function () {
  // API base — same origin when served by the backend, configurable otherwise
  const API_BASE = (function () {
    const fromQuery = new URLSearchParams(location.search).get('api');
    return fromQuery || `${location.origin}`;
  })();
  const BACKEND_FALLBACK = 'http://localhost:3000';
  let authDisabled = false;
  let clearMode = false;

  async function fetchRuntimeConfig() {
    const candidates = [`${API_BASE}/api/config`];

    // If frontend is hosted on a different local origin, try backend default port too.
    if (
      location.hostname === 'localhost' ||
      location.hostname === '127.0.0.1'
    ) {
      if (!API_BASE.startsWith(BACKEND_FALLBACK)) {
        candidates.push(`${BACKEND_FALLBACK}/api/config`);
      }
    }

    for (const url of candidates) {
      try {
        const res = await fetch(url);
        if (res.ok) {
          return await res.json();
        }
      } catch (_) {
        // Try next candidate.
      }
    }
    return null;
  }

  // ---- DOM refs ----
  const $ = (id) => document.getElementById(id);
  const els = {
    signinView: $('view-signin'),
    appView: $('view-app'),
    btnSignin: $('btn-signin'),
    btnSignout: $('btn-signout'),
    signinHint: $('signin-hint'),
    who: $('who'),
    whoName: $('who-name'),
    form: $('case-form'),
    btnSubmit: $('btn-submit'),
    formStatus: $('form-status'),
    latest: $('latest'),
    latestNumber: $('latest-number'),
    latestMeta: $('latest-meta'),
    btnTeams: $('btn-teams'),
    recent: $('recent'),
  };

  // ---- API helper ----
  async function apiFetch(path, options = {}) {
    const headers = Object.assign({ 'Content-Type': 'application/json' }, options.headers || {});
    if (!authDisabled) {
      const token = await AppAuth.getAccessToken();
      headers.Authorization = `Bearer ${token}`;
    }
    const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
    if (!res.ok) {
      let body = null;
      try { body = await res.json(); } catch (_) { /* ignore */ }
      const err = new Error(body && body.error ? body.error : `HTTP ${res.status}`);
      err.status = res.status;
      err.body = body;
      throw err;
    }
    return res.json();
  }

  // ---- View toggles ----
  function showSignedIn(acct) {
    els.signinView.hidden = true;
    els.appView.hidden = false;
    els.who.hidden = authDisabled;
    els.whoName.textContent = acct.name || acct.username || 'Signed in';
    loadRecent();
  }
  function showSignedOut() {
    els.signinView.hidden = false;
    els.appView.hidden = true;
    els.who.hidden = true;
  }

  // ---- Form handling ----
  function readForm() {
    const f = els.form;
    return {
      equipment: {
        serialNumber: f.serialNumber.value,
        productModel: f.productModel.value,
        purchaseDate: f.purchaseDate.value || null,
        issueDescription: f.issueDescription.value,
      },
      customer: {
        name: f.customerName.value,
        phone: f.customerPhone.value,
        email: f.customerEmail.value || null,
        address: f.customerAddress.value || null,
      },
    };
  }

  function setStatus(text, kind = '') {
    els.formStatus.textContent = text;
    els.formStatus.className = 'form-status' + (kind ? ' ' + kind : '');
  }

  function setClearMode(enabled) {
    clearMode = Boolean(enabled);
    els.btnSubmit.textContent = clearMode ? 'Clear' : 'Create case';
  }

  function clearForm() {
    els.form.reset();
    setClearMode(false);
  }

  function populateFormFromCase(doc) {
    const f = els.form;
    const eq = doc.equipment || {};
    const customer = doc.customer || {};

    f.serialNumber.value = eq.serialNumber || '';
    f.productModel.value = eq.productModel || '';
    f.purchaseDate.value = eq.purchaseDate || '';
    f.issueDescription.value = eq.issueDescription || '';

    f.customerName.value = customer.name || '';
    f.customerPhone.value = customer.phone || '';
    f.customerEmail.value = customer.email || '';
    f.customerAddress.value = customer.address || '';
  }

  function renderLatest(doc) {
    els.latest.hidden = false;
    els.latestNumber.textContent = doc.caseNumber;
    const eq = doc.equipment || {};
    els.latestMeta.textContent =
      `${eq.productModel || ''} · SN ${eq.serialNumber || '—'}`.trim();

    if (doc.teamsChatUrl) {
      els.btnTeams.href = doc.teamsChatUrl;
    }
  }

  function toDesktopTeamsUrl(webUrl) {
    return webUrl.replace(
      /^https:\/\/teams\.microsoft\.com\//i,
      'msteams://teams.microsoft.com/'
    );
  }

  function renderRecent(items) {
    if (!items.length) {
      els.recent.innerHTML = '<li class="recent-empty">No cases yet.</li>';
      return;
    }
    els.recent.innerHTML = items
      .map((it) => {
        const eq = it.equipment || {};
        const status = it.status || 'open';
        const when = new Date(it.createdAt).toLocaleString();
        return `
          <li data-case-number="${escapeHtml(it.caseNumber)}">
            <div class="rline">
              <span class="rno">${escapeHtml(it.caseNumber)}</span>
              <span class="status-pill ${escapeHtml(status)}">${escapeHtml(status.replace('_', ' '))}</span>
            </div>
            <div class="rmeta">${escapeHtml(eq.productModel || '')} · ${escapeHtml(when)}</div>
            <div class="ractions">
              <button class="btn btn-open-case" type="button" data-case-number="${escapeHtml(it.caseNumber)}">Open</button>
            </div>
          </li>`;
      })
      .join('');
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  async function loadRecent() {
    try {
      const data = await apiFetch('/api/cases?limit=10');
      renderRecent(data.items || []);
    } catch (err) {
      console.warn('Failed to load recent cases', err);
    }
  }

  async function openCase(caseNumber) {
    try {
      const doc = await apiFetch(`/api/cases/${encodeURIComponent(caseNumber)}`);
      populateFormFromCase(doc);
      setClearMode(true);
      renderLatest(doc);
      els.latest.scrollIntoView({ behavior: 'smooth', block: 'start' });
      setStatus(`Loaded ${doc.caseNumber}`, 'ok');
    } catch (err) {
      setStatus('Failed to load case: ' + (err.message || 'error'), 'error');
    }
  }

  // ---- Wire up events ----
  els.btnSignin.addEventListener('click', async () => {
    if (authDisabled) {
      showSignedIn({ name: 'Dev Mode' });
      return;
    }
    els.signinHint.textContent = 'Signing in…';
    els.signinHint.classList.remove('error');
    els.btnSignin.disabled = true;
    try {
      const acct = await AppAuth.signIn();
      showSignedIn(acct);
    } catch (err) {
      console.error(err);
      els.signinHint.textContent = 'Sign-in failed: ' + (err.message || err);
      els.signinHint.classList.add('error');
    } finally {
      els.btnSignin.disabled = false;
    }
  });

  els.btnSignout.addEventListener('click', async () => {
    try { await AppAuth.signOut(); } catch (_) { /* ignore */ }
    showSignedOut();
  });

  els.recent.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-case-number]');
    if (!btn) return;
    const caseNumber = btn.getAttribute('data-case-number');
    if (!caseNumber) return;
    openCase(caseNumber);
  });

  // Desktop Teams tends to handle deep links more reliably than web in some environments.
  els.btnTeams.addEventListener('click', (e) => {
    const webUrl = els.btnTeams.href;
    if (!webUrl || !/^https:\/\/teams\.microsoft\.com\//i.test(webUrl)) return;

    e.preventDefault();
    const desktopUrl = toDesktopTeamsUrl(webUrl);

    let focusShifted = false;
    function onBlur() {
      focusShifted = true;
    }

    window.addEventListener('blur', onBlur, { once: true });
    window.location.href = desktopUrl;

    // If desktop protocol is unavailable, fall back to regular web URL.
    setTimeout(() => {
      if (!focusShifted) {
        window.open(webUrl, '_blank', 'noopener');
      }
    }, 1200);
  });

  els.form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (clearMode) {
      clearForm();
      setStatus('Form cleared');
      return;
    }

    setStatus('Creating case…');
    els.btnSubmit.disabled = true;
    try {
      const payload = readForm();
      const doc = await apiFetch('/api/cases', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      setStatus(`Created ${doc.caseNumber}`, 'ok');
      renderLatest(doc);
      clearForm();
      loadRecent();
    } catch (err) {
      const details = err.body && err.body.details ? ': ' + err.body.details.join(', ') : '';
      setStatus('Failed: ' + (err.message || 'error') + details, 'error');
    } finally {
      els.btnSubmit.disabled = false;
    }
  });

  // ---- Boot ----
  (async function boot() {
    try {
      const cfg = await fetchRuntimeConfig();
      if (cfg) {
        authDisabled = Boolean(cfg.authDisabled);
      }

      if (authDisabled) {
        showSignedIn({ name: 'Dev Mode' });
        return;
      }

      await AppAuth.init();
      const acct = AppAuth.getAccount();
      if (acct) {
        showSignedIn(acct);
      } else {
        showSignedOut();
      }
    } catch (err) {
      console.error('Auth init failed', err);
      els.signinHint.textContent = 'Auth init failed: ' + (err.message || err);
      els.signinHint.classList.add('error');
    }
  })();
})();
