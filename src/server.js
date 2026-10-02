import 'dotenv/config';
import crypto from 'node:crypto';
import express from 'express';
import pg from 'pg';

const app = express();
app.use(express.json({ limit: '32kb' }));
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false });
const domain = (process.env.ALLOWED_EMAIL_DOMAIN || 'rgipt.ac.in').toLowerCase();
const clientId = process.env.GOOGLE_CLIENT_ID;
const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
const androidRedirect = process.env.ANDROID_REDIRECT_URI || 'snaproll://oauth/callback';
const googleRedirect = process.env.GOOGLE_REDIRECT_URI;
const ttlDays = Number(process.env.SESSION_TTL_DAYS || 7);

const random = (n = 32) => crypto.randomBytes(n).toString('base64url');
const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');
const safeEqual = (a, b) => a?.length === b?.length && crypto.timingSafeEqual(Buffer.from(a || ''), Buffer.from(b || ''));
const jsonError = (res, status, error) => res.status(status).json({ error });

app.get('/healthz', async (_req, res) => {
  try { await pool.query('SELECT 1'); res.json({ ok: true }); }
  catch { res.status(503).json({ ok: false }); }
});

app.get('/auth/google/start', async (req, res) => {
  const { state, code_challenge: challenge, code_challenge_method: method } = req.query;
  if (!state || !challenge || method !== 'S256' || String(state).length > 200) return jsonError(res, 400, 'Invalid OAuth request');
  await pool.query('INSERT INTO oauth_transactions(state, code_challenge, expires_at) VALUES($1,$2,now()+interval \'10 minutes\') ON CONFLICT(state) DO UPDATE SET code_challenge=EXCLUDED.code_challenge, expires_at=EXCLUDED.expires_at', [state, challenge]);
  const params = new URLSearchParams({ client_id: clientId, redirect_uri: googleRedirect, response_type: 'code', scope: 'openid email profile', access_type: 'offline', prompt: 'select_account', state });
  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
});

app.get('/auth/google/callback', async (req, res) => {
  try {
    const { code, state, error } = req.query;
    if (error) return res.redirect(`${androidRedirect}?error=${encodeURIComponent(error)}&state=${encodeURIComponent(state || '')}`);
    const tx = (await pool.query('DELETE FROM oauth_transactions WHERE state=$1 AND expires_at>now() RETURNING code_challenge', [state])).rows[0];
    if (!tx || !code) return jsonError(res, 400, 'OAuth transaction expired or invalid');
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: googleRedirect, grant_type: 'authorization_code' }) });
    if (!tokenResponse.ok) return jsonError(res, 401, 'Google token exchange failed');
    const tokens = await tokenResponse.json();
    const profileResponse = await fetch('https://openidconnect.googleapis.com/v1/userinfo', { headers: { authorization: `Bearer ${tokens.access_token}` } });
    const profile = await profileResponse.json();
    const email = String(profile.email || '').trim().toLowerCase();
    if (!profile.email_verified || !email.endsWith(`@${domain}`) || email === domain) return res.redirect(`${androidRedirect}?error=domain_not_allowed&state=${encodeURIComponent(state)}`);
    const user = (await pool.query(`INSERT INTO users(email, display_name, google_subject) VALUES($1,$2,$3) ON CONFLICT(email) DO UPDATE SET display_name=EXCLUDED.display_name, google_subject=EXCLUDED.google_subject, last_login_at=now() RETURNING id,email,display_name,role`, [email, profile.name || email.split('@')[0], profile.sub])).rows[0];
    const oneTimeCode = random(32);
    await pool.query('INSERT INTO oauth_codes(code_hash,user_id,code_challenge,expires_at) VALUES($1,$2,$3,now()+interval \'2 minutes\')', [hash(oneTimeCode), user.id, tx.code_challenge]);
    res.redirect(`${androidRedirect}?code=${encodeURIComponent(oneTimeCode)}&state=${encodeURIComponent(state)}`);
  } catch (error) { console.error('oauth callback failed', error); jsonError(res, 500, 'OAuth login failed'); }
});

app.post('/auth/google/exchange', async (req, res) => {
  const { code, code_verifier: verifier } = req.body || {};
  if (!code || !verifier) return jsonError(res, 400, 'Missing authorization code');
  const record = (await pool.query('SELECT c.*,u.email,u.role FROM oauth_codes c JOIN users u ON u.id=c.user_id WHERE c.code_hash=$1 AND c.expires_at>now() AND c.consumed_at IS NULL', [hash(code)])).rows[0];
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  if (!record || !safeEqual(challenge, record.code_challenge)) return jsonError(res, 401, 'Invalid or expired authorization code');
  await pool.query('UPDATE oauth_codes SET consumed_at=now() WHERE code_hash=$1', [hash(code)]);
  const token = random(48);
  await pool.query('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+($3 || \' days\')::interval)', [hash(token), record.user_id, ttlDays]);
  res.json({ access_token: token, token_type: 'Bearer', expires_in: ttlDays * 86400, email: record.email, role: record.role });
});

async function authenticated(req, res, next) {
  const token = req.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) return jsonError(res, 401, 'Authentication required');
  const row = (await pool.query('SELECT u.id,u.email,u.display_name,u.role FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now()', [hash(token)])).rows[0];
  if (!row) return jsonError(res, 401, 'Session expired');
  req.user = row; next();
}
app.get('/v1/auth/me', authenticated, (req, res) => res.json({ user: req.user }));
app.post('/v1/auth/logout', authenticated, async (req, res) => { const token = req.get('authorization').replace(/^Bearer\s+/i, ''); await pool.query('DELETE FROM sessions WHERE token_hash=$1', [hash(token)]); res.status(204).end(); });

app.use((_req, res) => jsonError(res, 404, 'Not found'));
const host = process.env.HOST || '127.0.0.1';
const port = Number(process.env.PORT || 8443);
app.listen(port, host, () => console.log(`SnapRoll API listening on ${host}:${port}`));
