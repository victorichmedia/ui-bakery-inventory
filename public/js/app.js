(() => {
  const tokenKey = 'uibakery.accessToken';
  const refreshKey = 'uibakery.refreshToken';
  const root = document.querySelector('#viewRoot');
  const nav = document.querySelector('#appNav');
  const notice = document.querySelector('#appNotice');
  const labels = {
    admin: 'Administrator',
    store_officer: 'Store Officer',
    production_supervisor: 'Production Supervisor',
    sales_officer: 'Sales Officer',
  };
  const navItems = [
    { key: 'overview', label: 'Overview', icon: 'bi-grid-1x2', group: 'WORKSPACE', roles: ['admin', 'store_officer', 'production_supervisor', 'sales_officer'] },
    { key: 'materials', label: 'Raw materials', icon: 'bi-box-seam', group: 'WORKFLOWS', roles: ['admin', 'store_officer'] },
    { key: 'production', label: 'Production', icon: 'bi-gear-wide-connected', group: 'WORKFLOWS', roles: ['admin', 'production_supervisor'] },
    { key: 'sales', label: 'Sales & returns', icon: 'bi-truck', group: 'WORKFLOWS', roles: ['admin', 'sales_officer'] },
    { key: 'inventory', label: 'Daily stock', icon: 'bi-arrow-repeat', group: 'MANAGEMENT', roles: ['admin'] },
    { key: 'reports', label: 'Reports', icon: 'bi-bar-chart-line', group: 'MANAGEMENT', roles: ['admin'] },
    { key: 'team', label: 'Users & SKUs', icon: 'bi-people', group: 'MANAGEMENT', roles: ['admin'] },
    { key: 'audit', label: 'Audit history', icon: 'bi-clock-history', group: 'MANAGEMENT', roles: ['admin'] },
  ];
  const stageLabels = {
    mixing_baking: 'Mixing / baking',
    slicing_packaging: 'Slicing / packaging',
    distribution: 'Distribution',
  };
  let profile = null;
  let currentView = 'overview';
  let noticeTimer = null;
  let temporaryPassword = '';
  let refreshInFlight = null;

  const e = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  const num = (value, digits = 0) => new Intl.NumberFormat('en-NG', { maximumFractionDigits: digits }).format(Number(value || 0));
  const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Lagos' }).format(new Date());
  const dateLabel = (value) => value ? new Intl.DateTimeFormat('en-NG', { dateStyle: 'medium', timeZone: 'Africa/Lagos' }).format(new Date(`${value}T12:00:00Z`)) : '—';
  const timeLabel = (value) => value ? new Intl.DateTimeFormat('en-NG', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : '—';
  const token = () => localStorage.getItem(tokenKey) || '';

  async function refreshSession() {
    if (refreshInFlight) return refreshInFlight;
    const refreshToken = localStorage.getItem(refreshKey);
    if (!refreshToken) return false;
    refreshInFlight = (async () => {
      const response = await fetch('/api/auth/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: refreshToken }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.access_token) return false;
      localStorage.setItem(tokenKey, result.access_token);
      if (result.refresh_token) localStorage.setItem(refreshKey, result.refresh_token);
      return true;
    })().catch(() => false).finally(() => { refreshInFlight = null; });
    return refreshInFlight;
  }

  function showNotice(message, type = 'success') {
    clearTimeout(noticeTimer);
    notice.textContent = message;
    notice.className = `app-notice show ${type}`;
    noticeTimer = setTimeout(() => { notice.className = 'app-notice'; }, 4200);
  }

  function clearSession() {
    localStorage.removeItem(tokenKey);
    localStorage.removeItem(refreshKey);
    window.location.replace('/login');
  }

  async function api(url, options = {}, retried = false) {
    const headers = { ...(options.headers || {}), Authorization: `Bearer ${token()}` };
    if (options.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
    const response = await fetch(`/api${url}`, { ...options, headers });
    if (response.status === 401 && !retried && url !== '/auth/refresh') {
      if (await refreshSession()) return api(url, options, true);
      clearSession();
      throw new Error('Your session ended. Sign in again.');
    }
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || 'The request could not be completed.');
    return body;
  }

  function roleName() { return labels[profile?.role] || 'Staff'; }

  function renderNav() {
    const available = navItems.filter((item) => item.roles.includes(profile.role));
    let lastGroup = '';
    nav.innerHTML = available.map((item) => {
      const group = item.group !== lastGroup ? `<div class="nav-group-label">${e(item.group)}</div>` : '';
      lastGroup = item.group;
      return `${group}<button type="button" data-view="${e(item.key)}" class="${item.key === currentView ? 'active' : ''}"><i class="bi ${e(item.icon)}"></i>${e(item.label)}</button>`;
    }).join('');
  }

  function heading(kicker, title, description, action = '') {
    return `<div class="app-heading"><div><div class="eyebrow">${e(kicker)}</div><h1>${e(title)}</h1><p>${e(description)}</p></div><div class="heading-actions">${action}</div></div>`;
  }

  function metric(label, value, note, icon, color = '') {
    return `<div class="metric-card"><div class="metric-card-top"><span>${e(label)}</span><span class="metric-icon ${e(color)}"><i class="bi ${e(icon)}"></i></span></div><strong class="metric-value">${e(value)}</strong><small class="metric-note">${e(note)}</small></div>`;
  }

  function table(headers, rows, emptyText = 'No records to show yet.') {
    if (!rows.length) return `<div class="empty-state"><i class="bi bi-inbox"></i>${e(emptyText)}</div>`;
    return `<div class="table-responsive"><table class="data-table"><thead><tr>${headers.map((header) => `<th>${e(header)}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
  }

  function panel(title, subtitle, content, extra = '') {
    return `<section class="panel ${e(extra)}"><div class="panel-header"><h2>${e(title)}</h2><span>${e(subtitle)}</span></div><div class="panel-body">${content}</div></section>`;
  }

  function datePill(date = today()) {
    return `<span class="app-date-pill"><i class="bi bi-calendar3"></i>${e(dateLabel(date))}</span>`;
  }

  async function renderOverview() {
    const data = await api('/overview');
    const m = data.metrics;
    const names = {
      admin: 'Your bakery, at a glance.',
      store_officer: 'Start with what is in store.',
      production_supervisor: 'Keep each batch in view.',
      sales_officer: 'Reconcile today as it happens.',
    };
    const lowRows = data.materials.filter((item) => Number(item.quantity_on_hand) <= Number(item.reorder_level));
    const stockRows = data.totals.map((item) => `<tr><td><strong>${e(item.sku_name)}</strong></td><td>${num(item.opening)}</td><td>${num(item.produced)}</td><td>${num(item.damaged)}</td><td>${num(item.net_sold)}</td><td class="number-cell">${num(item.closing)}</td></tr>`);
    const alertRows = lowRows.map((item) => `<tr><td><strong>${e(item.name)}</strong></td><td>${num(item.quantity_on_hand, 2)} ${e(item.unit)}</td><td><span class="status-pill warning">Below reorder</span></td></tr>`);
    const quick = {
      admin: 'Manage inventory, check reports and close the day when all entries are complete.',
      store_officer: 'Record deliveries and log each issue before production begins.',
      production_supervisor: 'Link a production batch to its material issue, then add stage damage as it happens.',
      sales_officer: 'Record each dispatch and enter returned loaves against the representative.',
    }[profile.role];
    const quickLinks = {
      admin: `
        <div class="overview-actions mt-3 d-flex flex-wrap gap-2">
          <button type="button" class="btn btn-dark btn-sm rounded-pill" data-view="materials"><i class="bi bi-box-seam me-1"></i> Raw materials</button>
          <button type="button" class="btn btn-dark btn-sm rounded-pill" data-view="production"><i class="bi bi-gear-wide-connected me-1"></i> Production floor</button>
          <button type="button" class="btn btn-dark btn-sm rounded-pill" data-view="sales"><i class="bi bi-truck me-1"></i> Sales & returns</button>
          <button type="button" class="btn btn-dark btn-sm rounded-pill" data-view="inventory"><i class="bi bi-arrow-repeat me-1"></i> Daily stock</button>
          <button type="button" class="btn btn-outline-dark btn-sm rounded-pill" data-view="reports"><i class="bi bi-bar-chart-line me-1"></i> Reports</button>
          <button type="button" class="btn btn-outline-dark btn-sm rounded-pill" data-view="team"><i class="bi bi-people me-1"></i> Staff & SKUs</button>
          <button type="button" class="btn btn-outline-dark btn-sm rounded-pill" data-view="audit"><i class="bi bi-clock-history me-1"></i> Audit log</button>
        </div>`,
      store_officer: `
        <div class="overview-actions mt-3 d-flex flex-wrap gap-2">
          <button type="button" class="btn btn-dark btn-sm rounded-pill" data-view="materials"><i class="bi bi-box-arrow-in-down me-1"></i> Receive delivery</button>
          <button type="button" class="btn btn-outline-dark btn-sm rounded-pill" data-view="materials"><i class="bi bi-box-arrow-up-right me-1"></i> Issue to production</button>
        </div>`,
      production_supervisor: `
        <div class="overview-actions mt-3 d-flex flex-wrap gap-2">
          <button type="button" class="btn btn-dark btn-sm rounded-pill" data-view="production"><i class="bi bi-plus-circle me-1"></i> Record new batch</button>
          <button type="button" class="btn btn-outline-dark btn-sm rounded-pill" data-view="production"><i class="bi bi-exclamation-circle me-1"></i> Log stage damage</button>
        </div>`,
      sales_officer: `
        <div class="overview-actions mt-3 d-flex flex-wrap gap-2">
          <button type="button" class="btn btn-dark btn-sm rounded-pill" data-view="sales"><i class="bi bi-truck me-1"></i> Record dispatch</button>
          <button type="button" class="btn btn-outline-dark btn-sm rounded-pill" data-view="sales"><i class="bi bi-arrow-return-left me-1"></i> Log returned bread</button>
        </div>`,
    }[profile.role] || '';
    const cards = [
      metric('Raw material types', num(m.material_count), `${num(m.low_stock_count)} at or below reorder level`, 'bi-box-seam'),
      metric('Production batches', num(m.batch_count), `${num(m.produced)} loaves counted today`, 'bi-gear-wide-connected', 'orange'),
      metric('Stage damage', num(m.damaged), 'Loaves logged across all stages', 'bi-exclamation-triangle', 'gold'),
      metric('Finished stock', num(m.closing_stock), `${num(m.net_sold)} net units sold today`, 'bi-boxes', 'blue'),
    ].join('');
    root.innerHTML = `${heading('DAILY WORKSPACE', names[profile.role] || 'Your bakery, at a glance.', 'Stock activity for today, with the latest entries from your team.', datePill(data.date))}
      <div class="role-banner"><i class="bi bi-info-circle"></i><div class="w-100"><div><strong>${e(roleName())} view.</strong> ${e(quick)}</div>${quickLinks}</div></div>
      <div class="metric-grid">${cards}</div>
      <div class="dashboard-grid"><div class="panel table-panel"><div class="panel-header"><h2>Finished stock position</h2><span>${e(dateLabel(data.date))}</span></div>${table(['SKU', 'Opening', 'Produced', 'Damaged', 'Net sold', 'Closing'], stockRows, 'Add SKUs and opening stock to begin daily reconciliation.')}</div>
      <div class="panel table-panel"><div class="panel-header"><h2>Raw material watch</h2><span>${num(lowRows.length)} need attention</span></div>${table(['Material', 'On hand', 'Status'], alertRows, 'No materials are below their reorder level.')}</div></div>`;
  }

  function selectOptions(items, labelFn, empty = 'No options available') {
    if (!items.length) return `<option value="">${e(empty)}</option>`;
    return `<option value="">Choose…</option>${items.map((item) => `<option value="${e(item.id)}">${e(labelFn(item))}</option>`).join('')}`;
  }

  function materialIssueRows(materials, count = 1) {
    return Array.from({ length: count }, () => `<div class="inline-row issue-line"><div class="form-field"><label>Material</label><select name="material_id" required>${selectOptions(materials, (item) => `${item.name} · ${item.unit} · ${num(item.quantity_on_hand, 2)} on hand`, 'Add materials first')}</select></div><div class="form-field"><label>Quantity</label><input name="quantity" type="number" min="0.001" step="0.001" required></div><button class="row-remove" type="button" data-remove-row aria-label="Remove material"><i class="bi bi-x-lg"></i></button></div>`).join('');
  }

  async function renderMaterials() {
    const [materialsData, movementsData] = await Promise.all([api('/materials'), api('/materials/movements')]);
    const materials = materialsData.materials;
    const admin = profile.role === 'admin';
    const store = admin || profile.role === 'store_officer';
    const materialRows = materials.map((item) => {
      const low = Number(item.quantity_on_hand) <= Number(item.reorder_level);
      const percent = Number(item.reorder_level) > 0 ? Math.min(100, Math.round(Number(item.quantity_on_hand) / (Number(item.reorder_level) * 2) * 100)) : 100;
      const editBtn = admin ? `<td><button type="button" class="btn btn-outline-secondary btn-sm rounded-pill py-0 px-2" data-edit-material='${JSON.stringify(item).replace(/'/g, '&#39;')}'>Edit</button></td>` : '';
      return `<tr><td><strong>${e(item.name)}</strong></td><td>${e(item.unit)}</td><td class="number-cell">${num(item.quantity_on_hand, 2)}</td><td>${num(item.reorder_level, 2)}</td><td><div class="stock-bar ${low ? 'low' : ''}"><span style="width:${percent}%"></span></div></td><td><span class="status-pill ${low ? 'warning' : ''}">${low ? 'Reorder' : 'In range'}</span></td>${editBtn}</tr>`;
    });
    const materialHeaders = ['Material', 'Unit', 'On hand', 'Reorder at', 'Level', 'Status'];
    if (admin) materialHeaders.push('Actions');
    const movementRows = movementsData.movements.map((item) => `<tr><td>${e(timeLabel(item.created_at))}</td><td><strong>${e(item.materials?.name || 'Material')}</strong></td><td><span class="status-pill ${item.movement_type === 'issue' ? 'neutral' : ''}">${item.movement_type === 'issue' ? 'Issue' : 'Receipt'}</span></td><td class="number-cell">${item.movement_type === 'issue' ? '−' : '+'}${num(item.quantity, 2)} ${e(item.materials?.unit || '')}</td><td>${e(item.profile?.full_name || 'Staff')}</td></tr>`);
    root.innerHTML = `${heading('STORE MANAGEMENT', 'Raw materials', 'Keep a reliable record of what arrived, what was issued and what remains.', datePill())}
      <div class="metric-grid">${metric('Materials tracked', num(materials.length), 'Active raw material types', 'bi-box-seam')}${metric('Reorder alerts', num(materials.filter((item) => Number(item.quantity_on_hand) <= Number(item.reorder_level)).length), 'At or below threshold', 'bi-bell', 'gold')}${metric('Latest movements', num(movementsData.movements.length), 'Recent receipts and issues', 'bi-arrow-left-right', 'blue')}${metric('Issue control', 'Logged', 'Each issue records staff and time', 'bi-shield-check', 'orange')}</div>
      ${store ? `<div class="panel-grid"><section class="panel form-panel"><h2>Receive materials</h2><p>Add delivered stock to a material balance.</p><form data-form="receipt" class="form-grid"><div class="form-field full"><label>Material</label><select name="material_id" required>${selectOptions(materials, (item) => `${item.name} · ${item.unit}`)}</select></div><div class="form-field"><label>Quantity received</label><input name="quantity" type="number" min="0.001" step="0.001" required></div><div class="form-field"><label>Note / supplier reference</label><input name="note" maxlength="240" placeholder="Optional"></div><div class="form-field full"><button class="form-submit" type="submit"><i class="bi bi-plus-circle"></i> Save receipt</button></div></form></section>
      <section class="panel form-panel"><h2>Issue to production</h2><p>Choose each ingredient and quantity. Flour must use the unit “bag” for batch yield checks.</p><form data-form="issue"><div id="issueRows">${materialIssueRows(materials)}</div><button type="button" class="add-row-button" data-add-issue-row aria-label="Add another material"><i class="bi bi-plus"></i></button><div class="form-grid mt-2"><div class="form-field full"><label>Approved requisition reference</label><input name="note" maxlength="240" required placeholder="e.g. REQ-2026-001"></div><div class="form-field full"><button class="form-submit" type="submit"><i class="bi bi-box-arrow-up-right"></i> Save material issue</button></div></div></form></section></div>` : ''}
      ${admin ? `<section class="panel form-panel mb-3"><h2>Add a raw material</h2><p>Set the tracking unit and reorder level before recording receipts.</p><form data-form="material-create" class="form-grid"><div class="form-field"><label>Material name</label><input name="name" required maxlength="80" placeholder="e.g. Flour"></div><div class="form-field"><label>Unit</label><input name="unit" required maxlength="24" placeholder="bag, kg, litre"></div><div class="form-field"><label>Reorder level</label><input name="reorder_level" type="number" min="0" step="0.001" required value="0"></div><div class="form-field"><button class="form-submit" type="submit"><i class="bi bi-plus-lg"></i> Add material</button></div></form></section>` : ''}
      <div class="panel table-panel mb-3"><div class="panel-header"><h2>Material balances</h2><span>${num(materials.length)} materials</span></div>${table(materialHeaders, materialRows, 'Add raw materials from the Administrator view.')}</div>
      <div class="panel table-panel"><div class="panel-header"><h2>Recent movements</h2><span>Latest 80</span></div>${table(['Recorded', 'Material', 'Type', 'Quantity', 'Staff'], movementRows)}</div>`;
  }

  async function renderProduction() {
    const [skuData, issueData, batchData] = await Promise.all([api('/skus'), api('/issues/available'), api(`/production/batches?date=${today()}`)]);
    const skus = skuData.skus;
    const batches = batchData.batches;
    const issues = issueData.issues;
    const batchRows = batches.map((batch) => {
      const damage = (batch.stage_damages || []).reduce((sum, item) => sum + item.quantity_damaged, 0);
      const net = batch.actual_yield - damage;
      const efficiency = batch.expected_yield ? `${num(batch.actual_yield / batch.expected_yield * 100, 1)}%` : '—';
      return `<tr><td><strong>${e(batch.sku?.name || 'SKU')}</strong></td><td>${num(batch.bags_used)} bag${batch.bags_used === 1 ? '' : 's'}</td><td>${num(batch.expected_yield)}</td><td>${num(batch.actual_yield)}</td><td>${num(damage)}</td><td class="number-cell">${num(net)}</td><td>${efficiency}</td></tr>`;
    });
    const damageRows = batches.flatMap((batch) => (batch.stage_damages || []).map((damage) => `<tr><td><strong>${e(batch.sku?.name || 'SKU')}</strong></td><td>${e(stageLabels[damage.stage_name] || damage.stage_name)}</td><td class="number-cell">${num(damage.quantity_damaged)}</td><td>${e(damage.reason)}</td></tr>`));
    const eligibleIssues = issues.filter((issue) => (issue.material_issue_items || []).some((line) => line.materials?.name?.toLowerCase() === 'flour' && ['bag', 'bags'].includes(line.materials?.unit?.toLowerCase())));
    const issueLabel = (issue) => {
      const flour = (issue.material_issue_items || []).filter((line) => line.materials?.name?.toLowerCase() === 'flour');
      const bags = flour.reduce((sum, line) => sum + Number(line.quantity), 0);
      const remaining = Math.max(0, bags - Number(issue.flour_consumed || 0));
      return `${dateLabel(issue.issued_at?.slice(0, 10))} · ${num(remaining)} flour bag${remaining === 1 ? '' : 's'} available${issue.note ? ` · ${issue.note}` : ''}`;
    };
    const damageBatchRows = batches.filter((batch) => batch.actual_yield > (batch.stage_damages || []).reduce((sum, item) => sum + item.quantity_damaged, 0));
    const damageOptions = selectOptions(damageBatchRows, (batch) => `${batch.sku?.name || 'SKU'} · batch ${batch.id.slice(0, 8)} · ${num(batch.actual_yield)} output`);
    root.innerHTML = `${heading('PRODUCTION FLOOR', 'Batches & yield', 'Calculate expected output from the recipe and keep damage tied to the stage where it happened.', datePill())}
      <div class="metric-grid">${metric('Batches today', num(batches.length), 'Linked to Store Officer issues', 'bi-gear-wide-connected', 'orange')}${metric('Expected yield', num(batches.reduce((sum, batch) => sum + batch.expected_yield, 0)), 'Based on bags and SKU standard', 'bi-calculator')}${metric('Actual output', num(batches.reduce((sum, batch) => sum + batch.actual_yield, 0)), 'Counted before stage damage', 'bi-boxes', 'blue')}${metric('Net production', num(batches.reduce((sum, batch) => sum + batch.actual_yield - (batch.stage_damages || []).reduce((n, item) => n + item.quantity_damaged, 0), 0)), 'Output less logged damage', 'bi-check2-circle')}</div>
      <div class="panel-grid"><section class="panel form-panel"><h2>Create a production batch</h2><p>Select a Store Officer issue with enough flour remaining. One issue can supply several batches.</p><form data-form="batch" class="form-grid"><div class="form-field full"><label>Store issue</label><select name="issue_id" required>${selectOptions(eligibleIssues, issueLabel, 'No flour issues with bags remaining')}</select></div><div class="form-field full"><label>Product SKU</label><select name="sku_id" id="batchSku" required>${selectOptions(skus, (sku) => `${sku.name} · ${num(sku.weight_grams)}g · ${num(sku.standard_yield_per_bag)} per bag`, 'Add SKUs in Administrator view')}</select></div><div class="form-field"><label>Flour bags used</label><input name="bags_used" id="bagsUsed" type="number" min="1" step="1" required></div><div class="form-field"><label>Actual output loaves</label><input name="actual_yield" id="actualYield" type="number" min="0" step="1" required></div><div class="form-field full"><label>Production date</label><input name="produced_on" type="date" value="${e(today())}" required></div><div class="form-field full"><div class="yield-preview"><span>Expected yield from standard</span><strong id="expectedYieldPreview">— loaves</strong></div></div><div class="form-field full"><button class="form-submit" type="submit"><i class="bi bi-plus-circle"></i> Save production batch</button></div></form></section>
      <section class="panel form-panel"><h2>Log stage damage</h2><p>Each entry reduces the batch's net production and appears in the audit trail.</p><form data-form="damage" class="form-grid"><div class="form-field full"><label>Production batch</label><select name="batch_id" required>${damageOptions}</select></div><div class="form-field"><label>Stage</label><select name="stage_name" required><option value="">Choose…</option>${Object.entries(stageLabels).map(([key, label]) => `<option value="${e(key)}">${e(label)}</option>`).join('')}</select></div><div class="form-field"><label>Loaves damaged</label><input name="quantity_damaged" type="number" min="1" step="1" required></div><div class="form-field full"><label>Reason</label><input name="reason" maxlength="240" required placeholder="e.g. Burnt during baking"></div><div class="form-field full"><button class="form-submit" type="submit"><i class="bi bi-exclamation-circle"></i> Save stage damage</button></div></form><div class="form-divider"></div><p class="form-help">Damage at every stage is checked against the batch's counted output to prevent negative production.</p></section></div>
      <div class="panel table-panel mb-3"><div class="panel-header"><h2>Today's production</h2><span>${e(dateLabel(today()))}</span></div>${table(['SKU', 'Flour', 'Expected', 'Actual', 'Damaged', 'Net output', 'Yield'], batchRows, 'No production batches have been recorded today.')}</div>
      <div class="panel table-panel"><div class="panel-header"><h2>Damage by production stage</h2><span>${num(damageRows.length)} entries</span></div>${table(['SKU', 'Stage', 'Loaves damaged', 'Reason'], damageRows, 'No stage damage has been logged today.')}</div>`;
    setupYieldPreview(skus);
  }

  function setupYieldPreview(skus) {
    const skuSelect = document.querySelector('#batchSku');
    const bagsInput = document.querySelector('#bagsUsed');
    const actualInput = document.querySelector('#actualYield');
    const output = document.querySelector('#expectedYieldPreview');
    if (!skuSelect || !bagsInput || !output) return;
    let actualManuallyChanged = false;
    actualInput.addEventListener('input', () => { actualManuallyChanged = true; });
    const update = () => {
      const sku = skus.find((item) => item.id === skuSelect.value);
      const expected = sku && Number(bagsInput.value) > 0 ? Number(sku.standard_yield_per_bag) * Number(bagsInput.value) : 0;
      output.textContent = expected ? `${num(expected)} loaves` : '— loaves';
      if (!actualManuallyChanged && expected) actualInput.value = expected;
    };
    skuSelect.addEventListener('change', update);
    bagsInput.addEventListener('input', update);
  }

  async function renderSales() {
    const [skuData, dispatchData, overview] = await Promise.all([api('/skus'), api(`/sales/dispatches?date=${today()}`), api('/overview')]);
    const skus = skuData.skus;
    const dispatches = dispatchData.dispatches;
    const totals = new Map(overview.totals.map((item) => [item.sku_id, item]));
    const rows = dispatches.map((item) => `<tr><td><strong>${e(item.sales_rep_name)}</strong></td><td>${e(item.sku?.name || 'SKU')}</td><td>${num(item.units_issued)}</td><td>${num(item.units_returned)}</td><td class="number-cell">${num(item.units_issued - item.units_returned)}</td><td>${num(Math.max(0, item.units_issued - item.units_returned)) > 0 ? '<span class="status-pill">Recorded</span>' : '<span class="status-pill neutral">Returned</span>'}</td><td><button type="button" class="btn btn-outline-dark btn-sm rounded-pill py-0 px-2" data-print-waybill='${JSON.stringify(item).replace(/'/g, '&#39;')}"><i class="bi bi-printer"></i> Waybill</button></td></tr>`);
    const openDispatches = dispatches.filter((item) => item.units_returned < item.units_issued);
    root.innerHTML = `${heading('SALES DESK', 'Dispatch & returns', 'Track goods handed to each representative and reconcile unsold loaves at return.', datePill())}
      <div class="metric-grid">${metric('Representatives today', num(new Set(dispatches.map((item) => item.sales_rep_name)).size), 'With a recorded dispatch', 'bi-people')}${metric('Units dispatched', num(dispatches.reduce((sum, item) => sum + item.units_issued, 0)), 'Finished stock issued to sales', 'bi-truck', 'orange')}${metric('Units returned', num(dispatches.reduce((sum, item) => sum + item.units_returned, 0)), 'Unsold loaves added back', 'bi-arrow-return-left', 'blue')}${metric('Net sales', num(dispatches.reduce((sum, item) => sum + item.units_issued - item.units_returned, 0)), 'Dispatch less returned units', 'bi-receipt', 'gold')}</div>
      <div class="panel-grid"><section class="panel form-panel"><h2>Record a dispatch</h2><p>Available stock is checked before dispatch is saved.</p><form data-form="dispatch" class="form-grid"><div class="form-field full"><label>Product SKU</label><select name="sku_id" required>${selectOptions(skus, (sku) => `${sku.name} · ${num(totals.get(sku.id)?.closing || 0)} available`, 'Add SKUs first')}</select></div><div class="form-field"><label>Sales representative</label><input name="sales_rep_name" maxlength="100" required placeholder="Representative name"></div><div class="form-field"><label>Loaves handed out</label><input name="units_issued" type="number" min="1" step="1" required></div><div class="form-field full"><label>Dispatch date</label><input name="dispatch_date" type="date" value="${e(today())}" required></div><div class="form-field full"><button class="form-submit" type="submit"><i class="bi bi-truck"></i> Save dispatch</button></div></form></section>
      <section class="panel form-panel"><h2>Record returned loaves</h2><p>Returns are linked to their original dispatch and cannot exceed the quantity issued.</p><form data-form="return" class="form-grid"><div class="form-field full"><label>Representative / dispatch</label><select name="dispatch_id" required>${selectOptions(openDispatches, (item) => `${item.sales_rep_name} · ${item.sku?.name || 'SKU'} · ${num(item.units_issued - item.units_returned)} still out`, 'No unreturned dispatches today')}</select></div><div class="form-field full"><label>Unsold loaves returned now</label><input name="units_returned" type="number" min="1" step="1" required></div><div class="form-field full"><button class="form-submit" type="submit"><i class="bi bi-arrow-return-left"></i> Save return</button></div></form></section></div>
      <div class="panel table-panel"><div class="panel-header"><h2>Today's dispatch register</h2><span>${e(dateLabel(today()))}</span></div>${table(['Representative', 'SKU', 'Dispatched', 'Returned', 'Net sold', 'Status', 'Slip'], rows, 'No dispatches have been recorded today.')}</div>`;
  }

  async function dailyData(date) { return api(`/reports/daily?date=${encodeURIComponent(date)}`); }

  async function renderInventory() {
    const [skuData, report] = await Promise.all([api('/skus'), dailyData(today())]);
    const skus = skuData.skus;
    const balances = report.balances;
    const balanceRows = balances.map((item) => `<tr><td><strong>${e(item.skus?.name || 'SKU')}</strong></td><td>${num(item.opening_stock)}</td><td>${num(item.total_produced)}</td><td>${num(item.total_damaged)}</td><td>${num(item.total_sold)}</td><td class="number-cell">${num(item.closing_stock)}</td><td><span class="status-pill ${item.is_closed ? 'closed' : 'neutral'}">${item.is_closed ? 'Closed' : 'Open'}</span></td></tr>`);
    const closed = balances.length > 0 && balances.every((item) => item.is_closed);
    root.innerHTML = `${heading('INVENTORY CONTROL', 'Daily stock', 'Set the first opening counts, review movement and close the day when entries are complete.', datePill())}
      <div class="role-banner"><i class="bi bi-arrow-repeat"></i><span>Closing stock is calculated as <strong>opening + actual output − stage damage − net sales</strong>. A closed date cannot accept new production or sales entries.</span></div>
      <div class="panel-grid"><section class="panel form-panel"><h2>Set opening stock</h2><p>Use this to enter physical opening counts before the first daily close.</p><form data-form="opening" class="form-grid"><div class="form-field full"><label>Product SKU</label><select name="sku_id" required>${selectOptions(skus, (sku) => sku.name, 'Add SKUs first')}</select></div><div class="form-field"><label>Opening loaves</label><input name="opening_stock" type="number" min="0" step="1" required value="0"></div><div class="form-field"><label>Balance date</label><input name="balance_date" type="date" value="${e(today())}" required></div><div class="form-field full"><button class="form-submit secondary" type="submit"><i class="bi bi-save"></i> Save opening count</button></div></form></section>
      <section class="panel form-panel"><h2>Close the day</h2><p>Closes all active SKU balances and carries each closing quantity into the next day's opening.</p><div class="yield-preview"><span>Reconciliation date · ${e(dateLabel(today()))}</span><strong>${closed ? 'Closed' : 'Open'}</strong></div><button class="form-submit mt-3 w-100" type="button" data-close-day ${closed ? 'disabled' : ''}><i class="bi bi-check2-circle"></i> ${closed ? 'Day already closed' : 'Review & close today'}</button><div class="form-divider"></div><span class="form-help">Complete receipts, batches, damage, dispatches and returns before closing.</span></section></div>
      <div class="panel table-panel"><div class="panel-header"><h2>Today's balance ledger</h2><span>${e(dateLabel(today()))}</span></div>${table(['SKU', 'Opening', 'Produced', 'Damaged', 'Net sales', 'Closing', 'Status'], balanceRows, 'No daily balance has been closed yet. The first opening count will appear here.')}</div>`;
  }

  function downloadCsv(filename, rows) {
    const csv = rows.map((row) => row.map((cell) => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n');
    const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  }

  function reportHtml(report) {
    const balances = report.balances.map((item) => `<tr><td><strong>${e(item.skus?.name || 'SKU')}</strong></td><td>${num(item.opening_stock)}</td><td>${num(item.total_produced)}</td><td>${num(item.total_damaged)}</td><td>${num(item.total_sold)}</td><td class="number-cell">${num(item.closing_stock)}</td><td><span class="status-pill ${item.is_closed ? 'closed' : 'neutral'}">${item.is_closed ? 'Closed' : 'Open'}</span></td></tr>`);
    const batches = report.batches.map((item) => {
      const damaged = (item.stage_damages || []).reduce((sum, row) => sum + row.quantity_damaged, 0);
      const efficiency = item.expected_yield ? `${num(item.actual_yield / item.expected_yield * 100, 1)}%` : '—';
      return `<tr><td><strong>${e(item.skus?.name || 'SKU')}</strong></td><td>${num(item.bags_used)}</td><td>${num(item.expected_yield)}</td><td>${num(item.actual_yield)}</td><td>${num(damaged)}</td><td>${num(item.actual_yield - damaged)}</td><td>${efficiency}</td></tr>`;
    });
    const damages = report.batches.flatMap((batch) => (batch.stage_damages || []).map((damage) => `<tr><td><strong>${e(batch.skus?.name || 'SKU')}</strong></td><td>${e(stageLabels[damage.stage_name] || damage.stage_name)}</td><td>${num(damage.quantity_damaged)}</td><td>${e(damage.reason)}</td></tr>`));
    const dispatches = report.dispatches.map((item) => `<tr><td><strong>${e(item.sales_rep_name)}</strong></td><td>${e(item.skus?.name || 'SKU')}</td><td>${num(item.units_issued)}</td><td>${num(item.units_returned)}</td><td>${num(item.units_issued - item.units_returned)}</td></tr>`);
    return `<div class="panel table-panel mb-3"><div class="panel-header"><h2>Stock reconciliation</h2><span>${e(dateLabel(report.date))}</span></div>${table(['SKU', 'Opening', 'Produced', 'Damaged', 'Net sales', 'Closing', 'Status'], balances, 'No closing balance for this date.')}</div><div class="panel table-panel mb-3"><div class="panel-header"><h2>Production & yield</h2><span>${num(report.batches.length)} batches</span></div>${table(['SKU', 'Bags', 'Expected', 'Actual', 'Damaged', 'Net output', 'Efficiency'], batches, 'No production batches for this date.')}</div><div class="panel table-panel mb-3"><div class="panel-header"><h2>Damage by stage</h2><span>${num(damages.length)} entries</span></div>${table(['SKU', 'Stage', 'Damaged', 'Reason'], damages, 'No stage damage entries for this date.')}</div><div class="panel table-panel"><div class="panel-header"><h2>Sales reconciliation</h2><span>${num(report.dispatches.length)} dispatches</span></div>${table(['Representative', 'SKU', 'Dispatched', 'Returned', 'Net sold'], dispatches, 'No dispatches for this date.')}</div>`;
  }

  let reportMode = 'daily';
  let reportStartDate = today();
  let reportEndDate = today();

  function rangeReportHtml(data) {
    const s = data.summary;
    const damages = data.stage_damages;
    const totalDmg = s.total_damaged || 0;
    const mixPct = totalDmg > 0 ? Math.round((damages.mixing_baking / totalDmg) * 100) : 0;
    const slicePct = totalDmg > 0 ? Math.round((damages.slicing_packaging / totalDmg) * 100) : 0;
    const distPct = totalDmg > 0 ? Math.max(0, 100 - mixPct - slicePct) : 0;

    const cards = [
      metric('Total Flour Used', `${num(s.total_bags)} bags`, 'Consumed across batches', 'bi-box-seam'),
      metric('Total Output Baked', `${num(s.total_produced)}`, `Standard: ${num(s.total_expected)} loaves`, 'bi-gear-wide-connected', 'orange'),
      metric('Stage Damage', `${num(s.total_damaged)} loaves`, `Loss rate: ${num(s.damage_rate, 1)}% of output`, 'bi-exclamation-triangle', 'gold'),
      metric('Total Net Sold', `${num(s.total_net_sold)} loaves`, `Dispatched: ${num(s.total_dispatched)} · Ret: ${num(s.total_returned)}`, 'bi-truck', 'blue'),
    ].join('');

    const batchRows = data.batches.map((b) => `<tr><td>${e(dateLabel(b.produced_on))}</td><td><strong>${e(b.skus?.name || 'SKU')}</strong></td><td>${num(b.bags_used)} bag${b.bags_used === 1 ? '' : 's'}</td><td>${num(b.expected_yield)}</td><td class="number-cell">${num(b.actual_yield)}</td></tr>`);
    const dispatchRows = data.dispatches.map((d) => `<tr><td>${e(dateLabel(d.dispatch_date))}</td><td><strong>${e(d.sales_rep_name)}</strong></td><td>${e(d.skus?.name || 'SKU')}</td><td>${num(d.units_issued)}</td><td>${num(d.units_returned)}</td><td class="number-cell">${num(d.units_issued - d.units_returned)}</td></tr>`);

    return `
      <div class="metric-grid mb-3">${cards}</div>
      <div class="panel mb-3 p-3">
        <h3 class="h6 mb-2 text-uppercase fw-bold text-muted">Loss & Damage Stage Breakdown</h3>
        <p class="small text-muted mb-2">Identify where bakery shrinkage is occurring across the production stages.</p>
        <div class="damage-bar-wrap">
          <div class="damage-bar-segment mixing" style="width: ${mixPct}%" title="Mixing/Baking: ${mixPct}%"></div>
          <div class="damage-bar-segment slicing" style="width: ${slicePct}%" title="Slicing/Packaging: ${slicePct}%"></div>
          <div class="damage-bar-segment distribution" style="width: ${distPct}%" title="Distribution: ${distPct}%"></div>
        </div>
        <div class="d-flex flex-wrap gap-4 mt-2 font-monospace small">
          <span><i class="bi bi-circle-fill text-warning me-1"></i> Mixing & Baking: <strong>${num(damages.mixing_baking)} (${mixPct}%)</strong></span>
          <span><i class="bi bi-circle-fill text-secondary me-1" style="color:#f39c12!important"></i> Slicing & Packaging: <strong>${num(damages.slicing_packaging)} (${slicePct}%)</strong></span>
          <span><i class="bi bi-circle-fill text-danger me-1"></i> Distribution: <strong>${num(damages.distribution)} (${distPct}%)</strong></span>
        </div>
      </div>
      <div class="panel table-panel mb-3">
        <div class="panel-header"><h2>Batches in period</h2><span>${num(data.batches.length)} batches</span></div>
        ${table(['Date', 'SKU', 'Flour Used', 'Expected Output', 'Actual Output'], batchRows, 'No batches in this date range.')}
      </div>
      <div class="panel table-panel">
        <div class="panel-header"><h2>Sales dispatches in period</h2><span>${num(data.dispatches.length)} dispatches</span></div>
        ${table(['Date', 'Representative', 'SKU', 'Issued', 'Returned', 'Net Sold'], dispatchRows, 'No dispatches in this date range.')}
      </div>
    `;
  }

  async function renderReports() {
    root.innerHTML = `${heading('MANAGEMENT REPORTS', 'Bakery Reports', 'Review daily stock ledgers, or select a date range for period summaries and damage analytics.', '')}
      <div class="report-toggle-bar">
        <button type="button" class="report-toggle-btn ${reportMode === 'daily' ? 'active' : ''}" data-report-mode="daily">Daily View</button>
        <button type="button" class="report-toggle-btn ${reportMode === 'range' ? 'active' : ''}" data-report-mode="range">Date Range (Weekly / Monthly)</button>
      </div>
      <div class="panel mb-3">
        <div class="report-toolbar">
          ${reportMode === 'daily' ? `
            <div>
              <div class="section-label">REPORT DATE</div>
              <div class="form-field"><input class="field-control" id="reportDate" type="date" value="${e(root.dataset.reportDate || today())}"></div>
            </div>
            <div class="d-flex gap-2">
              <button class="form-submit secondary" type="button" data-load-report><i class="bi bi-arrow-repeat"></i> Load date</button>
              <button class="form-submit" type="button" data-export-report><i class="bi bi-download"></i> Export CSV</button>
            </div>
          ` : `
            <div class="d-flex flex-wrap gap-3 align-items-center">
              <div>
                <div class="section-label">START DATE</div>
                <div class="form-field"><input class="field-control" id="reportStartDate" type="date" value="${e(reportStartDate)}"></div>
              </div>
              <div>
                <div class="section-label">END DATE</div>
                <div class="form-field"><input class="field-control" id="reportEndDate" type="date" value="${e(reportEndDate)}"></div>
              </div>
            </div>
            <div class="d-flex gap-2 align-items-end">
              <button class="form-submit secondary" type="button" data-load-range><i class="bi bi-funnel"></i> Generate Range</button>
              <button class="form-submit" type="button" data-export-range><i class="bi bi-download"></i> Export CSV</button>
            </div>
          `}
        </div>
        <div class="p-3" id="reportContent">
          <div class="empty-state"><i class="bi bi-arrow-repeat"></i> Loading report data…</div>
        </div>
      </div>`;

    if (reportMode === 'daily') {
      const report = await dailyData(root.dataset.reportDate || today());
      root.dataset.reportDate = report.date;
      root.querySelector('#reportContent').innerHTML = reportHtml(report);
    } else {
      await loadRangeReport();
    }
  }

  async function loadRangeReport() {
    const start = document.querySelector('#reportStartDate')?.value || reportStartDate;
    const end = document.querySelector('#reportEndDate')?.value || reportEndDate;
    reportStartDate = start;
    reportEndDate = end;
    const data = await api(`/reports/range?start_date=${encodeURIComponent(start)}&end_date=${encodeURIComponent(end)}`);
    root.querySelector('#reportContent').innerHTML = rangeReportHtml(data);
    showNotice(`Loaded summary from ${dateLabel(start)} to ${dateLabel(end)}.`);
  }

  async function exportRangeReport() {
    const start = document.querySelector('#reportStartDate')?.value || reportStartDate;
    const end = document.querySelector('#reportEndDate')?.value || reportEndDate;
    const data = await api(`/reports/range?start_date=${encodeURIComponent(start)}&end_date=${encodeURIComponent(end)}`);
    const rows = [
      ['UI Bakery Range Report', `From: ${data.start_date}`, `To: ${data.end_date}`],
      [],
      ['METRIC', 'VALUE'],
      ['Total Flour Used (Bags)', data.summary.total_bags],
      ['Total Loaves Produced', data.summary.total_produced],
      ['Expected Yield', data.summary.total_expected],
      ['Efficiency Rate (%)', num(data.summary.efficiency_rate, 1)],
      ['Total Stage Damage', data.summary.total_damaged],
      ['Damage Rate (%)', num(data.summary.damage_rate, 1)],
      ['Total Dispatched', data.summary.total_dispatched],
      ['Total Returned', data.summary.total_returned],
      ['Total Net Sold', data.summary.total_net_sold],
      [],
      ['STAGE LOSS BREAKDOWN', 'LOAVES'],
      ['Mixing & Baking', data.stage_damages.mixing_baking],
      ['Slicing & Packaging', data.stage_damages.slicing_packaging],
      ['Distribution', data.stage_damages.distribution],
      [],
      ['BATCH REGISTER'],
      ['Date', 'SKU', 'Flour Used', 'Expected Output', 'Actual Output'],
    ];
    data.batches.forEach((b) => {
      rows.push([b.produced_on, b.skus?.name || 'SKU', b.bags_used, b.expected_yield, b.actual_yield]);
    });
    rows.push([]);
    rows.push(['SALES DISPATCH REGISTER']);
    rows.push(['Date', 'Sales Representative', 'SKU', 'Issued', 'Returned', 'Net Sold']);
    data.dispatches.forEach((d) => {
      rows.push([d.dispatch_date, d.sales_rep_name, d.skus?.name || 'SKU', d.units_issued, d.units_returned, d.units_issued - d.units_returned]);
    });
    downloadCsv(`ui-bakery-range-${data.start_date}-to-${data.end_date}.csv`, rows);
    showNotice('Date range report CSV downloaded.');
  }

  async function loadReportForDate() {
    const date = document.querySelector('#reportDate').value;
    if (!date) return showNotice('Choose a report date first.', 'error');
    const report = await dailyData(date);
    root.querySelector('#reportContent').innerHTML = reportHtml(report);
    root.dataset.reportDate = report.date;
    showNotice(`Loaded report for ${dateLabel(report.date)}.`);
  }

  async function exportCurrentReport() {
    const report = await dailyData(root.dataset.reportDate || today());
    const rows = [['Date', 'SKU', 'Opening stock', 'Actual output', 'Damaged', 'Net sold', 'Closing stock', 'Status']];
    report.balances.forEach((item) => rows.push([
      report.date, item.skus?.name || '', item.opening_stock, item.total_produced,
      item.total_damaged, item.total_sold, item.closing_stock, item.is_closed ? 'Closed' : 'Open',
    ]));
    if (!report.balances.length) rows.push([report.date, 'No balance has been closed for this date']);
    downloadCsv(`ui-bakery-stock-${report.date}.csv`, rows);
    showNotice('Daily stock CSV downloaded.');
  }

  async function renderTeam() {
    const [usersData, skuData] = await Promise.all([api('/admin/users'), api('/skus')]);
    const users = usersData.users;
    const skus = skuData.skus;
    const userRows = users.map((user) => {
      const isSelf = user.id === profile.id;
      const toggleBtn = isSelf ? '' : `
        <button type="button" class="btn ${user.active ? 'btn-outline-danger' : 'btn-outline-success'} btn-sm rounded-pill py-0 px-2" data-toggle-user-id="${e(user.id)}" data-active="${user.active ? 'false' : 'true'}" title="${user.active ? 'Deactivate staff account' : 'Activate staff account'}">
          <i class="bi ${user.active ? 'bi-person-x' : 'bi-person-check'}"></i> ${user.active ? 'Deactivate' : 'Activate'}
        </button>
      `;
      return `
        <tr>
          <td><strong>${e(user.full_name)}</strong></td>
          <td><code>${e(user.email || '—')}</code></td>
          <td><span class="status-pill ${user.role === 'admin' ? '' : 'neutral'}">${e(labels[user.role] || user.role)}</span></td>
          <td><span class="status-pill ${user.active ? '' : 'warning'}">${user.active ? 'Active' : 'Inactive'}</span></td>
          <td>${e(dateLabel(user.created_at?.slice(0, 10)))}</td>
          <td>
            <div class="d-flex gap-1">
              <button type="button" class="btn btn-outline-secondary btn-sm rounded-pill py-0 px-2" data-reset-user-id="${e(user.id)}" data-user-name="${e(user.full_name)}">
                <i class="bi bi-key"></i> Reset password
              </button>
              ${toggleBtn}
            </div>
          </td>
        </tr>
      `;
    });
    const skuRows = skus.map((sku) => `
      <tr>
        <td><strong>${e(sku.name)}</strong></td>
        <td>${num(sku.weight_grams)}g</td>
        <td>${num(sku.standard_yield_per_bag)} loaves</td>
        <td><span class="status-pill ${sku.active ? '' : 'warning'}">${sku.active ? 'Active' : 'Archived'}</span></td>
        <td>
          <button type="button" class="btn btn-outline-secondary btn-sm rounded-pill py-0 px-2" data-edit-sku='${JSON.stringify(sku).replace(/'/g, '&#39;')}'>
            <i class="bi bi-pencil"></i> Edit
          </button>
        </td>
      </tr>
    `);
    const passwordBox = temporaryPassword ? `<div class="password-reveal mt-3"><strong>Auto-generated password (copy and share with staff):</strong><span>${e(temporaryPassword)}</span><button type="button" class="form-submit secondary mt-2" data-copy-password><i class="bi bi-clipboard"></i> Copy password</button></div>` : '';
    root.innerHTML = `${heading('ADMINISTRATION', 'Users & SKUs', 'Give each staff member a role and password, and configure the product standards used by yield calculations.', '')}
      <div class="panel-grid"><section class="panel form-panel"><h2>Create a staff account</h2><p>Assign a role and set their password. If you leave the password blank, one will be generated automatically.</p><form data-form="user" class="form-grid"><div class="form-field"><label>Full name</label><input name="full_name" required maxlength="100" placeholder="e.g. John Doe"></div><div class="form-field"><label>Work email</label><input name="email" type="email" required maxlength="254" placeholder="john@uibakery.edu.ng"></div><div class="form-field"><label>Role</label><select name="role" required><option value="store_officer">Store Officer</option><option value="production_supervisor">Production Supervisor</option><option value="sales_officer">Sales Officer</option><option value="admin">Administrator</option></select></div><div class="form-field"><label>Assign password</label><input name="password" type="text" minlength="8" maxlength="128" placeholder="e.g. StaffPass2026! (or leave blank)"></div><div class="form-field full"><button class="form-submit" type="submit"><i class="bi bi-person-plus"></i> Create staff account</button></div></form>${passwordBox}</section>
      <section class="panel form-panel"><h2>Add a product SKU</h2><p>Set the loaf size and the bakery's standard yield per flour bag.</p><form data-form="sku" class="form-grid"><div class="form-field full"><label>SKU name</label><input name="name" required maxlength="80" placeholder="e.g. Standard loaf"></div><div class="form-field"><label>Loaf weight (grams)</label><input name="weight_grams" type="number" min="1" step="1" required placeholder="1000"></div><div class="form-field"><label>Standard yield per bag</label><input name="standard_yield_per_bag" type="number" min="1" step="1" required placeholder="Set from recipe"></div><div class="form-field full"><span class="form-help">Use the bakery's measured recipe standard. The report's 500g / 1,000g / 2,000g yields are illustrative examples.</span></div><div class="form-field full"><button class="form-submit" type="submit"><i class="bi bi-plus-circle"></i> Add SKU</button></div></form></section></div>
      <div class="panel table-panel mb-3"><div class="panel-header"><h2>Staff accounts</h2><span>${num(users.length)} people</span></div>${table(['Staff member', 'Email', 'Role', 'Status', 'Added', 'Actions'], userRows, 'No staff accounts found.')}</div>
      <div class="panel table-panel"><div class="panel-header"><h2>Product SKUs</h2><span>${num(skus.length)} active products</span></div>${table(['Product', 'Weight', 'Standard yield / bag', 'Status', 'Actions'], skuRows, 'Add SKUs before tracking production.')}</div>`;
  }

  async function renderAudit() {
    const data = await api('/admin/audit');
    const rows = data.logs.map((log) => {
      const details = Object.entries(log.details || {}).map(([key, value]) => `${key.replaceAll('_', ' ')}: ${typeof value === 'object' ? JSON.stringify(value) : value}`).join(' · ');
      return `<tr><td>${e(timeLabel(log.created_at))}</td><td><strong>${e(log.profile?.full_name || 'Staff account')}</strong></td><td><span class="audit-action">${e(log.action_performed.replaceAll('.', ' · '))}</span></td><td>${e(log.entity_type)}</td><td>${e(details || log.entity_id || '—')}</td></tr>`;
    });
    root.innerHTML = `${heading('ACCOUNTABILITY', 'Audit history', 'A time-stamped trail of critical inventory, production, sales and access changes.', '')}<div class="panel table-panel"><div class="panel-header"><h2>Recent actions</h2><span>Latest 150 entries</span></div>${table(['Time', 'Staff member', 'Action', 'Record', 'Details'], rows, 'Audit entries will appear as your team records activity.')}</div>`;
  }

  async function renderCurrentView() {
    renderNav();
    const label = navItems.find((item) => item.key === currentView)?.label || 'Overview';
    document.querySelector('#topbarSection').textContent = label;
    root.innerHTML = '<div class="panel"><div class="empty-state"><i class="bi bi-arrow-repeat"></i>Loading your workspace…</div></div>';
    const renderers = {
      overview: renderOverview,
      materials: renderMaterials,
      production: renderProduction,
      sales: renderSales,
      inventory: renderInventory,
      reports: renderReports,
      team: renderTeam,
      audit: renderAudit,
    };
    try {
      await renderers[currentView]();
    } catch (error) {
      root.innerHTML = `<div class="panel"><div class="empty-state"><i class="bi bi-exclamation-circle"></i>${e(error.message)}<br><button type="button" class="form-submit secondary mt-3" data-retry>Try again</button></div></div>`;
    }
  }

  function formValues(form) { return Object.fromEntries(new FormData(form).entries()); }
  function asNumber(value) { return Number(value); }

  function navigateTo(targetView, pushState = true) {
    if (!profile) return;
    const available = navItems.filter((item) => item.roles.includes(profile.role));
    if (!available.some((item) => item.key === targetView)) {
      targetView = 'overview';
    }
    currentView = targetView;
    if (pushState) {
      const url = targetView === 'overview' ? '/app' : `/${targetView}`;
      window.history.pushState({ view: targetView }, '', url);
    }
    const sidebar = document.querySelector('#appSidebar');
    if (sidebar) sidebar.classList.remove('open');
    renderCurrentView();
  }

  function getViewFromUrl() {
    const path = window.location.pathname.replace(/^\//, '').toLowerCase();
    const hash = window.location.hash.replace(/^#\/?/, '').toLowerCase();
    const slug = path || hash;
    if (slug && slug !== 'app' && slug !== 'dashboard') {
      const found = navItems.find((item) => item.key === slug);
      if (found && profile && found.roles.includes(profile.role)) {
        return found.key;
      }
    }
    return 'overview';
  }

  document.addEventListener('click', (event) => {
    const viewButton = event.target.closest('[data-view]');
    if (viewButton) {
      event.preventDefault();
      navigateTo(viewButton.dataset.view);
    }
  });

  root.addEventListener('click', async (event) => {
    if (event.target.closest('[data-add-issue-row]')) {
      const materialsData = await api('/materials');
      document.querySelector('#issueRows').insertAdjacentHTML('beforeend', materialIssueRows(materialsData.materials, 1));
    }
    if (event.target.closest('[data-remove-row]')) {
      const lines = document.querySelectorAll('.issue-line');
      if (lines.length > 1) event.target.closest('.issue-line').remove();
    }
    if (event.target.closest('[data-close-day]')) {
      if (!window.confirm(`Close inventory for ${dateLabel(today())}? New production, damage, dispatch and return entries for this date will be blocked.`)) return;
      const button = event.target.closest('[data-close-day]');
      button.disabled = true;
      try {
        const result = await api('/admin/close-day', { method: 'POST', body: JSON.stringify({ date: today() }) });
        showNotice(result.message);
        await renderCurrentView();
      } catch (error) { button.disabled = false; showNotice(error.message, 'error'); }
    }
    if (event.target.closest('[data-load-report]')) {
      try { await loadReportForDate(); } catch (error) { showNotice(error.message, 'error'); }
    }
    if (event.target.closest('[data-export-report]')) {
      try { await exportCurrentReport(); } catch (error) { showNotice(error.message, 'error'); }
    }
    if (event.target.closest('[data-copy-password]')) {
      try { await navigator.clipboard.writeText(temporaryPassword); showNotice('Temporary password copied.'); }
      catch { showNotice('Select and copy the displayed password.', 'error'); }
    }
    if (event.target.closest('[data-reset-user-id]')) {
      const button = event.target.closest('[data-reset-user-id]');
      const userId = button.dataset.resetUserId;
      const userName = button.dataset.userName;
      const newPassword = window.prompt(`Set new password for ${userName} (minimum 8 characters):`);
      if (newPassword !== null) {
        if (newPassword.trim().length < 8) {
          showNotice('Password must be at least 8 characters.', 'error');
        } else {
          try {
            const res = await api(`/admin/users/${userId}/password`, {
              method: 'POST',
              body: JSON.stringify({ password: newPassword.trim() }),
            });
            showNotice(res.message || `Password updated for ${userName}.`);
          } catch (err) {
            showNotice(err.message, 'error');
          }
        }
      }
    }
    if (event.target.closest('[data-print-waybill]')) {
      const item = JSON.parse(event.target.closest('[data-print-waybill]').dataset.printWaybill);
      showWaybill(item);
    }
    if (event.target.closest('[data-edit-material]')) {
      const item = JSON.parse(event.target.closest('[data-edit-material]').dataset.editMaterial);
      showEditMaterial(item);
    }
    if (event.target.closest('[data-edit-sku]')) {
      const item = JSON.parse(event.target.closest('[data-edit-sku]').dataset.editSku);
      showEditSku(item);
    }
    if (event.target.closest('[data-toggle-user-id]')) {
      const button = event.target.closest('[data-toggle-user-id]');
      const userId = button.dataset.toggleUserId;
      const newActive = button.dataset.active === 'true';
      if (!window.confirm(`${newActive ? 'Activate' : 'Deactivate'} this staff member?`)) return;
      button.disabled = true;
      try {
        const res = await api(`/admin/users/${userId}/role`, {
          method: 'POST',
          body: JSON.stringify({ active: newActive }),
        });
        showNotice(res.message);
        await renderCurrentView();
      } catch (err) {
        button.disabled = false;
        showNotice(err.message, 'error');
      }
    }
    if (event.target.closest('[data-report-mode]')) {
      reportMode = event.target.closest('[data-report-mode]').dataset.reportMode;
      renderReports();
    }
    if (event.target.closest('[data-load-range]')) {
      try { await loadRangeReport(); } catch (err) { showNotice(err.message, 'error'); }
    }
    if (event.target.closest('[data-export-range]')) {
      try { await exportRangeReport(); } catch (err) { showNotice(err.message, 'error'); }
    }
    if (event.target.closest('[data-retry]')) renderCurrentView();
  });

  root.addEventListener('submit', async (event) => {
    const form = event.target.closest('form[data-form]');
    if (!form) return;
    event.preventDefault();
    if (!form.reportValidity()) return;
    const submit = form.querySelector('[type="submit"]');
    const originalText = submit?.textContent || '';
    if (submit) { submit.disabled = true; submit.textContent = 'Saving…'; }
    try {
      let result;
      const values = formValues(form);
      switch (form.dataset.form) {
        case 'receipt':
          result = await api('/materials/receive', { method: 'POST', body: JSON.stringify({ material_id: values.material_id, quantity: asNumber(values.quantity), note: values.note || '' }) });
          break;
        case 'issue': {
          const rows = [...form.querySelectorAll('.issue-line')].map((line) => ({
            material_id: line.querySelector('[name="material_id"]').value,
            quantity: asNumber(line.querySelector('[name="quantity"]').value),
          }));
          result = await api('/materials/issue', { method: 'POST', body: JSON.stringify({ items: rows, note: values.note || '' }) });
          break;
        }
        case 'material-create':
          result = await api('/admin/materials', { method: 'POST', body: JSON.stringify({ name: values.name, unit: values.unit, reorder_level: asNumber(values.reorder_level) }) });
          break;
        case 'batch':
          result = await api('/production/batches', { method: 'POST', body: JSON.stringify({ sku_id: values.sku_id, issue_id: values.issue_id, bags_used: asNumber(values.bags_used), actual_yield: asNumber(values.actual_yield), produced_on: values.produced_on }) });
          break;
        case 'damage':
          result = await api('/production/damages', { method: 'POST', body: JSON.stringify({ batch_id: values.batch_id, stage_name: values.stage_name, quantity_damaged: asNumber(values.quantity_damaged), reason: values.reason }) });
          break;
        case 'dispatch':
          result = await api('/sales/dispatches', { method: 'POST', body: JSON.stringify({ sku_id: values.sku_id, sales_rep_name: values.sales_rep_name, units_issued: asNumber(values.units_issued), dispatch_date: values.dispatch_date }) });
          break;
        case 'return':
          result = await api('/sales/returns', { method: 'POST', body: JSON.stringify({ dispatch_id: values.dispatch_id, units_returned: asNumber(values.units_returned) }) });
          break;
        case 'opening':
          result = await api('/inventory/opening', { method: 'POST', body: JSON.stringify({ sku_id: values.sku_id, opening_stock: asNumber(values.opening_stock), balance_date: values.balance_date }) });
          break;
        case 'sku':
          result = await api('/admin/skus', { method: 'POST', body: JSON.stringify({ name: values.name, weight_grams: asNumber(values.weight_grams), standard_yield_per_bag: asNumber(values.standard_yield_per_bag) }) });
          break;
        case 'user':
          result = await api('/admin/users', { method: 'POST', body: JSON.stringify(values) });
          temporaryPassword = result.temporary_password || '';
          break;
        default: throw new Error('Unknown form.');
      }
      showNotice(result.message || 'Saved successfully.');
      await renderCurrentView();
    } catch (error) {
      showNotice(error.message, 'error');
      if (submit) { submit.disabled = false; submit.textContent = originalText; }
    }
  });

  document.querySelector('#signOutButton').addEventListener('click', clearSession);
  const passwordDialog = document.querySelector('#passwordDialog');
  document.querySelector('#updatePasswordButton').addEventListener('click', () => passwordDialog.showModal());
  document.querySelectorAll('[data-close-password]').forEach((button) => button.addEventListener('click', () => passwordDialog.close()));
  document.querySelector('#passwordForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.reportValidity()) return;
    const passwordField = form.querySelector('#newPassword');
    const confirmation = form.querySelector('#confirmPassword');
    const message = form.querySelector('#passwordMessage');
    message.textContent = '';
    if (passwordField.value !== confirmation.value) {
      message.textContent = 'The passwords do not match.';
      return;
    }
    const button = form.querySelector('[type="submit"]');
    button.disabled = true;
    try {
      const result = await api('/auth/password', { method: 'POST', body: JSON.stringify({ password: passwordField.value }) });
      form.reset();
      passwordDialog.close();
      showNotice(result.message);
    } catch (error) { message.textContent = error.message; }
    finally { button.disabled = false; }
  });
  document.querySelector('#mobileNavToggle').addEventListener('click', () => document.querySelector('#appSidebar').classList.toggle('open'));
  document.addEventListener('click', (event) => {
    const sidebar = document.querySelector('#appSidebar');
    if (window.innerWidth <= 767 && sidebar.classList.contains('open') && !sidebar.contains(event.target) && !event.target.closest('#mobileNavToggle')) sidebar.classList.remove('open');
  });

  function showWaybill(item) {
    const modal = document.querySelector('#waybillDialog');
    const container = document.querySelector('#printableWaybill');
    const netSold = item.units_issued - item.units_returned;
    container.innerHTML = `
      <div class="waybill-card">
        <div class="waybill-header">
          <div class="d-flex justify-content-between align-items-center">
            <div>
              <small class="text-uppercase fw-bold text-muted" style="letter-spacing:0.05em">UI BAKERY INVENTORY</small>
              <h3 class="mb-0">Official Dispatch Slip & Waybill</h3>
            </div>
            <div class="text-end font-monospace small">
              <div><strong>REF:</strong> DSP-${(item.id || '').slice(0, 8).toUpperCase()}</div>
              <div><strong>DATE:</strong> ${e(item.dispatch_date || today())}</div>
            </div>
          </div>
        </div>
        <div class="waybill-grid">
          <div><span class="text-muted small">Sales Representative:</span><br><strong>${e(item.sales_rep_name)}</strong></div>
          <div><span class="text-muted small">Product SKU:</span><br><strong>${e(item.sku?.name || 'Bread SKU')}</strong></div>
          <div><span class="text-muted small">Loaves Dispatched:</span><br><strong class="fs-5">${num(item.units_issued)} loaves</strong></div>
          <div><span class="text-muted small">Unsold Returns:</span><br><strong>${num(item.units_returned)} loaves</strong></div>
          <div><span class="text-muted small">Net Sold / Accountable:</span><br><strong class="fs-5 text-success">${num(netSold)} loaves</strong></div>
          <div><span class="text-muted small">Reconciliation Status:</span><br><span class="status-pill ${item.units_returned >= item.units_issued ? 'neutral' : ''}">${item.units_returned >= item.units_issued ? 'Fully Reconciled' : 'In Custody / Out for Sales'}</span></div>
        </div>
        <div class="waybill-signatures">
          <div>
            <div class="text-muted small">Handed Over By (Sales Officer):</div>
            <div class="sig-line">Signature & Date</div>
          </div>
          <div>
            <div class="text-muted small">Received In Good Order (Representative):</div>
            <div class="sig-line">Signature & Date</div>
          </div>
        </div>
      </div>
    `;
    modal.showModal();
  }

  function showEditMaterial(item) {
    const modal = document.querySelector('#editItemDialog');
    document.querySelector('#editItemOverline').textContent = 'RAW MATERIAL SETTINGS';
    document.querySelector('#editItemTitle').textContent = `Edit ${item.name}`;
    const fields = document.querySelector('#editItemFields');
    fields.innerHTML = `
      <input type="hidden" name="type" value="material">
      <input type="hidden" name="id" value="${e(item.id)}">
      <div class="form-field full"><label>Material Name</label><input name="name" required maxlength="80" value="${e(item.name)}"></div>
      <div class="form-field"><label>Unit</label><input name="unit" required maxlength="24" value="${e(item.unit)}"></div>
      <div class="form-field"><label>Reorder Level</label><input name="reorder_level" type="number" min="0" step="0.001" required value="${e(item.reorder_level)}"></div>
      <div class="form-field full"><label>Status</label><select name="active"><option value="true" ${item.active ? 'selected' : ''}>Active</option><option value="false" ${!item.active ? 'selected' : ''}>Archived / Inactive</option></select></div>
    `;
    modal.showModal();
  }

  function showEditSku(sku) {
    const modal = document.querySelector('#editItemDialog');
    document.querySelector('#editItemOverline').textContent = 'PRODUCT SKU SETTINGS';
    document.querySelector('#editItemTitle').textContent = `Edit ${sku.name}`;
    const fields = document.querySelector('#editItemFields');
    fields.innerHTML = `
      <input type="hidden" name="type" value="sku">
      <input type="hidden" name="id" value="${e(sku.id)}">
      <div class="form-field full"><label>SKU Name</label><input name="name" required maxlength="80" value="${e(sku.name)}"></div>
      <div class="form-field"><label>Loaf Weight (grams)</label><input name="weight_grams" type="number" min="1" step="1" required value="${e(sku.weight_grams)}"></div>
      <div class="form-field"><label>Standard Yield / Bag</label><input name="standard_yield_per_bag" type="number" min="1" step="1" required value="${e(sku.standard_yield_per_bag)}"></div>
      <div class="form-field full"><label>Status</label><select name="active"><option value="true" ${sku.active ? 'selected' : ''}>Active</option><option value="false" ${!sku.active ? 'selected' : ''}>Archived / Inactive</option></select></div>
    `;
    modal.showModal();
  }

  const waybillDialog = document.querySelector('#waybillDialog');
  const editItemDialog = document.querySelector('#editItemDialog');
  document.querySelectorAll('[data-close-waybill]').forEach((b) => b.addEventListener('click', () => waybillDialog.close()));
  document.querySelectorAll('[data-close-edit]').forEach((b) => b.addEventListener('click', () => editItemDialog.close()));
  document.querySelector('#printWaybillBtn')?.addEventListener('click', () => window.print());

  document.querySelector('#editItemForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    if (!form.reportValidity()) return;
    const values = formValues(form);
    const submit = form.querySelector('[type="submit"]');
    submit.disabled = true;
    try {
      if (values.type === 'material') {
        const res = await api(`/admin/materials/${values.id}`, {
          method: 'PATCH',
          body: JSON.stringify({
            name: values.name,
            unit: values.unit,
            reorder_level: asNumber(values.reorder_level),
            active: values.active === 'true',
          }),
        });
        showNotice(res.message);
      } else if (values.type === 'sku') {
        const res = await api(`/admin/skus/${values.id}`, {
          method: 'PATCH',
          body: JSON.stringify({
            name: values.name,
            weight_grams: asNumber(values.weight_grams),
            standard_yield_per_bag: asNumber(values.standard_yield_per_bag),
            active: values.active === 'true',
          }),
        });
        showNotice(res.message);
      }
      editItemDialog.close();
      await renderCurrentView();
    } catch (err) {
      showNotice(err.message, 'error');
    } finally {
      submit.disabled = false;
    }
  });

  async function boot() {
    document.querySelector('#topbarDate').textContent = new Intl.DateTimeFormat('en-NG', { dateStyle: 'medium', timeZone: 'Africa/Lagos' }).format(new Date());
    if (!token()) return clearSession();
    try {
      const response = await api('/auth/me');
      profile = response.profile;
      document.querySelector('#profileName').textContent = profile.full_name;
      document.querySelector('#profileRole').textContent = roleName();
      document.querySelector('#profileInitial').textContent = (profile.full_name || 'U').trim().charAt(0).toUpperCase();
      currentView = getViewFromUrl();
      await renderCurrentView();
    } catch { clearSession(); }
  }

  window.addEventListener('popstate', (event) => {
    if (!profile) return;
    const view = event.state?.view || getViewFromUrl();
    navigateTo(view, false);
  });

  boot();
})();
