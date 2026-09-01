/* ============================================================
   AtléticaHub — cliente HTTP central + sessão
   ============================================================ */
window.AH = window.AH || {};

// URL limpa na barra (sem .html): /atletica/dashboard.html -> /atletica/dashboard ; /index.html -> /
try {
  let clean = location.pathname;
  if (clean.endsWith('/index.html')) clean = clean.slice(0, -'index.html'.length);
  else if (clean.endsWith('.html')) clean = clean.slice(0, -'.html'.length);
  if (clean !== location.pathname) history.replaceState(null, '', clean + location.search + location.hash);
} catch (e) { /* ignora */ }

// Dev: front no python:4599, API no bun:3200. Prod: nginx proxeia /api.
AH.API_BASE = location.port === "4599"
  ? "http://localhost:3200/api/v1"
  : location.origin + "/api/v1";

/* ---------- Sessão em 2 camadas (localStorage) ----------
   ah_session = conta base (todo mundo: comprador, sócio, diretor)
   ah_dir     = elevação de diretoria (emitida após o PIN)
   No painel (/atletica/) a sessão ATIVA é a de diretoria; fora dele, a conta. */
const ACCT_KEY = "ah_session", DIR_KEY = "ah_dir";
function readS(k) { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch { return null; } }
function writeS(k, v) { localStorage.setItem(k, JSON.stringify(v)); }
function inPanel() { return location.pathname.startsWith("/atletica/"); }
function activeKey() { return inPanel() ? DIR_KEY : ACCT_KEY; }
function activeS() { return readS(activeKey()); }

AH.session = {
  get raw()        { return activeS(); },
  get access()     { return activeS()?.access || null; },
  get refresh()    { return activeS()?.refresh || null; },
  get scope()      { return activeS()?.scope || null; },
  get role()       { const s = activeS(); return s?.role || s?.director?.role || null; },
  get slug()       { return readS(ACCT_KEY)?.slug || localStorage.getItem("ah_slug") || "cyber"; },
  get user()       { const s = activeS(); return s?.director || s?.account || null; },
  get account()    { return readS(ACCT_KEY)?.account || null; },
  get director()   { return readS(DIR_KEY)?.director || null; },
  get workspace()  { return activeS()?.workspace || readS(ACCT_KEY)?.workspace || null; },
  get isElevated() { return !!readS(DIR_KEY)?.access; },
  get isLoggedIn() { return !!readS(ACCT_KEY)?.access; },
};

AH.setAccountSession = function (d, slug) {
  const s = { access: d.accessToken, refresh: d.refreshToken, scope: "account",
    slug: slug || d.workspace?.slug || "cyber", account: d.account, workspace: d.workspace };
  writeS(ACCT_KEY, s);
  if (s.slug) localStorage.setItem("ah_slug", s.slug);
  return s;
};
AH.setDirSession = function (d) {
  const acct = readS(ACCT_KEY);
  const s = { access: d.accessToken, refresh: d.refreshToken, scope: "director",
    role: d.director?.role, director: d.director, workspace: acct?.workspace || d.workspace };
  writeS(DIR_KEY, s);
  return s;
};
AH.clearDir = function () { localStorage.removeItem(DIR_KEY); };
AH.clearSession = function () { localStorage.removeItem(ACCT_KEY); localStorage.removeItem(DIR_KEY); };

/* ---------- Core request (com refresh automático da sessão ativa) ----------
   useAccount:true força usar a conta base (necessário no /atletica/login.html,
   onde a sessão ativa seria a de diretoria — que ainda não existe). */
async function request(method, path, body, { auth = true, retry = true, useAccount = false } = {}) {
  const key = useAccount ? ACCT_KEY : activeKey(), sess = readS(key);
  const headers = { "Content-Type": "application/json" };
  if (auth && sess?.access) headers["Authorization"] = "Bearer " + sess.access;

  const res = await fetch(AH.API_BASE + path, {
    method, headers, body: body != null ? JSON.stringify(body) : undefined,
  });

  let json = null;
  try { json = await res.json(); } catch { /* sem corpo */ }

  if (res.status === 401 && auth && retry && sess?.refresh) {
    if (await tryRefresh(key)) return request(method, path, body, { auth, retry: false });
  }
  if (!res.ok || (json && json.error)) {
    const msg = (json && json.message) || `Erro ${res.status}`;
    throw Object.assign(new Error(msg), { status: res.status, code: json && json.error });
  }
  return json ? json.data : null;
}

async function tryRefresh(key) {
  const sess = readS(key);
  if (!sess?.refresh) return false;
  try {
    const res = await fetch(AH.API_BASE + "/auth/refresh", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken: sess.refresh }),
    });
    const json = await res.json();
    if (json?.data?.accessToken) {
      sess.access = json.data.accessToken; sess.refresh = json.data.refreshToken;
      writeS(key, sess);
      return true;
    }
  } catch { /* ignore */ }
  if (key === DIR_KEY) AH.clearDir(); else AH.clearSession();
  return false;
}

AH.api = {
  get:   (p, o)    => request("GET", p, null, o),
  post:  (p, b, o) => request("POST", p, b, o),
  patch: (p, b, o) => request("PATCH", p, b, o),
  put:   (p, b, o) => request("PUT", p, b, o),
  del:   (p, o)    => request("DELETE", p, null, o),
};

/* ---------- Upload de arquivo (multipart) ---------- */
AH.upload = async function (file, prefix) {
  const fd = new FormData();
  fd.append("file", file);
  if (prefix) fd.append("prefix", prefix);
  const sess = activeS();
  const res = await fetch(AH.API_BASE + "/uploads", {
    method: "POST",
    headers: sess?.access ? { Authorization: "Bearer " + sess.access } : {},
    body: fd,
  });
  const json = await res.json().catch(() => null);
  if (!res.ok || (json && json.error)) throw new Error((json && json.message) || "Falha no upload");
  return json.data; // { key, url }
};
/** URL absoluta de um arquivo servido pelo backend. */
AH.fileUrl = function (keyOrUrl) {
  if (!keyOrUrl) return null;
  if (/^https?:|^data:/.test(keyOrUrl)) return keyOrUrl;
  const path = keyOrUrl.startsWith("/api/") ? keyOrUrl : "/api/v1/files/" + keyOrUrl;
  return (location.port === "4599" ? "http://localhost:3200" : location.origin) + path;
};

/* ---------- Auth (conta unificada) ---------- */
AH.register = async function (fields) { // {slug,name,email,password,phone?}
  const d = await AH.api.post("/auth/register", fields, { auth: false });
  return AH.setAccountSession(d, fields.slug);
};
AH.login = async function (email, password, slug) {
  const d = await AH.api.post("/auth/login", { email, password, slug }, { auth: false });
  return AH.setAccountSession(d, slug);
};
/** Destrava o painel: valida PIN (com o token da CONTA) e guarda a elevação. */
AH.unlockDirector = async function (pin) {
  const d = await AH.api.post("/auth/director/unlock", { pin }, { useAccount: true });
  return AH.setDirSession(d);
};
AH.setDirectorPin = function (pin) { return AH.api.post("/auth/director/pin", { pin }, { useAccount: true }); };

AH.logout = async function () {
  const acct = readS(ACCT_KEY), dir = readS(DIR_KEY);
  for (const t of [dir?.refresh, acct?.refresh]) {
    try { if (t) await AH.api.post("/auth/logout", { refreshToken: t }, { auth: false }); } catch {}
  }
  AH.clearSession();
};
/** Sai só do painel da diretoria, mantendo a conta logada. */
AH.exitPanel = async function () {
  const dir = readS(DIR_KEY);
  try { if (dir?.refresh) await AH.api.post("/auth/logout", { refreshToken: dir.refresh }, { auth: false }); } catch {}
  AH.clearDir();
};

/** Protege página. Painel exige elevação; senão manda destravar/entrar. */
AH.guard = function (scope, loginUrl) {
  const sess = activeS();
  if (!sess?.access || (scope && sess.scope !== scope)) {
    location.href = loginUrl || (inPanel() ? "/atletica/login" : "/entrar");
    return false;
  }
  return true;
};
/** Protege área do usuário: exige apenas conta logada. */
AH.guardAccount = function () {
  if (!readS(ACCT_KEY)?.access) { location.href = "/entrar?next=" + encodeURIComponent(location.pathname + location.search); return false; }
  return true;
};
/** Painel: o cargo do diretor precisa liberar o módulo (admin passa sempre). */
AH.guardModule = function (moduleKey) {
  const dir = readS(DIR_KEY);
  if (!dir?.access) { location.href = "/atletica/login"; return false; }
  const d = dir.director || {};
  if (d.isAdmin || (d.modules || []).includes(moduleKey)) return true;
  AH.toast && AH.toast("Seu cargo não tem acesso a este módulo", "warn");
  location.href = "/atletica/dashboard";
  return false;
};
/** Painel: ação exclusiva do cargo de administração (equipe, configurações). */
AH.guardAdmin = function () {
  const dir = readS(DIR_KEY);
  if (dir?.director?.isAdmin) return true;
  AH.toast && AH.toast("Ação restrita ao cargo de administração", "warn");
  location.href = "/atletica/dashboard";
  return false;
};

/* ---------- Utils ---------- */
AH.fmtBRL = function (cents, opts = {}) {
  const v = (cents || 0) / 100;
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: opts.decimals ?? 2 });
};
AH.fmtBRLk = function (cents) { // compacto p/ KPI: R$ 24.850
  return "R$ " + Math.round((cents || 0) / 100).toLocaleString("pt-BR");
};
AH.fmtDate = function (iso) {
  if (!iso) return "—";
  const d = new Date(iso.length <= 10 ? iso + "T00:00:00" : iso);
  return d.toLocaleDateString("pt-BR");
};
AH.escape = function (s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
};
AH.initials = function (name) {
  const p = String(name || "").trim().split(/\s+/);
  return ((p[0]?.[0] || "") + (p[p.length - 1]?.[0] || "")).toUpperCase() || "?";
};
/** Baixa um CSV (separador ';' + BOM, pro Excel-BR abrir com acento). */
AH.downloadCSV = function (filename, headers, rows) {
  const esc = (v) => { const s = String(v ?? ""); return /[",\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const csv = "﻿" + [headers, ...rows].map((r) => r.map(esc).join(";")).join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};
/* ---------- Modal de formulário genérico ----------
   fields: [{ name, label, type:'text|number|money|select|textarea|checkbox|cpf', value, options:[{value,label}], required, placeholder, hint }]
   Campos type 'money' entram em reais e saem em centavos. */
AH.formModal = function ({ title, fields, submitLabel = "Salvar", onSubmit }) {
  return new Promise((resolve) => {
    const ov = document.createElement("div");
    ov.className = "ah-modal-ov";
    const body = fields.map((f) => {
      const id = "f_" + f.name;
      if (f.type === "checkbox")
        return `<label class="ah-check"><input type="checkbox" id="${id}" ${f.value ? "checked" : ""}><span>${AH.escape(f.label)}</span></label>`;
      let input;
      if (f.type === "select")
        input = `<select id="${id}">${(f.options || []).map(o => `<option value="${AH.escape(o.value)}" ${String(o.value) === String(f.value ?? "") ? "selected" : ""}>${AH.escape(o.label)}</option>`).join("")}</select>`;
      else if (f.type === "textarea")
        input = `<textarea id="${id}" rows="3" placeholder="${AH.escape(f.placeholder || "")}">${AH.escape(f.value || "")}</textarea>`;
      else {
        const it = f.type === "number" || f.type === "money" ? "number" : "text";
        const step = f.type === "money" ? ' step="0.01"' : "";
        input = `<input id="${id}" type="${it}"${step} value="${AH.escape(f.value ?? "")}" placeholder="${AH.escape(f.placeholder || "")}">`;
      }
      return `<div class="ah-field"><label for="${id}">${AH.escape(f.label)}</label>${input}${f.hint ? `<span class="ah-hint">${AH.escape(f.hint)}</span>` : ""}</div>`;
    }).join("");
    ov.innerHTML = `<div class="ah-modal">
      <div class="ah-modal__head"><strong>${AH.escape(title)}</strong><button class="ah-x" aria-label="Fechar">&times;</button></div>
      <form class="ah-modal__body">${body}
        <div class="ah-modal__err" style="display:none"></div>
        <div class="ah-modal__foot">
          <button type="button" class="btn ah-cancel">Cancelar</button>
          <button type="submit" class="btn btn--primary">${AH.escape(submitLabel)}</button>
        </div>
      </form></div>`;
    document.body.appendChild(ov);
    const close = (val) => { ov.remove(); resolve(val); };
    ov.querySelector(".ah-x").onclick = () => close(null);
    ov.querySelector(".ah-cancel").onclick = () => close(null);
    ov.addEventListener("click", (e) => { if (e.target === ov) close(null); });
    const form = ov.querySelector("form");
    const errBox = ov.querySelector(".ah-modal__err");
    form.onsubmit = async (e) => {
      e.preventDefault();
      const vals = {};
      for (const f of fields) {
        const el = ov.querySelector("#f_" + f.name);
        if (f.type === "checkbox") vals[f.name] = el.checked;
        else if (f.type === "money") vals[f.name] = Math.round(parseFloat(el.value || "0") * 100);
        else if (f.type === "number") vals[f.name] = el.value === "" ? null : Number(el.value);
        else vals[f.name] = el.value.trim();
        if (f.required && (vals[f.name] === "" || vals[f.name] == null)) { errBox.textContent = `Preencha "${f.label}"`; errBox.style.display = "block"; return; }
      }
      const btn = form.querySelector('button[type="submit"]');
      btn.disabled = true; btn.textContent = "Salvando…";
      try { await onSubmit(vals); close(vals); }
      catch (err) { errBox.textContent = err.message || "Erro"; errBox.style.display = "block"; btn.disabled = false; btn.textContent = submitLabel; }
    };
  });
};

AH.confirm = function (msg) { return Promise.resolve(window.confirm(msg)); };

AH.toast = function (msg, type = "ok") {
  let host = document.getElementById("ah-toast");
  if (!host) { host = document.createElement("div"); host.id = "ah-toast"; host.style.cssText = "position:fixed;bottom:20px;left:50%;transform:translateX(-50%);z-index:9999;display:flex;flex-direction:column;gap:8px;align-items:center"; document.body.appendChild(host); }
  const el = document.createElement("div");
  const bg = type === "err" ? "var(--danger)" : type === "warn" ? "var(--warn)" : "var(--success-strong)";
  el.style.cssText = `background:${bg};color:#fff;padding:11px 18px;border-radius:10px;font-size:13.5px;font-weight:600;box-shadow:0 10px 30px rgba(0,0,0,.4);animation:ahfade .2s`;
  el.textContent = msg;
  host.appendChild(el);
  setTimeout(() => el.remove(), 3200);
};
