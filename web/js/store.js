/* ============================================================
   AtléticaHub — motor da vitrine pública (home, loja, eventos, sócio)
   Rotas: /  /loja  /eventos  /socio
   ============================================================ */
window.AH = window.AH || {};
(function () {
  const params = new URLSearchParams(location.search);
  const slug = params.get('slug') || 'cyber';
  const CART_KEY = 'ah_cart_' + slug;
  const root = document.documentElement;
  let CART = readCart();
  let STORE = null;
  let pollTimer = null;

  function readCart() { try { return JSON.parse(localStorage.getItem(CART_KEY) || '[]'); } catch { return []; } }
  const saveCart = () => localStorage.setItem(CART_KEY, JSON.stringify(CART));

  /* ---------------- Carrinho ---------------- */
  function addItem(kind, refId, name, priceCents, variantId) {
    const vid = variantId || undefined;
    const ex = CART.find(i => i.kind === kind && i.refId === refId && (i.variantId || undefined) === vid);
    if (ex) ex.quantity++; else CART.push({ kind, refId, name, priceCents, quantity: 1, variantId: vid });
    saveCart(); renderCart(); updateBadge(); AH.toast(name + ' no carrinho');
  }
  // Produto com tamanhos: lê o <select> e adiciona a variante escolhida
  function addVariant(productId, name, priceCents) {
    const sel = document.getElementById('size-' + productId);
    if (!sel || !sel.value) { AH.toast('Escolha um tamanho', 'warn'); return; }
    const opt = sel.options[sel.selectedIndex];
    addItem('product', productId, name + ' · ' + opt.dataset.name, priceCents, sel.value);
  }
  function setQty(idx, d) { CART[idx].quantity += d; if (CART[idx].quantity <= 0) CART.splice(idx, 1); saveCart(); renderCart(); updateBadge(); }
  const cartTotal = () => CART.reduce((s, i) => s + i.priceCents * i.quantity, 0);
  function updateBadge() {
    const n = CART.reduce((s, i) => s + i.quantity, 0);
    document.querySelectorAll('[data-cart-count]').forEach(b => { b.textContent = n; b.style.display = n ? 'grid' : 'none'; });
  }
  function renderCart() {
    const host = document.getElementById('cartItems'), foot = document.getElementById('cartFoot'); if (!host) return;
    if (!CART.length) { host.innerHTML = '<div class="ah-empty"><i class="ph ph-shopping-bag"></i><span>Carrinho vazio</span></div>'; foot.style.display = 'none'; return; }
    host.innerHTML = CART.map((i, idx) => `<div class="cart-item"><div class="grow stack" style="line-height:1.3"><strong style="font-size:14px">${AH.escape(i.name)}</strong><span class="dim" style="font-size:12px">${AH.fmtBRL(i.priceCents)}</span></div><div class="qty"><button onclick="AH.store.setQty(${idx},-1)">−</button><span class="num" style="min-width:18px;text-align:center">${i.quantity}</span><button onclick="AH.store.setQty(${idx},1)">+</button></div></div>`).join('');
    document.getElementById('cartTotal').textContent = AH.fmtBRL(cartTotal());
    const cb = document.getElementById('checkoutBtn');
    if (cb) cb.innerHTML = AH.session.isLoggedIn ? 'Finalizar pedido' : '<i class="ph ph-sign-in"></i> Entrar pra finalizar';
    foot.style.display = 'flex';
  }
  const openCart = () => { renderCart(); document.getElementById('cartOv').classList.add('open'); };
  const closeCart = () => document.getElementById('cartOv').classList.remove('open');

  /* ---------------- Checkout / pagamento ---------------- */
  async function checkout() {
    if (!CART.length) return;
    const s = AH.session;
    // Comprar exige conta (a pessoa acessa as compras dela depois)
    if (!s.isLoggedIn) {
      AH.toast('Entre ou crie uma conta pra finalizar', 'warn');
      const next = location.pathname + '?cart=1';
      setTimeout(() => { location.href = '/entrar?next=' + encodeURIComponent(next) + '&slug=' + encodeURIComponent(slug); }, 700);
      return;
    }
    const items = CART.map(i => ({ kind: i.kind, refId: i.refId, quantity: i.quantity, variantId: i.variantId }));
    let r; try { r = await AH.api.post('/account/orders', { items }); } catch (e) { AH.toast(e.message, 'err'); return; }
    CART = []; saveCart(); updateBadge();
    const pay = STORE.payment || {};
    if (pay.online && pay.pixEnabled) paymentStep(r, { buyerName: s.account?.name }); else manualConfirm(r);
  }
  function manualConfirm(r) {
    document.getElementById('cartFoot').style.display = 'none';
    document.getElementById('cartItems').innerHTML = `<div class="ah-empty" style="color:var(--success)"><i class="ph-fill ph-check-circle"></i><strong style="font-size:16px;color:var(--text)">Pedido #${r.orderNumber} recebido!</strong><span class="dim">Total ${AH.fmtBRL(r.totalCents)} · aguardando pagamento.</span><span class="dim" style="font-size:12px">A diretoria confirma o pagamento e libera a retirada.</span></div>`;
  }
  function paymentStep(order, buyer) {
    const pay = STORE.payment || {};
    document.getElementById('cartFoot').style.display = 'none';
    document.getElementById('cartItems').innerHTML = `<div class="stack gap-14" style="padding:6px 0"><div class="row" style="justify-content:space-between;font-size:15px;font-weight:600"><span>Pedido #${order.orderNumber}</span><span class="num">${AH.fmtBRL(order.totalCents)}</span></div><button class="btn btn--primary btn--block btn--hero" id="payPix"><i class="ph-fill ph-qr-code"></i> Pagar com Pix</button>${pay.cardEnabled ? '<button class="btn btn--block" id="payCard"><i class="ph ph-credit-card"></i> Cartão de crédito</button>' : ''}<div id="payArea"></div></div>`;
    document.getElementById('payPix').onclick = () => doPix(order, buyer);
    const cb = document.getElementById('payCard'); if (cb) cb.onclick = () => AH.toast('Cartão ativa ao conectar o Mercado Pago', 'warn');
  }
  async function doPix(order, buyer) {
    const area = document.getElementById('payArea'); area.innerHTML = '<div class="dim" style="padding:12px">Gerando Pix…</div>';
    let pix; try { pix = await AH.api.post('/store/' + slug + '/orders/' + order.orderId + '/pix', { buyerName: buyer.buyerName, buyerEmail: buyer.buyerEmail }, { auth: false }); }
    catch (e) { area.innerHTML = `<div class="ah-modal__err">${AH.escape(e.message)}</div>`; return; }
    area.innerHTML = `<div class="stack gap-12" style="padding:12px;border:1px solid var(--border-strong);border-radius:12px;background:var(--surface-1)">${pix.qrBase64 ? `<img src="data:image/png;base64,${pix.qrBase64}" style="width:180px;height:180px;align-self:center;border-radius:8px;background:#fff;padding:6px">` : '<div class="row" style="justify-content:center;color:var(--brand-accent)"><i class="ph ph-qr-code" style="font-size:64px"></i></div>'}<span class="label-cap">Pix copia e cola</span><textarea readonly style="width:100%;height:60px;font-size:11px;background:var(--surface-0);border:1px solid var(--border-strong);border-radius:8px;color:var(--text-soft);padding:8px;resize:none">${AH.escape(pix.copyPaste || '')}</textarea><button class="btn" id="copyPix"><i class="ph ph-copy"></i> Copiar código</button><div class="row gap-8" style="justify-content:center;color:var(--warn-soft);font-size:13px"><i class="ph ph-spinner"></i> Aguardando pagamento…</div></div>`;
    document.getElementById('copyPix').onclick = () => { navigator.clipboard?.writeText(pix.copyPaste || ''); AH.toast('Código copiado'); };
    startPolling(order.orderId, order.orderNumber);
  }
  function startPolling(orderId, orderNumber) {
    clearInterval(pollTimer);
    pollTimer = setInterval(async () => {
      try {
        const s = await AH.api.get('/store/' + slug + '/orders/' + orderId + '/status', { auth: false });
        if (s.paymentStatus === 'paid') {
          clearInterval(pollTimer);
          document.getElementById('cartItems').innerHTML = `<div class="ah-empty" style="color:var(--success)"><i class="ph-fill ph-check-circle" style="font-size:52px"></i><strong style="font-size:17px;color:var(--text)">Pagamento confirmado!</strong><span class="dim">Pedido #${orderNumber} pago. Retire com a diretoria.</span></div>`;
          AH.toast('Pagamento confirmado 🎉');
        }
      } catch { /* segue tentando */ }
    }, 3000);
  }

  /* ---------------- Dados + branding ---------------- */
  async function fetchStore() { if (STORE) return STORE; STORE = await AH.api.get('/store/' + slug, { auth: false }); return STORE; }
  function applyBranding(ws) {
    if (ws.primaryColor) root.style.setProperty('--brand', ws.primaryColor);
    if (ws.accentColor) root.style.setProperty('--brand-accent', ws.accentColor);
  }

  /* ---------------- Nav + rodapé (compartilhados) ---------------- */
  function renderNav(active) {
    const ws = (STORE && STORE.workspace) || {};
    const logo = ws.logoKey ? AH.fileUrl(ws.logoKey) : '/assets/brasao-cyber.jpeg';
    const s = AH.session;
    const acc = s.account;
    const authRight = s.isLoggedIn
      ? `<a class="btn" href="/socio/home"><i class="ph ph-user-circle" style="font-size:16px"></i> ${AH.escape(((acc && acc.name) || 'Conta').split(' ')[0])}</a><button class="btn btn--icon" id="logoutBtn" title="Sair"><i class="ph ph-sign-out"></i></button>`
      : `<a class="btn" href="/entrar?slug=${encodeURIComponent(slug)}">Entrar</a>`;
    document.getElementById('siteNav').innerHTML = `<nav class="store-nav">
      <a class="row gap-10" href="/" style="color:var(--text);text-decoration:none"><div class="store-nav__logo"><img src="${logo}" alt=""></div><strong class="display" style="font-size:19px;letter-spacing:0.04em">${AH.escape(ws.name || 'AtléticaHub')}</strong></a>
      <div class="store-nav__links">
        <a href="/" class="${active === 'inicio' ? 'is-active' : ''}">Início</a>
        <a href="/eventos" class="${active === 'eventos' ? 'is-active' : ''}">Eventos</a>
        <a href="/loja" class="${active === 'loja' ? 'is-active' : ''}">Loja</a>
        <a href="/seja-socio" class="${active === 'seja' ? 'is-active' : ''}">Seja sócio</a>
      </div>
      <div class="mla row gap-10">
        <button class="cart-btn" id="cartBtn" aria-label="Carrinho"><i class="ph ph-shopping-bag" style="font-size:18px"></i><span class="n" data-cart-count style="display:none">0</span></button>
        ${authRight}
      </div>
    </nav>`;
    document.getElementById('cartBtn').onclick = openCart;
    const lo = document.getElementById('logoutBtn'); if (lo) lo.onclick = async () => { await AH.logout(); location.reload(); };
  }
  function renderFooter() {
    const ws = (STORE && STORE.workspace) || {};
    const c = (STORE && STORE.homepage && STORE.homepage.contact) || {};
    const logo = ws.logoKey ? AH.fileUrl(ws.logoKey) : '/assets/brasao-cyber.jpeg';
    // redes sociais (ícones)
    const soc = [];
    if (c.instagram) soc.push(`<a href="${AH.escape(c.instagram)}" target="_blank" rel="noopener" title="Instagram"><i class="ph ph-instagram-logo"></i></a>`);
    if (c.whatsapp) soc.push(`<a href="${AH.escape(c.whatsapp)}" target="_blank" rel="noopener" title="WhatsApp"><i class="ph ph-whatsapp-logo"></i></a>`);
    if (c.email) soc.push(`<a href="mailto:${AH.escape(c.email)}" title="E-mail"><i class="ph ph-envelope-simple"></i></a>`);
    // coluna de contato (texto)
    const contact = [];
    if (c.email) contact.push(`<a href="mailto:${AH.escape(c.email)}"><i class="ph ph-envelope-simple"></i>${AH.escape(c.email)}</a>`);
    if (c.whatsapp) contact.push(`<a href="${AH.escape(c.whatsapp)}" target="_blank" rel="noopener"><i class="ph ph-whatsapp-logo"></i>WhatsApp</a>`);
    if (c.instagram) contact.push(`<a href="${AH.escape(c.instagram)}" target="_blank" rel="noopener"><i class="ph ph-instagram-logo"></i>Instagram</a>`);
    if (c.location) contact.push(`<span><i class="ph ph-map-pin"></i>${AH.escape(c.location)}</span>`);
    const el = document.getElementById('siteFooter'); if (!el) return;
    el.innerHTML = `<footer class="store-footer">
      <div class="store-footer__grid">
        <div class="stack gap-12" style="max-width:340px">
          <a class="row gap-10" href="/" style="text-decoration:none;color:var(--text)"><div class="store-nav__logo" style="width:40px;height:40px"><img src="${logo}" alt=""></div><strong class="display" style="font-size:19px;letter-spacing:0.03em">${AH.escape(ws.name || 'AtléticaHub')}</strong></a>
          <span class="store-footer__about">${AH.escape(c.about || 'Ingressos, loja e plano de sócio da atlética num só lugar. Sócio paga menos em tudo.')}</span>
          ${soc.length ? `<div class="store-footer__soc">${soc.join('')}</div>` : ''}
        </div>
        <div class="stack gap-10"><span class="label-cap">Navegação</span>
          <a href="/">Início</a><a href="/eventos">Eventos</a><a href="/loja">Loja</a><a href="/seja-socio">Seja sócio</a>
        </div>
        <div class="stack gap-10"><span class="label-cap">Sua conta</span>
          <a href="/entrar">Entrar / cadastrar</a><a href="/socio/home">Minha conta</a><a href="/socio/carteirinha">Carteirinha digital</a>
        </div>
        <div class="stack gap-10"><span class="label-cap">Contato</span>
          ${contact.join('') || '<span class="dim" style="font-size:13px">Em breve</span>'}
        </div>
      </div>
      <div class="store-footer__bar">
        <span>© ${new Date().getFullYear()} ${AH.escape(ws.name || 'Atlética')} · feito com AtléticaHub</span>
        <a href="/atletica/login"><i class="ph ph-lock-simple"></i> Painel da diretoria</a>
      </div>
    </footer>`;
  }
  function injectChrome(active) {
    const d = document.createElement('div'); d.className = 'cart-ov'; d.id = 'cartOv';
    d.innerHTML = `<aside class="cart-drawer"><div class="cart-drawer__head"><strong class="display" style="font-size:20px">Seu carrinho</strong><button class="ah-x" id="cartClose">&times;</button></div><div class="cart-drawer__body" id="cartItems"></div><div class="cart-drawer__foot" id="cartFoot" style="display:none"><div class="row" style="justify-content:space-between;font-size:15px;font-weight:600"><span>Total</span><span class="num" id="cartTotal">R$ 0,00</span></div><button class="btn btn--primary btn--block btn--hero" id="checkoutBtn">Finalizar pedido</button></div></aside>`;
    document.body.appendChild(d);
    d.addEventListener('click', e => { if (e.target === d) closeCart(); });
    document.getElementById('cartClose').onclick = closeCart;
    document.getElementById('checkoutBtn').onclick = checkout;
    const bn = document.createElement('nav'); bn.className = 'bottom-nav';
    const A = k => active === k ? 'is-active' : '';
    bn.innerHTML = `<a href="/" class="${A('inicio')}"><i class="ph ph-house"></i>Início</a><a href="/eventos" class="${A('eventos')}"><i class="ph ph-confetti"></i>Eventos</a><a href="/loja" class="${A('loja')}"><i class="ph ph-t-shirt"></i>Loja</a><a href="/seja-socio" class="${A('seja')}"><i class="ph ph-identification-badge"></i>Sócio</a>`;
    document.body.appendChild(bn);
  }

  /* ---------------- Helpers de card ---------------- */
  function productCard(p) {
    const socio = p.memberPriceCents;
    const img = p.imageKey ? `style="background:#0e1826 center/cover url(${AH.fileUrl(p.imageKey)})"` : '';
    const nm = AH.escape(p.name).replace(/'/g, '&#39;');
    const btnStyle = 'border-color:#2a5c8a;color:var(--text-brand);font-weight:600';
    const hasVars = p.variants && p.variants.length;
    const allOut = hasVars && p.variants.every(v => v.stockQuantity <= 0);
    const action = allOut
      ? `<button class="btn btn--block" disabled style="opacity:.5">Esgotado</button>`
      : hasVars
        ? `<select id="size-${p.id}" class="prod-size">${p.variants.map(v => `<option value="${v.id}" data-name="${AH.escape(v.name)}" ${v.stockQuantity <= 0 ? 'disabled' : ''}>${AH.escape(v.name)}${v.stockQuantity <= 0 ? ' — esgotado' : ''}</option>`).join('')}</select><button class="btn btn--block" style="${btnStyle}" onclick="AH.store.addVariant('${p.id}','${nm}',${p.basePriceCents})">Adicionar</button>`
        : `<button class="btn btn--block" style="${btnStyle}" onclick="AH.store.addItem('product','${p.id}','${nm}',${p.basePriceCents})">Adicionar</button>`;
    return `<div class="product"><div class="product__img" ${img}>${p.imageKey ? '' : AH.escape(p.name)}</div><div class="product__body"><div class="stack" style="line-height:1.3"><span style="font-size:14.5px;font-weight:600">${AH.escape(p.name)}</span><span style="font-size:11.5px;color:var(--text-dim)">${AH.escape(p.category || '')}</span></div><div class="product__price"><span class="v">${AH.fmtBRL(socio ?? p.basePriceCents)}</span>${socio ? `<span class="old">${AH.fmtBRL(p.basePriceCents)}</span><span class="pill pill--accent mla">sócio</span>` : ''}</div>${action}</div></div>`;
  }
  function eventBatchRow(ev, b) {
    const nm = AH.escape(ev.name + ' — ' + b.name).replace(/'/g, '&#39;');
    return `<div class="row gap-10" style="justify-content:space-between;padding:10px;border-radius:10px;background:var(--surface-0);border:1px solid var(--border)"><div class="stack"><strong style="font-size:13.5px">${AH.escape(b.name)}</strong><span class="dim" style="font-size:11.5px">${b.memberPriceCents ? ('sócio ' + AH.fmtBRL(b.memberPriceCents)) : ''}${b.remaining <= 20 && b.remaining > 0 ? ' · restam ' + b.remaining : ''}</span></div><div class="row gap-10"><span class="display" style="font-size:18px">${AH.fmtBRL(b.priceCents)}</span><button class="btn btn--primary" style="font-size:12px;padding:8px 12px" onclick="AH.store.addItem('ticket','${b.id}','${nm}',${b.priceCents})">Comprar</button></div></div>`;
  }

  async function init(active) {
    injectChrome(active);
    try { await fetchStore(); } catch (e) { /* segue mesmo sem dados */ }
    if (STORE) applyBranding(STORE.workspace);
    renderNav(active); renderFooter(); updateBadge();
    if (params.get('cart') === '1') openCart();
    return STORE;
  }

  AH.store = { slug, init, fetch: fetchStore, addItem, addVariant, setQty, openCart, closeCart, productCard, eventBatchRow, get data() { return STORE; } };
})();
