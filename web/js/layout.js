/* ============================================================
   AtléticaHub — layout compartilhado (rail da diretoria)
   Uso: <nav class="rail" id="rail"></nav> + AH.renderRail('dashboard')
   ============================================================ */
window.AH = window.AH || {};

AH.nav = [
  { key: 'dashboard', label: 'Dashboard',     icon: 'ph-squares-four',         href: 'dashboard' },
  { key: 'socios',    label: 'Sócios',         icon: 'ph-users-three',          href: 'socios',      mod: 'socios' },
  { key: 'planos',    label: 'Planos',         icon: 'ph-identification-badge', href: 'planos',      mod: 'planos' },
  { key: 'cobrancas', label: 'Cobranças',      icon: 'ph-receipt',              href: 'cobrancas',   mod: 'cobrancas' },
  { key: 'produtos',  label: 'Produtos',       icon: 'ph-t-shirt',              href: 'produtos',    mod: 'produtos' },
  { key: 'pedidos',   label: 'Pedidos',        icon: 'ph-shopping-bag',         href: 'pedidos',     mod: 'pedidos' },
  { key: 'retirada',  label: 'Retirada',       icon: 'ph-package',              href: 'retirada',    mod: 'pedidos' },
  { key: 'eventos',   label: 'Eventos',        icon: 'ph-confetti',             href: 'eventos',     mod: 'eventos' },
  { key: 'financeiro',label: 'Financeiro',     icon: 'ph-chart-line-up',        href: 'financeiro',  mod: 'financeiro' },
  { key: 'loja',      label: 'Loja',           icon: 'ph-storefront',           href: 'loja-config', mod: 'loja' },
  { key: 'diretoria', label: 'Diretoria',      icon: 'ph-users-four',           href: 'diretoria',   admin: true },
  { key: 'config',    label: 'Configurações',  icon: 'ph-gear-six',             href: 'configuracoes', admin: true },
];

/** Um item do rail é visível se: sempre (dashboard) / cargo admin / módulo liberado. */
AH.canSeeModule = function (item) {
  const dir = (AH.session && AH.session.director) || {};
  if (dir.isAdmin) return true;
  if (item.admin) return false;
  if (!item.mod) return true;
  return (dir.modules || []).includes(item.mod);
};

AH.renderRail = function (active) {
  const el = document.getElementById('rail');
  if (!el) return;
  const sess = (AH.session && AH.session.workspace) || null;
  const user = (AH.session && AH.session.user) || null;
  const name = (sess && sess.name) || 'AtléticaHub';
  const initials = user ? AH.initials(user.name) : 'AH';
  const cargo = user ? (user.cargoLabel || user.role || '') : '';

  const items = AH.nav.filter(AH.canSeeModule).map(n => `
    <a class="rail__item ${n.key === active ? 'is-active' : ''}" href="${n.href}" data-tip="${AH.escape(n.label)}" aria-label="${AH.escape(n.label)}">
      <i class="ph ${n.key === active ? n.icon.replace('ph-', 'ph-fill ph-') : n.icon}"></i>
    </a>`).join('');
  el.innerHTML = `
    <a class="rail__logo" href="dashboard" title="${AH.escape(name)}">
      <img src="../assets/brasao-cyber.jpeg" alt="${AH.escape(name)}">
    </a>
    ${items}
    <div class="rail__avatar" id="rail-avatar" title="${AH.escape((user && user.name) || '')}${cargo ? ' — ' + AH.escape(cargo) : ''} · sair do painel" style="cursor:pointer">${initials}</div>
  `;
  const av = document.getElementById('rail-avatar');
  if (av) av.addEventListener('click', async () => {
    if (confirm('Sair do painel e voltar pra sua conta?')) { await AH.exitPanel(); location.href = '/socio/home'; }
  });
};
