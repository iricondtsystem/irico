const { getSupabaseAdmin, getUserFromJwt, corsHeaders } = require('./_shared');

// Admin upload flow:
//   1. Browser uploads each raw .dcm directly to Supabase storage
//      (path: <client_id>/studies/<study_uid>/<sop_uid>.dcm) using the admin's
//      own JWT + the irico_admin_insert RLS policy (no Netlify 6MB limit).
//   2. Browser parses DICOM headers with dcmjs and POSTs the OHIF dicomjson
//      metadata (no per-instance urls) here to upsert the studies row.
exports.handler = async (event) => {
  const headers = corsHeaders();
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const jwt = (event.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const user = await getUserFromJwt(jwt);
  if (!user) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) };
  }
  if ((user.app_metadata || {}).role !== 'admin') {
    return { statusCode: 403, headers, body: JSON.stringify({ error: 'Admin only' }) };
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Bad JSON' }) };
  }

  const { clientId, studyUid, metadata } = body;
  if (!clientId || !studyUid || !metadata?.studies?.length) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing clientId/studyUid/metadata' }) };
  }

  const study = metadata.studies[0];
  const numInstances = (study.series || []).reduce(
    (acc, s) => acc + (s.instances?.length || 0),
    0
  );

  const admin = getSupabaseAdmin();
  const row = {
    client_id: clientId,
    study_uid: studyUid,
    patient_name: study.PatientName || null,
    patient_id: study.PatientID || null,
    study_date: study.StudyDate || null,
    study_time: study.StudyTime || null,
    study_description: study.StudyDescription || null,
    modality: Array.isArray(study.Modalities) ? study.Modalities.join(' / ') : (study.Modalities || null),
    num_instances: numInstances,
    metadata: metadata,
  };

  const { error } = await admin
    .from('studies')
    .upsert(row, { onConflict: 'client_id,study_uid' });

  if (error) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: error.message }) };
  }

  return {
    statusCode: 200,
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ok: true, num_instances: numInstances }),
  };
};