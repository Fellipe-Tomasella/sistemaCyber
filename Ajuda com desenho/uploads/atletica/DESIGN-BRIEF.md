# AtléticaHub — Brief de Design

> Documento para direção de arte e UI. Objetivo: projetar um produto **bonito, moderno e energético** para gestão de atléticas universitárias. Web-first, 100% responsivo (muita gente usa no celular).

---

## 1. O que é o produto

Plataforma SaaS multi-tenant para **atléticas de faculdade** gerirem tudo num lugar só: sócios, financeiro, eventos/festas e uma **loja pública white-label** (com a marca de cada atlética). Cada atlética tem seu próprio ambiente.

**Dois públicos, duas experiências:**
- **Diretoria** (quem administra) → painel de gestão completo, sério mas jovem.
- **Sócio / Fã** (aluno) → loja pública + área do sócio, experiência de consumo (comprar ingresso, produto, virar sócio, carteirinha digital).

**Referências de vibe:** energia de arena esportiva + fintech moderna. Pense em Nubank/Stone (clareza financeira) cruzado com apps de eventos (Sympla/Shotgun) e a irreverência de marca universitária.

---

## 2. Identidade visual

### Paleta (proposta — pode refinar)
- **Primária:** Laranja energia `#FF6B1A` (ação, destaque, esporte)
- **Secundária:** Azul-marinho `#0F1E3D` (profundidade, confiança, fundo escuro)
- **Apoio:** Branco/off-white, cinzas neutros para superfícies
- **Semânticas:** verde sucesso (pago/ativo), âmbar alerta (a vencer), vermelho (inadimplente/vencido)
- Suportar **light e dark mode** (dark é a cara do produto — arena à noite, festas).

> A cor primária de cada atlética deve poder **sobrescrever** a paleta na loja white-label (a loja usa a cor e o logo do cliente).

### Tipografia
- **Display/Títulos:** fonte pesada, condensada, esportiva (impacto tipo pôster de jogo). Ex.: Anton, Archivo Expanded, Druk-like.
- **Texto/UI:** grotesca limpa e legível (Inter, Geist, Satoshi).
- Números financeiros: tabular, fáceis de escanear.

### Elementos de marca
- Formas dinâmicas (diagonais, chevrons, faixas) remetendo a movimento/velocidade.
- Badges e selos (o concorrente usa selos de "check" — podemos ter linguagem de conquista/medalha).
- Cantos arredondados médios, sombras suaves, glassmorphism pontual em cards de destaque.
- Ícones estilo Lucide (line icons), consistentes.

### Tom
Jovem, confiante, "vamos vender e organizar". Nada corporativo-cinza. Copy direta em português brasileiro.

---

## 3. Arquitetura de telas

O produto tem **3 áreas**:

1. **Loja pública white-label** (`/{slug}`) — sem login, cara do cliente
2. **Área do sócio** (aluno logado)
3. **Painel da diretoria** (gestão)

---

## ÁREA 1 — Loja pública white-label (`/{atletica}`)

A vitrine da atlética. Deve parecer o site oficial **dela**, não o nosso. Usa logo + cor primária do workspace.

### Telas
| Tela | Objetivo | Componentes-chave |
|---|---|---|
| **Home da loja** | Vender tudo | Hero com logo/banner da atlética; destaques de eventos; grid de produtos; card "Vire sócio"; contador de próximo evento |
| **Catálogo de produtos** | Merch/kits | Grid de cards de produto (foto, nome, preço), filtro por categoria, badge de "sócio paga menos" |
| **Detalhe do produto** | Comprar item | Galeria, variação (tamanho), seletor de qtd, **preço por tipo** (fã × sócio), botão comprar |
| **Página do evento/festa** | Vender ingresso | Banner, data/local, **lotes** (1º lote esgotando), preço por tipo, botão "garantir ingresso" |
| **Planos de sócio** | Converter em sócio | Cards de plano (Semestral/Anual), lista de benefícios, comparativo, CTA |
| **Carrinho + Checkout** | Fechar pedido | Resumo de itens, dados do comprador, **gera pedido "aguardando pagamento"** (pagamento manual no MVP: mostra instruções/Pix/confirmação da diretoria) |
| **Confirmação de pedido** | Pós-compra | Número do pedido, QR do pedido (para retirada/entrada), status "aguardando confirmação" |

**Notas de design:**
- Preço em camadas precisa de um selo claro: ex. `R$40 fã · R$25 sócio`.
- Sensação de urgência nos lotes ("Restam 12 no 1º lote").
- Mobile-first de verdade — a maioria compra pelo celular no corredor da facul.

---

## ÁREA 2 — Sócio (aluno logado)

Experiência leve, tipo app. Login por CPF/e-mail + senha.

| Tela | Objetivo | Componentes-chave |
|---|---|---|
| **Login / Cadastro** | Entrar / virar sócio | Form simples; cadastro escolhe atlética + plano |
| **Home do sócio** | Status num relance | Card grande de **status** (Ativo/Inadimplente/Vence em X dias); atalhos; próximos eventos |
| **Carteirinha digital** | Identificação | **Cartão vertical fullscreen** com foto, nome, curso, plano, status, **QR animado**, cores da atlética. Precisa ser "instagramável" |
| **Meus pedidos** | Acompanhar compras | Lista de pedidos (produto/ingresso) com status pago/retirar/entregue + QR |
| **Meus ingressos** | Entrar na festa | Ingressos com QR para check-in |
| **Pagamentos / Renovar** | Manter em dia | Histórico de mensalidades, botão renovar plano |

**Notas:** a **carteirinha** é a estrela — capriche. Status por cor (verde/âmbar/vermelho). Design de "cartão de membro premium".

---

## ÁREA 3 — Painel da diretoria (gestão)

Layout de app administrativo: **sidebar** à esquerda (navegação por módulo), topbar com nome da atlética + gestão atual + usuário. Denso em dados, mas organizado e agradável. Dark mode caprichado.

### Navegação (sidebar)
`Dashboard · Sócios · Planos · Cobranças · Produtos · Pedidos · Retirada · Eventos · Financeiro · Loja/Config · Diretoria · Configurações`

### Telas

| Tela | Objetivo | Componentes-chave |
|---|---|---|
| **Login diretoria** | Acesso gestão | Split-screen (visual esportivo à esquerda, form à direita) |
| **Dashboard** | Visão geral | KPIs no topo (Sócios ativos, Inadimplentes, Receita do mês, Saldo em caixa); **4 gráficos** (receita × despesa 6 meses, sócios por status, receita por fonte, próximos eventos); lista de pendências |
| **Sócios** | Gerir membros | Tabela com foto/nome/curso/plano/**status colorido**; filtros (status, plano); busca; ações rápidas; drawer de detalhe |
| **Detalhe do sócio** | Ficha completa | Dados, plano atual, histórico de pagamentos, pedidos, botão marcar pago/renovar |
| **Planos** | Configurar adesões | Cards de plano; criar/editar (nome, período, preço, **preços por tipo**, benefícios) |
| **Cobranças** | Controlar mensalidades | Lista de cobranças por vencimento; status; **marcar pago em 1 clique**; destaque de atrasados |
| **Produtos** | Estoque & catálogo | Tabela/grid de produtos; estoque; variações; **preço por tipo**; upload de foto; ativar na loja |
| **Pedidos** | Vendas da loja | Lista de pedidos (loja + manual); status pagamento e entrega; marcar pago; ver itens |
| **Retirada** | Entregar produtos | **Tela tipo portaria**: buscar por QR/CPF/pedido → confere itens → **marcar entregue**; baixa estoque |
| **Eventos** | Gerir festas/jogos | Lista de eventos (cards com status: rascunho/vendendo/encerrado) |
| **Detalhe do evento** | Operar o evento | Abas: **Lotes** (criar/preços), **Ingressos** (vendidos), **Listas** (promoter), **Check-in** (leitor QR), **Prestação de contas** (receita − despesas do evento) |
| **Check-in** | Portaria da festa | Leitor de QR grande, contador de entradas, validação (verde OK / vermelho já usado) |
| **Financeiro** | Caixa & DRE | Tabela de lançamentos (entradas/saídas), filtros por centro de custo/evento; saldo; **DRE simplificado**; anexar comprovante |
| **Centros de custo** | Organizar gastos | Por modalidade/evento/admin, com cor |
| **Diretoria** | Equipe & gestões | Membros da diretoria, cargos/roles, **gestão atual (mandato)**, histórico de gestões |
| **Loja / Config White-label** | Marca da loja | Logo, cor primária, banner, slug, textos da home da loja — **preview ao vivo** |
| **Configurações** | Workspace | Dados da atlética, faculdade, semestre atual; danger-zone (botões pequenos) |

---

## 4. Componentes de UI recorrentes (design system)

Projetar como sistema reutilizável:

- **KPI card** (número grande, label, variação, ícone) — usado no dashboard
- **Status pill** (Ativo/Inadimplente/Vence/Pago/Aguardando/Entregue) com cor semântica
- **Data table** com busca, filtros, paginação, ações por linha, empty state bonito
- **Drawer/Modal** de detalhe e de criação (form em 1–2 colunas)
- **Card de produto / evento / plano** (loja)
- **Price tier badge** (`fã × sócio × atleta`)
- **QR viewer / scanner** (carteirinha, ingresso, retirada, check-in)
- **Gráficos** (barra, rosca, linha) — Chart.js, estilo limpo, respeitam dark mode
- **Botões:** primário laranja, secundário outline, **destrutivo pequeno** em "danger-zone"
- **Toast / feedback** de ação (ex.: "Pagamento confirmado ✅")
- **Sidebar** (diretoria) + **bottom-nav mobile** (sócio/loja)
- **Empty states** ilustrados e amigáveis
- **Carteirinha digital** (cartão premium com QR) — componente hero

---

## 5. Princípios

1. **Mobile-first** — sócio e loja vivem no celular.
2. **Ação em 1 clique** — marcar pago, dar baixa, check-in: rápido, sem burocracia.
3. **Status por cor** — sempre óbvio o que está ativo/atrasado/pago.
4. **White-label real** — a loja pública troca de cara conforme a atlética.
5. **Dark mode nativo**, não um tema secundário.
6. **Dados densos, mas respiráveis** — muito número no painel, mas com hierarquia clara.
7. **Ações destrutivas discretas** (botão pequeno em danger-zone).

---

## 6. Entregáveis de design desejados

- Style guide (cores, tipografia, tokens, light/dark)
- Biblioteca de componentes (lista da seção 4)
- Telas-chave em alta fidelidade:
  - **Loja:** home + detalhe de evento + checkout
  - **Sócio:** home + **carteirinha digital**
  - **Diretoria:** dashboard + sócios (tabela) + detalhe do evento (check-in) + retirada + financeiro
- Versões **mobile e desktop** das telas principais
- Tela de **login split-screen** (diretoria) e login/loja (sócio)

---

## 7. Contexto técnico (para o design ser implementável)

Front em **HTML + CSS + JS puro + Chart.js** (sem framework), ícones estilo Lucide inline. Então: usar design tokens em CSS variables, componentes que dá pra montar sem React, e nada que dependa de biblioteca pesada. Valores monetários em BRL (R$).
