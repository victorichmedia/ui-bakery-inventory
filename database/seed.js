require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const service = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function seed() {
  console.log('--- Starting UI Bakery database seed ---');

  // 1. Get admin user
  const { data: adminProfiles, error: pErr } = await service.from('profiles').select('*').eq('role', 'admin').limit(1);
  if (pErr || !adminProfiles?.length) {
    throw new Error('Admin profile not found. Please create an admin user first.');
  }
  const admin = adminProfiles[0];
  console.log(`Using admin: ${admin.full_name} (${admin.id})`);

  // 2. Insert Standard Materials if not exist
  const standardMaterials = [
    { name: 'Flour', unit: 'bag', reorder_level: 20 },
    { name: 'Granulated Sugar', unit: 'kg', reorder_level: 50 },
    { name: 'Instant Yeast', unit: 'kg', reorder_level: 10 },
    { name: 'Baking Margarine', unit: 'kg', reorder_level: 25 },
    { name: 'Fine Salt', unit: 'kg', reorder_level: 10 },
    { name: 'Packaging Nylon', unit: 'roll', reorder_level: 30 },
  ];

  const materialMap = new Map();
  for (const m of standardMaterials) {
    let { data: existing } = await service.from('materials').select('*').eq('name', m.name).maybeSingle();
    if (!existing) {
      const { data: created, error } = await service.from('materials').insert(m).select().single();
      if (error) console.error(`Error creating material ${m.name}:`, error.message);
      else {
        console.log(`+ Added material: ${created.name} (${created.unit})`);
        existing = created;
      }
    } else {
      console.log(`= Existing material: ${existing.name}`);
    }
    if (existing) materialMap.set(existing.name, existing);
  }

  // 3. Insert Standard SKUs if not exist
  const standardSkus = [
    { name: 'Standard Loaf (1000g)', weight_grams: 1000, standard_yield_per_bag: 250 },
    { name: 'Family Loaf (500g)', weight_grams: 500, standard_yield_per_bag: 500 },
    { name: 'Jumbo Loaf (2000g)', weight_grams: 2000, standard_yield_per_bag: 125 },
  ];

  const skuMap = new Map();
  for (const s of standardSkus) {
    let { data: existing } = await service.from('skus').select('*').eq('name', s.name).maybeSingle();
    if (!existing) {
      const { data: created, error } = await service.from('skus').insert(s).select().single();
      if (error) console.error(`Error creating SKU ${s.name}:`, error.message);
      else {
        console.log(`+ Added SKU: ${created.name} (${created.weight_grams}g)`);
        existing = created;
      }
    } else {
      console.log(`= Existing SKU: ${existing.name}`);
    }
    if (existing) skuMap.set(existing.name, existing);
  }

  // 4. Create Staff Accounts for Each Role if not exist
  const staffAccounts = [
    { email: 'store@uibakery.edu.ng', password: 'StoreOfficer2026!', full_name: 'Adewale Store Officer', role: 'store_officer' },
    { email: 'production@uibakery.edu.ng', password: 'Production2026!', full_name: 'Chioma Production Sup.', role: 'production_supervisor' },
    { email: 'sales@uibakery.edu.ng', password: 'SalesOfficer2026!', full_name: 'Babatunde Sales Officer', role: 'sales_officer' },
  ];

  for (const staff of staffAccounts) {
    const { data: existingUsers } = await service.auth.admin.listUsers();
    let authUser = existingUsers?.users?.find(u => u.email === staff.email);
    if (!authUser) {
      const { data: createdUser, error: authError } = await service.auth.admin.createUser({
        email: staff.email,
        password: staff.password,
        email_confirm: true,
        user_metadata: { full_name: staff.full_name },
      });
      if (authError) {
        console.log(`Notice for ${staff.email}:`, authError.message);
      } else {
        authUser = createdUser.user;
        console.log(`+ Created Auth User: ${staff.email}`);
      }
    }
    if (authUser) {
      const { data: profile } = await service.from('profiles').select('*').eq('id', authUser.id).maybeSingle();
      if (!profile) {
        await service.from('profiles').insert({
          id: authUser.id,
          full_name: staff.full_name,
          role: staff.role,
          active: true,
        });
        console.log(`+ Created Profile for: ${staff.full_name} (${staff.role})`);
      } else {
        console.log(`= Existing Profile: ${profile.full_name} (${profile.role})`);
      }
    }
  }

  // 5. Initial Material Receipts (if balances are 0)
  const flour = materialMap.get('Flour');
  if (flour && Number(flour.quantity_on_hand) === 0) {
    console.log('Recording initial material stock deliveries...');
    const deliveries = [
      { name: 'Flour', qty: 100, note: 'Supplier Delivery - Golden Penny Flour Mills' },
      { name: 'Granulated Sugar', qty: 200, note: 'Dangote Sugar Delivery' },
      { name: 'Instant Yeast', qty: 40, note: 'Saf-Instant Yeast batch delivery' },
      { name: 'Baking Margarine', qty: 100, note: 'Simas Margarine 20kg tubs' },
      { name: 'Fine Salt', qty: 50, note: 'Annapurna Iodized Salt' },
      { name: 'Packaging Nylon', qty: 100, note: 'UI Bakery branded printed nylons' },
    ];
    for (const d of deliveries) {
      const mat = materialMap.get(d.name);
      if (mat) {
        const { error } = await service.rpc('record_receipt', {
          _material_id: mat.id,
          _quantity: d.qty,
          _note: d.note,
          _actor: admin.id,
        });
        if (error) console.error(`Failed receipt for ${d.name}:`, error.message);
        else console.log(`+ Stock receipt recorded: ${d.qty} ${mat.unit} of ${d.name}`);
      }
    }
  }

  // 6. Set initial opening stock for SKUs for today
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Lagos' }).format(new Date());
  for (const [name, sku] of skuMap.entries()) {
    const { data: existingBalance } = await service.from('inventory_balances').select('*').eq('sku_id', sku.id).eq('balance_date', today).maybeSingle();
    if (!existingBalance) {
      const opening = name.includes('Standard') ? 50 : name.includes('Family') ? 80 : 25;
      const { error } = await service.rpc('set_opening_stock', {
        _sku_id: sku.id,
        _date: today,
        _quantity: opening,
        _actor: admin.id,
      });
      if (error) console.error(`Failed opening stock for ${name}:`, error.message);
      else console.log(`+ Opening stock set for ${name}: ${opening} loaves`);
    }
  }

  console.log('--- UI Bakery seed completed successfully! ---');
}

seed().catch(console.error);

