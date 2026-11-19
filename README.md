# UI Bakery Inventory

A standalone inventory and production tracking web app based on the Group A29 project report. The interface uses HTML, Bootstrap 5 and browser JavaScript; the application server uses Node.js and Express; Supabase provides authentication and a PostgreSQL database.

## Features

- Public landing page and staff sign-in
- Separate Store Officer, Production Supervisor, Sales Officer and Administrator access
- Raw material receipts, multi-item issues, reorder thresholds and movement history
- SKU yield configuration, production batches and stage-specific damage records
- Dispatch and return tracking by sales representative
- Daily opening stock, close-of-day reconciliation and rollover
- Reports, CSV export and critical-action audit log
- Server-verified Supabase access tokens and server-only service-role access

## Run locally

1. Create a Supabase project and open its SQL Editor.
2. Run `database/schema.sql` once.
3. In Supabase Authentication, create an initial staff account. Copy its user UUID from the Users page.
4. In the SQL Editor, assign that account as the first administrator:

   ```sql
   insert into public.profiles (id, full_name, role)
   values ('AUTH-USER-UUID', 'Bakery Administrator', 'admin');
   ```

5. Copy `.env.example` to `.env` and fill in the project URL, anon key and service-role key from Supabase project settings. Keep the service-role key on the server; do not put it in browser code or commit `.env`.
6. Install dependencies and start the app:

   ```bash
   npm install
   npm run dev
   ```

7. Open `http://localhost:3001`. Sign in with the initial Supabase Auth account.

The landing page is public. All inventory endpoints require a valid Supabase access token and an active profile. Express checks the profile role on each request; browser-side navigation is only a convenience. The Supabase tables are not exposed to `anon` or `authenticated` clients. Data mutations that span multiple records run through PostgreSQL functions so a failed stock update rolls back as one transaction.

## First-day setup

Add materials and SKUs from the Administrator area. Set an opening quantity for each finished SKU before recording the first day's sales. Create materials using the unit `bag` for flour so production batches can verify that the linked store issue includes enough flour. Store issues require the approved requisition reference. Configure standard yield per bag from the bakery's recipe; the example yields in the report are illustrative only.

At batch entry, `Actual output` is the counted number of loaves before recorded stage damage. Net production is actual output minus stage damage. The daily closing formula is:

`closing = opening + actual output - stage damage - (dispatched - returned)`

An administrator closes a date after staff finish entering that day's work. Closed dates reject further production, damage, dispatch and return entries.

## Deployment notes

Deploy the Express server on a machine reachable from the bakery's local network to keep the workflow available during internet outages only if the Supabase project itself is reachable from that network. For a fully offline deployment, a local PostgreSQL/Supabase-compatible service and a later synchronization plan would be needed. Configure regular Supabase backups and use HTTPS when staff access the app across an untrusted network.
