/* ============================================================
   AtléticaHub — Área do usuário ("Minha conta")
   Shell responsivo (topo + bottom-nav) + fluxo de PIN da diretoria.
   Cada página chama: AH.conta.init('home'|'carteirinha'|'pagamentos')
   ============================================================ */
window.AH = window.AH || {};
(function () {
  const NAVDEF = [
    { key: "home",        label: "Início",      href: "/socio/home",        icon: "ph-house",                 show: () => true },
    { key: "carteirinha", label: "Carteirinha", href: "/socio/carteirinha", icon: "ph-identification-badge",   show: a => !!(a && (a.member || a.director)) },
    { key: "compras",     label: "Compras",     href: "/socio/compras",     icon: "ph-bag",                   show: () => true },
    { key: "pagamentos",  label: "Pagamentos",  href: "/socio/pagamentos",  icon: "ph-receipt",               show: a => !!(a && a.member) },
    { key: "loja",        label: "Loja",        href: "/loja",                   icon: "ph-t-shirt",               show: () => true },
    { key: "eventos",     label: "Eventos",     href: "/eventos",                icon: "ph-confetti",              show: () => true },
  ];

  const acct = () => AH.session.account;

  function renderShell(active) {
    const a = acct(), ws = AH.session.workspace || {};
    const logo = ws.logoKey ? AH.fileUrl(ws.logoKey) : "/assets/brasao-cyber.jpeg";
    const items = NAVDEF.filter(n => n.show(a));

    const top = document.getElementById("contaTop");
    if (top) {
      top.innerHTML = `
        <a class="row gap-10" href="/socio/home" style="text-decoration:none;color:var(--text)">
          <div class="conta-top__logo"><img src="${logo}" alt=""></div>
          <span class="conta-top__name">${AH.escape(ws.name || "Minha conta")}</span>
        </a>
        <nav class="conta-nav mla">${items.map(n => `<a href="${n.href}" class="${active === n.key ? "on" : ""}"><i class="${active === n.key ? "ph-fill" : "ph"} ${n.icon}"></i>${n.label}</a>`).join("")}</nav>
        <div class="conta-top__acc">
          ${a && a.director ? `<button class="btn btn--primary btn--conta" id="mgBtn" style="padding:9px 14px"><i class="ph-fill ph-shield-star"></i> Painel</button>` : ""}
          <div class="acc-chip">
            <div class="acc-avatar">${AH.initials(a ? a.name : "")}</div>
            <span class="acc-chip__name">${AH.escape((a && a.name ? a.name : "Conta").split(" ")[0])}</span>
            <button class="btn btn--icon" id="logoutBtn" title="Sair" style="width:30px;height:30px;border:none"><i class="ph ph-sign-out"></i></button>
          </div>
        </div>`;
      const mg = document.getElementById("mgBtn"); if (mg) mg.onclick = openPanel;
      document.getElementById("logoutBtn").onclick = async () => { await AH.logout(); location.href = "/entrar"; };
    }

    const bn = document.getElementById("contaBottom");
    if (bn) {
      // bottom-nav curado (4 itens): Início · Carteirinha|Compras · Loja · Eventos
      const priority = ["home", (a && (a.member || a.director)) ? "carteirinha" : "compras", "loja", "eventos"];
      const bitems = priority.map(k => items.find(n => n.key === k)).filter(Boolean);
      bn.innerHTML = bitems.map(n => `<a href="${n.href}" class="${active === n.key ? "on" : ""}"><i class="${active === n.key ? "ph-fill" : "ph"} ${n.icon}"></i>${n.label}</a>`).join("");
    }
  }

  /* ---------- PIN da diretoria ---------- */
  function pinModal({ create = false } = {}) {
    return new Promise(resolve => {
      const ov = document.createElement("div"); ov.className = "pin-ov";
      ov.innerHTML = `<div class="pin-box">
        <div class="stack gap-6"><h3>${create ? "Criar PIN da diretoria" : "Painel da diretoria"}</h3>
          <span class="dim" style="font-size:13px">${create ? "Crie um PIN de 4 a 8 dígitos — você vai usá-lo pra abrir o painel de gestão." : "Digite seu PIN pra abrir o painel de gestão."}</span></div>
        <input class="pin-input" id="pinA" type="password" inputmode="numeric" maxlength="8" placeholder="••••" autocomplete="off">
        ${create ? '<input class="pin-input" id="pinB" type="password" inputmode="numeric" maxlength="8" placeholder="repita o PIN" autocomplete="off">' : ""}
        <div class="pin-err" id="pinErr" style="display:none"></div>
        <div class="row gap-10"><button class="btn grow" id="pinCancel">Cancelar</button><button class="btn btn--primary grow btn--conta" id="pinOk">${create ? "Criar PIN" : "Abrir painel"}</button></div>
      </div>`;
      document.body.appendChild(ov);
      const a = ov.querySelector("#pinA"), b = ov.querySelector("#pinB"), err = ov.querySelector("#pinErr");
      const close = v => { ov.remove(); resolve(v); };
      ov.querySelector("#pinCancel").onclick = () => close(null);
      ov.addEventListener("click", e => { if (e.target === ov) close(null); });
      setTimeout(() => a.focus(), 30);
      const submit = () => {
        const va = a.value.trim();
        if (!/^\d{4,8}$/.test(va)) { err.textContent = "O PIN deve ter de 4 a 8 dígitos."; err.style.display = "block"; return; }
        if (create && va !== (b.value || "").trim()) { err.textContent = "Os PINs não conferem."; err.style.display = "block"; return; }
        close(va);
      };
      ov.querySelector("#pinOk").onclick = submit;
      (b || a).addEventListener("keydown", e => { if (e.key === "Enter") submit(); });
    });
  }

  async function openPanel() {
    const a = acct();
    if (!a || !a.director) { AH.toast("Sua conta não é da diretoria", "warn"); return; }
    if (!a.director.pinSet) {
      const pin = await pinModal({ create: true });
      if (!pin) return;
      try { await AH.setDirectorPin(pin); } catch (e) { AH.toast(e.message || "Erro ao criar PIN", "err"); return; }
      try { await AH.unlockDirector(pin); location.href = "/atletica/dashboard"; }
      catch (e) { AH.toast(e.message || "Não foi possível abrir", "err"); }
      return;
    }
    const pin = await pinModal({ create: false });
    if (!pin) return;
    try { await AH.unlockDirector(pin); location.href = "/atletica/dashboard"; }
    catch (e) { AH.toast(e.message || "PIN incorreto", "err"); }
  }

  function init(active) {
    if (!AH.guardAccount()) return null;
    renderShell(active);
    return acct();
  }

  AH.conta = { init, openPanel, pinModal, get account() { return acct(); } };
})();
