/**
 * AtléticaHub — Schema (Drizzle / PostgreSQL)
 * Multi-tenant: workspace_id (atletica) NOT NULL em toda tabela de dados.
 * Valores monetários em CENTAVOS (bigint).
 * Documentos (CPF/CNPJ) SEMPRE hash argon2id + coluna _lookup (HMAC) para WHERE.
 */
import {
  pgTable, uuid, text, varchar, boolean, timestamp, bigint, integer,
  date, jsonb, pgEnum, uniqueIndex, index,
} from "drizzle-orm/pg-core";

/* ───────────────────────── Enums ───────────────────────── */
export const directorRole   = pgEnum("director_role", ["admin", "finance", "events", "viewer"]);
export const subjectType    = pgEnum("subject_type", ["director", "member", "account"]);
export const memberStatus   = pgEnum("member_status", ["active", "overdue", "expired", "pending", "cancelled"]);
export const planPeriod      = pgEnum("plan_period", ["semester", "annual", "custom"]);
export const payStatus       = pgEnum("pay_status", ["pending", "paid", "overdue", "cancelled"]);
export const txType          = pgEnum("tx_type", ["income", "expense"]);
export const costKind        = pgEnum("cost_kind", ["sport", "event", "admin", "general"]);
export const audience        = pgEnum("audience", ["public", "member", "athlete", "director"]);
export const orderPayStatus  = pgEnum("order_pay_status", ["pending", "paid", "cancelled"]);
export const fulfillStatus   = pgEnum("fulfill_status", ["open", "ready", "delivered"]);
export const orderChannel    = pgEnum("order_channel", ["store", "admin"]);
export const orderItemKind   = pgEnum("order_item_kind", ["product", "ticket", "plan"]);
export const eventStatus     = pgEnum("event_status", ["draft", "selling", "closed", "finished"]);
export const ticketStatus    = pgEnum("ticket_status", ["valid", "used", "cancelled"]);

/* ───────────────────── Tenant & gestão ───────────────────── */
export const workspaces = pgTable("atletica_workspaces", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: varchar("name", { length: 160 }).notNull(),
  slug: varchar("slug", { length: 64 }).notNull(),
  university: varchar("university", { length: 160 }),
  cnpjHash: text("cnpj_hash"),
  cnpjLookup: varchar("cnpj_lookup", { length: 64 }),
  logoKey: text("logo_key"),
  primaryColor: varchar("primary_color", { length: 9 }).default("#0077ff"),
  accentColor: varchar("accent_color", { length: 9 }).default("#00bfff"),
  currentSemester: varchar("current_semester", { length: 16 }),
  active: boolean("active").notNull().default(true),
  // Pagamentos (gateway configurável por atlética)
  paymentProvider: varchar("payment_provider", { length: 24 }),        // null | mock | mercadopago
  paymentAccessTokenEnc: text("payment_access_token_enc"),             // AES-256-GCM
  paymentPublicKey: text("payment_public_key"),                        // usado no frontend (cartão)
  paymentSandbox: boolean("payment_sandbox").notNull().default(true),
  cardFeeBp: integer("card_fee_bp").notNull().default(499),            // basis points (499 = 4,99%)
  cardFeePass: boolean("card_fee_pass").notNull().default(false),      // repassa taxa do cartão ao cliente?
  pixEnabled: boolean("pix_enabled").notNull().default(true),
  cardEnabled: boolean("card_enabled").notNull().default(true),
  // Conteúdo editável da página inicial (CMS): banner, carrosséis, galeria, contato
  homepage: jsonb("homepage").$type<HomepageContent>(),
  // Módulos ligados/desligados nesta atlética (null = todos ligados). Chaves em MODULES.
  modules: jsonb("modules").$type<Record<string, boolean>>(),
  // E-mail oficial dono da atlética (super-admin que gerencia usuários)
  officialEmail: varchar("official_email", { length: 190 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  slugIdx: uniqueIndex("ws_slug_idx").on(t.slug),
}));

/* Módulos do painel que um CARGO pode acessar. `dashboard` é sempre visível;
   `diretoria` (equipe) e `configuracoes` são exclusivos do cargo admin/sistema. */
export const MODULES = [
  "socios", "planos", "cobrancas", "produtos",
  "pedidos", "eventos", "financeiro", "loja",
] as const;
export type ModuleKey = (typeof MODULES)[number];

export type HomepageContent = {
  banners?: { imageKey: string; link?: string }[];                    // banners rotativos do topo (1 = fixo, +1 = giram)
  bannerKey?: string | null;                                          // legado (banner único)
  bannerLink?: string | null;                                         // legado
  carousel?: { imageKey: string; title?: string; link?: string }[];   // parceiros/patrocinadores
  board?: { name: string; role?: string; photoKey?: string }[];       // diretoria
  gallery?: { imageKey: string; caption?: string }[];                 // jogos/eventos/trotes
  contact?: { about?: string; instagram?: string; whatsapp?: string; email?: string; cnpj?: string; location?: string };
};

// Cobranças no gateway (liga um pedido/mensalidade/ingresso a uma transação de pagamento)
export const charges = pgTable("charges", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  provider: varchar("provider", { length: 24 }).notNull(),
  externalId: varchar("external_id", { length: 120 }),                 // id da cobrança no gateway
  kind: varchar("kind", { length: 20 }).notNull(),                     // order | membership | ticket
  refId: uuid("ref_id").notNull(),
  method: varchar("method", { length: 12 }).notNull(),                 // pix | credit
  amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
  status: varchar("status", { length: 16 }).notNull().default("pending"), // pending | paid | failed | cancelled
  pixCopyPaste: text("pix_copy_paste"),
  pixQrBase64: text("pix_qr_base64"),
  checkoutUrl: text("checkout_url"),
  paidAt: timestamp("paid_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  extIdx: index("charge_external_idx").on(t.externalId),
  refIdx: index("charge_ref_idx").on(t.refId),
}));

export const managementTerms = pgTable("management_terms", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 80 }).notNull(),   // "Gestão 25/26"
  startDate: date("start_date"),
  endDate: date("end_date"),
  isCurrent: boolean("is_current").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/* ──────────────── Contas (login único por atlética) ────────────────
   Toda pessoa que usa o sistema tem UMA conta (e-mail + senha).
   Os papéis (sócio / diretor) são PERFIS ligados à conta. */
export const accounts = pgTable("accounts", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 160 }).notNull(),
  email: varchar("email", { length: 190 }).notNull(),
  emailLookup: varchar("email_lookup", { length: 64 }).notNull(),
  passwordHash: text("password_hash"),                       // null = só login social (futuro)
  phone: varchar("phone", { length: 32 }),
  googleSub: varchar("google_sub", { length: 64 }),          // futuro: "Entrar com Google"
  emailVerified: boolean("email_verified").notNull().default(false),
  verifyCodeHash: varchar("verify_code_hash", { length: 64 }),   // código de verificação (SHA-256)
  verifyExpiresAt: timestamp("verify_expires_at", { withTimezone: true }),
  isSuperAdmin: boolean("is_super_admin").notNull().default(false),  // gerencia usuários da atlética
  active: boolean("active").notNull().default(true),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  emailIdx: uniqueIndex("account_email_lookup_idx").on(t.workspaceId, t.emailLookup),
}));

/* Cargos (RBAC) — criados por atlética; cada um libera um conjunto de módulos.
   Cada atlética define os seus (nem todas têm os mesmos cargos). */
export const roles = pgTable("roles", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 80 }).notNull(),          // "Presidente", "Tesoureiro"…
  modules: jsonb("modules").$type<string[]>().notNull().default([]),  // módulos liberados (chaves em MODULES)
  isSystem: boolean("is_system").notNull().default(false),  // cargo admin: acesso total, não editável/removível
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const directors = pgTable("directors", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  accountId: uuid("account_id").references(() => accounts.id, { onDelete: "cascade" }),  // conta dona do perfil
  roleId: uuid("role_id").references(() => roles.id, { onDelete: "set null" }),           // cargo (RBAC)
  termId: uuid("term_id").references(() => managementTerms.id, { onDelete: "set null" }),
  name: varchar("name", { length: 160 }).notNull(),
  email: varchar("email", { length: 190 }).notNull(),
  emailLookup: varchar("email_lookup", { length: 64 }).notNull(),
  passwordHash: text("password_hash").notNull(),
  pinHash: text("pin_hash"),                                 // PIN pra destravar o painel (2º fator)
  pinSetAt: timestamp("pin_set_at", { withTimezone: true }),
  role: directorRole("role").notNull().default("viewer"),
  permissions: jsonb("permissions").$type<string[]>().default([]),  // módulos liberados; [] = herda do papel
  cargoLabel: varchar("cargo_label", { length: 80 }),   // "Presidente", "Diretor Financeiro"
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  emailIdx: uniqueIndex("director_email_lookup_idx").on(t.workspaceId, t.emailLookup),
}));

/* ───────────────────────── Sócios ───────────────────────── */
export const membershipPlans = pgTable("membership_plans", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 80 }).notNull(),
  period: planPeriod("period").notNull().default("semester"),
  priceCents: bigint("price_cents", { mode: "number" }).notNull(),
  durationMonths: integer("duration_months").notNull().default(6),
  benefits: jsonb("benefits").$type<string[]>().default([]),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const members = pgTable("members", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  accountId: uuid("account_id").references(() => accounts.id, { onDelete: "cascade" }),  // conta dona do perfil de sócio
  cpfHash: text("cpf_hash").notNull(),
  cpfLookup: varchar("cpf_lookup", { length: 64 }).notNull(),
  name: varchar("name", { length: 160 }).notNull(),
  email: varchar("email", { length: 190 }),
  emailLookup: varchar("email_lookup", { length: 64 }),
  passwordHash: text("password_hash"),
  registrationNumber: varchar("registration_number", { length: 40 }), // matrícula
  course: varchar("course", { length: 120 }),
  phone: varchar("phone", { length: 32 }),
  isAthlete: boolean("is_athlete").notNull().default(false),
  status: memberStatus("status").notNull().default("pending"),
  photoKey: text("photo_key"),
  cardUuid: uuid("card_uuid").defaultRandom().notNull(),
  memberNumber: integer("member_number"),
  memberSince: date("member_since"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  cpfIdx: uniqueIndex("member_cpf_lookup_idx").on(t.workspaceId, t.cpfLookup),
  cardIdx: uniqueIndex("member_card_uuid_idx").on(t.cardUuid),
  statusIdx: index("member_status_idx").on(t.workspaceId, t.status),
}));

export const memberships = pgTable("memberships", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  memberId: uuid("member_id").notNull().references(() => members.id, { onDelete: "cascade" }),
  planId: uuid("plan_id").references(() => membershipPlans.id, { onDelete: "set null" }),
  startDate: date("start_date").notNull(),
  endDate: date("end_date").notNull(),
  priceCents: bigint("price_cents", { mode: "number" }).notNull(),
  status: memberStatus("status").notNull().default("pending"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const memberPayments = pgTable("member_payments", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  membershipId: uuid("membership_id").references(() => memberships.id, { onDelete: "set null" }),
  memberId: uuid("member_id").notNull().references(() => members.id, { onDelete: "cascade" }),
  amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
  dueDate: date("due_date").notNull(),
  paidAt: timestamp("paid_at", { withTimezone: true }),
  status: payStatus("status").notNull().default("pending"),
  method: varchar("method", { length: 32 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  statusIdx: index("member_payment_status_idx").on(t.workspaceId, t.status),
}));

/* ───────────────────────── Financeiro ───────────────────────── */
export const costCenters = pgTable("cost_centers", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 80 }).notNull(),
  description: text("description"),
  color: varchar("color", { length: 9 }).default("#00bfff"),
  kind: costKind("kind").notNull().default("general"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const financeCategories = pgTable("finance_categories", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 80 }).notNull(),
  type: txType("type").notNull(),
  color: varchar("color", { length: 9 }).default("#8fa3bb"),
  isDefault: boolean("is_default").notNull().default(false),
});

export const transactions = pgTable("transactions", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  description: varchar("description", { length: 200 }).notNull(),
  amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
  type: txType("type").notNull(),
  date: date("date").notNull(),
  dueDate: date("due_date"),
  paidAt: timestamp("paid_at", { withTimezone: true }),
  status: payStatus("status").notNull().default("paid"),
  categoryId: uuid("category_id").references(() => financeCategories.id, { onDelete: "set null" }),
  costCenterId: uuid("cost_center_id").references(() => costCenters.id, { onDelete: "set null" }),
  eventId: uuid("event_id"),
  memberPaymentId: uuid("member_payment_id"),
  orderId: uuid("order_id"),
  paymentMethod: varchar("payment_method", { length: 32 }),
  createdBy: uuid("created_by").references(() => directors.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  dateIdx: index("tx_date_idx").on(t.workspaceId, t.date),
}));

// Lançamentos recorrentes (contas fixas: aluguel, assinatura…) — geram uma pendência por mês
export const recurringTransactions = pgTable("recurring_transactions", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  description: varchar("description", { length: 200 }).notNull(),
  amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
  type: txType("type").notNull(),
  costCenterId: uuid("cost_center_id").references(() => costCenters.id, { onDelete: "set null" }),
  categoryId: uuid("category_id").references(() => financeCategories.id, { onDelete: "set null" }),
  dayOfMonth: integer("day_of_month").notNull().default(1),    // 1-28
  active: boolean("active").notNull().default(true),
  lastRunMonth: varchar("last_run_month", { length: 7 }),      // "YYYY-MM" da última geração
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/* ───────────────────────── Loja / Produtos ───────────────────────── */
export const products = pgTable("products", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 120 }).notNull(),
  description: text("description"),
  category: varchar("category", { length: 60 }),
  imageKey: text("image_key"),
  basePriceCents: bigint("base_price_cents", { mode: "number" }).notNull(),
  // Gestão de custo → cálculo automático do preço de venda
  costCents: bigint("cost_cents", { mode: "number" }).notNull().default(0),        // valor de compra
  shippingCents: bigint("shipping_cents", { mode: "number" }).notNull().default(0),// frete por unidade
  marginType: varchar("margin_type", { length: 8 }).notNull().default("percent"),  // percent | fixed
  marginValue: integer("margin_value").notNull().default(0),                       // % em bp (3000=30%) OU centavos
  feeBp: integer("fee_bp").notNull().default(0),                                    // taxa de pagamento considerada (bp)
  trackStock: boolean("track_stock").notNull().default(true),
  stockQuantity: integer("stock_quantity").notNull().default(0),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const productVariants = pgTable("product_variants", {
  id: uuid("id").defaultRandom().primaryKey(),
  productId: uuid("product_id").notNull().references(() => products.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 60 }).notNull(),   // "Tam. M"
  sku: varchar("sku", { length: 60 }),
  stockQuantity: integer("stock_quantity").notNull().default(0),
});

// Preço por tipo de comprador (fã/sócio/atleta/diretor) — sobrescreve o base
export const priceTiers = pgTable("price_tiers", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  refType: varchar("ref_type", { length: 20 }).notNull(), // product | ticket_batch | plan
  refId: uuid("ref_id").notNull(),
  audience: audience("audience").notNull(),
  priceCents: bigint("price_cents", { mode: "number" }).notNull(),
});

export const orders = pgTable("orders", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  orderNumber: integer("order_number"),
  accountId: uuid("account_id").references(() => accounts.id, { onDelete: "set null" }),   // conta que fez a compra
  buyerMemberId: uuid("buyer_member_id").references(() => members.id, { onDelete: "set null" }),
  buyerName: varchar("buyer_name", { length: 160 }),
  buyerCpfHash: text("buyer_cpf_hash"),
  buyerEmail: varchar("buyer_email", { length: 190 }),
  totalCents: bigint("total_cents", { mode: "number" }).notNull().default(0),
  paymentStatus: orderPayStatus("payment_status").notNull().default("pending"),
  fulfillmentStatus: fulfillStatus("fulfillment_status").notNull().default("open"),
  channel: orderChannel("channel").notNull().default("store"),
  qrUuid: uuid("qr_uuid").defaultRandom().notNull(),
  paidAt: timestamp("paid_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  qrIdx: uniqueIndex("order_qr_uuid_idx").on(t.qrUuid),
}));

export const orderItems = pgTable("order_items", {
  id: uuid("id").defaultRandom().primaryKey(),
  orderId: uuid("order_id").notNull().references(() => orders.id, { onDelete: "cascade" }),
  kind: orderItemKind("kind").notNull(),
  productId: uuid("product_id").references(() => products.id, { onDelete: "set null" }),
  variantId: uuid("variant_id").references(() => productVariants.id, { onDelete: "set null" }),
  batchId: uuid("batch_id"),
  planId: uuid("plan_id").references(() => membershipPlans.id, { onDelete: "set null" }),
  description: varchar("description", { length: 200 }).notNull(),
  unitPriceCents: bigint("unit_price_cents", { mode: "number" }).notNull(),
  quantity: integer("quantity").notNull().default(1),
  subtotalCents: bigint("subtotal_cents", { mode: "number" }).notNull(),
  pickedUpAt: timestamp("picked_up_at", { withTimezone: true }),
});

export const pickups = pgTable("pickups", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  orderId: uuid("order_id").notNull().references(() => orders.id, { onDelete: "cascade" }),
  pickedUpBy: varchar("picked_up_by", { length: 160 }),
  pickedUpAt: timestamp("picked_up_at", { withTimezone: true }).notNull().defaultNow(),
  handledBy: uuid("handled_by").references(() => directors.id, { onDelete: "set null" }),
});

/* ───────────────────────── Eventos & Festas ───────────────────────── */
export const events = pgTable("events", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 160 }).notNull(),
  description: text("description"),
  eventDate: timestamp("event_date", { withTimezone: true }),
  location: varchar("location", { length: 200 }),
  status: eventStatus("status").notNull().default("draft"),
  costCenterId: uuid("cost_center_id").references(() => costCenters.id, { onDelete: "set null" }),
  bannerKey: text("banner_key"),
  capacity: integer("capacity"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const ticketBatches = pgTable("ticket_batches", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  eventId: uuid("event_id").notNull().references(() => events.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 60 }).notNull(),   // "1º lote"
  priceCents: bigint("price_cents", { mode: "number" }).notNull(),
  quantityTotal: integer("quantity_total").notNull().default(0),
  quantitySold: integer("quantity_sold").notNull().default(0),
  saleStart: timestamp("sale_start", { withTimezone: true }),
  saleEnd: timestamp("sale_end", { withTimezone: true }),
  active: boolean("active").notNull().default(true),
});

export const tickets = pgTable("tickets", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  eventId: uuid("event_id").notNull().references(() => events.id, { onDelete: "cascade" }),
  batchId: uuid("batch_id").references(() => ticketBatches.id, { onDelete: "set null" }),
  buyerMemberId: uuid("buyer_member_id").references(() => members.id, { onDelete: "set null" }),
  buyerName: varchar("buyer_name", { length: 160 }),
  buyerEmail: varchar("buyer_email", { length: 190 }),
  qrUuid: uuid("qr_uuid").defaultRandom().notNull(),
  status: ticketStatus("status").notNull().default("valid"),
  paymentStatus: orderPayStatus("payment_status").notNull().default("pending"),
  priceCents: bigint("price_cents", { mode: "number" }).notNull(),
  checkedInAt: timestamp("checked_in_at", { withTimezone: true }),
  checkedInBy: uuid("checked_in_by").references(() => directors.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  qrIdx: uniqueIndex("ticket_qr_uuid_idx").on(t.qrUuid),
}));

export const guestLists = pgTable("guest_lists", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  eventId: uuid("event_id").notNull().references(() => events.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 80 }).notNull(),
  promoterName: varchar("promoter_name", { length: 120 }),
});

export const guestListEntries = pgTable("guest_list_entries", {
  id: uuid("id").defaultRandom().primaryKey(),
  listId: uuid("list_id").notNull().references(() => guestLists.id, { onDelete: "cascade" }),
  guestName: varchar("guest_name", { length: 160 }).notNull(),
  guestCpf: varchar("guest_cpf", { length: 20 }),
  checkedInAt: timestamp("checked_in_at", { withTimezone: true }),
});

/* ───────────────────────── Suporte / segurança ───────────────────────── */
export const refreshTokens = pgTable("refresh_tokens", {
  id: uuid("id").defaultRandom().primaryKey(),
  subjectType: subjectType("subject_type").notNull(),
  subjectId: uuid("subject_id").notNull(),
  workspaceId: uuid("workspace_id").notNull(),
  tokenHash: varchar("token_hash", { length: 64 }).notNull(),
  userAgent: text("user_agent"),
  ipAddress: varchar("ip_address", { length: 64 }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  tokenIdx: index("refresh_token_hash_idx").on(t.tokenHash),
}));

export const passwordResets = pgTable("password_resets", {
  id: uuid("id").defaultRandom().primaryKey(),
  subjectType: subjectType("subject_type").notNull(),
  subjectId: uuid("subject_id").notNull(),
  tokenHash: varchar("token_hash", { length: 64 }).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
});

export const attachments = pgTable("attachments", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  transactionId: uuid("transaction_id").references(() => transactions.id, { onDelete: "cascade" }),
  eventId: uuid("event_id").references(() => events.id, { onDelete: "cascade" }),
  uploadedBy: uuid("uploaded_by").references(() => directors.id, { onDelete: "set null" }),
  fileName: varchar("file_name", { length: 200 }),
  fileKey: text("file_key").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const auditLogs = pgTable("audit_logs", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id").notNull(),
  actorType: subjectType("actor_type"),
  actorId: uuid("actor_id"),
  action: varchar("action", { length: 80 }).notNull(),
  details: jsonb("details"),
  ipAddress: varchar("ip_address", { length: 64 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
