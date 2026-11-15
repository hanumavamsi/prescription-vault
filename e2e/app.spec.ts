import { expect, test, type Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

const MAILPIT = process.env.E2E_MAILPIT_URL!;

// Smallest valid one-page PDF.
const PDF = Buffer.from(
  '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj ' +
    '3 0 obj<</Type/Page/MediaBox[0 0 200 200]/Parent 2 0 R>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF',
);

/** Latest sign-in code emailed to `email`, polled from Mailpit. */
async function emailedCode(email: string): Promise<string> {
  for (let i = 0; i < 30; i++) {
    const res = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}&limit=1`);
    const { messages } = (await res.json()) as { messages: { ID: string }[] };
    if (messages?.length) {
      const msg = (await (await fetch(`${MAILPIT}/api/v1/message/${messages[0].ID}`)).json()) as { Text: string; HTML: string };
      const code = (msg.Text || msg.HTML).match(/\b(\d{6})\b/)?.[1];
      if (code) return code;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`No sign-in email for ${email}`);
}

async function signIn(page: Page, email: string) {
  await page.goto('/');
  await page.getByRole('checkbox', { name: /I agree to the Terms/ }).click();
  const useEmail = page.getByRole('button', { name: 'Use email instead' });
  if (await useEmail.isVisible()) await useEmail.click();
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByRole('button', { name: 'Email me a sign-in code' }).click();
  // A complete code signs in by itself (like iOS autofill).
  await page.getByLabel('6-digit code').fill(await emailedCode(email));
  await expect(page.getByRole('button', { name: 'Add my document' })).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  page.on('dialog', (d) => d.accept()); // window.confirm on web
});

test('signed-out visitors only see sign-in', async ({ page }) => {
  await page.goto('/settings');
  await expect(page.getByRole('button', { name: 'Email me a sign-in code' }).or(page.getByRole('button', { name: 'Use email instead' }))).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add my document' })).toHaveCount(0);
});

test('sign in, add a document, find it, manage a family member, delete the account', async ({ page }, info) => {
  const email = `e2e-${info.project.name}-${Date.now()}@test.dev`;
  await signIn(page, email);

  // Add a PDF document.
  await page.getByRole('button', { name: 'Add my document' }).click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByText('Import PDF').click();
  await (await chooser).setFiles({ name: 'cbc.pdf', mimeType: 'application/pdf', buffer: PDF });
  await page.getByRole('tab', { name: 'Report' }).click();
  await page.getByLabel('Title').fill('CBC blood test');
  await page.getByRole('button', { name: 'Save', exact: true }).last().click();

  // It shows up in my records and search finds it by type and title words.
  await expect(page.getByText('CBC blood test')).toBeVisible();
  const search = page.getByPlaceholder('Search doctor, specialty, hospital…');
  await search.fill('report cbc');
  await expect(page.getByText('CBC blood test')).toBeVisible();
  await search.fill('cardiology');
  await expect(page.getByText('No matches')).toBeVisible();

  // Open it: the page viewer loads the uploaded file.
  await search.fill('');
  await page.getByText('CBC blood test').click();
  await expect(page).toHaveURL(/\/document\//);
  await page.goBack();

  // Add a family member I manage.
  await page.goto('/add-person');
  await page.getByRole('button', { name: 'Add someone you manage' }).click();
  await page.getByLabel('Name', { exact: true }).fill('Grandpa Test');
  await page.getByRole('button', { name: 'Create' }).last().click();
  await expect(page.getByText('Grandpa Test').first()).toBeVisible();

  // Delete the account: back to sign-in, and the same email starts fresh.
  await page.goto('/settings');
  await page.getByText('Delete account', { exact: true }).last().click();
  await page.getByLabel('Type DELETE to confirm').fill('DELETE');
  await page.getByRole('button', { name: 'Delete my account' }).click();
  await expect(page.getByRole('checkbox', { name: /I agree to the Terms/ })).toBeVisible();

  const admin = createClient(process.env.E2E_SUPABASE_URL!, process.env.E2E_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  const { data } = await admin.auth.admin.listUsers({ perPage: 1000 });
  expect(data.users.map((u) => u.email)).not.toContain(email);
});

test('over the signup cap: waitlist screen, no app, can delete the account', async ({ page }, info) => {
  const admin = createClient(process.env.E2E_SUPABASE_URL!, process.env.E2E_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  const { data: before, error } = await admin.from('signup_limits').select('direct_cap').single();
  if (error) throw error;
  await admin.from('signup_limits').update({ direct_cap: 0 }).eq('id', true);
  try {
    const email = `e2e-wait-${info.project.name}-${Date.now()}@test.dev`;
    await page.goto('/');
    await page.getByRole('checkbox', { name: /I agree to the Terms/ }).click();
    const useEmail = page.getByRole('button', { name: 'Use email instead' });
    if (await useEmail.isVisible()) await useEmail.click();
    await page.getByLabel('Email', { exact: true }).fill(email);
    await page.getByRole('button', { name: 'Email me a sign-in code' }).click();
    await page.getByLabel('6-digit code').fill(await emailedCode(email));

    await expect(page.getByText("You're on the waitlist")).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add my document' })).toHaveCount(0);

    await page.getByRole('button', { name: 'Delete my account' }).click();
    await expect(page.getByRole('checkbox', { name: /I agree to the Terms/ })).toBeVisible();
    const { data } = await admin.auth.admin.listUsers({ perPage: 1000 });
    expect(data.users.map((u) => u.email)).not.toContain(email);
  } finally {
    await admin.from('signup_limits').update({ direct_cap: before.direct_cap }).eq('id', true);
  }
});

test('cloud full: save on this device, download a copy, still listed after reload', async ({ page }, info) => {
  const admin = createClient(process.env.E2E_SUPABASE_URL!, process.env.E2E_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  const shot = (n: string) => page.screenshot({ path: `e2e-screenshots/${info.project.name}-${n}.png` });
  // Headless browsers differ on navigator.share; force the download path so the copy can be checked.
  await page.addInitScript(() => Object.defineProperty(navigator, 'share', { value: undefined }));

  const email = `e2e-local-${info.project.name}-${Date.now()}@test.dev`;
  await signIn(page, email);
  const { error } = await admin.from('signup_limits').update({ storage_quota_bytes: 0 }).eq('id', true);
  if (error) throw error;
  try {
    await page.reload();
    await expect(page.getByLabel(/Cloud storage: 0 KB of 0 KB used/)).toBeVisible();
    await shot('1-home-cloud-full');

    await page.getByRole('button', { name: 'Add my document' }).click();
    const chooser = page.waitForEvent('filechooser');
    await page.getByText('Import PDF').click();
    await (await chooser).setFiles({ name: 'lab.pdf', mimeType: 'application/pdf', buffer: PDF });
    await page.getByRole('tab', { name: 'Report' }).click();
    await page.getByLabel('Title').fill('Lab report');
    await page.getByRole('button', { name: 'Save', exact: true }).last().click();

    await expect(page.getByText('Cloud storage full')).toBeVisible();
    await shot('2-cloud-full-dialog');
    await page.getByRole('button', { name: 'Save on this device' }).click();

    await expect(page.getByText('Saved on this device')).toBeVisible();
    await shot('3-saved-offer-download');
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download a copy' }).click();
    expect((await download).suggestedFilename()).toMatch(/^Lab[ _]report[ _]\d{4}-\d{2}-\d{2}\.pdf$/); // WebKit swaps spaces for _

    const row = page.getByText(/On this device · /);
    await expect(page.getByText('Lab report')).toBeVisible();
    await expect(row).toBeVisible();
    await shot('4-home-on-this-device');

    // Survives a reload (IndexedDB), and opens from the device.
    await page.reload();
    await expect(row).toBeVisible();
    await page.getByText('Lab report').click();
    await expect(page).toHaveURL(/\/document\/local-/);
    await expect(page.getByText(/couldn.t|not saved|missing/i)).toHaveCount(0);
    await shot('5-viewer-from-device');

    // Nothing went to the cloud.
    const { data: docs } = await admin.from('documents').select('id').eq('title', 'Lab report');
    expect(docs).toEqual([]);
  } finally {
    await admin.from('signup_limits').update({ storage_quota_bytes: 104857600 }).eq('id', true);
  }
});
