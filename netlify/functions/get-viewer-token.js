const crypto = require('crypto');
const { getUserFromJwt, corsHeaders } = require('./_shared');

// Client portal calls this with the user's Supabase JWT (Authorization header).
// It verifies the user, checks the study belongs to their client (or admin),
// and returns a short-lived HMAC token that the OHIF viewer can present in the
// ?url= query string (OHIF fetches that URL without auth headers).
exports.handler = async (event) => {
  const headers = corsHeaders();
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  const secret = process.env.VIEWER_TOKEN_SECRET;
  if (!secret) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Server not configured' }) };
  }

  const jwt = (event.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const user = await getUserFromJwt(jwt);
  if (!user) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  const { getSupabaseAdmin } = require('./_shared');
  const admin = getSupabaseAdmin();

  let body = {};
  try { body = JSON.parse(event.body || '{}') || {}; } catch {}
  const studyUid =
    (event.queryStringParameters || {}).study ||
    body.study;

  if (!studyUid) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing study' }) };
  }

  // Resolve the study + the caller's client_id
  const appMeta = (user.app_metadata || {});
  const isAdmin = appMeta.role === 'admin';
  const clientId = appMeta.client_id || null;

  const { data: study, error: studyErr } = await admin
    .from('studies')
    .select('client_id, study_uid')
    .eq('study_uid', studyUid)
    .maybeSingle();

  if (studyErr || !study) {
    return { statusCode: 404, headers, body: JSON.stringify({ error: 'Study not found' }) };
  }

  // Admin can view any study; a client may only view their own client's studies
  if (!isAdmin && study.client_id !== clientId) {
    return { statusCode: 403, headers, body: JSON.stringify({ error: 'Forbidden' }) };
  }

  // Short-lived token (5 minutes) carrying studyUid + clientId, HMAC-signed.
  // DICOM UIDs contain dots, so the UID is base64url-encoded (dot-safe) inside
  // the token; the sig covers the encoded segment so study-json can verify it.
  const exp = Math.floor(Date.now() / 1000) + 300;
  const uidB64 = Buffer.from(studyUid).toString('base64url');
  const payload = `${exp}.${uidB64}`;
  const sig = crypto.createHmac('sha256', secret).update(payload).digest('base64url');

  return {
    statusCode: 200,
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: `${exp}.${uidB64}.${sig}` }),
  };
};