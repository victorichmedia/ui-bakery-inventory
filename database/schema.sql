-- UI Bakery Inventory schema for Supabase PostgreSQL.
-- Run once in the Supabase SQL Editor. Application writes go through Express RPC calls.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  role text not null check (role in ('admin', 'store_officer', 'production_supervisor', 'sales_officer')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.materials (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  unit text not null,
  quantity_on_hand numeric(14,3) not null default 0 check (quantity_on_hand >= 0),
  reorder_level numeric(14,3) not null default 0 check (reorder_level >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.skus (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  weight_grams integer not null check (weight_grams > 0),
  standard_yield_per_bag integer not null check (standard_yield_per_bag > 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.material_issues (
  id uuid primary key default gen_random_uuid(),
  issued_by uuid not null references public.profiles(id),
  note text not null default '',
  flour_consumed numeric(14,3) not null default 0 check (flour_consumed >= 0),
  issued_at timestamptz not null default now()
);

create table if not exists public.material_issue_items (
  id uuid primary key default gen_random_uuid(),
  issue_id uuid not null references public.material_issues(id) on delete cascade,
  material_id uuid not null references public.materials(id),
  quantity numeric(14,3) not null check (quantity > 0)
);

create table if not exists public.material_movements (
  id uuid primary key default gen_random_uuid(),
  material_id uuid not null references public.materials(id),
  movement_type text not null check (movement_type in ('receipt', 'issue')),
  quantity numeric(14,3) not null check (quantity > 0),
  issue_id uuid references public.material_issues(id),
  note text not null default '',
  recorded_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create table if not exists public.production_batches (
  id uuid primary key default gen_random_uuid(),
  sku_id uuid not null references public.skus(id),
  issue_id uuid not null references public.material_issues(id),
  bags_used integer not null check (bags_used > 0),
  expected_yield integer not null check (expected_yield > 0),
  actual_yield integer not null check (actual_yield >= 0),
  produced_on date not null default current_date,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create table if not exists public.stage_damages (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.production_batches(id),
  stage_name text not null check (stage_name in ('mixing_baking', 'slicing_packaging', 'distribution')),
  quantity_damaged integer not null check (quantity_damaged > 0),
  reason text not null,
  recorded_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create table if not exists public.sales_dispatches (
  id uuid primary key default gen_random_uuid(),
  sku_id uuid not null references public.skus(id),
  sales_rep_name text not null,
  units_issued integer not null check (units_issued > 0),
  units_returned integer not null default 0 check (units_returned >= 0 and units_returned <= units_issued),
  dispatch_date date not null default current_date,
  recorded_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create table if not exists public.inventory_balances (
  id uuid primary key default gen_random_uuid(),
  balance_date date not null,
  sku_id uuid not null references public.skus(id),
  opening_stock integer not null default 0 check (opening_stock >= 0),
  total_produced integer not null default 0 check (total_produced >= 0),
  total_damaged integer not null default 0 check (total_damaged >= 0),
  total_sold integer not null default 0 check (total_sold >= 0),
  closing_stock integer not null default 0 check (closing_stock >= 0),
  is_closed boolean not null default false,
  closed_by uuid references public.profiles(id),
  closed_at timestamptz,
  unique (balance_date, sku_id)
);

create table if not exists public.audit_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id),
  action_performed text not null,
  entity_type text not null,
  entity_id uuid,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists material_movements_material_date_idx on public.material_movements (material_id, created_at desc);
create index if not exists production_batches_date_sku_idx on public.production_batches (produced_on, sku_id);
create index if not exists stage_damages_batch_idx on public.stage_damages (batch_id);
create index if not exists sales_dispatches_date_sku_idx on public.sales_dispatches (dispatch_date, sku_id);
create index if not exists inventory_balances_date_idx on public.inventory_balances (balance_date desc);
create index if not exists audit_log_created_idx on public.audit_log (created_at desc);

alter table public.profiles enable row level security;
alter table public.materials enable row level security;
alter table public.skus enable row level security;
alter table public.material_issues enable row level security;
alter table public.material_issue_items enable row level security;
alter table public.material_movements enable row level security;
alter table public.production_batches enable row level security;
alter table public.stage_damages enable row level security;
alter table public.sales_dispatches enable row level security;
alter table public.inventory_balances enable row level security;
alter table public.audit_log enable row level security;

revoke all on public.profiles, public.materials, public.skus, public.material_issues,
  public.material_issue_items, public.material_movements, public.production_batches,
  public.stage_damages, public.sales_dispatches, public.inventory_balances,
  public.audit_log from anon, authenticated;
grant all on public.profiles, public.materials, public.skus, public.material_issues,
  public.material_issue_items, public.material_movements, public.production_batches,
  public.stage_damages, public.sales_dispatches, public.inventory_balances,
  public.audit_log to service_role;

create or replace function public.write_audit(
  _actor uuid, _action text, _entity text, _entity_id uuid, _details jsonb default '{}'::jsonb
) returns void language sql security definer set search_path = public as $$
  insert into public.audit_log (user_id, action_performed, entity_type, entity_id, details)
  values (_actor, _action, _entity, _entity_id, coalesce(_details, '{}'::jsonb));
$$;

create or replace function public.lock_inventory_date(_date date)
returns void language plpgsql security definer set search_path = public as $$
begin
  -- Coordinate entry and close-of-day work so two concurrent requests cannot oversell a SKU.
  perform pg_advisory_xact_lock(hashtext('ui-bakery-close-' || _date::text));
  if exists (select 1 from public.inventory_balances where balance_date >= _date and is_closed) then
    raise exception 'This date is closed or a later date has already been closed';
  end if;
  if exists (select 1 from public.inventory_balances where balance_date < _date and not is_closed) then
    raise exception 'Close the earlier inventory date before recording work for this date';
  end if;
  if exists (
    select 1 from public.production_batches p
    where p.produced_on < _date and not exists (
      select 1 from public.inventory_balances b where b.balance_date = p.produced_on and b.sku_id = p.sku_id and b.is_closed
    )
  ) or exists (
    select 1 from public.sales_dispatches d
    where d.dispatch_date < _date and not exists (
      select 1 from public.inventory_balances b where b.balance_date = d.dispatch_date and b.sku_id = d.sku_id and b.is_closed
    )
  ) then
    raise exception 'Close the earlier inventory date before recording work for this date';
  end if;
end;
$$;

create or replace function public.record_receipt(
  _material_id uuid, _quantity numeric, _note text, _actor uuid
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_movement uuid;
begin
  if _quantity <= 0 then raise exception 'Quantity must be greater than zero'; end if;
  update public.materials set quantity_on_hand = quantity_on_hand + _quantity, updated_at = now()
    where id = _material_id and active;
  if not found then raise exception 'Material was not found or is inactive'; end if;
  insert into public.material_movements (material_id, movement_type, quantity, note, recorded_by)
    values (_material_id, 'receipt', _quantity, coalesce(_note, ''), _actor) returning id into v_movement;
  perform public.write_audit(_actor, 'material.received', 'material_movement', v_movement,
    jsonb_build_object('material_id', _material_id, 'quantity', _quantity));
  return v_movement;
end;
$$;

create or replace function public.issue_materials(
  _items jsonb, _note text, _actor uuid
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_issue uuid;
  v_item jsonb;
  v_material uuid;
  v_quantity numeric;
  v_balance numeric;
begin
  if jsonb_typeof(_items) <> 'array' or jsonb_array_length(_items) = 0 then
    raise exception 'Add at least one material to the issue';
  end if;
  if nullif(trim(coalesce(_note, '')), '') is null then raise exception 'Enter the approved requisition reference'; end if;
  insert into public.material_issues (issued_by, note) values (_actor, coalesce(_note, '')) returning id into v_issue;
  for v_item in select value from jsonb_array_elements(_items) loop
    v_material := (v_item->>'material_id')::uuid;
    v_quantity := (v_item->>'quantity')::numeric;
    if v_quantity <= 0 then raise exception 'Issue quantities must be greater than zero'; end if;
    select quantity_on_hand into v_balance from public.materials where id = v_material and active for update;
    if not found then raise exception 'A selected material was not found or is inactive'; end if;
    if v_balance < v_quantity then raise exception 'Insufficient stock for material %', v_material; end if;
    update public.materials set quantity_on_hand = quantity_on_hand - v_quantity, updated_at = now() where id = v_material;
    insert into public.material_issue_items (issue_id, material_id, quantity) values (v_issue, v_material, v_quantity);
    insert into public.material_movements (material_id, movement_type, quantity, issue_id, note, recorded_by)
      values (v_material, 'issue', v_quantity, v_issue, coalesce(_note, ''), _actor);
  end loop;
  perform public.write_audit(_actor, 'material.issued', 'material_issue', v_issue,
    jsonb_build_object('items', _items));
  return v_issue;
end;
$$;

create or replace function public.create_production_batch(
  _sku_id uuid, _issue_id uuid, _bags_used integer, _actual_yield integer,
  _produced_on date, _actor uuid
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_yield_per_bag integer;
  v_expected integer;
  v_flour_quantity numeric;
  v_flour_consumed numeric;
  v_batch uuid;
begin
  if _bags_used <= 0 or _actual_yield < 0 then raise exception 'Enter valid production quantities'; end if;
  perform public.lock_inventory_date(_produced_on);
  select flour_consumed into v_flour_consumed from public.material_issues where id = _issue_id for update;
  if not found then raise exception 'Material issue was not found'; end if;
  select coalesce(sum(ii.quantity), 0) into v_flour_quantity
    from public.material_issue_items ii join public.materials m on m.id = ii.material_id
    where ii.issue_id = _issue_id and lower(m.name) = 'flour' and lower(m.unit) in ('bag', 'bags');
  if v_flour_quantity - v_flour_consumed < _bags_used then raise exception 'The selected issue does not have enough unallocated flour bags'; end if;
  select standard_yield_per_bag into v_yield_per_bag from public.skus where id = _sku_id and active;
  if not found then raise exception 'SKU was not found or is inactive'; end if;
  v_expected := _bags_used * v_yield_per_bag;
  insert into public.production_batches (sku_id, issue_id, bags_used, expected_yield, actual_yield, produced_on, created_by)
    values (_sku_id, _issue_id, _bags_used, v_expected, _actual_yield, _produced_on, _actor) returning id into v_batch;
  update public.material_issues set flour_consumed = flour_consumed + _bags_used where id = _issue_id;
  perform public.write_audit(_actor, 'production.batch_created', 'production_batch', v_batch,
    jsonb_build_object('sku_id', _sku_id, 'bags_used', _bags_used, 'expected_yield', v_expected, 'actual_yield', _actual_yield));
  return v_batch;
end;
$$;

create or replace function public.record_stage_damage(
  _batch_id uuid, _stage text, _quantity integer, _reason text, _actor uuid
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_date date; v_actual integer; v_existing integer; v_damage uuid;
  v_sku uuid; v_opening integer; v_produced integer; v_total_damaged integer; v_sold integer;
begin
  if _quantity <= 0 then raise exception 'Damage quantity must be greater than zero'; end if;
  if _stage not in ('mixing_baking', 'slicing_packaging', 'distribution') then raise exception 'Choose a valid production stage'; end if;
  select produced_on, actual_yield, sku_id into v_date, v_actual, v_sku from public.production_batches where id = _batch_id for update;
  if not found then raise exception 'Production batch was not found'; end if;
  perform public.lock_inventory_date(v_date);
  select coalesce(sum(quantity_damaged), 0) into v_existing from public.stage_damages where batch_id = _batch_id;
  if v_existing + _quantity > v_actual then raise exception 'Total damage cannot exceed the batch output'; end if;
  select closing_stock into v_opening from public.inventory_balances
    where sku_id = v_sku and balance_date < v_date and is_closed order by balance_date desc limit 1;
  if v_opening is null then select opening_stock into v_opening from public.inventory_balances where sku_id = v_sku and balance_date = v_date; end if;
  select coalesce(sum(actual_yield), 0) into v_produced from public.production_batches where sku_id = v_sku and produced_on = v_date;
  select coalesce(sum(d.quantity_damaged), 0) into v_total_damaged
    from public.stage_damages d join public.production_batches b on b.id = d.batch_id
    where b.sku_id = v_sku and b.produced_on = v_date;
  select coalesce(sum(units_issued - units_returned), 0) into v_sold
    from public.sales_dispatches where sku_id = v_sku and dispatch_date = v_date;
  if coalesce(v_opening, 0) + v_produced - v_total_damaged - _quantity - v_sold < 0 then
    raise exception 'This damage entry would make finished stock negative after dispatches';
  end if;
  insert into public.stage_damages (batch_id, stage_name, quantity_damaged, reason, recorded_by)
    values (_batch_id, _stage, _quantity, coalesce(nullif(trim(_reason), ''), 'Not specified'), _actor) returning id into v_damage;
  perform public.write_audit(_actor, 'production.damage_recorded', 'stage_damage', v_damage,
    jsonb_build_object('batch_id', _batch_id, 'stage', _stage, 'quantity', _quantity));
  return v_damage;
end;
$$;

create or replace function public.record_dispatch(
  _sku_id uuid, _rep text, _quantity integer, _dispatch_date date, _actor uuid
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_opening integer;
  v_produced integer;
  v_damaged integer;
  v_sold integer;
  v_available integer;
  v_dispatch uuid;
begin
  if _quantity <= 0 then raise exception 'Dispatch quantity must be greater than zero'; end if;
  perform public.lock_inventory_date(_dispatch_date);
  select closing_stock into v_opening from public.inventory_balances
    where sku_id = _sku_id and balance_date < _dispatch_date and is_closed order by balance_date desc limit 1;
  if v_opening is null then
    select opening_stock into v_opening from public.inventory_balances where sku_id = _sku_id and balance_date = _dispatch_date;
  end if;
  select coalesce(sum(actual_yield), 0) into v_produced from public.production_batches where sku_id = _sku_id and produced_on = _dispatch_date;
  select coalesce(sum(d.quantity_damaged), 0) into v_damaged
    from public.stage_damages d join public.production_batches b on b.id = d.batch_id
    where b.sku_id = _sku_id and b.produced_on = _dispatch_date;
  select coalesce(sum(units_issued - units_returned), 0) into v_sold from public.sales_dispatches where sku_id = _sku_id and dispatch_date = _dispatch_date;
  v_available := coalesce(v_opening, 0) + v_produced - v_damaged - v_sold;
  if v_available < _quantity then raise exception 'Only % finished units are currently available', greatest(v_available, 0); end if;
  insert into public.sales_dispatches (sku_id, sales_rep_name, units_issued, dispatch_date, recorded_by)
    values (_sku_id, trim(_rep), _quantity, _dispatch_date, _actor) returning id into v_dispatch;
  perform public.write_audit(_actor, 'sales.dispatched', 'sales_dispatch', v_dispatch,
    jsonb_build_object('sku_id', _sku_id, 'units_issued', _quantity, 'representative', _rep));
  return v_dispatch;
end;
$$;

create or replace function public.record_return(
  _dispatch_id uuid, _quantity integer, _actor uuid
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_issued integer; v_returned integer; v_date date; v_sku uuid; v_return uuid;
begin
  if _quantity <= 0 then raise exception 'Return quantity must be greater than zero'; end if;
  select units_issued, units_returned, dispatch_date, sku_id into v_issued, v_returned, v_date, v_sku
    from public.sales_dispatches where id = _dispatch_id for update;
  if not found then raise exception 'Dispatch was not found'; end if;
  perform public.lock_inventory_date(v_date);
  select units_issued, units_returned, dispatch_date, sku_id into v_issued, v_returned, v_date, v_sku
    from public.sales_dispatches where id = _dispatch_id for update;
  if v_returned + _quantity > v_issued then raise exception 'Returns cannot exceed the units dispatched'; end if;
  update public.sales_dispatches set units_returned = units_returned + _quantity where id = _dispatch_id;
  v_return := _dispatch_id;
  perform public.write_audit(_actor, 'sales.returned', 'sales_dispatch', v_return,
    jsonb_build_object('sku_id', v_sku, 'dispatch_id', _dispatch_id, 'units_returned', _quantity));
  return v_return;
end;
$$;

create or replace function public.set_opening_stock(
  _sku_id uuid, _date date, _quantity integer, _actor uuid
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if _quantity < 0 then raise exception 'Opening stock cannot be negative'; end if;
  perform public.lock_inventory_date(_date);
  if exists (select 1 from public.inventory_balances where sku_id = _sku_id and balance_date < _date) then raise exception 'This SKU already has a prior-day balance; its opening rolls forward automatically'; end if;
  if exists (select 1 from public.inventory_balances where balance_date = _date and is_closed) then raise exception 'This date is already closed'; end if;
  if exists (select 1 from public.production_batches where sku_id = _sku_id and produced_on = _date)
     or exists (select 1 from public.sales_dispatches where sku_id = _sku_id and dispatch_date = _date) then
    raise exception 'Opening stock must be entered before production or dispatch for the date';
  end if;
  insert into public.inventory_balances (balance_date, sku_id, opening_stock, closing_stock)
    values (_date, _sku_id, _quantity, _quantity)
    on conflict (balance_date, sku_id) do update set opening_stock = excluded.opening_stock, closing_stock = excluded.closing_stock
    where public.inventory_balances.is_closed = false returning id into v_id;
  if v_id is null then raise exception 'Could not set opening stock'; end if;
  perform public.write_audit(_actor, 'inventory.opening_set', 'inventory_balance', v_id,
    jsonb_build_object('sku_id', _sku_id, 'date', _date, 'quantity', _quantity));
  return v_id;
end;
$$;

create or replace function public.close_inventory_day(_date date, _actor uuid)
returns setof public.inventory_balances language plpgsql security definer set search_path = public as $$
declare
  v_sku record;
  v_opening integer;
  v_produced integer;
  v_damaged integer;
  v_sold integer;
  v_closing integer;
  v_balance public.inventory_balances%rowtype;
begin
  perform public.lock_inventory_date(_date);
  if exists (select 1 from public.inventory_balances where balance_date = _date and is_closed) then raise exception 'This date has already been closed'; end if;
  for v_sku in select id from public.skus where active loop
    select closing_stock into v_opening from public.inventory_balances
      where sku_id = v_sku.id and balance_date < _date and is_closed order by balance_date desc limit 1;
    if v_opening is null then
      select opening_stock into v_opening from public.inventory_balances where sku_id = v_sku.id and balance_date = _date;
    end if;
    if v_opening is null then raise exception 'Set an opening stock count for each new SKU before closing the day'; end if;
    select coalesce(sum(actual_yield), 0) into v_produced from public.production_batches where sku_id = v_sku.id and produced_on = _date;
    select coalesce(sum(d.quantity_damaged), 0) into v_damaged
      from public.stage_damages d join public.production_batches b on b.id = d.batch_id
      where b.sku_id = v_sku.id and b.produced_on = _date;
    select coalesce(sum(units_issued - units_returned), 0) into v_sold from public.sales_dispatches where sku_id = v_sku.id and dispatch_date = _date;
    v_closing := coalesce(v_opening, 0) + v_produced - v_damaged - v_sold;
    if v_closing < 0 then raise exception 'Calculated stock for SKU % would be negative', v_sku.id; end if;
    insert into public.inventory_balances (balance_date, sku_id, opening_stock, total_produced, total_damaged, total_sold, closing_stock, is_closed, closed_by, closed_at)
      values (_date, v_sku.id, coalesce(v_opening, 0), v_produced, v_damaged, v_sold, v_closing, true, _actor, now())
      on conflict (balance_date, sku_id) do update set total_produced = excluded.total_produced,
        total_damaged = excluded.total_damaged, total_sold = excluded.total_sold,
        closing_stock = excluded.closing_stock, is_closed = true, closed_by = excluded.closed_by, closed_at = excluded.closed_at
      returning * into v_balance;
    perform public.write_audit(_actor, 'inventory.day_closed', 'inventory_balance', v_balance.id,
      jsonb_build_object('date', _date, 'sku_id', v_sku.id, 'closing_stock', v_closing));
    return next v_balance;
  end loop;
end;
$$;

revoke all on function public.write_audit(uuid, text, text, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.lock_inventory_date(date) from public, anon, authenticated;
revoke all on function public.record_receipt(uuid, numeric, text, uuid) from public, anon, authenticated;
revoke all on function public.issue_materials(jsonb, text, uuid) from public, anon, authenticated;
revoke all on function public.create_production_batch(uuid, uuid, integer, integer, date, uuid) from public, anon, authenticated;
revoke all on function public.record_stage_damage(uuid, text, integer, text, uuid) from public, anon, authenticated;
revoke all on function public.record_dispatch(uuid, text, integer, date, uuid) from public, anon, authenticated;
revoke all on function public.record_return(uuid, integer, uuid) from public, anon, authenticated;
revoke all on function public.set_opening_stock(uuid, date, integer, uuid) from public, anon, authenticated;
revoke all on function public.close_inventory_day(date, uuid) from public, anon, authenticated;
grant execute on function public.record_receipt(uuid, numeric, text, uuid) to service_role;
grant execute on function public.issue_materials(jsonb, text, uuid) to service_role;
grant execute on function public.create_production_batch(uuid, uuid, integer, integer, date, uuid) to service_role;
grant execute on function public.record_stage_damage(uuid, text, integer, text, uuid) to service_role;
grant execute on function public.record_dispatch(uuid, text, integer, date, uuid) to service_role;
grant execute on function public.record_return(uuid, integer, uuid) to service_role;
grant execute on function public.set_opening_stock(uuid, date, integer, uuid) to service_role;
grant execute on function public.close_inventory_day(date, uuid) to service_role;
