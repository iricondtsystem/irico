const crypto = require('crypto');
const { getSupabaseAdmin, corsHeaders } = require('./_shared');

// OHIF dicomjson data source calls this URL (via ?url=) WITHOUT auth headers.
// We validate a short-lived HMAC token issued by get-viewer-token, load the
// stored study metadata, and return OHIF's dicomjson shape where each instance
// url is a freshly-signed Supabase storage URL for the raw DICOM file.
//
// Storage layout:  <client_id>/studies/<study_uid>/<sop_uid>.dcm
// We sign each instance URL with a short expiry (10 min) so the study stays
// viewable for the session but URLs cannot be shared indefinitely.
exports.handler = async (event) => {
  const headers = corsHeaders();
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  const secret = process.env.VIEWER_TOKEN_SECRET;
  const urlRoot = process.env.SUPABASE_URL;
  if (!secret || !urlRoot) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Server not configured' }) };
  }

  const token = (event.queryStringParameters || {}).token;
  if (!token) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'Missing token' }) };
  }

  // token format: <exp>.<base64url(studyUid)>.<sig>
  const parts = token.split('.');
  if (parts.length !== 3) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'Invalid token' }) };
  }
  const [exp, uidB64, sig] = parts;
  const now = Math.floor(Date.now() / 1000);
  if (Number(exp) < now) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'Token expired' }) };
  }

  const expected = crypto
    .createHmac('sha256', secret)
    .update(`${exp}.${uidB64}`)
    .digest('base64url');
  if (!crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig))) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'Invalid signature' }) };
  }

  const studyUid = Buffer.from(uidB64, 'base64url').toString('utf-8');

  const admin = getSupabaseAdmin();

  // Load the stored study metadata (OHIF studies array, without per-instance URLs)
  const { data: studyRow, error: studyErr } = await admin
    .from('studies')
    .select('client_id, metadata')
    .eq('study_uid', studyUid)
    .maybeSingle();

  if (studyErr || !studyRow) {
    return { statusCode: 404, headers, body: JSON.stringify({ error: 'Study not found' }) };
  }

  const clientId = studyRow.client_id;
  const metadata = studyRow.metadata || {};

  // Build fresh signed URLs for every instance and rewrite the studies JSON.
  const bucket = 'irico-dicom';
  const signedFor = async (path, ttlSeconds = 600) => {
    const { data, error } = await admin.storage
      .from(bucket)
      .createSignedUrl(`${clientId}/studies/${studyUid}/${path}`, ttlSeconds);
    if (error || !data?.signedUrl) return null;
    return data.signedUrl;
  };

  const studies = await Promise.all(
    (metadata.studies || []).map(async (study) => {
      const series = await Promise.all(
        (study.series || []).map(async (ser) => {
          const instances = await Promise.all(
            (ser.instances || []).map(async (inst) => {
              const sopUid = inst.metadata?.SOPInstanceUID || inst.sopInstanceUid || inst.url;
              const fileName = inst.storageKey || `${sopUid}.dcm`;
              const signed = await signedFor(fileName);
              return { ...inst, url: signed ? `wadouri:${signed}` : null };
            })
          );
          return { ...ser, instances };
        })
      );
      return { ...study, series };
    })
  );

  return {
    statusCode: 200,
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ studies }),
  };
};