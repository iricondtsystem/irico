// IRICO DICOM portal - client-side config (REAL).
// Supabase URL + anon key are public/publishable (safe in the browser).
// The service_role key lives only in Netlify env vars, never here.
window.PORTAL_CONFIG = {
  SUPABASE_URL: 'https://umiuiqvvnzikjpjntntt.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_QozEGwOQZ67Xqz5Dcv0NOw_ylblgr3F',
  VIEWER_BASE: '/dicom-viewer',
  TOKEN_URL: '/.netlify/functions/get-viewer-token',
};