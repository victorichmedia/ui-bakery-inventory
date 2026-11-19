require('dotenv').config();

const crypto = require('node:crypto');
const path = require('node:path');
const express = require('express');
const helmet = require('helmet');
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const { createClient } = require('@supabase/supabase-js');
const { z } = require('zod');

const requiredEnv = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY'];
const missingEnv = requiredEnv.filter((key) => !process.env[key]);
if (missingEnv.length) {
  throw new Error(`Missing required environment values: ${missingEnv.join(', ')}`);
}

const supabaseUrl = process.env.SUPABASE_URL.replace(/\/$/, '');
const anonClient = createClient(supabaseUrl, process.env.SUPABASE_ANON_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const service = createClient(supabaseUrl, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const app = express();
const publicDir = path.join(__dirname, '..', 'public');
const roleValues = ['admin', 'store_officer', 'production_supervisor', 'sales_officer'];
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}, 'Enter a valid date');
const uuid = z.string().uuid();
const positiveInt = z.number().int().positive();
const nonnegativeInt = z.number().int().nonnegative();
const positiveNumber = z.number().positive();

app.disable('x-powered-by');
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", 'https://fonts.googleapis.com', "'unsafe-inline'"],
      fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
      imgSrc: ["'self'", 'data:'],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
    },
  },
}));
app.use(express.json({ limit: '64kb' }));
app.use('/vendor/bootstrap', express.static(path.join(__dirname, '..', 'node_modules', 'bootstrap', 'dist'), { maxAge: '1d' }));
app.use('/vendor/bootstrap-icons', express.static(path.join(__dirname, '..', 'node_modules', 'bootstrap-icons'), { maxAge: '1d' }));
app.use(express.static(publicDir, { dotfiles: 'deny', index: false, maxAge: '1h' }));

function fail(status, message) {
  const error = new Error(message);
  error.status = status;
  throw error;
}

function resultOf({ data, error }) {
  if (error) {
    const wrapped = new Error(error.message || 'The database request failed');
    wrapped.status = error.code === '23505' ? 409 : 400;
    throw wrapped;
  }
  return data;
}

function parseBody(schema) {
  return (req, _res, next) => {
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return next(Object.assign(new Error(parsed.error.issues[0]?.message || 'Check the submitted values'), { status: 400 }));
    }
    req.input = parsed.data;
    next();
  };
}

async function writeAudit(userId, action, entity, entityId, details = {}) {
  resultOf(await service.from('audit_log').insert({
    user_id: userId,
    action_performed: action,
    entity_type: entity,
    entity_id: entityId || null,
    details,
  }));
}

async function authenticate(req, _res, next) {
  try {
    const authorization = req.get('authorization') || '';
    const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
    if (!token) fail(401, 'Sign in to continue');
    const { data: authData, error: authError } = await service.auth.getUser(token);
    if (authError || !authData.user) fail(401, 'Your session has expired. Sign in again.');
    const profile = resultOf(await service.from('profiles')
      .select('id, full_name, role, active')
      .eq('id', authData.user.id)
      .maybeSingle());
    if (!profile || !profile.active) fail(403, 'This account is inactive or has not been assigned a bakery role.');
    req.user = authData.user;
    req.profile = profile;
    next();
  } catch (error) {
    next(error);
  }
}

function allow(...roles) {
  return (req, _res, next) => {
    if (!roles.includes(req.profile.role)) return next(Object.assign(new Error('Your role cannot perform this action.'), { status: 403 }));
    next();
  };
}

function todayInLagos() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Lagos' }).format(new Date());
}

const loginIpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 120,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Too many authentication requests from this network. Wait a few minutes and try again.' },
});
const loginIdentityLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 12,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  keyGenerator: (req) => req.body?.email
    ? `email:${String(req.body.email).trim().slice(0, 254).toLowerCase()}`
    : ipKeyGenerator(req.ip),
  message: { error: 'Too many sign-in attempts for this account. Wait a few minutes and try again.' },
});
const refreshLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  keyGenerator: (req) => req.body?.refresh_token
    ? `refresh:${crypto.createHash('sha256').update(String(req.body.refresh_token)).digest('hex')}`
    : ipKeyGenerator(req.ip),
  message: { error: 'Too many session refreshes. Sign in again.' },
});

app.get('/api/config', (_req, res) => {
  res.json({ supabaseUrl, supabaseAnonKey: process.env.SUPABASE_ANON_KEY });
});

app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));

app.post('/api/auth/login', loginIpLimiter, loginIdentityLimiter, parseBody(z.object({
  email: z.string().email().max(254),
  password: z.string().min(1).max(256),
})), async (req, res, next) => {
  try {
    const { data, error } = await anonClient.auth.signInWithPassword(req.input);
    if (error || !data.session || !data.user) return res.status(401).json({ error: 'Email or password is incorrect.' });
    const profile = resultOf(await service.from('profiles')
      .select('id, full_name, role, active')
      .eq('id', data.user.id)
      .maybeSingle());
    if (!profile || !profile.active) {
      await anonClient.auth.signOut({ scope: 'local' });
      return res.status(403).json({ error: 'This account has not been given an active bakery role.' });
    }
    res.json({
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
      expires_at: data.session.expires_at,
      profile,
    });
  } catch (error) { next(error); }
});

app.post('/api/auth/refresh', loginIpLimiter, refreshLimiter, parseBody(z.object({ refresh_token: z.string().min(20).max(2048) })), async (req, res, next) => {
  try {
    const { data, error } = await anonClient.auth.refreshSession({ refresh_token: req.input.refresh_token });
    if (error || !data.session || !data.user) return res.status(401).json({ error: 'Your session has expired. Sign in again.' });
    const profile = resultOf(await service.from('profiles')
      .select('id, full_name, role, active').eq('id', data.user.id).maybeSingle());
    if (!profile || !profile.active) return res.status(403).json({ error: 'This account is inactive.' });
    res.json({ access_token: data.session.access_token, refresh_token: data.session.refresh_token, profile });
  } catch (error) { next(error); }
});

app.get('/', (_req, res) => res.sendFile(path.join(publicDir, 'index.html')));
app.get('/login', (_req, res) => res.sendFile(path.join(publicDir, 'login.html')));
const appViews = ['/app', '/dashboard', '/overview', '/materials', '/production', '/sales', '/inventory', '/reports', '/team', '/audit'];
app.get(appViews, (_req, res) => res.sendFile(path.join(publicDir, 'app.html')));

const api = express.Router();
api.use(authenticate);
app.use('/api', api);

api.get('/auth/me', (req, res) => res.json({ profile: req.profile }));

api.post('/auth/password', parseBody(z.object({ password: z.string().min(12).max(128) })), async (req, res, next) => {
  try {
    const { error } = await service.auth.admin.updateUserById(req.user.id, { password: req.input.password });
    if (error) throw Object.assign(new Error(error.message), { status: 400 });
    await writeAudit(req.user.id, 'account.password_changed', 'profile', req.user.id);
    res.json({ message: 'Password updated.' });
  } catch (error) { next(error); }
});

api.get('/materials', async (_req, res, next) => {
  try {
    const data = resultOf(await service.from('materials').select('*').eq('active', true).order('name'));
    res.json({ materials: data });
  } catch (error) { next(error); }
});

api.get('/materials/movements', async (_req, res, next) => {
  try {
    const data = resultOf(await service.from('material_movements')
      .select('id, movement_type, quantity, note, created_at, materials(name, unit), profile:profiles!material_movements_recorded_by_fkey(full_name)')
      .order('created_at', { ascending: false }).limit(80));
    res.json({ movements: data });
  } catch (error) { next(error); }
});

api.post('/admin/materials', allow('admin'), parseBody(z.object({
  name: z.string().trim().min(2).max(80),
  unit: z.string().trim().min(1).max(24),
  reorder_level: z.coerce.number().min(0).max(100000000),
})), async (req, res, next) => {
  try {
    const material = resultOf(await service.from('materials').insert(req.input).select('*').single());
    await writeAudit(req.user.id, 'material.created', 'material', material.id, { name: material.name, unit: material.unit });
    res.status(201).json({ material });
  } catch (error) { next(error); }
});

api.patch('/admin/materials/:id', allow('admin'), parseBody(z.object({
  name: z.string().trim().min(2).max(80).optional(),
  unit: z.string().trim().min(1).max(24).optional(),
  reorder_level: z.coerce.number().min(0).max(100000000).optional(),
  active: z.boolean().optional(),
})), async (req, res, next) => {
  try {
    const updated = resultOf(await service.from('materials').update(req.input).eq('id', req.params.id).select().single());
    await writeAudit(req.user.id, 'material.updated', 'material', req.params.id, req.input);
    res.json({ material: updated, message: 'Material updated successfully.' });
  } catch (error) { next(error); }
});

api.post('/materials/receive', allow('store_officer', 'admin'), parseBody(z.object({
  material_id: uuid,
  quantity: positiveNumber,
  note: z.string().trim().max(240).default(''),
})), async (req, res, next) => {
  try {
    const movementId = resultOf(await service.rpc('record_receipt', {
      _material_id: req.input.material_id, _quantity: req.input.quantity,
      _note: req.input.note, _actor: req.user.id,
    }));
    res.status(201).json({ id: movementId, message: 'Stock receipt saved.' });
  } catch (error) { next(error); }
});

api.post('/materials/issue', allow('store_officer', 'admin'), parseBody(z.object({
  note: z.string().trim().min(1, 'Enter the approved requisition reference').max(240),
  items: z.array(z.object({ material_id: uuid, quantity: positiveNumber })).min(1).max(24),
})), async (req, res, next) => {
  try {
    const issueId = resultOf(await service.rpc('issue_materials', {
      _items: req.input.items, _note: req.input.note, _actor: req.user.id,
    }));
    res.status(201).json({ id: issueId, message: 'Material issue saved.' });
  } catch (error) { next(error); }
});

api.get('/issues/available', allow('production_supervisor', 'admin'), async (_req, res, next) => {
  try {
    const rows = resultOf(await service.from('material_issues')
      .select('id, note, issued_at, flour_consumed, material_issue_items(quantity, materials(name, unit))')
      .order('issued_at', { ascending: false }).limit(150));
    const issues = rows.filter((issue) => {
      const flour = (issue.material_issue_items || []).filter((line) => line.materials?.name?.toLowerCase() === 'flour' && ['bag', 'bags'].includes(line.materials?.unit?.toLowerCase()));
      return flour.reduce((sum, line) => sum + Number(line.quantity), 0) > Number(issue.flour_consumed || 0);
    });
    res.json({ issues });
  } catch (error) { next(error); }
});

api.get('/skus', async (_req, res, next) => {
  try {
    const data = resultOf(await service.from('skus').select('*').eq('active', true).order('weight_grams'));
    res.json({ skus: data });
  } catch (error) { next(error); }
});

api.post('/admin/skus', allow('admin'), parseBody(z.object({
  name: z.string().trim().min(2).max(80),
  weight_grams: positiveInt.max(20000),
  standard_yield_per_bag: positiveInt.max(100000),
})), async (req, res, next) => {
  try {
    const sku = resultOf(await service.from('skus').insert(req.input).select('*').single());
    await writeAudit(req.user.id, 'sku.created', 'sku', sku.id, { name: sku.name });
    res.status(201).json({ sku });
  } catch (error) { next(error); }
});

api.patch('/admin/skus/:id', allow('admin'), parseBody(z.object({
  name: z.string().trim().min(2).max(80).optional(),
  weight_grams: positiveInt.max(20000).optional(),
  standard_yield_per_bag: positiveInt.max(100000).optional(),
  active: z.boolean().optional(),
})), async (req, res, next) => {
  try {
    const updated = resultOf(await service.from('skus').update(req.input).eq('id', req.params.id).select().single());
    await writeAudit(req.user.id, 'sku.updated', 'sku', req.params.id, req.input);
    res.json({ sku: updated, message: 'Product SKU updated successfully.' });
  } catch (error) { next(error); }
});

api.get('/production/batches', async (req, res, next) => {
  try {
    const date = isoDate.safeParse(req.query.date || todayInLagos());
    if (!date.success) fail(400, 'Enter a valid date');
    const data = resultOf(await service.from('production_batches')
      .select('id, issue_id, bags_used, expected_yield, actual_yield, produced_on, created_at, sku:skus(id, name, weight_grams, standard_yield_per_bag), stage_damages(id, stage_name, quantity_damaged, reason)')
      .eq('produced_on', date.data).order('created_at', { ascending: false }));
    res.json({ batches: data });
  } catch (error) { next(error); }
});

api.post('/production/batches', allow('production_supervisor', 'admin'), parseBody(z.object({
  sku_id: uuid,
  issue_id: uuid,
  bags_used: positiveInt.max(10000),
  actual_yield: nonnegativeInt.max(1000000),
  produced_on: isoDate,
})), async (req, res, next) => {
  try {
    const batchId = resultOf(await service.rpc('create_production_batch', {
      _sku_id: req.input.sku_id, _issue_id: req.input.issue_id,
      _bags_used: req.input.bags_used, _actual_yield: req.input.actual_yield,
      _produced_on: req.input.produced_on, _actor: req.user.id,
    }));
    res.status(201).json({ id: batchId, message: 'Production batch saved.' });
  } catch (error) { next(error); }
});

api.post('/production/damages', allow('production_supervisor', 'admin'), parseBody(z.object({
  batch_id: uuid,
  stage_name: z.enum(['mixing_baking', 'slicing_packaging', 'distribution']),
  quantity_damaged: positiveInt.max(1000000),
  reason: z.string().trim().min(2).max(240),
})), async (req, res, next) => {
  try {
    const damageId = resultOf(await service.rpc('record_stage_damage', {
      _batch_id: req.input.batch_id, _stage: req.input.stage_name,
      _quantity: req.input.quantity_damaged, _reason: req.input.reason, _actor: req.user.id,
    }));
    res.status(201).json({ id: damageId, message: 'Stage damage saved.' });
  } catch (error) { next(error); }
});

api.get('/sales/dispatches', async (req, res, next) => {
  try {
    const date = isoDate.safeParse(req.query.date || todayInLagos());
    if (!date.success) fail(400, 'Enter a valid date');
    const dispatches = resultOf(await service.from('sales_dispatches')
      .select('id, sales_rep_name, units_issued, units_returned, dispatch_date, created_at, sku:skus(name, weight_grams)')
      .eq('dispatch_date', date.data).order('created_at', { ascending: false }));
    res.json({ dispatches });
  } catch (error) { next(error); }
});

api.post('/sales/dispatches', allow('sales_officer', 'admin'), parseBody(z.object({
  sku_id: uuid,
  sales_rep_name: z.string().trim().min(2).max(100),
  units_issued: positiveInt.max(1000000),
  dispatch_date: isoDate,
})), async (req, res, next) => {
  try {
    const dispatchId = resultOf(await service.rpc('record_dispatch', {
      _sku_id: req.input.sku_id, _rep: req.input.sales_rep_name,
      _quantity: req.input.units_issued, _dispatch_date: req.input.dispatch_date,
      _actor: req.user.id,
    }));
    res.status(201).json({ id: dispatchId, message: 'Dispatch saved.' });
  } catch (error) { next(error); }
});

api.post('/sales/returns', allow('sales_officer', 'admin'), parseBody(z.object({
  dispatch_id: uuid,
  units_returned: positiveInt.max(1000000),
})), async (req, res, next) => {
  try {
    const id = resultOf(await service.rpc('record_return', {
      _dispatch_id: req.input.dispatch_id, _quantity: req.input.units_returned, _actor: req.user.id,
    }));
    res.status(201).json({ id, message: 'Sales return saved.' });
  } catch (error) { next(error); }
});

api.post('/inventory/opening', allow('admin'), parseBody(z.object({
  sku_id: uuid, balance_date: isoDate, opening_stock: nonnegativeInt.max(10000000),
})), async (req, res, next) => {
  try {
    const id = resultOf(await service.rpc('set_opening_stock', {
      _sku_id: req.input.sku_id, _date: req.input.balance_date,
      _quantity: req.input.opening_stock, _actor: req.user.id,
    }));
    res.status(201).json({ id, message: 'Opening stock saved.' });
  } catch (error) { next(error); }
});

api.post('/admin/close-day', allow('admin'), parseBody(z.object({ date: isoDate })), async (req, res, next) => {
  try {
    const balances = resultOf(await service.rpc('close_inventory_day', { _date: req.input.date, _actor: req.user.id }));
    res.json({ balances, message: `Inventory closed for ${req.input.date}.` });
  } catch (error) { next(error); }
});

api.get('/overview', async (req, res, next) => {
  try {
    const date = todayInLagos();
    const [materials, skus, batches, dispatches, balances, priorBalances] = await Promise.all([
      service.from('materials').select('id, name, unit, quantity_on_hand, reorder_level').eq('active', true).order('name'),
      service.from('skus').select('id, name, weight_grams').eq('active', true).order('weight_grams'),
      service.from('production_batches').select('id, sku_id, expected_yield, actual_yield, stage_damages(quantity_damaged)').eq('produced_on', date),
      service.from('sales_dispatches').select('sku_id, units_issued, units_returned').eq('dispatch_date', date),
      service.from('inventory_balances').select('sku_id, opening_stock, closing_stock, is_closed').eq('balance_date', date),
      service.from('inventory_balances').select('sku_id, closing_stock, balance_date').lt('balance_date', date).eq('is_closed', true).order('balance_date', { ascending: false }).limit(1000),
    ]);
    const rows = [materials, skus, batches, dispatches, balances, priorBalances].map(resultOf);
    const [materialRows, skuRows, batchRows, dispatchRows, balanceRows, priorRows] = rows;
    const totals = skuRows.map((sku) => {
      const skuBatches = batchRows.filter((batch) => batch.sku_id === sku.id);
      const dailyBalance = balanceRows.find((row) => row.sku_id === sku.id);
      const priorBalance = priorRows.find((row) => row.sku_id === sku.id);
      const opening = dailyBalance?.opening_stock ?? priorBalance?.closing_stock ?? 0;
      const produced = skuBatches.reduce((sum, batch) => sum + batch.actual_yield, 0);
      const damaged = skuBatches.reduce((sum, batch) => sum + (batch.stage_damages || []).reduce((n, item) => n + item.quantity_damaged, 0), 0);
      const sales = dispatchRows.filter((row) => row.sku_id === sku.id).reduce((sum, row) => sum + row.units_issued - row.units_returned, 0);
      const closing = dailyBalance?.is_closed ? dailyBalance.closing_stock : (opening + produced - damaged - sales);
      return { sku_id: sku.id, sku_name: sku.name, opening, produced, damaged, net_sold: sales, closing };
    });
    const peopleResult = req.profile.role === 'admin'
      ? await service.from('profiles').select('id', { count: 'exact', head: true }).eq('active', true)
      : null;
    if (peopleResult?.error) resultOf(peopleResult);
    res.json({
      date,
      role: req.profile.role,
      materials: materialRows,
      skus: skuRows,
      totals,
      metrics: {
        material_count: materialRows.length,
        low_stock_count: materialRows.filter((item) => Number(item.quantity_on_hand) <= Number(item.reorder_level)).length,
        batch_count: batchRows.length,
        produced: totals.reduce((sum, row) => sum + row.produced, 0),
        damaged: totals.reduce((sum, row) => sum + row.damaged, 0),
        net_sold: totals.reduce((sum, row) => sum + row.net_sold, 0),
        closing_stock: totals.reduce((sum, row) => sum + row.closing, 0),
        day_closed: balanceRows.length > 0 && balanceRows.every((row) => row.is_closed),
        active_users: peopleResult?.count ?? null,
      },
    });
  } catch (error) { next(error); }
});

api.get('/reports/daily', allow('admin'), async (req, res, next) => {
  try {
    const date = isoDate.safeParse(req.query.date || todayInLagos());
    if (!date.success) fail(400, 'Enter a valid date');
    const [skus, balances, batches, dispatches, priorBalances] = await Promise.all([
      service.from('skus').select('id, name, weight_grams').eq('active', true).order('weight_grams'),
      service.from('inventory_balances').select('*, skus(name, weight_grams)').eq('balance_date', date.data).order('sku_id'),
      service.from('production_batches').select('id, bags_used, expected_yield, actual_yield, produced_on, skus(name), stage_damages(stage_name, quantity_damaged, reason)').eq('produced_on', date.data),
      service.from('sales_dispatches').select('sales_rep_name, units_issued, units_returned, skus(name)').eq('dispatch_date', date.data),
      service.from('inventory_balances').select('sku_id, closing_stock, balance_date').lt('balance_date', date.data).eq('is_closed', true).order('balance_date', { ascending: false }).limit(1000),
    ]);
    const skuRows = resultOf(skus);
    const dailyRows = resultOf(balances);
    const batchRows = resultOf(batches);
    const dispatchRows = resultOf(dispatches);
    const priorRows = resultOf(priorBalances);
    const liveBalances = skuRows.map((sku) => {
      const stored = dailyRows.find((row) => row.sku_id === sku.id);
      const previous = priorRows.find((row) => row.sku_id === sku.id);
      const skuBatches = batchRows.filter((batch) => batch.sku_id === sku.id);
      const opening = stored?.opening_stock ?? previous?.closing_stock ?? 0;
      const produced = skuBatches.reduce((sum, batch) => sum + batch.actual_yield, 0);
      const damaged = skuBatches.reduce((sum, batch) => sum + (batch.stage_damages || []).reduce((subtotal, item) => subtotal + item.quantity_damaged, 0), 0);
      const sold = dispatchRows.filter((row) => row.sku_id === sku.id).reduce((sum, row) => sum + row.units_issued - row.units_returned, 0);
      return {
        ...(stored || {}),
        balance_date: date.data,
        sku_id: sku.id,
        skus: { name: sku.name, weight_grams: sku.weight_grams },
        opening_stock: opening,
        total_produced: stored?.is_closed ? stored.total_produced : produced,
        total_damaged: stored?.is_closed ? stored.total_damaged : damaged,
        total_sold: stored?.is_closed ? stored.total_sold : sold,
        closing_stock: stored?.is_closed ? stored.closing_stock : opening + produced - damaged - sold,
        is_closed: Boolean(stored?.is_closed),
      };
    });
    res.json({ date: date.data, balances: liveBalances, batches: batchRows, dispatches: dispatchRows });
  } catch (error) { next(error); }
});

api.get('/reports/range', allow('admin'), async (req, res, next) => {
  try {
    const startDate = isoDate.safeParse(req.query.start_date || todayInLagos());
    const endDate = isoDate.safeParse(req.query.end_date || todayInLagos());
    if (!startDate.success || !endDate.success) fail(400, 'Enter valid start and end dates');
    if (startDate.data > endDate.data) fail(400, 'Start date cannot be after end date');

    const [batchesRes, dispatchesRes, skusRes] = await Promise.all([
      service.from('production_batches')
        .select('id, bags_used, expected_yield, actual_yield, produced_on, skus(name)')
        .gte('produced_on', startDate.data).lte('produced_on', endDate.data),
      service.from('sales_dispatches')
        .select('id, sales_rep_name, units_issued, units_returned, dispatch_date, skus(name)')
        .gte('dispatch_date', startDate.data).lte('dispatch_date', endDate.data),
      service.from('skus').select('id, name, weight_grams').eq('active', true),
    ]);

    const batches = resultOf(batchesRes);
    const dispatches = resultOf(dispatchesRes);
    const skus = resultOf(skusRes);

    const batchIds = batches.map((b) => b.id);
    const allDamages = batchIds.length > 0
      ? resultOf(await service.from('stage_damages').select('id, batch_id, stage_name, quantity_damaged, reason').in('batch_id', batchIds))
      : [];

    const stageCounts = {
      mixing_baking: 0,
      slicing_packaging: 0,
      distribution: 0,
    };
    for (const d of allDamages) {
      if (stageCounts[d.stage_name] !== undefined) {
        stageCounts[d.stage_name] += Number(d.quantity_damaged);
      }
    }

    const totalBags = batches.reduce((sum, b) => sum + Number(b.bags_used), 0);
    const totalProduced = batches.reduce((sum, b) => sum + Number(b.actual_yield), 0);
    const totalExpected = batches.reduce((sum, b) => sum + Number(b.expected_yield), 0);
    const totalDamaged = allDamages.reduce((sum, d) => sum + Number(d.quantity_damaged), 0);
    const totalDispatched = dispatches.reduce((sum, d) => sum + Number(d.units_issued), 0);
    const totalReturned = dispatches.reduce((sum, d) => sum + Number(d.units_returned), 0);
    const totalNetSold = totalDispatched - totalReturned;

    res.json({
      start_date: startDate.data,
      end_date: endDate.data,
      summary: {
        total_batches: batches.length,
        total_bags: totalBags,
        total_produced: totalProduced,
        total_expected: totalExpected,
        total_damaged: totalDamaged,
        total_dispatched: totalDispatched,
        total_returned: totalReturned,
        total_net_sold: totalNetSold,
        efficiency_rate: totalExpected > 0 ? (totalProduced / totalExpected) * 100 : 0,
        damage_rate: totalProduced > 0 ? (totalDamaged / totalProduced) * 100 : 0,
      },
      stage_damages: stageCounts,
      batches,
      dispatches,
    });
  } catch (error) { next(error); }
});

api.get('/admin/users', allow('admin'), async (_req, res, next) => {
  try {
    const [profilesRes, authUsersRes] = await Promise.all([
      service.from('profiles').select('id, full_name, role, active, created_at').order('created_at', { ascending: false }),
      service.auth.admin.listUsers({ perPage: 1000 }),
    ]);
    const profiles = resultOf(profilesRes);
    const emailMap = new Map((authUsersRes.data?.users || []).map((u) => [u.id, u.email]));
    const usersWithEmail = profiles.map((p) => ({ ...p, email: emailMap.get(p.id) || '—' }));
    res.json({ users: usersWithEmail });
  } catch (error) { next(error); }
});

api.post('/admin/users', allow('admin'), parseBody(z.object({
  full_name: z.string().trim().min(2).max(100),
  email: z.string().email().max(254),
  role: z.enum(roleValues),
  password: z.string().min(8).max(128).optional().or(z.literal('')),
})), async (req, res, next) => {
  try {
    const customPassword = req.input.password && req.input.password.trim().length >= 8 ? req.input.password.trim() : null;
    const finalPassword = customPassword || `${crypto.randomBytes(15).toString('base64url')}aA7!`;
    const { data, error } = await service.auth.admin.createUser({
      email: req.input.email,
      password: finalPassword,
      email_confirm: true,
      user_metadata: { full_name: req.input.full_name },
    });
    if (error || !data.user) {
      const duplicate = /already|exists/i.test(error?.message || '');
      return res.status(duplicate ? 409 : 400).json({ error: error?.message || 'Could not create the account.' });
    }
    const profile = await service.from('profiles').insert({
      id: data.user.id, full_name: req.input.full_name, role: req.input.role,
    }).select('id, full_name, role, active, created_at').single();
    if (profile.error) {
      await service.auth.admin.deleteUser(data.user.id);
      throw Object.assign(new Error(profile.error.message), { status: 400 });
    }
    await writeAudit(req.user.id, 'user.created', 'profile', data.user.id, { email: req.input.email, role: req.input.role });
    res.status(201).json({
      user: { ...profile.data, email: req.input.email },
      temporary_password: customPassword ? null : finalPassword,
      message: `Staff account for ${profile.data.full_name} created successfully.`,
    });
  } catch (error) { next(error); }
});

api.post('/admin/users/:id/password', allow('admin'), parseBody(z.object({
  password: z.string().min(8, 'Password must be at least 8 characters').max(128),
})), async (req, res, next) => {
  try {
    const targetUserId = req.params.id;
    const { error } = await service.auth.admin.updateUserById(targetUserId, {
      password: req.input.password,
    });
    if (error) throw Object.assign(new Error(error.message), { status: 400 });
    await writeAudit(req.user.id, 'admin.password_reset', 'profile', targetUserId);
    res.json({ message: 'Password updated successfully.' });
  } catch (error) { next(error); }
});

api.post('/admin/users/:id/role', allow('admin'), parseBody(z.object({
  role: z.enum(roleValues).optional(),
  active: z.boolean().optional(),
})), async (req, res, next) => {
  try {
    const targetUserId = req.params.id;
    if (targetUserId === req.user.id && req.input.active === false) {
      fail(400, 'You cannot deactivate your own administrator account.');
    }
    const updates = {};
    if (req.input.role) updates.role = req.input.role;
    if (typeof req.input.active === 'boolean') updates.active = req.input.active;
    const updated = resultOf(await service.from('profiles').update(updates).eq('id', targetUserId).select().single());
    await writeAudit(req.user.id, 'admin.profile_updated', 'profile', targetUserId, updates);
    res.json({ user: updated, message: 'Staff profile updated.' });
  } catch (error) { next(error); }
});

api.get('/admin/audit', allow('admin'), async (_req, res, next) => {
  try {
    const logs = resultOf(await service.from('audit_log')
      .select('id, action_performed, entity_type, entity_id, details, created_at, profile:profiles!audit_log_user_id_fkey(full_name)')
      .order('created_at', { ascending: false }).limit(150));
    res.json({ logs });
  } catch (error) { next(error); }
});

app.use('/api', (_req, res) => res.status(404).json({ error: 'API route not found.' }));
app.use((error, _req, res, _next) => {
  const status = Number.isInteger(error.status) ? error.status : 500;
  if (status >= 500) console.error(error);
  res.status(status).json({ error: status >= 500 ? 'The server could not complete that request.' : error.message });
});

const port = Number(process.env.PORT) || 3001;
app.listen(port, () => console.log(`UI Bakery Inventory is running on http://localhost:${port}`));
